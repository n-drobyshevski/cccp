// The URL bridge against a recording stand-in for google.script.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStore } from "../../src/client/state/store.js";
import { store } from "../../src/client/state/store.js";
import * as url from "../../src/client/state/url.js";

let calls;
let listener;
let location;

beforeEach(() => {
  calls = [];
  listener = null;
  location = { parameter: {} };
  globalThis.google = {
    script: {
      history: {
        push: (...a) => calls.push(["push", ...a]),
        replace: (...a) => calls.push(["replace", ...a]),
        setChangeHandler: (fn) => { listener = fn; },
      },
      url: { getLocation: (cb) => cb(location) },
    },
  };
  store.reset();
  url.resetUrlState();
});
afterEach(() => { delete globalThis.google; });

describe("store", () => {
  it("merges, notifies on change only, and unsubscribes", () => {
    const s = createStore();
    const seen = [];
    const off = s.subscribe((n, p) => seen.push([n.route, p.route]));
    s.set({ route: "list" });
    s.set({ route: "list" });
    off();
    s.set({ route: "heatmap" });
    expect(seen).toEqual([["list", ""]]);
    expect(s.get().route).toBe("heatmap");
  });
});

describe("url.js", () => {
  it("records a push for a page change and a replace for a filter change", () => {
    url.init({ fallbackRoute: "list" });
    return url.readLocation().then(() => {
      url.push({ route: "heatmap" });
      url.replace({ route: "heatmap", q: "pay" });
      expect(calls[0].slice(0, 2)).toEqual(["push", null]);
      expect(calls[0][2]).toEqual({ r: "heatmap" });
      expect(calls[1][0]).toBe("replace");
      expect(calls[1][2]).toEqual({ r: "heatmap", q: "pay" });
      expect(store.get().q).toBe("pay");
    });
  });

  it("does not write the same address twice and leaves it alone for mode none", () => {
    url.push({ route: "overview" });
    url.push({ route: "overview" });
    url.navigate({ route: "list" }, "none");
    expect(calls).toHaveLength(1);
    expect(store.get().route).toBe("list");
  });

  it("drops filters from the address of routes that have none", () => {
    store.set({ q: "abc", f: { dom: ["Finance"] } });
    url.push({ route: "overview" });
    expect(calls[0][2]).toEqual({ r: "overview" });
    url.push({ route: "list" });
    expect(calls[1][2]).toEqual({ r: "list", q: "abc", dom: "Finance" });
  });

  it("opens the fact sheet from ?app=<UUID> and carries the id back out", async () => {
    const id = "3f2c9a1e-7b44-4d0a-9a55-0c1d2e3f4a5b";
    location = { parameter: { app: id } };
    await url.init({ fallbackRoute: "list" });
    expect(store.get().route).toBe("app");
    expect(store.get().app).toBe(id);
    expect(url.queryFor(store.get())).toBe("r=app&app=" + id);
  });

  it("falls back to the default route for an empty, junk or app-less address", async () => {
    location = { parameter: { r: "nonsense", app: "bad id!" } };
    await url.init({ fallbackRoute: "heatmap" });
    expect(store.get().route).toBe("heatmap");
    expect(store.get().app).toBeNull();
  });

  it("applies Back through the change listener without writing the address", async () => {
    await url.init({ fallbackRoute: "list" });
    url.push({ route: "overview" });
    const before = calls.length;
    listener({ state: null, location: { parameter: { r: "list" } } });
    expect(store.get().route).toBe("list");
    expect(calls).toHaveLength(before);
    expect(url.isApplying()).toBe(false);
  });

  it("gives up on a location that never answers after 400 ms", async () => {
    globalThis.google.script.url.getLocation = () => {};
    const t0 = Date.now();
    const p = await url.readLocation();
    expect(p).toEqual({});
    expect(Date.now() - t0).toBeGreaterThanOrEqual(350);
  });

  it("builds the shareable link from the service URL", () => {
    store.set({ route: "list", q: "x" });
    expect(url.linkFor(["https:", "", "example.test", "exec"].join("/"), store.get())).toBe("https://example.test/exec?r=list&q=x");
    expect(url.linkFor("", store.get())).toBe("");
  });
});
