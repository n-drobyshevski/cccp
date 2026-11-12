import { beforeEach, describe, expect, it, vi } from "vitest";
import * as access from "../../src/server/access";
import * as api from "../../src/server/api";
import { cfgGen, viewsGen } from "../../src/server/serverCache";
import { listSharedViews } from "../../src/server/sharedViews";
import { useGasEnv } from "../gasEnv";

const fakes = useGasEnv({ workbook: true, seed: true });
const as = (who: string) => { access.__resetMemosForTest(); fakes().setActiveUser(who); };
const prop = (k: string) => PropertiesService.getScriptProperties().getProperty(k);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const view = (name: string, extra: Record<string, unknown> = {}) => ({
  name, scope: "shared", route: "list",
  state: { q: "", f: { tier: ["1"] }, sort: "-t", cols: ["n", "d"], metric: "worst" }, ...extra,
});

describe("saveSharedView", () => {
  it("stores the view as shared with a 10-character id and the date, and no author, and bumps CFG_GEN", () => {
    as("admin@example.com");
    const res = api.saveSharedView({ view: view("Tier 1", { scope: "personal", by: "someone@else", id: "x" }) });
    expect(res.ok).toBe(true);
    const [v] = res.data!.views;
    expect(v).toMatchObject({ name: "Tier 1", scope: "shared", route: "list" });
    expect(JSON.stringify(res.data!.views)).not.toContain("@");
    expect(v).not.toHaveProperty("by");
    expect(v!.id).toMatch(/^[0-9a-f]{10}$/);
    expect(v!.at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.data!.id).toBe(v!.id);
    expect(listSharedViews()).toEqual(res.data!.views);
    // The views have their own generation: the settings save base (CFG_GEN) does not move.
    expect(viewsGen()).toBe(1);
    expect(cfgGen()).toBe(0);
  });

  it("replaces a view with the same id instead of adding one", () => {
    as("admin@example.com");
    const id = api.saveSharedView({ view: view("A") }).data!.id;
    const res = api.saveSharedView({ view: view("A renamed", { id }) });
    expect(res.data!.views.length).toBe(1);
    expect(res.data!.views[0]).toMatchObject({ id, name: "A renamed" });
  });

  it("refuses the 41st view and keeps the 40", () => {
    as("admin@example.com");
    for (let i = 0; i < 40; i++) {
      const r = api.saveSharedView({ view: view("v" + i, { state: { q: "", f: {}, sort: "n", cols: [], metric: "worst" } }) });
      expect(r.ok, "view " + i + ": " + r.error).toBe(true);
    }
    const gen = viewsGen();
    const res = api.saveSharedView({ view: view("one too many") });
    expect(res).toMatchObject({ ok: false });
    expect(res.error).toMatch(/At most 40/);
    expect(listSharedViews().length).toBe(40);
    expect(viewsGen()).toBe(gen);
  });

  it("refuses an oversize view and an oversize list", () => {
    as("admin@example.com");
    const big = view("big", { state: { q: "", f: { dom: Array.from({ length: 50 }, (_, i) => String(i).padEnd(190, "x")) }, sort: "n", cols: [], metric: "worst" } });
    const res = api.saveSharedView({ view: big });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/too large/);
    expect(prop("SHARED_VIEWS")).toBeNull();
  });

  it("refuses an invalid view with sentences", () => {
    as("admin@example.com");
    expect(api.saveSharedView({ view: view("") }).error).toMatch(/needs a name/);
    expect(api.saveSharedView({ view: view("x", { route: "app" }) }).error).toMatch(/list, heatmap or landscape/);
    expect(api.saveSharedView({ view: view("x", { state: { sort: "nope" } }) }).error).toMatch(/sort by a column/);
    expect(api.saveSharedView({}).ok).toBe(false);
    expect(prop("SHARED_VIEWS")).toBeNull();
  });

  it("REFUSES viewers and strangers and writes nothing", () => {
    for (const who of ["viewer@example.com", "stranger@elsewhere.org"]) {
      as(who);
      expect(api.saveSharedView({ view: view("x") })).toMatchObject({ ok: false, errorKind: "forbidden" });
      expect(api.deleteSharedView({ id: "abc" })).toMatchObject({ ok: false, errorKind: "forbidden" });
    }
    expect(prop("SHARED_VIEWS")).toBeNull();
    expect(viewsGen()).toBe(0);
  });

  it("is busy while the lock is held", () => {
    as("admin@example.com");
    fakes().holdLock(true);
    expect(api.saveSharedView({ view: view("x") })).toMatchObject({ ok: false, errorKind: "busy" });
  });
});

describe("deleteSharedView", () => {
  it("removes a view and bumps CFG_GEN; an unknown id is refused", () => {
    as("admin@example.com");
    const id = api.saveSharedView({ view: view("A") }).data!.id;
    api.saveSharedView({ view: view("B") });
    const gen = viewsGen();
    const cfg = cfgGen();
    const res = api.deleteSharedView({ id });
    expect(res.data!.views.map((v) => v.name)).toEqual(["B"]);
    expect(viewsGen()).toBe(gen + 1);
    expect(cfgGen()).toBe(cfg);
    expect(api.deleteSharedView({ id }).ok).toBe(false);
    expect(api.deleteSharedView({}).ok).toBe(false);
  });
});

describe("what viewers see", () => {
  it("shared views ride in the bootstrap core for everyone", () => {
    as("admin@example.com");
    api.saveSharedView({ view: view("A") });
    as("viewer@example.com");
    expect(api.bootstrap().data!.core.sharedViews.map((v) => v.name)).toEqual(["A"]);
  });
  it("drops a malformed stored entry rather than showing it", () => {
    PropertiesService.getScriptProperties().setProperty("SHARED_VIEWS", JSON.stringify([{ nonsense: true }, { id: "abc", name: "Good", scope: "shared", route: "list", state: {} }]));
    expect(listSharedViews().map((v) => v.name)).toEqual(["Good"]);
    PropertiesService.getScriptProperties().setProperty("SHARED_VIEWS", "{oops");
    expect(listSharedViews()).toEqual([]);
  });
});

describe("shared views and the settings save base (review fix)", () => {
  it("publishing a view does not invalidate an open settings draft", () => {
    as("admin@example.com");
    const opened = api.getSettings().data!.cfgGen;
    expect(api.saveSharedView({ view: view("Mine") }).ok).toBe(true);
    const res = api.saveSettings({ patch: { display: { theme: "dark" } }, baseGen: opened });
    expect(res.ok, res.error).toBe(true);
  });
  it("still moves the cached core key, so the new list is served", () => {
    as("admin@example.com");
    const before = api.bootstrap().data!.core.sharedViews.length;
    api.saveSharedView({ view: view("Another") });
    expect(api.bootstrap().data!.core.sharedViews.length).toBe(before + 1);
  });
});
