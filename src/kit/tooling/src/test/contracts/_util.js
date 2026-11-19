// Extracted from the author's production Apps Script apps; adapted.
// Shared helpers for the contract factories (node side).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const REGEX_PREV = "(,=:[!&|?{};+-*%<>~^";
const REGEX_KEYWORDS = new Set(["return", "typeof", "case", "in", "of", "delete", "void", "throw", "new", "else", "do", "instanceof", "yield", "await"]);

/**
 * Drop block and line comments but keep quoted text (single, double and template quotes) and
 * regex literals, so a mention in prose passes, a string key such as
 * PropertiesService["getUserProperties"] is still seen, and a quote inside a regex does not open
 * a fake string. A slash starts a regex when the previous token cannot end an expression (an
 * operator, an opening bracket, a keyword such as return, or the start of the text). Newlines are
 * kept so line numbers survive.
 * @param {string} src
 * @returns {string}
 */
export function stripComments(src) {
  let out = "";
  let i = 0;
  /** @type {string | null} */
  let q = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (q) {
      out += c;
      if (c === "\\" && n !== undefined) { out += n; i += 2; continue; }
      if (c === q) q = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { q = c; out += c; i++; continue; }
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] === "\n") out += "\n"; i++; }
      i += 2;
      continue;
    }
    if (c === "/" && startsRegex(out)) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length && src[j] !== "\n") {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === "[") inClass = true;
        else if (src[j] === "]") inClass = false;
        else if (src[j] === "/" && !inClass) break;
        j++;
      }
      if (src[j] === "/") {
        out += src.slice(i, j + 1);
        i = j + 1;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

/** True when a slash after this already-emitted text starts a regex literal. @param {string} out */
function startsRegex(out) {
  const t = out.trimEnd();
  if (!t) return true;
  const last = t[t.length - 1];
  if (REGEX_PREV.includes(last)) return true;
  const word = /[A-Za-z_$][\w$]*$/.exec(t);
  return !!word && REGEX_KEYWORDS.has(word[0]);
}

/**
 * The same text with comments blanked and, unless keepStrings, the bodies of string, template
 * and regex literals blanked too (their delimiters stay). Every offset and newline is kept, so a
 * position found in one form is valid in the other and in the source. Template expressions are
 * blanked with their template.
 * @param {string} src
 * @param {{ keepStrings?: boolean }} [o]
 * @returns {string}
 */
export function maskCode(src, { keepStrings = false } = {}) {
  const out = src.split("");
  /** @param {number} a @param {number} b @param {boolean} [literal] */
  const blank = (a, b, literal = false) => {
    if (literal && keepStrings) return;
    for (let k = a; k < b && k < out.length; k++) if (out[k] !== "\n") out[k] = " ";
  };
  /** True when a slash at offset at starts a regex, judged on the text before it. @param {number} at */
  const regexAllowed = (at) => {
    let k = at - 1;
    while (k >= 0 && /\s/.test(out[k])) k--;
    if (k < 0) return true;
    const c = out[k];
    if (REGEX_PREV.includes(c)) return true;
    if (!/[\w$]/.test(c)) return false;
    let s = k;
    while (s > 0 && /[\w$]/.test(out[s - 1])) s--;
    return REGEX_KEYWORDS.has(out.slice(s, k + 1).join(""));
  };
  /** Scan code from i; with closer, stop after the brace that closes depth 0. @param {number} i @param {boolean} closer @returns {number} */
  const scan = (i, closer) => {
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      const n = src[i + 1];
      if (c === '"' || c === "'") {
        let k = i + 1;
        while (k < src.length && src[k] !== c && src[k] !== "\n") k += src[k] === "\\" ? 2 : 1;
        blank(i + 1, k, true);
        i = k + 1;
        continue;
      }
      if (c === "`") {
        const end = template(i);
        blank(i + 1, end - 1, true);
        i = end;
        continue;
      }
      if (c === "/" && n === "/") {
        let k = i;
        while (k < src.length && src[k] !== "\n") k++;
        blank(i, k);
        i = k;
        continue;
      }
      if (c === "/" && n === "*") {
        const e = src.indexOf("*/", i + 2);
        const k = e < 0 ? src.length : e + 2;
        blank(i, k);
        i = k;
        continue;
      }
      if (c === "/" && regexAllowed(i)) {
        let j = i + 1;
        let inClass = false;
        while (j < src.length && src[j] !== "\n") {
          if (src[j] === "\\") { j += 2; continue; }
          if (src[j] === "[") inClass = true;
          else if (src[j] === "]") inClass = false;
          else if (src[j] === "/" && !inClass) break;
          j++;
        }
        if (src[j] === "/") {
          blank(i + 1, j, true);
          i = j + 1;
          continue;
        }
      }
      if (closer) {
        if (c === "{") depth++;
        else if (c === "}") {
          if (depth === 0) return i + 1;
          depth--;
        }
      }
      i++;
    }
    return i;
  };
  /** @param {number} j offset of the opening backtick @returns {number} offset after the closing one */
  const template = (j) => {
    let k = j + 1;
    while (k < src.length) {
      const c = src[k];
      if (c === "\\") { k += 2; continue; }
      if (c === "`") return k + 1;
      if (c === "$" && src[k + 1] === "{") { k = scan(k + 2, true); continue; }
      k++;
    }
    return k;
  };
  scan(0, false);
  return out.join("");
}

/**
 * The block that opens at the brace at offset open, to its matching brace, counted on masked
 * text (see maskCode), as [open, end) offsets.
 * @param {string} masked @param {number} open
 * @returns {[number, number]}
 */
export function blockRange(masked, open) {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === "{") depth++;
    else if (masked[i] === "}" && --depth === 0) return [open, i + 1];
  }
  return [open, masked.length];
}

/**
 * Body ranges of every function in masked text: function declarations and expressions, and arrow
 * functions with a block body. A declaration inside one of these is not a global.
 * @param {string} masked
 * @returns {[number, number][]}
 */
export function functionBodies(masked) {
  /** @type {[number, number][]} */ const out = [];
  for (const m of masked.matchAll(/\bfunction\b\s*\*?\s*[\w$]*\s*\(/g)) {
    let depth = 0;
    let i = /** @type {number} */ (m.index) + m[0].length - 1;
    for (; i < masked.length; i++) {
      if (masked[i] === "(") depth++;
      else if (masked[i] === ")" && --depth === 0) break;
    }
    const open = masked.indexOf("{", i);
    if (open >= 0) out.push(blockRange(masked, open));
  }
  for (const m of masked.matchAll(/=>\s*\{/g)) out.push(blockRange(masked, /** @type {number} */ (m.index) + m[0].length - 1));
  return out;
}

/** True when offset at lies inside one of the ranges. @param {[number, number][]} ranges @param {number} at */
export const inside = (ranges, at) => ranges.some(([a, b]) => at > a && at < b);

const SKIP = new Set(["node_modules", "dist", ".git"]);

/**
 * The extensions of script source the source-scanning contracts read by default: every module
 * flavour esbuild bundles (TypeScript and JavaScript, ES module, CommonJS and JSX forms), so a
 * server module is not out of scope because of its extension.
 */
export const SOURCE_EXTS = [".ts", ".mts", ".cts", ".tsx", ".js", ".mjs", ".cjs", ".jsx"];

/** True for a TypeScript declaration file (.d.ts, .d.mts, .d.cts): types only, no code. @param {string} rel */
export const isDeclarationFile = (rel) => /\.d\.[mc]?ts$/.test(rel);

/**
 * Every file under dir whose name ends in one of exts, sorted, as absolute paths.
 * @param {string} dir @param {string[]} [exts] default SOURCE_EXTS
 * @returns {string[]}
 */
export function listFiles(dir, exts = SOURCE_EXTS) {
  /** @type {string[]} */ const out = [];
  /** @param {string} d */
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      if (SKIP.has(name)) continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (exts.some((e) => name.endsWith(e))) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** Posix-style path of f relative to dir. @param {string} dir @param {string} f */
export const relPath = (dir, f) => relative(dir, f).split(sep).join("/");

/** @param {string} f */
export const read = (f) => readFileSync(f, "utf8");

/** 1-based line of an offset. @param {string} text @param {number} at */
export const lineOf = (text, at) => text.slice(0, at).split("\n").length;

/**
 * True when file (relative posix path) is covered by an allow entry: an exact relative path, a
 * bare file name, or a path suffix.
 * @param {string} file @param {string[]} [allow]
 */
export function isAllowed(file, allow = []) {
  return allow.some((a) => file === a || file.endsWith("/" + a));
}

/**
 * Wire a check into a describe/it/expect triple: one it() that fails with the violation list.
 * @param {(name: string, fn: () => void) => void} describe
 * @param {(name: string, fn: () => void) => void} it
 * @param {(v: any) => any} expect
 * @param {string} title
 * @param {() => string[]} run
 */
export function wire(describe, it, expect, title, run) {
  describe(title, () => {
    it("has no violations", () => {
      expect(run()).toEqual([]);
    });
  });
}

/**
 * A violation when a scan saw fewer files than expected, so a wrong srcDir (or a dir holding only
 * vendored kit or browser files) fails loudly instead of passing vacuously. Empty list when fine.
 * @param {unknown[]} files the scanned files @param {number} minFiles @param {string | string[]} srcDir
 * @returns {string[]}
 */
export function scannedEnough(files, minFiles, srcDir) {
  if (files.length >= minFiles) return [];
  return ["scanned " + files.length + " file(s) under " + [].concat(/** @type {any} */ (srcDir)).join(", ") + ", expected at least " + minFiles + " (wrong srcDir, or only kit/ or client/ files there)"];
}

// Anchored to the first path segment under the scanned directory: the vendored kit is src/kit and
// the browser code is src/client, never a folder of that name deeper in the tree (a server module
// filed under src/server/client/ or src/server/kit/ is server code and stays in scope).
/** True when rel (relative to the scanned dir) is in the vendored kit, src/kit. @param {string} rel */
export const isKitPath = (rel) => /^kit\//.test(rel);
/** True when rel (relative to the scanned dir) is browser code, src/client. @param {string} rel */
export const isClientPath = (rel) => /^client\//.test(rel);

/**
 * Source files of an app for the static contracts, with the same scoping rules everywhere: the
 * vendored kit (kit/ right under a scanned dir, src/kit/<pkg>/...) is skipped unless includeKit,
 * browser code (client/ right under a scanned dir) is skipped unless includeClient, and allow
 * entries (relative path, file name or path suffix) are skipped. A folder named kit or client
 * deeper in the tree is scanned like any other.
 * @param {string | string[]} srcDir one directory or several
 * @param {{ exts?: string[], allow?: string[], includeKit?: boolean, includeClient?: boolean }} [o]
 * @returns {{ file: string, rel: string }[]}
 */
export function sourceFiles(srcDir, { exts, allow = [], includeKit = false, includeClient = true } = {}) {
  /** @type {{ file: string, rel: string }[]} */ const out = [];
  for (const dir of Array.isArray(srcDir) ? srcDir : [srcDir]) {
    for (const file of listFiles(dir, exts)) {
      const rel = relPath(dir, file);
      if (!includeKit && isKitPath(rel)) continue;
      if (!includeClient && isClientPath(rel)) continue;
      if (isAllowed(rel, allow)) continue;
      out.push({ file, rel });
    }
  }
  return out;
}
