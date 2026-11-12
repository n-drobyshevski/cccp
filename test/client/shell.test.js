// The shell: the app bar (views, logo, search field) and the search behaviour (live on the Inventory,
// Enter from anywhere else). DOM behaviour is in e2e/inventory.spec.ts.
import { describe, expect, it, vi } from "vitest";
import { appbarView, VIEWS } from "../../src/client/shell/appbar.js";
import { createSearch } from "../../src/client/shell/search.js";
import { initialState } from "../../src/client/state/store.js";

const s = (v) => String(v);

describe("shell search", () => {
  const make = (route, f) => {
    vi.useFakeTimers();
    const st = { route, f: f || {}, q: "" };
    const calls = [];
    const search = createSearch({ state: () => st, replace: (p) => calls.push(["replace", p]), navigate: (p, m) => calls.push(["navigate", p, m]) });
    return { search, calls, st };
  };
  it("filters live on the Inventory, after a short pause", () => {
    const { search, calls } = make("list");
    search.type("a");
    search.type("ab");
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(130);
    expect(calls).toEqual([["replace", { q: "ab", limit: 50 }]]);
    expect(search.draft).toBeNull();
    vi.useRealTimers();
  });
  it("does nothing while typing on another page, and Enter opens the Inventory with the query", () => {
    const { search, calls } = make("overview");
    search.type("pay");
    vi.advanceTimersByTime(500);
    expect(calls).toEqual([]);
    expect(search.draft).toBe("pay");
    search.enter("pay");
    expect(calls).toEqual([["navigate", { route: "list", app: null, tab: null, view: null, q: "pay", f: {}, limit: 50 }, "push"]]);
    vi.useRealTimers();
  });
  it("keeps the filters when it leaves the Heatmap, and drops them when it leaves a fact sheet", () => {
    const f = { tier: ["T1"] };
    const a = make("heatmap", f);
    a.search.enter("x");
    expect(a.calls[0][1].f).toBe(f);
    const b = make("app", f);
    b.search.enter("x");
    expect(b.calls[0][1].f).toEqual({});
    vi.useRealTimers();
  });
  it("Enter on the Inventory applies at once and cancels the pause", () => {
    const { search, calls } = make("list");
    search.type("z");
    search.enter("z");
    vi.advanceTimersByTime(500);
    expect(calls).toEqual([["replace", { q: "z", limit: 50 }]]);
    vi.useRealTimers();
  });
  it("shows what was typed, else q on a query page, else nothing", () => {
    const { search } = make("list");
    expect(search.value({ route: "list", q: "abc" })).toBe("abc");
    expect(search.value({ route: "overview", q: "abc" })).toBe("");
    search.type("typed");
    expect(search.value({ route: "list", q: "abc" })).toBe("typed");
    search.reset();
    expect(search.value({ route: "list", q: "abc" })).toBe("abc");
    vi.useRealTimers();
  });
});

describe("the bar", () => {
  const ready = { ...initialState(), route: "list", booted: true, core: {}, live: { viewer: { canEditSettings: false } }, boot: { status: "ready", message: "" } };
  it("reads Overview, Inventory, Heatmap, Landscape and carries the search", () => {
    expect(VIEWS.map((v) => v.label)).toEqual(["Overview", "Inventory", "Heatmap", "Landscape"]);
    expect(VIEWS[1].route).toBe("list");
    const h = s(appbarView({ ...ready, q: "pay" }, "light"));
    expect(h).toContain('placeholder="Search applications, people"');
    expect(h).toContain('value="pay"');
    expect(h).toContain('<span>Inventory</span>');
    expect(h).toContain('aria-current="page"');
  });
  it("draws four pillar bars in the logo", () => {
    expect(s(appbarView(ready, "light")).match(/<i><\/i>/g)).toHaveLength(4);
  });
  it("shows no search before the first boot has ended", () => {
    expect(s(appbarView({ ...initialState(), boot: { status: "loading", message: "" } }, "light"))).not.toContain("data-k=\"q\"");
  });
});
