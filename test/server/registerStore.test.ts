// The register read-through cache and the version counters.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeRegister, payloadBytes, REGISTER_INLINE_MAX_BYTES } from "../../src/domain/payload";
import * as access from "../../src/server/access";
import * as api from "../../src/server/api";
import { getRegisterPayload, registerEntry, reloadRegister, UNREACHABLE } from "../../src/server/registerStore";
import { cfgGen, dataVersion } from "../../src/server/serverCache";
import { recentErrors } from "../../src/server/errors";
import { genWorkbook } from "../../dev/genTabs.mjs";
import { useGasEnv } from "../gasEnv";

const fakes = useGasEnv({ workbook: true, seed: true });
const as = (who: string) => { access.__resetMemosForTest(); fakes().setActiveUser(who); };
const wb = genWorkbook();

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("getRegister", () => {
  it("returns the whole register, decodable, with source facts cached beside it", () => {
    as("viewer@example.com");
    const res = api.getRegister();
    expect(res.ok).toBe(true);
    const apps = decodeRegister(res.data!);
    expect(apps.length).toBe(wb.tabs[0]!.rows.length - 1);
    expect(apps[0]!.id).toBeTruthy();
    const meta = registerEntry().meta;
    expect(meta.tz).toBe(wb.tz);
    expect(meta.tabs.map((t) => t.key)).toEqual(["apps", "ciat", "aud", "drp", "plat"]);
    expect(meta.tabs[0]).toMatchObject({ name: "Apps", rows: apps.length, gid: 0 });
    expect(JSON.stringify(res.data)).not.toMatch(/@example\.com/);
  });

  it("stays under the inline limit for the sample data", () => {
    expect(payloadBytes(getRegisterPayload())).toBeLessThan(REGISTER_INLINE_MAX_BYTES);
  });

  it("a second call within the TTL makes no SpreadsheetApp calls", () => {
    as("viewer@example.com");
    const open = vi.spyOn(SpreadsheetApp, "openById");
    api.getRegister();
    expect(open).toHaveBeenCalledTimes(1);
    const reads = fakes().counters().sheetRead;
    api.getRegister();
    api.getRegister();
    expect(open).toHaveBeenCalledTimes(1);
    expect(fakes().counters().sheetRead).toBe(reads);
  });

  it("reads again after cacheMinutes", () => {
    const open = vi.spyOn(SpreadsheetApp, "openById");
    getRegisterPayload();
    fakes().advance(9 * 60 * 1000);
    getRegisterPayload();
    expect(open).toHaveBeenCalledTimes(1);
    fakes().advance(2 * 60 * 1000);
    getRegisterPayload();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("gives an empty register, not an error, when no source is configured", () => {
    PropertiesService.getScriptProperties().deleteProperty("CFG_SOURCE");
    const open = vi.spyOn(SpreadsheetApp, "openById");
    expect(decodeRegister(getRegisterPayload())).toEqual([]);
    expect(open).not.toHaveBeenCalled();
    expect(registerEntry().meta.tabs).toEqual([]);
  });

  it("says 'Data source unreachable' and logs the cause when the Sheet cannot be opened", () => {
    as("viewer@example.com");
    fakes().setSourceAccess(false);
    const res = api.getRegister();
    expect(res).toMatchObject({ ok: false, error: UNREACHABLE, errorKind: "error" });
    const log = recentErrors();
    expect(log.length).toBe(1);
    expect(log[0]!.message).toMatch(/could not be opened/);
    // A failure is not cached: the next call recovers.
    fakes().setSourceAccess(true);
    expect(api.getRegister().ok).toBe(true);
  });
});

describe("version counters", () => {
  const rulesPatch = { rules: { rules: { "co.review": { months: 7 } } } };

  it("reloadData bumps DATA_VERSION, re-reads the Sheet and serves the next call from the cache", () => {
    as("admin@example.com");
    getRegisterPayload();
    const before = { d: dataVersion(), c: cfgGen() };
    const open = vi.spyOn(SpreadsheetApp, "openById");
    const res = api.reloadData();
    expect(res.ok).toBe(true);
    expect(dataVersion()).toBe(before.d + 1);
    expect(res.data!.dataVersion).toBe(before.d + 1);
    expect(open).toHaveBeenCalledTimes(1);
    api.getRegister();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("a fields save bumps DATA_VERSION and CFG_GEN", () => {
    as("admin@example.com");
    getRegisterPayload();
    const d = dataVersion();
    const g = cfgGen();
    const res = api.saveSettings({ patch: { fields: { subdomain: { header: "Domain" } } }, baseGen: g });
    expect(res.ok).toBe(true);
    expect(dataVersion()).toBe(d + 1);
    expect(cfgGen()).toBe(g + 1);
  });

  it("a source save bumps DATA_VERSION too", () => {
    as("admin@example.com");
    const d = dataVersion();
    expect(api.saveSettings({ patch: { source: { cacheMinutes: 30 } }, baseGen: cfgGen() }).ok).toBe(true);
    expect(dataVersion()).toBe(d + 1);
  });

  it("a rules save bumps only CFG_GEN, and the register stays cached", () => {
    as("admin@example.com");
    getRegisterPayload();
    const d = dataVersion();
    const g = cfgGen();
    const open = vi.spyOn(SpreadsheetApp, "openById");
    expect(api.saveSettings({ patch: rulesPatch, baseGen: g }).ok).toBe(true);
    expect(dataVersion()).toBe(d);
    expect(cfgGen()).toBe(g + 1);
    api.getRegister();
    expect(open).not.toHaveBeenCalled();
  });

  it("a display save bumps only CFG_GEN", () => {
    as("admin@example.com");
    const d = dataVersion();
    expect(api.saveSettings({ patch: { display: { theme: "dark" } }, baseGen: cfgGen() }).ok).toBe(true);
    expect(dataVersion()).toBe(d);
  });

  it("reloadRegister is refused while another save holds the lock (busy)", () => {
    as("admin@example.com");
    fakes().holdLock(true);
    expect(() => reloadRegister()).toThrow(/Try again/);
    expect(api.reloadData()).toMatchObject({ ok: false, errorKind: "busy" });
  });
});
