// Saved views in node: the personal store (cap of 20, refusal handling), the shared list from
// the core, the modified cue, the links, and the tab row as a pure view. The DOM behaviour
// (save form, share, copy, delete, reload) is in e2e/views.spec.ts.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { modelOf, viewTabsView } from "../../src/client/components/viewTabs.js";
import { initialState, store } from "../../src/client/state/store.js";
import * as views from "../../src/client/state/views.js";
import { fromQuery } from "../../src/domain/viewState";

const KEY = "cccp.views.v1";
let mem;
let refuse;

function installStorage() {
  mem = new Map();
  refuse = false;
  globalThis.window = {
    localStorage: {
      getItem: (k) => { if (refuse) throw new Error("blocked"); return mem.has(k) ? mem.get(k) : null; },
      setItem: (k, v) => { if (refuse) throw new Error("blocked"); mem.set(k, String(v)); },
      removeItem: (k) => { if (refuse) throw new Error("blocked"); mem.delete(k); },
    },
  };
}

const body = (over) => ({ q: "", f: {}, sort: "n", cols: [], metric: "worst", ...over });
const stateWith = (over) => ({ ...initialState(), route: "list", ...over });
const viewer = { role: "viewer", canEditSettings: false };
const admin = { role: "admin", canEditSettings: true };
const live = (v) => ({ viewer: v, serviceUrl: "https://example.test/exec" });
const s = (v) => String(v);

beforeEach(() => { installStorage(); store.reset(); });
afterEach(() => { delete globalThis.window; delete globalThis.google; });

describe("personal views", () => {
  it("saves, lists and removes", () => {
    const r = views.addPersonal("  Tier 1 gaps ", "list", body({ f: { tier: ["T1"] } }));
    expect(r.view.name).toBe("Tier 1 gaps");
    expect(views.listPersonal().map((v) => v.name)).toEqual(["Tier 1 gaps"]);
    expect(views.listPersonal()[0].scope).toBe("personal");
    expect(views.removePersonal(r.view.id)).toBe(true);
    expect(views.listPersonal()).toEqual([]);
    expect(views.removePersonal("nope")).toBe(false);
  });

  it("refuses the 21st view and says why", () => {
    for (let i = 0; i < 20; i++) expect(views.addPersonal("v" + i, "list", body()).view).toBeTruthy();
    const r = views.addPersonal("one too many", "list", body());
    expect(r.view).toBeUndefined();
    expect(r.error).toMatch(/at most 20/);
    expect(views.listPersonal()).toHaveLength(20);
  });

  it("refuses an empty or over-long name", () => {
    expect(views.addPersonal("   ", "list", body()).error).toMatch(/name/);
    expect(views.addPersonal("x".repeat(61), "list", body()).error).toMatch(/at most 60/);
    expect(views.listPersonal()).toEqual([]);
  });

  it("update replaces the filters and keeps the name", () => {
    const { view } = views.addPersonal("Mine", "list", body({ f: { tier: ["T1"] } }));
    const r = views.updatePersonal(view.id, "list", body({ f: { lc: ["Production"] }, q: "pay" }));
    expect(r.view.name).toBe("Mine");
    expect(views.listPersonal()[0].state.f).toEqual({ lc: ["Production"] });
    expect(views.listPersonal()[0].state.q).toBe("pay");
    expect(views.updatePersonal("gone", "list", body()).error).toMatch(/no longer/);
  });

  it("drops a damaged stored entry and survives garbage", () => {
    mem.set(KEY, JSON.stringify([{ id: "ok1", name: "Fine", route: "list", state: body() }, { id: "x", name: "", route: "list" }, 7, null]));
    expect(views.listPersonal().map((v) => v.id)).toEqual(["ok1"]);
    mem.set(KEY, "{not json");
    expect(views.listPersonal()).toEqual([]);
    mem.set(KEY, '{"a":1}');
    expect(views.listPersonal()).toEqual([]);
  });

  it("a refusal keeps nothing and reports it", () => {
    refuse = true;
    expect(views.canKeepPersonal()).toBe(false);
    expect(views.listPersonal()).toEqual([]);
    expect(views.addPersonal("x", "list", body()).error).toMatch(/does not allow/);
    delete globalThis.window;
    expect(views.canKeepPersonal()).toBe(false);
  });
});

describe("tabs and the modified cue", () => {
  const shared = [{ id: "sh1", name: "Shared one", scope: "shared", route: "list", state: body({ f: { tier: ["T1"] } }) }, { id: "sh2", name: "On heatmap", scope: "shared", route: "heatmap", state: body() }];

  it("orders All applications, shared, then personal, per route", () => {
    views.addPersonal("Mine", "list", body());
    views.addPersonal("Mine heat", "heatmap", body());
    const tabs = views.tabsFor("list", { sharedViews: shared });
    expect(tabs.map((v) => v.name)).toEqual(["All applications", "Shared one", "Mine"]);
    expect(views.tabsFor("heatmap", { sharedViews: shared }).map((v) => v.name)).toEqual(["All applications", "On heatmap", "Mine heat"]);
    expect(views.tabsFor("list", null).map((v) => v.name)).toEqual(["All applications", "Mine"]);
  });

  it("All applications is modified by a search or a filter only", () => {
    expect(views.isModified(views.ALL_VIEW, stateWith({}))).toBe(false);
    expect(views.isModified(views.ALL_VIEW, stateWith({ sort: "t", desc: true }))).toBe(false);
    expect(views.isModified(views.ALL_VIEW, stateWith({ q: "a" }))).toBe(true);
    expect(views.isModified(views.ALL_VIEW, stateWith({ f: { tier: ["T1"] } }))).toBe(true);
  });

  it("a saved view is modified when the page differs, whatever the value order", () => {
    const v = { id: "p1", name: "V", scope: "personal", route: "list", state: body({ f: { dom: ["B", "A"] } }) };
    expect(views.isModified(v, stateWith({ f: { dom: ["A", "B"] } }))).toBe(false);
    expect(views.isModified(v, stateWith({ f: { dom: ["A"] } }))).toBe(true);
    expect(views.isModified(v, stateWith({ f: { dom: ["A", "B"] }, q: "x" }))).toBe(true);
    expect(views.isModified(v, stateWith({ f: { dom: ["A", "B"] }, sort: "t" }))).toBe(true);
  });

  it("patchFor applies a view and All clears the filters", () => {
    const p = views.patchFor({ ...shared[0], state: body({ f: { tier: ["T1"] }, sort: "-t", q: "z" }) });
    expect(p).toMatchObject({ q: "z", f: { tier: ["T1"] }, sort: "t", desc: true, view: "sh1", currentViewId: "sh1", limit: 50 });
    expect(views.patchFor({ ...shared[0], scope: "personal" }).view).toBeNull();
    expect(views.patchFor(views.ALL_VIEW)).toEqual({ q: "", f: {}, view: null, currentViewId: "all", limit: 50 });
  });
});

describe("links", () => {
  it("a shared view links by id, and the link parses back to that view", () => {
    const href = views.linkFor("https://example.test/exec", { id: "sh1", scope: "shared", route: "list", name: "S", state: body({ f: { tier: ["T1"] } }) });
    expect(href).toBe("https://example.test/exec?r=list&view=sh1");
    const p = fromQuery(href.split("?")[1]);
    expect(p.view).toBe("sh1");
    expect(p.state.route).toBe("list");
  });

  it("a personal view links with explicit params that reproduce it", () => {
    const v = { id: "p1", scope: "personal", route: "heatmap", name: "P", state: body({ f: { dom: ["A,B", "C"], tier: ["T1"] }, q: "pay now", sort: "-t", metric: "c1" }) };
    const href = views.linkFor("https://example.test/exec", v);
    expect(href).not.toContain("view=");
    const p = fromQuery(href.split("?")[1]);
    expect(p.state.route).toBe("heatmap");
    expect(p.state.f).toEqual({ dom: ["A,B", "C"], tier: ["T1"] });
    expect(p.state.q).toBe("pay now");
    expect(p.state.sort).toBe("t");
    expect(p.state.desc).toBe(true);
    expect(p.state.metric).toBe("c1");
  });

  it("there is no link for All applications or without a service URL", () => {
    expect(views.linkFor("https://example.test/exec", views.ALL_VIEW)).toBe("");
    expect(views.linkFor("", { id: "p", scope: "personal", route: "list", name: "x", state: body() })).toBe("");
  });
});

describe("shared views through the server", () => {
  it("saveShared and deleteShared refresh the core's list", async () => {
    const calls = [];
    const list = [{ id: "n1", name: "New", scope: "shared", route: "list", state: body() }];
    globalThis.google = { script: { run: { withSuccessHandler(ok) { return { withFailureHandler() { return new Proxy({}, { get: (t, name) => (p) => { calls.push([name, p]); ok({ ok: true, data: name === "api_saveSharedView" ? { views: list, id: "n1" } : { views: [] } }); } }); } }; } } } };
    store.set({ core: { sharedViews: [] } });
    const id = await views.saveShared({ id: "", name: "New", scope: "shared", route: "list", state: body() });
    expect(id).toBe("n1");
    expect(store.get().core.sharedViews).toEqual(list);
    await views.deleteShared("n1");
    expect(store.get().core.sharedViews).toEqual([]);
    expect(calls.map((c) => c[0])).toEqual(["api_saveSharedView", "api_deleteSharedView"]);
    expect(calls[1][1]).toEqual({ id: "n1" });
  });

  it("only admins and the owner may share", () => {
    expect(views.canShare(stateWith({ live: live(viewer) }))).toBe(false);
    expect(views.canShare(stateWith({ live: live(admin) }))).toBe(true);
    expect(views.canShare(stateWith({ live: live({ role: "owner" }) }))).toBe(true);
    expect(views.canShare(stateWith({}))).toBe(false);
  });
});

describe("the tab row view", () => {
  const core = { sharedViews: [{ id: "sh1", name: "Shared one", scope: "shared", route: "list", state: body({ f: { tier: ["T1"] } }) }] };
  const model = (over, local, env) => modelOf(stateWith({ core, live: live(viewer), ...over }), local || {}, { storage: true, personal: [], ...(env || {}) });

  it("shows tabs with aria-selected, Save view, and nothing to act on for All", () => {
    const out = s(viewTabsView(model()));
    expect(out).toContain('role="tablist"');
    expect(out.match(/role="tab"/g)).toHaveLength(2);
    expect(out).toMatch(/data-id="all"[^>]*aria-selected="true"/);
    expect(out).toContain("Save view");
    expect(out).not.toContain("Copy link");
    expect(out).not.toContain("Delete");
    expect(out).not.toContain("data-cue");
  });

  it("a viewer on a shared view can copy the link but not delete it", () => {
    const out = s(viewTabsView(model({ currentViewId: "sh1", f: { tier: ["T1"] } })));
    expect(out).toContain("Copy link");
    expect(out).not.toContain("Delete");
    expect(out).not.toContain("data-cue");
  });

  it("an admin on a shared view can also delete it", () => {
    const out = s(viewTabsView(model({ currentViewId: "sh1", f: { tier: ["T1"] }, live: live(admin) })));
    expect(out).toContain("Copy link");
    expect(out).toContain("Delete");
  });

  it("shows the cue with Update view when the filters moved off a saved view", () => {
    const own = { id: "p1", name: "Mine", scope: "personal", route: "list", state: body() };
    const out = s(viewTabsView(model({ currentViewId: "p1", q: "x" }, {}, { personal: [own] })));
    expect(out).toContain("Filters changed");
    expect(out).toContain("Update view");
  });

  it("a viewer who edits a shared view is offered Save as view, not Update", () => {
    const out = s(viewTabsView(model({ currentViewId: "sh1", f: { tier: ["T2"] } })));
    expect(out).toContain("Save as view");
    expect(out).not.toContain("Update view");
  });

  it("hides Save view when storage is refused, except for an admin, who can only share", () => {
    expect(s(viewTabsView(model({}, {}, { storage: false })))).not.toContain("Save view");
    const m = model({ live: live(admin) }, { saving: true }, { storage: false });
    const out = s(viewTabsView(m));
    expect(out).toContain("Shared with everyone");
    expect(out).not.toContain('data-act="vshare"');
    expect(model({ live: live(admin) }, {}, { storage: false }).canSave).toBe(true);
  });

  it("the form shows the share choice to admins only, and escapes a hostile name", () => {
    const hostile = '"><img src=x onerror=alert(1)>';
    const a = s(viewTabsView(model({ live: live(admin) }, { saving: true, name: hostile })));
    expect(a).toContain("Share with everyone");
    expect(a).not.toContain("<img");
    const v = s(viewTabsView(model({}, { saving: true, error: "At most 20" })));
    expect(v).not.toContain("Share with everyone");
    expect(v).toContain('role="alert"');
    const bad = { id: "p9", name: hostile, scope: "personal", route: "list", state: body() };
    expect(s(viewTabsView(model({}, {}, { personal: [bad] })))).not.toContain("<img");
  });

  it("an unknown current view falls back to All applications", () => {
    expect(model({ currentViewId: "zzz" }).current).toBe("all");
    expect(model({ currentViewId: "sh1", route: "heatmap" }).current).toBe("all");
  });
});
