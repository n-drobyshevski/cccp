// The kit-imports step of the kit-shaped profile, and the helpers the client-side steps share.
// kit-imports decides, for each source helper module under src/client/lib/, whether the kit's module
// of the same name stands in for it: it does when every export of the source module is one the kit
// module has (maps.fitsKit) and no exported function of the source takes more parameters than the
// kit's function of that name (a second parameter the kit ignores is a silent change of meaning). A
// module that fits is not copied: imports of it become @gas-kit/client/<x>.js. One that does not is
// copied to src/client/migrated/lib/<x>.js and gets an agent step reconcile-<x>. The step records
// the decision of every lib module in maps.modules (a kit specifier, the copy's target path, or
// "pending") and WRITES the copies itself; copy-pages then applies the same map to the pages.
// Every copied client file goes through portClientJs: its imports are rewritten, html templates are
// checked against the kit's stricter html tag (a conditional bare attribute becomes attrs(), a
// literal hash link gets target="_self" so it stays in Apps Script's frame), every
// untyped parameter gets an explicit any type so tsc checkJs accepts it, and it is refused when it
// breaks a kit rule (a markup sink, raw(), title, an inline handler, a double slash, direct storage,
// a google.* global, a colour literal), in which case it stays in .migrate/pending.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { KIT_CLIENT_MODULES, fitsKit, kitExports } from "../maps.mjs";
import { scanJs, tokenizeJs, unquote } from "../scan/js.mjs";
import { findJsColourLiterals } from "../../../../tooling/src/test/contracts/noColourOutsideTokens.js";
import { rawUses } from "../../../../tooling/src/test/contracts/noRaw.js";
import { findTitles } from "../../../../tooling/src/test/contracts/noTitleAttr.js";
import { stripComments } from "../../../../tooling/src/test/contracts/_util.js";
import { leaveReason, templateFrameEdits, templateParts } from "../frameLinks.mjs";
import { jsHeader, pagesFor, pendingPath } from "./_common.mjs";
import { agentStep, applyEdits, importSites, listOf, relSpec, spawnId } from "./copyDomain.mjs";

/** @typedef {import("../apply.mjs").StepContext} StepContext */
/** @typedef {import("../apply.mjs").StepResult} StepResult */
/** @typedef {import("../scan/js.mjs").JsToken} JsToken */
/** @typedef {import("./copyDomain.mjs").Located} Located */
/** @typedef {import("./copyDomain.mjs").SpawnStep} SpawnStep */

export const LIB = "src/client/lib/";
export const MIGRATED = "src/client/migrated/";
export const KIT_HTML = "@gas-kit/client/html.js";

/** One import line of generated code. @param {string[]} names @param {string} spec */
export const importLine = (names, spec) => ["import {", names.join(", "), "} from", JSON.stringify(spec) + ";"].join(" ");

/**
 * The index of the token that closes the bracket (or template) opened at i, or -1.
 * @param {JsToken[]} toks @param {number} i
 */
export function closeOf(toks, i) {
  let depth = 0;
  for (let k = i; k < toks.length; k++) {
    const t = /** @type {JsToken} */ (toks[k]);
    if (t.type === "punct" && (t.value === "(" || t.value === "[" || t.value === "{")) depth++;
    else if (t.type === "punct" && (t.value === ")" || t.value === "]" || t.value === "}")) depth--;
    else if (t.type === "template") {
      const open = t.value.endsWith("${");
      if (t.value.startsWith("`") && open) depth++;
      else if (t.value.startsWith("}") && !open) depth--;
    }
    if (depth === 0) return k;
  }
  return -1;
}

/**
 * The index of the token that opens the bracket closed at i, or -1.
 * @param {JsToken[]} toks @param {number} i
 */
export function openOf(toks, i) {
  let depth = 0;
  for (let k = i; k >= 0; k--) {
    const t = /** @type {JsToken} */ (toks[k]);
    if (t.type === "punct" && (t.value === ")" || t.value === "]" || t.value === "}")) depth++;
    else if (t.type === "punct" && (t.value === "(" || t.value === "[" || t.value === "{")) depth--;
    else if (t.type === "template") {
      const open = t.value.endsWith("${");
      if (t.value.startsWith("}") && !open) depth++;
      else if (t.value.startsWith("`") && open) depth--;
    }
    if (depth === 0) return k;
  }
  return -1;
}

/**
 * Split tokens lo..hi (exclusive) at the commas of depth 0.
 * @param {JsToken[]} toks @param {number} lo @param {number} hi
 * @returns {[number, number][]} [from, to) per part, empty parts dropped
 */
export function splitArgs(toks, lo, hi) {
  /** @type {[number, number][]} */
  const out = [];
  let from = lo;
  for (let k = lo; k < hi; k++) {
    const t = /** @type {JsToken} */ (toks[k]);
    if (t.type === "punct" && (t.value === "(" || t.value === "[" || t.value === "{") || (t.type === "template" && t.value.startsWith("`") && t.value.endsWith("${"))) {
      const c = closeOf(toks, k);
      if (c < 0) break;
      k = c;
      continue;
    }
    if (t.type === "punct" && t.value === ",") {
      if (k > from) out.push([from, k]);
      from = k + 1;
    }
  }
  if (hi > from) out.push([from, hi]);
  return out;
}

const JSDOC_BEFORE = /\/\*\*(?:(?!\*\/)[\s\S])*@(?:param|type|returns|template|callback)(?:(?!\*\/)[\s\S])*\*\/\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:(?:const|let|var)\s+[\w$]+\s*=\s*)?(?:async\s+)?(?:static\s+|get\s+|set\s+)?$/;
const NOT_METHOD = new Set(["if", "for", "while", "switch", "catch", "with", "function", "return", "typeof", "await", "new", "void", "delete", "in", "of", "instanceof", "yield", "super", "import", "require"]);

/**
 * Give every untyped parameter an explicit any type (an inline JSDoc comment), and every `let`
 * initialised with an object literal an any type, so a source written without JSDoc passes the
 * target's tsc checkJs strict. A function with a JSDoc block that types it is left alone. Comments
 * only: the code runs the same.
 * @param {string} text
 * @returns {{ text: string, count: number }}
 */
export function typeAny(text) {
  const toks = tokenizeJs(text).filter((t) => t.type !== "comment");
  /** @type {{ start: number, end: number, text: string }[]} */
  const edits = [];
  /** @type {Set<number>} */
  const done = new Set();
  let count = 0;
  /** @param {number} at */
  const documented = (at) => JSDOC_BEFORE.test(text.slice(Math.max(0, at - 600), at));
  /** @param {number} open @param {number} close */
  const params = (open, close) => {
    if (done.has(open)) return;
    done.add(open);
    for (const [a] of splitArgs(toks, open + 1, close)) {
      const first = /** @type {JsToken} */ (toks[a]);
      const gap = text.slice(/** @type {JsToken} */ (toks[a - 1]).end, first.start);
      if (/@type\b/.test(gap)) continue;
      edits.push({ start: first.start, end: first.start, text: first.value === "..." ? "/** @type {any[]} */ " : "/** @type {any} */ " });
      count++;
    }
  };
  for (let i = 0; i < toks.length; i++) {
    const t = /** @type {JsToken} */ (toks[i]);
    if (t.type === "punct" && t.value === "=>") {
      const p = toks[i - 1];
      if (!p) continue;
      if (p.type === "ident") {
        const gap = text.slice(toks[i - 2]?.end ?? 0, p.start);
        if (/@type\b/.test(gap)) continue;
        edits.push({ start: p.start, end: p.end, text: "(/** @type {any} */ " + p.value + ")" });
        count++;
      } else if (p.value === ")") {
        const open = openOf(toks, i - 1);
        if (open >= 0 && !documented(/** @type {JsToken} */ (toks[open]).start)) params(open, i - 1);
      }
      continue;
    }
    if (t.type === "ident" && t.value === "function" && toks[i - 1]?.value !== ".") {
      let j = i + 1;
      if (toks[j]?.value === "*") j++;
      if (toks[j]?.type === "ident" && toks[j]?.value !== "(") j++;
      if (toks[j]?.value === "(" && !documented(t.start)) {
        const close = closeOf(toks, j);
        if (close > j) params(j, close);
      }
      continue;
    }
    if (t.type === "ident" && toks[i + 1]?.value === "(" && !NOT_METHOD.has(t.value)) {
      const prev = toks[i - 1];
      const methodish = !prev || ["{", ",", "}", ";"].includes(prev.value) || (prev.type === "ident" && ["get", "set", "static", "async"].includes(prev.value));
      if (!methodish) continue;
      const close = closeOf(toks, i + 1);
      if (close > 0 && toks[close + 1]?.value === "{" && !documented(t.start)) params(i + 1, close);
      continue;
    }
    if (t.type === "ident" && t.value === "let" && toks[i + 1]?.type === "ident" && toks[i + 2]?.value === "=" && toks[i + 3]?.value === "{" && !documented(t.start)) {
      edits.push({ start: t.start, end: t.start, text: "/** @type {any} */\n" + indentAt(text, t.start) });
      count++;
    }
  }
  return { text: applyEdits(text, edits), count };
}

/** The whitespace before offset at on its line. @param {string} text @param {number} at */
function indentAt(text, at) {
  const line = text.slice(text.lastIndexOf("\n", at - 1) + 1, at);
  return /^\s*$/.test(line) ? line : "";
}

/**
 * The template literals of a script: the tag before each (an identifier, or null), the literal parts
 * and the token range of each interpolation.
 * @typedef {{ tag: string | null, parts: string[], holes: { lo: number, hi: number, start: number, end: number }[] }} Template
 * @param {JsToken[]} toks non-comment tokens
 * @returns {Template[]}
 */
export function templatesOf(toks) {
  /** @type {Template[]} */
  const out = [];
  /** @type {{ t: Template, last: number }[]} */
  const stack = [];
  /** @param {string} v */
  const inner = (v) => v.slice(1, v.endsWith("${") ? -2 : v.endsWith("`") ? -1 : v.length);
  for (let i = 0; i < toks.length; i++) {
    const tok = /** @type {JsToken} */ (toks[i]);
    if (tok.type !== "template") continue;
    const opens = tok.value.endsWith("${") && !(tok.value.length >= 2 && tok.value.startsWith("`") && tok.value.endsWith("`"));
    if (tok.value.startsWith("`")) {
      const prev = toks[i - 1];
      /** @type {Template} */
      const t = { tag: prev && prev.type === "ident" ? prev.value : null, parts: [inner(tok.value)], holes: [] };
      if (opens) stack.push({ t, last: i });
      else out.push(t);
      continue;
    }
    const top = stack[stack.length - 1];
    if (!top) continue;
    const from = /** @type {JsToken} */ (toks[top.last]);
    top.t.holes.push({ lo: top.last + 1, hi: i, start: from.end, end: tok.start });
    top.t.parts.push(inner(tok.value));
    top.last = i;
    if (!opens) {
      stack.pop();
      out.push(top.t);
    }
  }
  return out;
}

/**
 * The markup context of each interpolation of a template, read from its literal parts the way the
 * kit's html tag reads them: text, inside a tag, a quoted attribute value (with its name), or a
 * place the kit refuses outright.
 * @param {string[]} parts
 * @returns {({ k: "text" } | { k: "tag" } | { k: "value", attr: string } | { k: "bad", why: string })[]}
 */
export function holeContexts(parts) {
  /** @type {any[]} */
  const out = [];
  let st = "text";
  let tag = "";
  let name = "";
  let quote = "";
  let closing = false;
  let rawEnd = "";
  for (let p = 0; p < parts.length; p++) {
    const s = /** @type {string} */ (parts[p]);
    let i = 0;
    while (i < s.length) {
      const c = /** @type {string} */ (s[i]);
      if (st === "text") {
        if (s.startsWith("<!--", i)) { st = "comment"; i += 4; }
        else if (c === "<" && (i + 1 === s.length || /[A-Za-z/]/.test(s[i + 1] ?? ""))) { closing = s[i + 1] === "/"; st = "tagname"; tag = ""; i += closing ? 2 : 1; }
        else i++;
      } else if (st === "comment") {
        if (s.startsWith("-->", i)) { st = "text"; i += 3; } else i++;
      } else if (st === "tagname") {
        if (/[\w-]/.test(c)) { tag += c.toLowerCase(); i++; } else st = "tag";
      } else if (st === "tag") {
        if (c === ">") { st = !closing && ["script", "style", "textarea", "title"].includes(tag) ? "raw" : "text"; rawEnd = "</" + tag; i++; }
        else if (/[\s/]/.test(c)) i++;
        else { st = "attr"; name = ""; }
      } else if (st === "attr") {
        if (c === "=") { st = "before"; i++; }
        else if (/\s/.test(c)) { st = "afterattr"; i++; }
        else if (c === ">" || c === "/") st = "tag";
        else { name += c.toLowerCase(); i++; }
      } else if (st === "afterattr") {
        if (c === "=") { st = "before"; i++; } else if (/\s/.test(c)) i++; else st = "tag";
      } else if (st === "before") {
        if (/\s/.test(c)) i++;
        else if (c === '"' || c === "'") { st = "value"; quote = c; i++; }
        else st = "unquoted";
      } else if (st === "unquoted") {
        if (/\s/.test(c)) { st = "tag"; i++; } else if (c === ">") st = "tag"; else i++;
      } else if (st === "value") {
        if (c === quote) { st = "tag"; i++; } else i++;
      } else {
        if (s.slice(i, i + rawEnd.length).toLowerCase() === rawEnd) { st = "tagname"; tag = ""; closing = true; i += 2; } else i++;
      }
    }
    if (p === parts.length - 1) break;
    if (st === "text" || st === "comment") out.push({ k: "text" });
    else if (st === "raw") out.push({ k: "bad", why: "is inside a script, style, textarea or title element" });
    else if (st === "tagname") out.push({ k: "bad", why: "is in a tag name" });
    else if (st === "tag" || st === "afterattr" || (st === "attr" && name === "")) { out.push({ k: "tag" }); st = "tag"; }
    else if (st === "attr") out.push({ k: "bad", why: "is part of an attribute name" });
    else if (st === "before" || st === "unquoted") out.push({ k: "bad", why: "is an unquoted attribute value" });
    else if (name.startsWith("on") || name === "srcdoc") out.push({ k: "bad", why: "is inside a " + name + " attribute" });
    else if (name === "style") out.push({ k: "bad", why: "is inside a style attribute (the kit takes only a number or cssValue() there)" });
    else out.push({ k: "value", attr: name });
  }
  return out;
}

const ATTR_NAME = /^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/;

/** A string token holding "" or one bare attribute name the kit's attrs() accepts. @param {JsToken | undefined} t */
function bareAttr(t) {
  if (!t || t.type !== "string") return null;
  const v = unquote(t.value).trim();
  if (v === "") return "";
  if (!ATTR_NAME.test(v) || /^on/i.test(v) || /^(title|srcdoc)$/i.test(v)) return null;
  return v;
}

/**
 * The attrs({...}) text for an interpolation inside a tag that the source wrote as a conditional
 * bare attribute (cond ? "checked" : "", cond && "disabled"), or null for any other shape.
 * @param {string} text @param {JsToken[]} toks @param {number} lo @param {number} hi @param {string} attrsName
 */
function attrsFor(text, toks, lo, hi, attrsName) {
  const top = [];
  for (let k = lo; k < hi; k++) {
    const t = /** @type {JsToken} */ (toks[k]);
    if ((t.type === "punct" && "([{".includes(t.value) && t.value.length === 1) || (t.type === "template" && t.value.startsWith("`") && t.value.endsWith("${"))) {
      const c = closeOf(toks, k);
      if (c < 0 || c >= hi) return null;
      k = c;
      continue;
    }
    if (t.type === "punct" && ["?", ":", "&&", "||", "??", ",", "="].includes(t.value)) top.push(k);
  }
  const at = (/** @type {number} */ k) => /** @type {JsToken} */ (toks[k]);
  const cond = (/** @type {number} */ end) => text.slice(at(lo).start, at(end).start).trim();
  /** @param {string} name @param {string} expr */
  const entry = (name, expr) => JSON.stringify(name) + ": " + expr;
  if (top.length === 2 && at(/** @type {number} */ (top[0])).value === "?" && at(/** @type {number} */ (top[1])).value === ":" && top[1] === /** @type {number} */ (top[0]) + 2 && hi === /** @type {number} */ (top[1]) + 2) {
    const yes = bareAttr(toks[/** @type {number} */ (top[0]) + 1]);
    const no = bareAttr(toks[/** @type {number} */ (top[1]) + 1]);
    const c = cond(/** @type {number} */ (top[0]));
    if (yes === null || no === null || !c) return null;
    if (yes === "" && no === "") return '""';
    /** @type {string[]} */
    const parts = [];
    if (yes && yes === no) parts.push(entry(yes, "true"));
    else {
      if (yes) parts.push(entry(yes, "!!(" + c + ")"));
      if (no) parts.push(entry(no, "!(" + c + ")"));
    }
    return attrsName + "({ " + parts.join(", ") + " })";
  }
  if (top.length === 1 && at(/** @type {number} */ (top[0])).value === "&&" && hi === /** @type {number} */ (top[0]) + 2) {
    const yes = bareAttr(toks[/** @type {number} */ (top[0]) + 1]);
    const c = cond(/** @type {number} */ (top[0]));
    if (!yes || !c) return null;
    return attrsName + "({ " + entry(yes, "!!(" + c + ")") + " })";
  }
  return null;
}

/**
 * Check the html templates of a script against the kit's html tag, which refuses a plain value
 * inside a tag, an unquoted value, a tag name, a script or style body and an on* or style value.
 * A conditional bare attribute inside a tag is rewritten to attrs(); anything else is a problem.
 * @param {string} text @param {Set<string>} tags the local names of the kit's html tag
 * @param {string} attrsName the local name attrs is (or will be) imported as
 * @returns {{ edits: { start: number, end: number, text: string }[], problems: string[], usesAttrs: boolean }}
 */
export function htmlHoles(text, tags, attrsName) {
  const toks = tokenizeJs(text).filter((t) => t.type !== "comment");
  /** @type {{ start: number, end: number, text: string }[]} */
  const edits = [];
  /** @type {string[]} */
  const problems = [];
  let usesAttrs = false;
  for (const t of templatesOf(toks)) {
    if (!t.tag || !tags.has(t.tag)) continue;
    const ctxs = holeContexts(t.parts);
    t.holes.forEach((h, n) => {
      const c = ctxs[n];
      const line = text.slice(0, h.start).split("\n").length;
      if (!c || c.k === "text" || c.k === "value") return;
      if (c.k === "bad") {
        problems.push("an html interpolation on line " + line + " " + c.why);
        return;
      }
      const fixed = attrsFor(text, toks, h.lo, h.hi, attrsName);
      if (fixed === null) problems.push("an html interpolation on line " + line + " puts a plain value inside a tag (the kit's html takes attrs() there)");
      else {
        edits.push({ start: h.start, end: h.end, text: fixed });
        if (fixed !== '""') usesAttrs = true;
      }
    });
  }
  return { edits, problems, usesAttrs };
}

const CODE_BANS = /** @type {[RegExp, string][]} */ ([
  [/\b(?:localStorage|sessionStorage)\b/, "touches localStorage directly (the kit's createStorage wraps it)"],
  [/(?<![\w$.])google\s*\./, "calls a google.* global (the kit's rpc and router stand in)"],
  [/\bUserProperties\b|getUserProperties/, "uses UserProperties"],
  [/createElement\s*\(\s*["'`]script/i, "creates a script element"],
  [/\bpostMessage\s*\(|addEventListener\s*\(\s*["'`]message["'`]|\bonmessage\b/, "talks to other windows (postMessage or a message listener)"],
  [/\bdocument\s*\.\s*write(?:ln)?\b/, "calls document.write"],
  [/\bDOMParser\b|parseFromString|createContextualFragment|setHTMLUnsafe|parseHTMLUnsafe/, "parses markup outside the kit's sinks"],
  [/(?<![\w$])eval\s*\(|\bnew\s+Function\s*\(/, "runs text as code"],
  [/\bnew\s+Date\s*\(\s*["'`]\d{4}-\d{2}-\d{2}["'`]\s*\)|Date\.parse\s*\(\s*["'`]\d{4}-\d{2}-\d{2}["'`]/, "parses a date-only string with new Date"],
]);

/**
 * Why a client script breaks a kit rule, or [] when it keeps them all.
 * @param {string} text @param {string} label for messages
 */
export function clientRuleBreaks(text, label) {
  /** @type {Set<string>} */
  const out = new Set();
  const f = scanJs(text);
  for (const s of f.sinks) out.add("writes markup through " + s.kind + " (line " + s.line + ")");
  if (f.titles.length) out.add("sets a title attribute (line " + /** @type {any} */ (f.titles[0]).line + "): use data-tip");
  for (const h of f.handlers) out.add("has an inline " + h.name + " handler (line " + h.line + "): use delegate");
  for (const r of f.rpc) if (r.shape === "gsr-chain") out.add("calls google.script.run directly (line " + r.line + ")");
  for (const t of findTitles(label, text)) out.add("has a title attribute (line " + t.line + "): use data-tip");
  for (const u of rawUses(text)) out.add(u.what + " (raw() and html() as a function need a reviewed allow list entry)");
  for (const c of findJsColourLiterals(text)) out.add("has a colour literal on line " + c.line + " (colours live in the token files)");
  for (const t of tokenizeJs(text)) {
    if ((t.type === "string" || t.type === "template" || t.type === "regex") && t.value.includes("//")) {
      out.add("has a literal double slash on line " + t.line + " (the Apps Script middlebox strips it)");
    }
  }
  const code = stripComments(text);
  for (const [re, what] of CODE_BANS) if (re.test(code)) out.add(what);
  for (const m of code.matchAll(/\b(innerHTML|outerHTML|insertAdjacentHTML)\b/g)) out.add("names the markup sink " + m[1]);
  return [...out];
}

/**
 * Port one client script to the target: rewrite its imports with locate, fit its html templates to
 * the kit's tag (a literal hash link gets target="_self"), type its parameters, check the kit
 * rules. text is the source text (or a generated text whose specifiers are relative to key).
 * links: notes on hash links that keep a target of their own, as "key:line: ...".
 * @param {StepContext} ctx
 * @param {{ key: string, text: string, toRel: string, locate: (key: string) => Located, from?: string }} o
 * @returns {{ text: string, problems: string[], typed: number, links: string[] }}
 */
export function portClientJs(ctx, { key, text, toRel, locate, from }) {
  /** @type {string[]} */
  const problems = [];
  /** @type {{ start: number, end: number, text: string }[]} */
  const edits = [];
  const sites = importSites(text);
  /** @type {Set<string>} */
  const tags = new Set();
  let attrsName = "";
  /** @type {import("./copyDomain.mjs").ImportSite | null} */
  let htmlSite = null;
  /** @type {Set<string>} */
  const locals = new Set();
  for (const site of sites) {
    for (const n of site.names ?? []) locals.add(n.local);
    if (site.dynamic) {
      problems.push("loads a module at run time (import() or require())");
      continue;
    }
    /** @type {Located} */
    let at;
    if (site.spec.startsWith("@gas-kit/")) at = { spec: site.spec };
    else if (!site.spec.startsWith("./") && !site.spec.startsWith("../")) at = { problem: "imports the package " + JSON.stringify(site.spec.slice(0, 80)) };
    else {
      const k = ctx.tree.resolve(key, site.spec);
      at = k ? locate(k) : { problem: "imports " + JSON.stringify(site.spec.slice(0, 80)) + ", which is not in the source" };
    }
    if ("problem" in at) {
      problems.push(at.problem);
      continue;
    }
    const spec = "spec" in at ? at.spec : relSpec(toRel, at.path, /\.(?:m?js|ts)$/.test(site.spec));
    if (spec !== site.spec) {
      const q = text.charAt(site.start) === "'" ? "'" : '"';
      edits.push({ start: site.start, end: site.end, text: q + spec + q });
    }
    if (spec === KIT_HTML && site.names) {
      for (const n of site.names) {
        if (n.imported === "html") tags.add(n.local);
        if (n.imported === "attrs") attrsName = n.local;
      }
      if (!htmlSite && site.names.some((n) => n.imported !== "*" && n.imported !== "default")) htmlSite = site;
    }
  }
  const wantAttrs = attrsName || (locals.has("attrs") ? "" : "attrs");
  const holes = htmlHoles(text, tags, wantAttrs || "attrs");
  problems.push(...holes.problems);
  edits.push(...holes.edits);
  const links = frameLinkFixes(text, tags, pagesFor(ctx));
  edits.push(...links.edits);
  if (holes.usesAttrs && !attrsName) {
    const brace = htmlSite ? text.indexOf("{", htmlSite.stmtStart) : -1;
    if (!wantAttrs || !htmlSite || brace < 0 || brace > htmlSite.start) problems.push("needs attrs() from the kit's html module, and cannot import it under that name");
    else edits.push({ start: brace + 1, end: brace + 1, text: " attrs," });
  }
  const typed = typeAny(applyEdits(text, edits));
  problems.push(...clientRuleBreaks(typed.text, toRel));
  return { text: jsHeader(ctx.step.id, from ?? key) + typed.text, problems: [...new Set(problems)], typed: typed.count, links: links.notes.map((n) => key + ":" + n) };
}

/**
 * The hash links of a script's html templates kept in Apps Script's frame (frameLinks.mjs): a
 * literal hash href gains target="_self", a _top, _parent or empty target on one becomes _self.
 * Another target is kept, with a note; a computed href is not read. A ?page= link to one of pages
 * becomes its hash route first; one to another page gets a marker; each relative link left is noted.
 * @param {string} text @param {Set<string>} tags the local names of the kit's html tag
 * @param {import("../frameLinks.mjs").AppPages} [pages]
 * @returns {{ edits: { start: number, end: number, text: string }[], notes: string[], fixed: number }}
 */
export function frameLinkFixes(text, tags, pages = new Map()) {
  /** @type {{ start: number, end: number, text: string }[]} */
  const edits = [];
  /** @type {string[]} */
  const notes = [];
  let fixed = 0;
  for (const t of templateParts(tokenizeJs(text))) {
    if (!t.tag || !tags.has(t.tag)) continue;
    const r = templateFrameEdits(t, pages);
    edits.push(...r.edits);
    /** @param {number} pos */
    const line = (pos) => text.slice(0, pos).split("\n").length;
    for (const l of r.links) {
      if (l.fix !== "keep") fixed++;
      else notes.push(line(l.pos) + ": the hash link " + leaveReason(l.target) + ": make it _self unless it opens a new window on purpose");
    }
    for (const l of r.relative) {
      if (l.fix === "left") notes.push(line(l.pos) + ": the page link " + JSON.stringify(l.href) + " is not rewritten: " + l.why);
      else if (l.fix === "report") notes.push(line(l.pos) + ": the link " + JSON.stringify(l.href) + " " + l.why + ": make it a hash route, or a full reload with the service URL and target _top");
    }
  }
  return { edits, notes, fixed };
}

/**
 * Parameter counts of a module's exported functions (rest parameters not counted).
 * @param {string} text
 * @returns {Map<string, number>}
 */
export function arities(text) {
  const toks = tokenizeJs(text).filter((t) => t.type !== "comment");
  /** @type {Map<string, number>} */
  const out = new Map();
  /** @param {number} open */
  const count = (open) => {
    const close = closeOf(toks, open);
    if (close < 0) return -1;
    return splitArgs(toks, open + 1, close).filter(([a]) => toks[a]?.value !== "...").length;
  };
  for (let i = 0; i < toks.length; i++) {
    if (toks[i]?.value !== "export" || toks[i]?.type !== "ident") continue;
    let j = i + 1;
    if (toks[j]?.value === "async") j++;
    if (toks[j]?.value === "function") {
      j++;
      if (toks[j]?.value === "*") j++;
      const name = toks[j]?.value;
      if (name && toks[j + 1]?.value === "(") out.set(name, count(j + 1));
      continue;
    }
    if (toks[j]?.value === "const" || toks[j]?.value === "let") {
      const name = toks[j + 1]?.value;
      if (!name || toks[j + 2]?.value !== "=") continue;
      let k = j + 3;
      if (toks[k]?.value === "async") k++;
      if (toks[k]?.value === "function") {
        k++;
        if (toks[k]?.type === "ident") k++;
      }
      if (toks[k]?.value === "(") out.set(name, count(k));
      else if (toks[k]?.type === "ident" && toks[k + 1]?.value === "=>") out.set(name, 1);
    }
  }
  return out;
}

/**
 * Whether the kit's module stands in for a source lib module, and why not.
 * @param {StepContext} ctx @param {string} text @param {string} spec a @gas-kit/client/<x>.js specifier
 */
export function kitFit(ctx, text, spec) {
  const src = scanJs(text).exports;
  const kit = kitExports(ctx.kitRoot, spec);
  /** @type {string[]} */
  const reasons = [];
  if (!kit.length) reasons.push("the kit has no module " + spec);
  else if (!fitsKit(src, kit)) reasons.push("exports " + src.filter((e) => !kit.includes(e)).join(", ") + ", which " + spec + " does not");
  const file = join(ctx.kitRoot, "packages", "client", "src", spec.replace(/^@gas-kit\/client\//, ""));
  if (kit.length && existsSync(file)) {
    const mine = arities(text);
    const theirs = arities(readFileSync(file, "utf8"));
    for (const [name, n] of mine) {
      const m = theirs.get(name);
      if (m !== undefined && m >= 0 && n > m) reasons.push(name + " takes " + n + " parameter" + (n === 1 ? "" : "s") + " and the kit's takes " + m);
    }
  }
  return { fits: reasons.length === 0, reasons };
}

/** The kit specifier that may stand in for a lib key, or null. @param {string} key @param {Record<string, string>} modules */
export function kitSpecFor(key, modules) {
  const m = modules[key];
  if (typeof m === "string" && m.startsWith("@gas-kit/")) return m;
  const x = key.slice(LIB.length).replace(/\.js$/, "");
  return KIT_CLIENT_MODULES.includes(x) ? "@gas-kit/client/" + x + ".js" : null;
}

/** @param {StepContext} ctx @returns {StepResult} */
export function run(ctx) {
  const modules = /** @type {Record<string, string>} */ ({ ...(ctx.plan.maps.modules ?? {}) });
  const keys = ctx.inv.files.filter((f) => f.key.startsWith(LIB) && f.kind === "js").map((f) => f.key).sort();
  /** @type {Map<string, { kit: string | null, use: "kit" | "copy", reasons: string[], text: string }>} */
  const plan = new Map();
  for (const key of keys) {
    const text = ctx.tree.read(key);
    const kit = kitSpecFor(key, modules);
    const forced = typeof modules[key] === "string" && /** @type {string} */ (modules[key]).startsWith("src/");
    const fit = kit ? kitFit(ctx, text, kit) : { fits: false, reasons: [] };
    plan.set(key, { kit, use: kit && fit.fits && !forced ? "kit" : "copy", reasons: fit.reasons, text });
  }
  /** @param {string} key */
  const copyPath = (key) => {
    const m = modules[key];
    return typeof m === "string" && m.startsWith("src/client/migrated/") ? m : MIGRATED + "lib/" + key.slice(LIB.length);
  };
  /** @type {Set<string>} */
  const failed = new Set();
  /** @type {Map<string, { text: string, problems: string[], typed: number }>} */
  let ported = new Map();
  for (let round = 0; round < keys.length + 1; round++) {
    ported = new Map();
    let more = false;
    for (const [key, d] of plan) {
      if (d.use !== "copy") continue;
      /** @param {string} k @returns {Located} */
      const locate = (k) => {
        const other = plan.get(k);
        if (!other) return { problem: "imports " + k + ", outside src/client/lib" };
        if (other.use === "kit") return { spec: /** @type {string} */ (other.kit) };
        if (failed.has(k)) return { problem: "imports " + k + ", which stays pending" };
        return { path: copyPath(k) };
      };
      const r = portClientJs(ctx, { key, text: d.text, toRel: copyPath(key), locate });
      ported.set(key, r);
      if (r.problems.length && !failed.has(key)) {
        failed.add(key);
        more = true;
      }
    }
    if (!more) break;
  }
  /** @type {string[]} */
  const notes = [];
  /** @type {SpawnStep[]} */
  const spawn = [];
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, d] of plan) {
    const x = key.slice(LIB.length).replace(/\.js$/, "");
    if (d.use === "kit") {
      out[key] = /** @type {string} */ (d.kit);
      ctx.out.remove(pendingPath(key));
      notes.push(key + ": " + d.kit + " stands in for it");
      continue;
    }
    const r = /** @type {{ text: string, problems: string[], typed: number, links: string[] }} */ (ported.get(key));
    const why = [...d.reasons, ...(failed.has(key) ? r.problems : [])];
    if (failed.has(key)) {
      out[key] = "pending";
      notes.push(key + " stays in .migrate/pending: " + listOf(r.problems));
    } else {
      out[key] = copyPath(key);
      ctx.out.write(copyPath(key), r.text);
      ctx.out.remove(pendingPath(key));
      notes.push(key + " copied to " + copyPath(key) + (d.reasons.length ? " (" + listOf(d.reasons) + ")" : d.kit ? " (kept as the source wrote it)" : " (no kit module of that name)") + (r.typed ? "; " + r.typed + " untyped parameter" + (r.typed === 1 ? "" : "s") + " typed any" : ""));
      notes.push(...r.links);
    }
    if (d.reasons.length || failed.has(key)) {
      spawn.push(agentStep({
        id: spawnId(ctx, "reconcile", x),
        title: "Reconcile " + key + " with the kit" + (d.kit ? " (" + d.kit + ")" : ""),
        why: key + (failed.has(key) ? " could not be copied: " : " drifted from the kit: ") + listOf(why) + (failed.has(key) ? "" : ". Imports point at the copy, " + copyPath(key) + ": move its callers onto the kit module, or keep the copy"),
        reads: [key],
        writes: [copyPath(key)],
      }));
    }
  }
  notes.unshift(keys.length + " lib module" + (keys.length === 1 ? "" : "s") + ": " + Object.values(out).filter((v) => v.startsWith("@gas-kit/")).length + " replaced by the kit, " + Object.values(out).filter((v) => v.startsWith("src/")).length + " copied, " + failed.size + " pending. Pages are rewritten by copy-pages with this map.");
  return { notes, maps: { modules: out }, ...(spawn.length ? { spawn } : {}) };
}
