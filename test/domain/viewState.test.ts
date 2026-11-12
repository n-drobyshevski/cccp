import { describe, expect, it } from "vitest";
import type { SavedView, ViewState } from "../../src/domain/types";
import { URL_MAX, cleanView, defaultState, fromParams, fromQuery, savedToState, stateToSaved, toQuery, validateSharedViews, validateView } from "../../src/domain/viewState";

const full: ViewState = {
  route: "list", q: "café & co", f: { dom: ["Finance, Risk", "NO DOMAIN"], sd: ["Other"], tier: ["T1", "No tier"], lc: ["End of life"],
    so: ["None assigned"], gap: ["Cyber", "Platform"], ty: ["Application"], h: ["Cloud"] },
  sort: "st", desc: true, cols: ["-d", "+h"], metric: "tier", lens: "landscape",
};

describe("URL round trip", () => {
  it("round-trips every param", () => {
    const q = toQuery(full, { app: "abc-123", view: "v1x", tab: "people" });
    const back = fromQuery(q);
    expect(back.state).toEqual(full);
    expect(back.app).toBe("abc-123");
    expect(back.view).toBe("v1x");
    expect(back.tab).toBe("people");
    expect(toQuery(back.state, { app: back.app, view: back.view, tab: back.tab })).toBe(q);
  });

  it("omits defaults and round-trips the default state", () => {
    expect(toQuery(defaultState())).toBe("");
    expect(fromQuery("").state).toEqual(defaultState());
    expect(toQuery(defaultState("overview"))).toBe("r=overview");
  });

  it("drops unknown keys and invalid values", () => {
    const p = fromParams({ r: "nowhere", q: "x", evil: "1", sort: "bogus", metric: "zzz", cols: "-n,-zzz,+h", dom: "A,B", app: "bad\u0007id", tab: "X/Y", desc: "1" });
    expect(p.state).toEqual({ route: "", q: "x", f: { dom: ["A", "B"] }, sort: "n", desc: true, cols: ["+h"], metric: "worst", lens: "table" });
    expect(p.app).toBeUndefined();
    expect(p.tab).toBeUndefined();
    expect(JSON.stringify(p)).not.toContain("evil");
    expect(toQuery(p.state)).not.toContain("evil");
  });

  it("survives malformed percent escapes and a leading question mark", () => {
    expect(fromQuery("?q=%E0%A4%A&dom=%zz").state.q).toBe("%E0%A4%A");
    expect(fromQuery("?r=list&r=heatmap").state.route).toBe("list");
  });

  it("carries the lens and leaves the default one out", () => {
    expect(toQuery({ ...defaultState("list"), lens: "heatmap" })).toBe("r=list&lens=heatmap");
    expect(toQuery(defaultState("list"))).toBe("r=list");
    expect(fromQuery("r=list&lens=landscape").state.lens).toBe("landscape");
    expect(fromQuery("r=list&lens=bogus").state.lens).toBe("table");
    expect(fromQuery("lens=heatmap").state).toMatchObject({ route: "", lens: "heatmap" });
  });

  it("opens the old heatmap and landscape routes as lenses of the Inventory", () => {
    expect(fromQuery("r=heatmap&tier=T1").state).toMatchObject({ route: "list", lens: "heatmap", f: { tier: ["T1"] } });
    expect(fromQuery("r=landscape&metric=tier").state).toMatchObject({ route: "list", lens: "landscape", metric: "tier" });
    expect(fromQuery("r=list").state.lens).toBe("table");
  });

  it("caps the query at 2,000 characters", () => {
    const big = Array.from({ length: 50 }, (_, i) => "Domain number " + i + " " + "x".repeat(150));
    const s: ViewState = { ...full, q: "q".repeat(200), f: { ...full.f, dom: big, so: big, h: big } };
    const q = toQuery(s);
    expect(q.length).toBeLessThanOrEqual(URL_MAX);
    expect(q.startsWith("r=list")).toBe(true);
    const back = fromQuery(q);
    expect(back.state.route).toBe("list");
    expect(back.state.sort).toBe("st");
  });
});

describe("saved views", () => {
  const view: SavedView = { id: "abc123", name: "Gaps", scope: "shared", route: "list", state: { q: "", f: { tier: ["T1"] }, sort: "-st", cols: ["+h"], metric: "worst" }, by: "a@b.c", at: "2026-11-11" };

  it("validates a good view with no sentences", () => {
    expect(validateView(view)).toEqual([]);
  });

  it("returns sentences for bad views", () => {
    const errs = validateView({ name: " ", scope: "x", route: "settings", state: { f: { nope: ["a"], tier: [1] }, sort: "zzz", cols: ["-q", "+nope"], metric: "m" } });
    expect(errs.length).toBeGreaterThanOrEqual(7);
    for (const e of errs) expect(e).toMatch(/^[A-Z].*\.$/);
    expect(validateView(null)).toEqual(["A view must be an object."]);
    expect(validateView({ ...view, state: null })).toContain("A view needs its filters, sort and columns.");
  });

  it("cleans: drops unknown keys, caps strings, keeps the shape", () => {
    const dirty = { ...view, extra: 1, name: "n".repeat(500), state: { ...view.state, junk: true, q: "q".repeat(500), f: { tier: ["T1"], bad: ["x"] } } };
    const c = cleanView(dirty);
    expect(Object.keys(c).sort()).toEqual(["at", "by", "id", "name", "route", "scope", "state"]);
    expect(Object.keys(c.state).sort()).toEqual(["cols", "f", "metric", "q", "sort"]);
    expect(c.name).toHaveLength(200);
    expect(c.state.q).toHaveLength(200);
    expect(c.state.f).toEqual({ tier: ["T1"] });
    expect(cleanView(view)).toEqual(view);
  });

  it("still reads and validates a view saved on the heatmap or landscape page", () => {
    for (const route of ["heatmap", "landscape"]) {
      const old = { ...view, route };
      expect(validateView(old)).toEqual([]);
      expect(cleanView(old).route).toBe(route);
      expect(validateSharedViews([old])).toEqual([]);
      // Opening ignores the page it was saved on: the view is a set of applications, a sort, columns and a metric.
      expect(savedToState(old)).toMatchObject({ route: "list", lens: "table", sort: "st", desc: true });
    }
  });

  it("accepts a new view with no page, and rejects a page that is not one of the three", () => {
    const { route: _r, ...bare } = view;
    expect(validateView(bare)).toEqual([]);
    expect(cleanView(bare)).not.toHaveProperty("route");
    expect(validateView({ ...view, route: "settings" })).toHaveLength(1);
  });

  it("converts between a saved view and a state", () => {
    const st = savedToState(view);
    expect(st).toMatchObject({ route: "list", sort: "st", desc: true, cols: ["+h"] });
    expect(stateToSaved(st)).toEqual(view.state);
  });

  it("limits the shared list by count and size", () => {
    expect(validateSharedViews([view])).toEqual([]);
    expect(validateSharedViews(Array.from({ length: 41 }, () => view)).some((e) => /At most 40/.test(e))).toBe(true);
    const fat = { ...view, state: { ...view.state, f: { dom: Array.from({ length: 40 }, (_, i) => "d".repeat(150) + i) } } };
    expect(validateSharedViews([fat, fat]).some((e) => /too large/.test(e))).toBe(true);
    expect(validateSharedViews("x")).toEqual(["Shared views must be a list."]);
  });
});

describe("fact-sheet ids round trip (review fix)", () => {
  it("reads back any printable application id it wrote", () => {
    for (const id of ["APP.001", "APP 001", "ÉCO-1", "a:b/c", "x".repeat(70)]) {
      const q = toQuery(defaultState("app")) + "&app=" + encodeURIComponent(id);
      const params = Object.fromEntries(new URLSearchParams(q));
      expect(fromParams(params).app, id).toBe(id);
    }
  });
  it("still refuses control characters and over-long ids", () => {
    expect(fromParams({ app: "a\u0000b" }).app).toBeUndefined();
    expect(fromParams({ app: "x".repeat(201) }).app).toBeUndefined();
  });
});
