import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { guardCss, guardEntryDrift, guardJs, stripCommentsLikeMiddlebox } from "../../build/guards.mjs";

const root = new URL("../../", import.meta.url).pathname;

describe("guardJs", () => {
  it("passes clean output", () => {
    expect(() => guardJs("t", 'var a="x";function f(){return a+1}f();')).not.toThrow();
  });
  it("throws on a quoted URL containing a double slash", () => {
    const url = ["https:", "", "example.com"].join("/");
    expect(() => guardJs("t", 'var u="' + url + '";')).toThrow(/double slash/);
  });
  it("throws on a backtick", () => {
    expect(() => guardJs("t", "var a=`x`;")).toThrow(/backticks/);
  });
  it("strips real comments like the middlebox", () => {
    expect(stripCommentsLikeMiddlebox("a; // c\nb; /* d */ c;")).toBe("a; \nb;  c;");
  });
});

describe("guardCss", () => {
  it("passes clean css", () => {
    expect(() => guardCss("t", "a{color:red}/* c */")).not.toThrow();
  });
  it("throws on a url with a double slash", () => {
    const url = ["", "", "x"].join("/");
    expect(() => guardCss("t", "a{background:url('" + url + "')}")).toThrow(/double slash/);
  });
});

describe("entry drift guard", () => {
  const entry = "function api_a(p) { return timedApi_(\"a\", p); }\nfunction api_b(p) { return timedApi_(\"b\", p); }\n";
  const api = "export function a() {}\nexport function b<T>() {}\nfunction run() {}\n";
  it("passes when both agree", () => {
    expect(() => guardEntryDrift(entry, api)).not.toThrow();
  });
  it("fails when api.ts exports something with no delegator", () => {
    expect(() => guardEntryDrift(entry, api + "export function c() {}\n")).toThrow(/unreachable from GAS: c/);
  });
  it("fails when entry.js delegates something api.ts does not export", () => {
    expect(() => guardEntryDrift(entry + "function api_d(p) {}\n", api)).toThrow(/not exported: d/);
  });
});

describe("build", () => {
  it("writes the six dist files with the stamp", () => {
    const out = mkdtempSync(join(tmpdir(), "cccp-dist-"));
    const log = execFileSync("node", [join(root, "build/esbuild.config.mjs")], {
      env: { ...process.env, CCCP_DIST: out },
      encoding: "utf8",
    });
    expect(readdirSync(out).sort()).toEqual(
      ["appsscript.json", "entry.js", "index.html", "js_app.html", "server.js", "styles.html"],
    );
    const stamp = /stamp (\w+)/.exec(log)[1];
    expect(stamp).toMatch(/^[0-9a-f]{12}$/);
    expect(readFileSync(join(out, "server.js"), "utf8")).toContain(stamp);
    expect(existsSync(join(out, "js_app.html"))).toBe(true);
    expect(readFileSync(join(out, "js_app.html"), "utf8")).not.toContain("`");
  });
});
