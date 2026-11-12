// Saved views in node: the personal store (cap of 20, refusal handling), the shared list from
// the core, the modified cue, the links, and the side-panel list as a pure view. The DOM behaviour
// (save form, share, copy, delete, reload) is in e2e/views.spec.ts.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { modelOf, viewListView } from "../../src/client/components/viewList.js";
import { mk } from "../domain/mk";
import * as register from "../../src/client/state/register.js";
import { DEFAULT_RULES } from "../../src/domain/rules";
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
    const r = views.addPersonal("  Tier 1 gaps ", body({ f: { tier: ["T1"] } }));
    expect(r.view.name).toBe("Tier 1 gaps");
    expect(views.listPersonal().map((v) => v.name)).toEqual(["Tier 1 gaps"]);
    expect(views.listPersonal()[0].scope).toBe("personal");
    expect(views.removePersonal(r.view.id)).toBe(true);
    expect(views.listPersonal()).toEqual([]);
    expect(views.removePersonal("nope")).toBe(false);
  });

  it("refuses the 21st view and says why", () => {
    for (let i = 0; i < 20; i++) expect(views.addPersonal("v" + i, body()).view).toBeTruthy();
    const r = views.addPersonal("one too many", body());
    expect(r.view).toBeUndefined();
    expect(r.error).toMatch(/at most 20/);
    expect(views.listPersonal()).toHaveLength(20);
  });

  it("refuses an empty or over-long name", () => {
    expect(views.addPersonal("   ", body()).error).toMatch(/name/);
    expect(views.addPersonal("x".repeat(61), body()).error).toMatch(/at most 60/);
    expect(views.listPersonal()).toEqual([]);
  });

  it("update replaces the filters and keeps the name", () => {
    const { view } = views.addPersonal("Mine", body({ f: { tier: ["T1"] } }));
    const r = views.updatePersonal(view.id, body({ f: { lc: ["Production"] }, q: "pay" }));
    expect(r.view.name).toBe("Mine");
    expect(views.listPersonal()[0].state.f).toEqual({ lc: ["Production"] });
    expect(views.listPersonal()[0].state.q).toBe("pay");
    expect(views.updatePersonal("gone", body()).error).toMatch(/no longer/);
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
    expect(views.addPersonal("x", body()).error).toMatch(/does not allow/);
    delete globalThis.window;
    expect(views.canKeepPersonal()).toBe(false);
  });
});

describe("the list of views and the modified cue", () => {
  const shared = [{ id: "sh1", name: "Shared one", scope: "shared", route: "list", state: body({ f: { tier: ["T1"] } }) }, { id: "sh2", name: "Saved on the heatmap", scope: "shared", route: "heatmap", state: body() }, { id: "sh3", name: "No page", scope: "shared", state: body() }];

  it("lists All applications, every shared view whatever page it was saved on, then personal", () => {
    views.addPersonal("Mine", body());
    expect(views.allViews({ sharedViews: shared }).map((v) => v.name)).toEqual(["All applications", "Shared one", "Saved on the heatmap", "No page", "Mine"]);
    expect(views.allViews(null).map((v) => v.name)).toEqual(["All applications", "Mine"]);
  });

  it("an old personal view that carries a heatmap route is still read, and kept when saved again", () => {
    mem.set(KEY, JSON.stringify([{ id: "old1", name: "Old heat", scope: "personal", route: "heatmap", state: body({ f: { tier: ["T1"] } }) }]));
    const [v] = views.listPersonal();
    expect(v).toMatchObject({ id: "old1", name: "Old heat", route: "heatmap" });
    views.addPersonal("Next", body());
    expect(JSON.parse(mem.get(KEY)).find((x) => x.id === "old1").route).toBe("heatmap");
    expect(JSON.parse(mem.get(KEY)).find((x) => x.name === "Next")).not.toHaveProperty("route");
  });

  it("a new personal view has no page", () => {
    const { view } = views.addPersonal("Mine", body());
    expect(view).not.toHaveProperty("route");
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

  it("patchFor ignores the page a view was saved on: it never changes the route or the lens", () => {
    for (const route of ["list", "heatmap", "landscape", undefined]) {
      const p = views.patchFor({ ...shared[0], route });
      expect(p).not.toHaveProperty("route");
      expect(p).not.toHaveProperty("lens");
    }
  });

  it("counts how many applications a view holds, over the rows it is given", () => {
    const rows = register.derive([mk({ id: "a", tier: 1 }), mk({ id: "b", tier: 1 }), mk({ id: "c", tier: 2 })], { rules: DEFAULT_RULES, display: { opensOn: "list", theme: "system", hidePrefix: "", hideEol: false }, today: "2026-11-11" }).rows;
    expect(views.countOf(views.ALL_VIEW, rows)).toBe(3);
    expect(views.countOf(shared[0], rows)).toBe(2);
    expect(views.countOf({ ...shared[0], state: body({ q: "zzz" }) }, rows)).toBe(0);
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
    const href = views.linkFor("https://example.test/exec", { id: "sh1", scope: "shared", name: "S", state: body({ f: { tier: ["T1"] } }) });
    expect(href).toBe("https://example.test/exec?r=list&view=sh1");
    const p = fromQuery(href.split("?")[1]);
    expect(p.view).toBe("sh1");
    expect(p.state.route).toBe("list");
  });

  it("a personal view links with explicit params that reproduce it", () => {
    const v = { id: "p1", scope: "personal", route: "heatmap", name: "P (saved on the old heatmap page)", state: body({ f: { dom: ["A,B", "C"], tier: ["T1"] }, q: "pay now", sort: "-t", metric: "c1" }) };
    const href = views.linkFor("https://example.test/exec", v);
    expect(href).not.toContain("view=");
    const p = fromQuery(href.split("?")[1]);
    // an old view opens the Inventory, never the page it was saved on
    expect(p.state.route).toBe("list");
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

describe("the side-panel list", () => {
  const core = { sharedViews: [{ id: "sh1", name: "Shared one", scope: "shared", route: "list", state: body({ f: { tier: ["T1"] } }) }] };
  const apps = [mk({ id: "a", tier: 1 }), mk({ id: "b", tier: 1 }), mk({ id: "c", tier: 2 })];
  const rows = register.derive(apps, { rules: DEFAULT_RULES, display: { opensOn: "list", theme: "system", hidePrefix: "", hideEol: false }, today: "2026-11-11" }).rows;
  const model = (over, local, env) => modelOf(stateWith({ core, live: live(viewer), ...over }), local || {}, { storage: true, personal: [], rows, ...(env || {}) });

  it("has Shared views and My views, All applications first, each row with its live count", () => {
    const out = s(viewListView(model()));
    expect(out).toContain("Shared views");
    expect(out).toContain("My views");
    expect(out).toMatch(/data-id="all"[^>]*>.*?data-vcount>3</);
    expect(out).toMatch(/data-id="sh1"[^>]*>.*?data-vcount>2</);
    expect(out).toContain("+ Save");
    expect(out).not.toContain("Manage");
    expect(out).not.toContain("Copy link");
    expect(out).not.toContain("data-cue");
  });

  it("counts a personal view too, and lists it under My views", () => {
    const own = { id: "p1", name: "Mine", scope: "personal", state: body({ f: { tier: ["T2"] } }) };
    const m = model({}, {}, { personal: [own] });
    expect(m.personalRows.map((v) => [v.name, v.count])).toEqual([["Mine", 1]]);
    expect(m.sharedRows.map((v) => [v.name, v.count])).toEqual([["All applications", 3], ["Shared one", 2]]);
  });

  it("marks the open view with aria-current and an on class", () => {
    const out = s(viewListView(model({ currentViewId: "sh1", f: { tier: ["T1"] } })));
    expect(out).toMatch(/data-id="sh1"[^>]*aria-current="true"/);
    expect(out).toMatch(/data-id="all"[^>]*aria-current="false"/);
    expect(out).toContain('class="vi on"');
  });

  it("a viewer on a shared view can copy the link but not delete it", () => {
    const out = s(viewListView(model({ currentViewId: "sh1", f: { tier: ["T1"] } })));
    expect(out).toContain("Copy link");
    expect(out).not.toContain("Delete");
    expect(out).not.toContain("data-cue");
  });

  it("an admin sees Manage, can delete the open shared view, and in manage mode every shared row", () => {
    const out = s(viewListView(model({ currentViewId: "sh1", f: { tier: ["T1"] }, live: live(admin) })));
    expect(out).toContain("Manage");
    expect(out).toContain("Delete");
    expect(out).not.toContain('data-act="vrm"');
    const managing = s(viewListView(model({ live: live(admin) }, { manage: true })));
    expect(managing).toContain('data-act="vrm" data-id="sh1"');
    expect(managing).not.toContain('data-act="vrm" data-id="all"');
    expect(managing).toContain("Done");
  });

  it("says changed, with Save and Save as new, when the filters moved off a saved view", () => {
    const own = { id: "p1", name: "Mine", scope: "personal", state: body() };
    const out = s(viewListView(model({ currentViewId: "p1", q: "x" }, {}, { personal: [own] })));
    expect(out).toContain("data-cue");
    expect(out).toContain("changed");
    expect(out).toContain('data-act="vupdate"');
    expect(out).toContain("Save as new");
  });

  it("a colour-metric change or a sort change also marks the view changed", () => {
    const own = { id: "p1", name: "Mine", scope: "personal", state: body() };
    expect(model({ currentViewId: "p1", metric: "tier" }, {}, { personal: [own] }).modified).toBe(true);
    expect(model({ currentViewId: "p1", sort: "t" }, {}, { personal: [own] }).modified).toBe(true);
    expect(model({ currentViewId: "p1" }, {}, { personal: [own] }).modified).toBe(false);
  });

  it("keeps the cue while the name form is open", () => {
    const own = { id: "p1", name: "Mine", scope: "personal", state: body() };
    const out = s(viewListView(model({ currentViewId: "p1", q: "x" }, { saving: true }, { personal: [own] })));
    expect(out).toContain("data-cue");
    expect(out).toContain('data-k="vname"');
  });

  it("a viewer who edits a shared view is offered Save as new, not Save", () => {
    const out = s(viewListView(model({ currentViewId: "sh1", f: { tier: ["T2"] } })));
    expect(out).toContain("Save as new");
    expect(out).not.toContain('data-act="vupdate"');
  });

  it("All applications is changed by a filter and then offers Save as new only", () => {
    const out = s(viewListView(model({ f: { tier: ["T2"] } })));
    expect(out).toContain("data-cue");
    expect(out).toContain("Save as new");
    expect(out).not.toContain('data-act="vupdate"');
  });

  it("hides + Save when storage is refused, except for an admin, who can only share", () => {
    expect(s(viewListView(model({}, {}, { storage: false })))).not.toContain("+ Save");
    const m = model({ live: live(admin) }, { saving: true }, { storage: false });
    const out = s(viewListView(m));
    expect(out).toContain("Shared with everyone");
    expect(out).not.toContain('data-act="vshare"');
    expect(model({ live: live(admin) }, {}, { storage: false }).canSave).toBe(true);
  });

  it("the form shows the share choice to admins only, and escapes a hostile name", () => {
    const hostile = '"><img src=x onerror=alert(1)>';
    const a = s(viewListView(model({ live: live(admin) }, { saving: true, name: hostile })));
    expect(a).toContain("Share with everyone");
    expect(a).not.toContain("<img");
    const v = s(viewListView(model({}, { saving: true, error: "At most 20" })));
    expect(v).not.toContain("Share with everyone");
    expect(v).toContain('role="alert"');
    const bad = { id: "p9", name: hostile, scope: "personal", state: body() };
    expect(s(viewListView(model({}, {}, { personal: [bad] })))).not.toContain("<img");
  });

  it("an unknown current view falls back to All applications, on any lens", () => {
    expect(model({ currentViewId: "zzz" }).current).toBe("all");
    expect(model({ currentViewId: "sh1", lens: "heatmap" }).current).toBe("sh1");
  });
});
