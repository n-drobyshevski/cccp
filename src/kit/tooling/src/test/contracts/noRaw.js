// raw() turns any string into SafeHtml, and html() called as a plain function (not as a tag)
// does the same with a string array. Either one on data from a sheet cell or a setting is stored
// XSS that every other check passes. So each use is reviewed: a file may bind raw, reach it or
// call html( only when allow names it with a reason. An allow entry with an empty reason, or one
// for a file that no longer uses either, is reported too, so the list stays a record of reviewed
// uses. Comments and string literals are not code.
//
// The binding is what is banned, not only the call: once a file holds raw under any name it can
// pass it on (cells.map(raw), const trusted = raw, raw.call(...)) or re-export it, and no call of
// the word raw( is left to see. So a use is any of:
//   - an import or export specifier named raw (import { raw }, import { raw as x },
//     export { raw }, export { raw as trusted } from ...);
//   - export * (or export * as ns) of the html module or the client package, which re-exports raw;
//   - on a namespace import (import * as k from ...): k.raw, k?.raw or k["raw"], and a
//     destructuring of raw out of it (const { raw } = k), or out of an import() expression;
//   - a call raw( or raw?.( (bare or as a member, except String.raw), and a call of a local
//     alias of an imported raw;
//   - html( called as a function.
// Other .raw properties (a form model's raw values, String.raw) are not the binding and pass.
import { lineOf, maskCode, read, scannedEnough, sourceFiles, wire } from "./_util.js";

/** A module specifier that exports raw: the html module (any path ending in html or html.js) or the client package. */
export const HTML_MODULE_RE = /(?:^|\/)html(?:\.m?js)?$|^@gas-kit\/client(?:\/index\.js)?$|(?:^|\/)client\/src(?:\/index\.js)?$/;

/**
 * Every use in one file (see the header).
 * @param {string} src
 * @returns {{ at: number, what: string }[]}
 */
export function rawUses(src) {
  const masked = maskCode(src);
  const kept = maskCode(src, { keepStrings: true });
  /** @type {{ at: number, what: string }[]} */ const out = [];
  const names = ["raw"];
  for (const m of masked.matchAll(/\b(import|export)\s*(?:type\s+)?\{([^}]*)\}/g)) {
    for (const part of m[2].split(",")) {
      const p = /^\s*(?:type\s+)?([\w$]+)(?:\s+as\s+([\w$]+))?\s*$/.exec(part);
      if (!p || (p[1] !== "raw" && p[2] !== "raw")) continue;
      const at = /** @type {number} */ (m.index);
      if (m[1] === "import") {
        out.push({ at, what: p[1] !== "raw" ? "imports " + p[1] + " as raw" : p[2] ? "imports raw as " + p[2] : "imports raw" });
        if (p[2] && p[1] === "raw") names.push(p[2]);
      } else {
        out.push({ at, what: "re-exports raw" + (p[2] ? " as " + p[2] : "") });
      }
    }
  }
  for (const m of kept.matchAll(/\bexport\s*\*\s*(?:as\s+[\w$]+\s*)?from\s*(["'])([^"'\n]*)\1/g)) {
    if (HTML_MODULE_RE.test(m[2])) out.push({ at: /** @type {number} */ (m.index), what: "re-exports everything of " + m[2] + ", raw included" });
  }
  /** @type {string[]} */ const namespaces = [];
  for (const m of masked.matchAll(/\bimport\s+(?:[\w$]+\s*,\s*)?\*\s*as\s+([\w$]+)/g)) namespaces.push(m[1]);
  const esc = (/** @type {string} */ n) => n.replace(/\$/g, "\\$");
  for (const ns of namespaces) {
    const member = new RegExp("(?<![\\w$.])" + esc(ns) + "\\s*(?:\\?\\.\\s*|\\.\\s*)raw\\b|(?<![\\w$.])" + esc(ns) + "\\s*(?:\\?\\.)?\\s*\\[\\s*([\"'])raw\\1\\s*\\]", "g");
    for (const m of kept.matchAll(member)) out.push({ at: /** @type {number} */ (m.index), what: "reaches raw through the namespace " + ns });
  }
  // A destructuring of raw: const { raw } = ns, const { raw: t } = ns, or out of import().
  for (const m of masked.matchAll(/\{([^{}]*)\}\s*=\s*(await\s+import\s*\(|[\w$]+\b)/g)) {
    const from = m[2];
    if (!/^await/.test(from) && !namespaces.includes(from)) continue;
    if (m[1].split(",").some((k) => /^\s*raw\s*(?::|=|$)/.test(k))) out.push({ at: /** @type {number} */ (m.index), what: "destructures raw out of " + (/^await/.test(from) ? "import()" : "the namespace " + from) });
  }
  for (const n of names) {
    const re = new RegExp("(?<![\\w$])(?<!\\bString\\s*\\.\\s*)(?<!\\bfunction\\s+)" + esc(n) + "\\s*(?:\\?\\.\\s*)?\\(", "g");
    for (const m of masked.matchAll(re)) out.push({ at: /** @type {number} */ (m.index), what: "calls " + n + "()" });
  }
  for (const m of masked.matchAll(/(?<![\w$.])(?<!\bfunction\s+)html\s*\(/g)) out.push({ at: /** @type {number} */ (m.index), what: "calls html() as a function instead of as a tag" });
  const seen = new Set();
  return out.sort((a, b) => a.at - b.at).filter((u) => {
    const k = u.at + " " + u.what;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * @param {{ dirs: string | string[], allow?: Record<string, string>, includeKit?: boolean, exts?: string[], minFiles?: number }} opts
 *   dirs: the browser source (client code is scanned, the vendored kit is not unless
 *   includeKit). allow: file (relative path, file name or suffix) to the reason its use is safe.
 *   exts: default .js and .mjs. minFiles: fewest files the scan must see (default 1).
 * @returns {string[]} violations
 */
export function check({ dirs, allow = {}, includeKit = false, exts = [".js", ".mjs"], minFiles = 1 }) {
  const files = sourceFiles(dirs, { exts, includeKit, includeClient: true });
  /** @type {string[]} */ const bad = scannedEnough(files, minFiles, dirs);
  const used = new Set();
  for (const [file, reason] of Object.entries(allow)) if (typeof reason !== "string" || !reason.trim()) bad.push("noRaw allow entry " + file + " has no reason; say why its use is safe");
  for (const { file, rel } of files) {
    const text = read(file);
    const uses = rawUses(text);
    if (!uses.length) continue;
    const entry = Object.keys(allow).find((a) => rel === a || rel.endsWith("/" + a));
    if (entry) { used.add(entry); continue; }
    for (const u of uses) bad.push(rel + ":" + lineOf(text, u.at) + " " + u.what + " without an allow entry; render through the html tag, or allow the file with a reason");
  }
  for (const a of Object.keys(allow)) if (!used.has(a)) bad.push("noRaw allow entry " + a + " matches no file that uses raw() or html(); drop it");
  return bad;
}

/** @param {any} describe @param {any} it @param {any} expect @param {Parameters<typeof check>[0]} opts */
export function register(describe, it, expect, opts) {
  wire(describe, it, expect, "no unreviewed raw()", () => check(opts));
}
