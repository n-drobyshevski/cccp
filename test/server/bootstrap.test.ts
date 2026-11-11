// The bootstrap split: a viewer-free core in the cache, the viewer in the live part, the
// register inlined only when warm and small.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { genWorkbook } from "../../dev/genTabs.mjs";
import * as access from "../../src/server/access";
import * as api from "../../src/server/api";
import { cacheGetJson, cacheKey, cachePutJson } from "../../src/server/serverCache";
import { decodeRegister, REGISTER_INLINE_MAX_BYTES } from "../../src/domain/payload";
import { useGasEnv } from "../gasEnv";

const fakes = useGasEnv({ workbook: true, seed: true });
const as = (who: string) => { access.__resetMemosForTest(); fakes().setActiveUser(who); };
const EMAILS = ["owner@example.com", "admin@example.com", "viewer@example.com"];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

// The allowlist of the cached core: every key that may appear, by path. Nothing else may.
const CORE_KEYS = ["schemaVersion", "sourceMeta", "publicSettings", "sharedViews"];
const SOURCE_META_KEYS = ["title", "url", "tz", "loadedAt", "dataVersion", "tabs", "issues"];
const TAB_KEYS = ["key", "name", "gid", "rows", "missingHeaders", "unmatched"];
const PUBLIC_KEYS = ["rules", "display", "fieldLabels", "mapped"];
const LIVE_KEYS = ["viewer", "serviceUrl", "buildId", "today", "cfgGen"];
const VIEWER_KEYS = ["email", "role", "canEditSettings", "canEditAdmins", "canEditSource", "canEditMode"];
const ISSUE_KEYS = ["missingHeaders", "missingTabs", "unmatched", "duplicateIds", "unparseable", "unmapped"];

describe("bootstrap", () => {
  it("keeps the core within the allowlist and the viewer in the live part", () => {
    as("admin@example.com");
    const res = api.bootstrap();
    expect(res.ok).toBe(true);
    const { core, live } = res.data!;
    expect(Object.keys(core).sort()).toEqual([...CORE_KEYS].sort());
    expect(Object.keys(core.sourceMeta).sort()).toEqual([...SOURCE_META_KEYS].sort());
    for (const t of core.sourceMeta.tabs) expect(Object.keys(t).sort()).toEqual([...TAB_KEYS].sort());
    expect(Object.keys(core.publicSettings).sort()).toEqual([...PUBLIC_KEYS].sort());
    expect(Object.keys(core.sourceMeta.issues).sort()).toEqual([...ISSUE_KEYS].sort());
    expect(Object.keys(live).sort()).toEqual([...LIVE_KEYS].sort());
    expect(Object.keys(live.viewer).sort()).toEqual([...VIEWER_KEYS].sort());
    expect(live).toMatchObject({
      viewer: { email: "admin@example.com", role: "admin", canEditSettings: true, canEditAdmins: false, canEditSource: false, canEditMode: false },
      cfgGen: 0,
    });
    expect(live.serviceUrl).toMatch(/\/exec$/);
    expect(live.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(live.buildId).toBeTruthy();
    expect(JSON.stringify(core)).not.toMatch(/serviceUrl|viewer|role|"today"|buildId/);
  });

  it("gives two viewers an identical core and different flags", () => {
    as("viewer@example.com");
    const a = api.bootstrap().data!;
    as("owner@example.com");
    const b = api.bootstrap().data!;
    expect(JSON.stringify(a.core)).toBe(JSON.stringify(b.core));
    expect(a.live.viewer).toMatchObject({ email: "viewer@example.com", role: "viewer", canEditSettings: false, canEditSource: false });
    expect(b.live.viewer).toMatchObject({ email: "owner@example.com", role: "owner", canEditSettings: true, canEditAdmins: true, canEditSource: true, canEditMode: true });
  });

  it("puts no email anywhere in the cache", () => {
    as("admin@example.com");
    expect(api.saveSharedView({ view: { name: "Tier 1", scope: "shared", route: "list", state: { q: "", f: { tier: ["1"] }, sort: "-t", cols: ["n", "d"], metric: "worst" } } }).ok).toBe(true);
    for (const who of EMAILS) { as(who); api.bootstrap(); api.getRegister(); }
    as("viewer@example.com");
    expect(api.bootstrap().data!.core.sharedViews).toHaveLength(1);
    const stored = [cacheGetJson(cacheKey("core", undefined, "cfg")), cacheGetJson(cacheKey("register", undefined))];
    expect(stored[0]).toBeDefined();
    expect(stored[1]).toBeDefined();
    for (const v of stored) expect(JSON.stringify(v)).not.toMatch(/@/);
    // And not in a key.
    const keys: string[] = [cacheKey("core", undefined, "cfg"), cacheKey("register", undefined)];
    for (const k of keys) for (const e of EMAILS) expect(k).not.toContain(e);
  });

  it("still answers when the configured Sheet cannot be opened", () => {
    as("owner@example.com");
    const cfg = JSON.parse(PropertiesService.getScriptProperties().getProperty("CFG_SOURCE")!);
    PropertiesService.getScriptProperties().setProperty("CFG_SOURCE", JSON.stringify({ ...cfg, sheetId: "no-such-sheet-id" }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(SpreadsheetApp, "openById").mockImplementation(() => { throw new Error("gone"); });
    const res = api.bootstrap();
    expect(res.ok).toBe(true);
    expect(res.data!.core.sourceMeta.tabs).toEqual([]);
    expect(res.data!.core.sourceMeta.title).toBe("");
    expect(res.data!.core.sourceMeta.issues.missingTabs.length).toBeGreaterThan(0);
    expect(res.data!.live.viewer.canEditSource).toBe(true);
  });

  it("recomputes the live part on every call but not the core", () => {
    as("viewer@example.com");
    const open = vi.spyOn(SpreadsheetApp, "openById");
    api.bootstrap();
    as("owner@example.com");
    const second = api.bootstrap();
    expect(open).toHaveBeenCalledTimes(1);
    expect(second.data!.live.viewer.role).toBe("owner");
  });

  it("inlines the register when it is warm and under 600 KB", () => {
    as("viewer@example.com");
    const res = api.bootstrap().data!;
    expect(res.register).toBeDefined();
    expect(decodeRegister(res.register!).length).toBe(genWorkbook().tabs[0]!.rows.length - 1);
    expect(JSON.stringify(res.register).length).toBeLessThan(REGISTER_INLINE_MAX_BYTES);
  });

  it("does not inline the register when it is cold, and does not read the Sheet to find out", () => {
    as("viewer@example.com");
    api.bootstrap();
    CacheService.getScriptCache().remove(cacheKey("register", undefined) + ":m");
    const open = vi.spyOn(SpreadsheetApp, "openById");
    const res = api.bootstrap().data!;
    expect(res.register).toBeUndefined();
    expect(open).not.toHaveBeenCalled();
  });

  it("does not inline a register above 600 KB", () => {
    as("viewer@example.com");
    api.bootstrap();
    // Push the register entry past the limit: same key, padded strings.
    const key = cacheKey("register", undefined);
    const entry = cacheGetJson(key) as { register: { strings: string[] } };
    entry.register.strings = entry.register.strings.concat(Array.from({ length: 700 }, (_, i) => String(i).padStart(10, "0").repeat(100)));
    CacheService.getScriptCache().remove(key + ":m");
    cachePutJson(key, entry, 600);
    expect(api.bootstrap().data!.register).toBeUndefined();
  });

  it("works with no source configured: an empty core, nothing mapped", () => {
    PropertiesService.getScriptProperties().deleteProperty("CFG_SOURCE");
    as("owner@example.com");
    const res = api.bootstrap().data!;
    expect(res.core.sourceMeta.tabs).toEqual([]);
    expect(Object.values(res.core.publicSettings.mapped).some(Boolean)).toBe(false);
    expect(decodeRegister(res.register!)).toEqual([]);
  });

  it("rebuilds the core after a rules save but not the register", () => {
    as("admin@example.com");
    api.bootstrap();
    api.saveSettings({ patch: { rules: { rules: { "co.review": { months: 6 } } } }, baseGen: 0 });
    const open = vi.spyOn(SpreadsheetApp, "openById");
    const res = api.bootstrap().data!;
    expect(res.core.publicSettings.rules.rules["co.review"]!.months).toBe(6);
    expect(res.live.cfgGen).toBe(1);
    expect(open).not.toHaveBeenCalled();
  });

  it("is refused for someone who is not allowed in", () => {
    as("stranger@elsewhere.org");
    expect(api.bootstrap()).toMatchObject({ ok: false, errorKind: "forbidden" });
  });
});
