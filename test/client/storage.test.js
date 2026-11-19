// lib/storage.js over the kit's createStorage: data keys are JSON, two preferences stay bare strings
// as earlier builds wrote them. Old values must still read; what is written must still be readable by
// the old pre-paint script and builds; a refusing storage reads null and reports unavailable.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as storage from "../../src/client/lib/storage.js";
import * as theme from "../../src/client/shell/theme.js";
import { installLocalStorage, installRefusingLocalStorage, removeLocalStorage } from "./localStorageFake.js";
import { errorText } from "../../src/client/lib/errorText.js";

const mem = new Map();
const fake = () => ({ getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: (k) => { mem.delete(k); } });
let attr;
const html = { getAttribute: (k) => (k === "data-theme" ? attr : null), setAttribute: (k, v) => { if (k === "data-theme") attr = v; }, removeAttribute: (k) => { if (k === "data-theme") attr = null; } };

beforeEach(() => { mem.clear(); attr = null; globalThis.document = { documentElement: html }; installLocalStorage(fake()); });
afterEach(() => { removeLocalStorage(); delete globalThis.document; });

describe("values written by earlier builds", () => {
  it("reads the bare-string preferences", () => {
    mem.set("cccp.theme", "dark");
    mem.set("cccp.fs.side", "collapsed");
    expect(storage.get("theme")).toBe("dark");
    expect(storage.get("fs.side")).toBe("collapsed");
  });
  it("reads the JSON data keys", () => {
    mem.set("cccp.cols", '["-so","+ty"]');
    mem.set("cccp.fs.closed", '["cyber"]');
    mem.set("cccp.recent", '["a","b"]');
    mem.set("cccp.views.v1", '[{"id":"v1","name":"X","scope":"personal","state":{}}]');
    expect(storage.getJson("cols", [])).toEqual(["-so", "+ty"]);
    expect(storage.getJson("fs.closed", [])).toEqual(["cyber"]);
    expect(storage.getJson("recent", [])).toEqual(["a", "b"]);
    expect(storage.getJson("views.v1", [])[0].id).toBe("v1");
  });
  it("falls back for a missing or unreadable JSON value", () => {
    expect(storage.getJson("cols", [])).toEqual([]);
    expect(storage.getJson("cols")).toBeNull();
    mem.set("cccp.cols", "not json");
    expect(storage.getJson("cols", ["x"])).toEqual(["x"]);
  });
  it("keeps the stored theme when the app starts", () => {
    mem.set("cccp.theme", "dark");
    expect(theme.init("light")).toBe("dark");
    expect(attr).toBe("dark");
  });
  it("applies the Display default when nothing is stored, and 'system' leaves the attribute off", () => {
    expect(theme.init("light")).toBe("light");
    expect(attr).toBe("light");
    expect(theme.init("system")).toBe("light");
    expect(attr).toBeNull();
  });
});

describe("what is written", () => {
  it("writes the preferences as bare strings, which the pre-paint script and older builds read", () => {
    expect(storage.set("theme", "dark")).toBe(true);
    expect(mem.get("cccp.theme")).toBe("dark");
    storage.set("fs.side", "open");
    expect(mem.get("cccp.fs.side")).toBe("open");
    mem.delete("cccp.theme");
    theme.init("light");
    expect(theme.toggle()).toBe("dark");
    expect(mem.get("cccp.theme")).toBe("dark");
    expect(theme.toggle()).toBe("light");
    expect(mem.get("cccp.theme")).toBe("light");
  });
  it("unwraps a quoted preference, as a kit-based writer would leave it", () => {
    mem.set("cccp.theme", '"dark"');
    expect(storage.get("theme")).toBe("dark");
  });
  it("writes data keys as JSON and removes them", () => {
    expect(storage.setJson("cols", ["-so"])).toBe(true);
    expect(mem.get("cccp.cols")).toBe('["-so"]');
    expect(storage.remove("cols")).toBe(true);
    expect(mem.has("cccp.cols")).toBe(false);
  });
  it("is available with a working storage", () => {
    expect(storage.available()).toBe(true);
    expect(mem.has("cccp.probe")).toBe(false);
  });
});

describe("a refusing storage", () => {
  it("reads null, writes false and reports unavailable, so the control hides", () => {
    installRefusingLocalStorage();
    expect(storage.available()).toBe(false);
    expect(storage.get("theme")).toBeNull();
    expect(storage.set("theme", "dark")).toBe(false);
    expect(storage.getJson("cols", [])).toEqual([]);
    expect(storage.setJson("cols", ["-so"])).toBe(false);
    expect(storage.remove("cols")).toBe(false);
  });
  it("still toggles the theme for the session", () => {
    installRefusingLocalStorage();
    theme.init("light");
    expect(theme.toggle()).toBe("dark");
    expect(attr).toBe("dark");
  });
});

describe("errorText", () => {
  it("appends the reference of an unexpected fault, and leaves any other message alone", () => {
    expect(errorText({ message: "Something went wrong.", ref: "ab12cd" })).toBe("Something went wrong. Reference: ab12cd.");
    expect(errorText({ message: "Not allowed." })).toBe("Not allowed.");
    expect(errorText(null, "fallback")).toBe("fallback");
    expect(errorText({ message: "", ref: "" }, "fallback")).toBe("fallback");
  });
});
