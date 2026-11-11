import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { delegatedNames, exportedNames } from "../../build/guards.mjs";

const read = (p) => readFileSync(new URL("../../" + p, import.meta.url), "utf8");
const ENTRY = read("src/gas/entry.js");
const API = read("src/server/api.ts");
const INDEX = read("src/server/index.ts");

const decomment = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/^[ \t]*\/\/.*$/gm, "");
const ENTRY_CODE = decomment(ENTRY);

const exported = exportedNames(API);
const delegated = delegatedNames(ENTRY);

describe("the RPC surface", () => {
  it("exports something", () => {
    expect(exported.length).toBeGreaterThan(0);
  });
  it("gives every api.ts export a delegator and vice versa", () => {
    expect([...exported].sort()).toEqual([...delegated].sort());
  });
  it("routes every delegator through timedApi_", () => {
    for (const name of delegated) {
      expect(ENTRY).toContain("function api_" + name + "(p) { return timedApi_(\"" + name + "\", p); }");
    }
  });
  it("checks access before doing any work", () => {
    const body = ENTRY.slice(ENTRY.indexOf("function timedApi_"));
    expect(body.indexOf("denyResult")).toBeLessThan(body.indexOf("Server.api[name]"));
  });
});

describe("the web-app entry", () => {
  it("refuses before it draws", () => {
    const body = ENTRY.slice(ENTRY.indexOf("function doGet"), ENTRY.indexOf("function include"));
    expect(body.indexOf("deniedPage")).toBeGreaterThan(-1);
    expect(body.indexOf("deniedPage")).toBeLessThan(body.indexOf("Server.doGet"));
  });
  it("has no welcome gate", () => {
    expect(ENTRY_CODE).not.toMatch(/welcome/i);
  });
  it("gates include()", () => {
    expect(ENTRY).toMatch(/function include\(filename\)[\s\S]*denyResult\("include"\)/);
  });
  it("exposes every namespace entry.js uses on Server", () => {
    for (const name of ["doGet", "include", "access", "api"]) {
      expect(INDEX).toMatch(new RegExp("export (\\* as " + name + "|\\{[^}]*\\b" + name + "\\b)"));
    }
  });
  it("declares no trigger handlers", () => {
    expect(ENTRY_CODE.match(/function trigger_\w+/g)).toBeNull();
  });
});
