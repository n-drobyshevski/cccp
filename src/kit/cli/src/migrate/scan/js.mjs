// A linear JavaScript tokenizer and the findings the migrate command reads from a source app's
// scripts: imports and exports, top-level functions, RPC call sites, el() builder calls, markup
// sinks, title attributes, inline handlers, storage keys, key and route literals, URLs and hash
// links that would leave Apps Script's frame. It is not a parser: it knows strings, template
// literals (with nested ${} expressions), regex literals and comments, and matches brackets, which
// is enough to split call arguments. Every function here
// is total: malformed input yields what could be read, never an exception.
import { HOLE, frameLinkEdits, isHashUrl, linkAttrOf, pageRewrite, targetFix, templateFrameEdits, templateParts } from "../frameLinks.mjs";

/**
 * @typedef {object} JsToken
 * @property {"ident"|"punct"|"string"|"template"|"regex"|"comment"|"number"} type
 * @property {string} value the source text of the token. A template literal with expressions is
 *   several "template" tokens: the head ("`a${"), any middles ("}b${") and the tail ("}c`").
 * @property {number} start
 * @property {number} end
 * @property {number} line 1-based line of start
 */

/** A value as a finding keeps it: at most 120 characters. @param {string} s */
const clip = (s) => (s.length > 120 ? s.slice(0, 117) + "..." : s);

/** Keywords after which a slash starts a regex, not a division. */
const REGEX_AFTER = new Set(["return", "typeof", "case", "in", "of", "delete", "void", "throw", "new", "else", "do", "instanceof", "yield", "await", "export", "default", "extends"]);

/** Words that cannot be a binding name: a declarator list ends at one (a new statement). */
const RESERVED = new Set("break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return super switch this throw try typeof var void while with yield".split(" "));

/** Words that only ever start a statement: a declarator list never runs past one. */
const STATEMENT_START = new Set("const let var if for while do return export import switch try throw break continue debugger".split(" "));

/** Multi-character punctuators, longest first. */
const PUNCTS = [">>>=", "...", "===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??=", "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "**", "<<", ">>"];

const IDENT_RE = /[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*/uy;
const NUM_RE = /(?:0[xXoObB][\da-fA-F_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?)n?/y;
const SPACE_RE = /\s/;

/** @param {string} s */
function newlines(s) {
  let n = 0;
  for (let i = s.indexOf("\n"); i >= 0; i = s.indexOf("\n", i + 1)) n++;
  return n;
}

/**
 * Tokenize JavaScript (or TypeScript, which reads the same at this level). Whitespace is dropped;
 * comments are kept as tokens. A slash is a regex when the previous significant token cannot end
 * an expression.
 * @param {string} text
 * @returns {JsToken[]}
 */
export function tokenizeJs(text) {
  const src = typeof text === "string" ? text : "";
  const n = src.length;
  /** @type {JsToken[]} */
  const out = [];
  /** @type {("{" | "${")[]} */
  const stack = [];
  /** @type {JsToken | null} */
  let prev = null;
  let line = 1;
  let i = 0;
  // A regex scan that failed ran to the end of its line; a later slash on that line is not tried
  // again (it would rescan the same text), so the tokenizer stays linear.
  let regexFailedUntil = -1;

  /** @param {JsToken["type"]} type @param {number} start @param {number} end */
  const push = (type, start, end) => {
    const value = src.slice(start, end);
    /** @type {JsToken} */
    const tok = { type, value, start, end, line };
    out.push(tok);
    line += newlines(value);
    if (type !== "comment") prev = tok;
  };

  /**
   * The end of a template chunk that starts at from (just after the opening backtick or brace).
   * @param {number} from
   */
  const templateChunk = (from) => {
    let j = from;
    while (j < n) {
      const c = src[j];
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (c === "`") return { end: j + 1, opens: false };
      if (c === "$" && src[j + 1] === "{") return { end: j + 2, opens: true };
      j++;
    }
    return { end: n, opens: false };
  };

  const regexAllowed = () => {
    const p = prev;
    if (!p) return true;
    if (p.type === "punct") return !(p.value === ")" || p.value === "]" || p.value === "}" || p.value === "++" || p.value === "--");
    if (p.type === "ident") return REGEX_AFTER.has(p.value);
    if (p.type === "template") return p.value.endsWith("${");
    return false;
  };

  if (src.startsWith("#!")) {
    const e = src.indexOf("\n");
    push("comment", 0, e < 0 ? n : e);
    i = e < 0 ? n : e;
  }

  while (i < n) {
    const c = /** @type {string} */ (src[i]);
    const d = src[i + 1];
    if (SPACE_RE.test(c)) {
      if (c === "\n") line++;
      i++;
      continue;
    }
    if (c === "/" && d === "/") {
      let e = src.indexOf("\n", i);
      if (e < 0) e = n;
      push("comment", i, e);
      i = e;
      continue;
    }
    if (c === "/" && d === "*") {
      const e = src.indexOf("*/", i + 2);
      const end = e < 0 ? n : e + 2;
      push("comment", i, end);
      i = end;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        const x = src[j];
        if (x === "\\") {
          j += 2;
          continue;
        }
        if (x === c) {
          j++;
          break;
        }
        if (x === "\n") break;
        j++;
      }
      const end = Math.min(j, n);
      push("string", i, end);
      i = end;
      continue;
    }
    if (c === "`") {
      const ch = templateChunk(i + 1);
      push("template", i, ch.end);
      if (ch.opens) stack.push("${");
      i = ch.end;
      continue;
    }
    if (c === "}" && stack[stack.length - 1] === "${") {
      stack.pop();
      const ch = templateChunk(i + 1);
      push("template", i, ch.end);
      if (ch.opens) stack.push("${");
      i = ch.end;
      continue;
    }
    if (c === "/" && i >= regexFailedUntil && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      let ok = false;
      while (j < n) {
        const x = src[j];
        if (x === "\n" || x === "\r") break;
        if (x === "\\") {
          j += 2;
          continue;
        }
        if (x === "[") inClass = true;
        else if (x === "]") inClass = false;
        else if (x === "/" && !inClass) {
          ok = true;
          break;
        }
        j++;
      }
      if (ok) {
        j++;
        while (j < n && /[\w$]/.test(/** @type {string} */ (src[j]))) j++;
        push("regex", i, j);
        i = j;
        continue;
      }
      regexFailedUntil = j;
    }
    if ((c >= "0" && c <= "9") || (c === "." && d !== undefined && d >= "0" && d <= "9")) {
      NUM_RE.lastIndex = i;
      const m = NUM_RE.exec(src);
      const end = m && m[0].length ? i + m[0].length : i + 1;
      push("number", i, end);
      i = end;
      continue;
    }
    IDENT_RE.lastIndex = i;
    const id = IDENT_RE.exec(src);
    if (id && id[0].length) {
      push("ident", i, i + id[0].length);
      i += id[0].length;
      continue;
    }
    let len = 1;
    for (const p of PUNCTS) {
      if (src.startsWith(p, i)) {
        len = p.length;
        break;
      }
    }
    if (c === "{") stack.push("{");
    else if (c === "}" && stack.length) stack.pop();
    push("punct", i, i + len);
    i += len;
  }
  return out;
}

/**
 * The value of a string literal token (or a template with no expression), escapes decoded.
 * @param {string} raw the token text, quotes included
 */
export function unquote(raw) {
  const q = raw[0];
  let body = raw.slice(1);
  if (body.endsWith(/** @type {string} */ (q)) && body.length >= 1 && !(body.endsWith("\\" + q) && !body.endsWith("\\\\" + q))) body = body.slice(0, -1);
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== "\\") {
      out += c;
      continue;
    }
    const e = body[++i];
    if (e === undefined) break;
    if (e === "n") out += "\n";
    else if (e === "r") out += "\r";
    else if (e === "t") out += "\t";
    else if (e === "b") out += "\b";
    else if (e === "f") out += "\f";
    else if (e === "v") out += "\v";
    else if (e === "0" && !/[0-9]/.test(body[i + 1] ?? "")) out += "\0";
    else if (e === "x" && /^[0-9a-fA-F]{2}$/.test(body.slice(i + 1, i + 3))) {
      out += String.fromCharCode(parseInt(body.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (e === "u" && body[i + 1] === "{") {
      const close = body.indexOf("}", i + 2);
      const cp = close > 0 ? parseInt(body.slice(i + 2, close), 16) : NaN;
      if (Number.isFinite(cp) && cp <= 0x10ffff) {
        out += String.fromCodePoint(cp);
        i = close;
      } else out += "u";
    } else if (e === "u" && /^[0-9a-fA-F]{4}$/.test(body.slice(i + 1, i + 5))) {
      out += String.fromCharCode(parseInt(body.slice(i + 1, i + 5), 16));
      i += 4;
    } else if (e === "\r") {
      if (body[i + 1] === "\n") i++;
    } else if (e === "\n" || e === " " || e === " ") {
      // a line continuation
    } else out += e;
  }
  return out;
}

/**
 * @typedef {object} JsFindings
 * @property {{ spec: string, names: string[] | "*", default?: string, namespace?: string, locals?: string[], kind: "static" | "dynamic" | "require" | "reexport", line: number }[]} imports
 *   names are the imported (exported-by-the-module) names; locals the local bindings, in the same order
 * @property {string[]} exports
 * @property {{ name: string, params: string[], exported: boolean, line: number }[]} functions top-level declarations
 *   and top-level const/let/var bound to a function or an arrow
 * @property {{ name: string, shape: "gsr-chain" | "call" | "wrapper", line: number, with?: string[], args: number, via?: string }[]} rpc
 *   with: the withX names of a gsr chain, in order; args: the argument count of the server call
 *   (without the name for call and wrappers); via: the wrapper name
 * @property {{ line: number, start: number, end: number, tag: string | null, literal: boolean, keys: string[] }[]} el
 * @property {{ kind: "innerHTML" | "outerHTML" | "insertAdjacentHTML" | "document.write", line: number }[]} sinks
 * @property {{ line: number, via: "property" | "el" | "setAttribute" | "markup" }[]} titles
 * @property {{ name: string, line: number, via: "property" | "el" | "setAttribute" | "markup" }[]} handlers
 * @property {{ key: string | null, keyPrefix?: string, keyVia?: string, op: "get" | "set" | "remove", raw: boolean | null, store: "local" | "session", line: number }[]} storage
 *   keyVia: the helper a key was named through (storageKey("theme") gives key "theme", keyVia
 *   "storageKey"): the key is relative to the app's storage prefix
 * @property {{ key: string, line: number }[]} keys
 * @property {{ value: string, line: number }[]} routes
 * @property {{ value: string, line: number }[]} urls
 * @property {{ tag: string, href: string, target: string | null, line: number, via: "el" | "markup" }[]} hashLinks
 *   links to a hash (#...) with no target, or one other than _self, in el() calls with a literal
 *   href and in markup strings and templates: in Apps Script's frame, under <base target="_top">,
 *   they leave the frame (frameLinks.mjs)
 * @property {{ tag: string, href: string, page: string | null, line: number, via: "el" | "markup" | "script" }[]} relativeLinks
 *   relative, non-hash links (?page=x, ?, other.html), in el() calls, markup strings and templates,
 *   and script navigation to a literal URL (via "script": tag is location, location.href,
 *   location.search, location.assign, location.replace or window.open): they resolve against the
 *   frame's own address, not the app's (frameLinks.mjs pageRewrite)
 * @property {{ method: string, line: number }[]} scriptProps direct reads of Script Properties
 *   (getProperty, getProperties or getKeys on PropertiesService.getScriptProperties(), chained or
 *   through a variable bound to it): server code the kit's per-execution getProp snapshot replaces
 * @property {number} templates
 * @property {string[]} problems where the scan gave up on part of the text (a bound was reached or
 *   the input broke it); a finding past that point may be missing. Empty for ordinary code.
 */

/** The Properties methods that read: a direct call of one on Script Properties is a scriptProps finding. */
const SCRIPT_PROP_READS = new Set(["getProperty", "getProperties", "getKeys"]);

/** Event names whose on<event> property assignment counts as an inline handler. */
const EVENTS = new Set("click dblclick auxclick contextmenu input change submit reset invalid select keydown keyup keypress mousedown mouseup mouseover mouseout mouseenter mouseleave mousemove wheel focus blur focusin focusout load unload beforeunload error abort scroll resize touchstart touchend touchmove touchcancel pointerdown pointerup pointermove pointerover pointerout pointerenter pointerleave pointercancel drag dragstart dragend dragenter dragleave dragover drop paste copy cut toggle animationstart animationend transitionend hashchange popstate message storage visibilitychange".split(" "));

const MARKUP_TITLE = /\stitle\s*=/i;
const MARKUP_HANDLER = /\s(on[a-z]+)\s*=/gi;

/**
 * Findings from one JavaScript (or TypeScript, or Apps Script .gs) text.
 * @param {string} text
 * @param {{ rpcWrappers?: string[], elNames?: string[] }} [opts] rpcWrappers: functions whose first
 *   string argument names a server endpoint ("call" reads as shape "call", the others as "wrapper");
 *   elNames: the DOM builder functions (default ["el"])
 * @returns {JsFindings}
 */
export function scanJs(text, { rpcWrappers = ["call", "cached", "swrCall"], elNames = ["el"] } = {}) {
  /** @type {JsFindings} */
  const f = { imports: [], exports: [], functions: [], rpc: [], el: [], sinks: [], titles: [], handlers: [], storage: [], keys: [], routes: [], urls: [], hashLinks: [], relativeLinks: [], scriptProps: [], templates: 0, problems: [] };
  const toks = tokenizeJs(text).filter((t) => t.type !== "comment");
  const N = toks.length;
  /** @type {number[]} */
  const match = new Array(N).fill(-1);
  /** @type {number[]} */
  const depth = new Array(N).fill(0);
  /** @type {Map<number, number>} */
  const unEnd = new Map();
  {
    /** @type {number[]} */
    const st = [];
    const want = { ")": "(", "]": "[", "}": "{" };
    for (let k = 0; k < N; k++) {
      const t = /** @type {JsToken} */ (toks[k]);
      depth[k] = st.length;
      const head = t.type === "template" && t.value.startsWith("`") && t.value.endsWith("${") && t.value.length >= 3;
      const mid = t.type === "template" && t.value.startsWith("}") && t.value.endsWith("${");
      const tail = t.type === "template" && t.value.startsWith("}") && !t.value.endsWith("${");
      if (mid || tail) {
        const top = st[st.length - 1];
        if (top !== undefined && /** @type {JsToken} */ (toks[top]).type === "template") {
          st.pop();
          match[top] = k;
          match[k] = top;
        }
        depth[k] = st.length;
        if (mid) st.push(k);
        continue;
      }
      if (head || (t.type === "punct" && (t.value === "(" || t.value === "[" || t.value === "{"))) {
        st.push(k);
        continue;
      }
      if (t.type === "punct" && (t.value === ")" || t.value === "]" || t.value === "}")) {
        const top = st[st.length - 1];
        if (top !== undefined && /** @type {JsToken} */ (toks[top]).value === want[/** @type {")" | "]" | "}"} */ (t.value)]) {
          st.pop();
          match[top] = k;
          match[k] = top;
        }
        depth[k] = st.length;
      }
    }
    // An opener left unmatched holds everything after it; its arguments are read only up to the
    // next unmatched opener, so each token is split at most once (unmatched openers nest).
    for (let i = 0; i < st.length; i++) unEnd.set(/** @type {number} */ (st[i]), i + 1 < st.length ? /** @type {number} */ (st[i + 1]) : N);
    if (st.length) f.problems.push(st.length + " bracket(s) never closed (first at line " + /** @type {JsToken} */ (toks[/** @type {number} */ (st[0])]).line + "): their arguments were read up to the next unclosed one");
  }

  /** @param {number} k */
  const tok = (k) => toks[k];
  /** @param {number} k @param {string} v */
  const isP = (k, v) => toks[k]?.type === "punct" && toks[k]?.value === v;
  /** @param {number} k @param {string} [v] */
  const isId = (k, v) => toks[k]?.type === "ident" && (v === undefined || toks[k]?.value === v);
  /** A string literal, or a template literal with no expression. @param {number} k */
  const isStr = (k) => {
    const t = toks[k];
    return !!t && (t.type === "string" || (t.type === "template" && t.value.startsWith("`") && !t.value.endsWith("${") && t.value.length >= 2));
  };
  /** @param {number} k */
  const strOf = (k) => unquote(/** @type {JsToken} */ (toks[k]).value);
  /** @param {number} k */
  const opens = (k) => match[k] > k;

  /**
   * The top-level comma-separated ranges inside the bracket that opens at open.
   * @param {number} open
   * @returns {{ args: [number, number][], close: number }}
   */
  const splitArgs = (open) => {
    const close = match[open] > open ? match[open] : (unEnd.get(open) ?? N);
    /** @type {[number, number][]} */
    const args = [];
    let s = open + 1;
    for (let k = open + 1; k < close; k++) {
      if (opens(k)) {
        while (opens(k) && match[k] < close) k = match[k];
        continue;
      }
      if (isP(k, ",")) {
        args.push([s, k]);
        s = k + 1;
      }
    }
    if (s < close) args.push([s, close]);
    return { args, close };
  };

  /**
   * The keys of an object literal that opens at open. clean is false on a spread, a computed key,
   * a method or accessor, or a numeric key.
   * @param {number} open
   */
  const objectKeys = (open) => {
    /** @type {{ key: string, k: number }[]} */
    const keys = [];
    let clean = true;
    for (const [s, e] of splitArgs(open).args) {
      const t = tok(s);
      if (!t) continue;
      let key = null;
      if (t.type === "ident") key = t.value;
      else if (t.type === "string") key = strOf(s);
      if (key === null) {
        clean = false;
        continue;
      }
      if (e - s === 1 && t.type === "ident") keys.push({ key, k: s });
      else if (isP(s + 1, ":")) keys.push({ key, k: s });
      else {
        clean = false;
        if (t.type === "ident" && (t.value === "get" || t.value === "set" || t.value === "async") && (isId(s + 1) || tok(s + 1)?.type === "string")) continue;
        if (isP(s + 1, "(")) keys.push({ key, k: s }); // a method: its key still counts as a handler or title
      }
    }
    return { keys, clean };
  };

  /** The parameter names of the list that opens at open. @param {number} open */
  const params = (open) => {
    /** @type {string[]} */
    const out = [];
    for (const [s] of splitArgs(open).args) {
      const t = tok(s);
      if (!t) continue;
      if (isP(s, "...") && isId(s + 1)) out.push(/** @type {JsToken} */ (tok(s + 1)).value);
      else if (t.type === "ident") out.push(t.value);
      else if (isP(s, "{")) out.push("{}");
      else if (isP(s, "[")) out.push("[]");
    }
    return out;
  };

  /** @param {string} name @param {string[]} list @param {boolean} exported @param {number} line */
  const addFunction = (name, list, exported, line) => {
    f.functions.push({ name, params: list, exported, line });
  };

  /** Whether the declaration at k is preceded by export (through async and default). @param {number} k */
  const exportedAt = (k) => {
    let j = k - 1;
    if (isId(j, "async")) j--;
    if (isId(j, "default")) j--;
    if (isId(j, "declare")) j--;
    return isId(j, "export");
  };

  /** Binding names of a pattern or identifier at k; returns the names and the index after it. @param {number} k */
  const binding = (k) => {
    /** @type {string[]} */
    const names = [];
    if (isId(k)) return RESERVED.has(/** @type {JsToken} */ (tok(k)).value) ? { names, next: k } : { names: [/** @type {JsToken} */ (tok(k)).value], next: k + 1 };
    if ((isP(k, "{") || isP(k, "[")) && match[k] > k) {
      for (let j = k + 1; j < match[k]; j++) {
        const nx = tok(j + 1);
        if (isId(j) && !isP(j - 1, ".") && !isP(j - 1, "=") && nx && nx.type === "punct" && [",", "}", "]", "="].includes(nx.value)) names.push(/** @type {JsToken} */ (tok(j)).value);
      }
      return { names, next: match[k] + 1 };
    }
    return { names, next: k + 1 };
  };

  /**
   * The declarators of a const/let/var at k (the keyword). Each: its names and the index of its
   * initializer (or -1).
   * @param {number} k
   */
  const declarators = (k) => {
    /** @type {{ names: string[], init: number, line: number }[]} */
    const out = [];
    let j = k + 1;
    const d0 = depth[k];
    for (let guard = 0; j < N; guard++) {
      if (guard === 10000) {
        f.problems.push("line " + tok(k)?.line + ": more than 10000 declarators in one statement; the rest were not read");
        break;
      }
      const line = tok(j)?.line ?? 0;
      const b = binding(j);
      if (!b.names.length) break;
      j = b.next;
      // TS type annotation: skip to = , or ;
      let init = -1;
      while (j < N) {
        if (opens(j)) {
          j = match[j] + 1;
          continue;
        }
        if (depth[j] < d0) break;
        // a word that only starts a statement ends this one, at any depth (inside an unclosed bracket too)
        if (tok(j)?.type === "ident" && STATEMENT_START.has(/** @type {JsToken} */ (tok(j)).value) && !(isId(j, "import") && (isP(j + 1, "(") || isP(j + 1, ".")))) break;
        if (isP(j, "=") && init < 0) init = j + 1;
        if (isP(j, ",") || isP(j, ";")) break;
        const t = /** @type {JsToken} */ (tok(j));
        const p = tok(j - 1);
        // automatic semicolon: a new line that starts with a word after a token that can end an expression
        if (p && t.line > p.line && t.type === "ident" && !(p.type === "punct" && !(p.value === ")" || p.value === "]" || p.value === "}"))) break;
        j++;
      }
      out.push({ names: b.names, init, line });
      if (!isP(j, ",")) break;
      j++;
    }
    return out;
  };

  try {
    for (let k = 0; k < N; k++) {
      const t = /** @type {JsToken} */ (toks[k]);
      const afterDot = isP(k - 1, ".") || isP(k - 1, "?.");

      if (t.type === "template" && t.value.startsWith("`")) f.templates++;

      // String-like literal findings: routes, urls, markup titles and handlers.
      if (t.type === "string" || t.type === "template") {
        let v;
        if (t.type === "string") v = strOf(k);
        else {
          const body = t.value.slice(1, t.value.endsWith("${") ? -2 : t.value.endsWith("`") && t.value.length >= 2 ? -1 : undefined);
          v = body;
        }
        if (t.type === "string" || t.value.startsWith("`")) {
          if (v.startsWith("#/") || /^\?[a-z]+=/i.test(v)) f.routes.push({ value: v, line: t.line });
        }
        if (v.includes("//")) f.urls.push({ value: v, line: t.line });
        if (MARKUP_TITLE.test(v)) f.titles.push({ line: t.line, via: "markup" });
        for (const m of v.matchAll(MARKUP_HANDLER)) f.handlers.push({ name: /** @type {string} */ (m[1]).toLowerCase(), line: t.line, via: "markup" });
      }

      if (t.type !== "ident" && t.type !== "punct") continue;

      // ---- imports and exports
      if (isId(k, "import") && !afterDot) {
        if (isP(k + 1, "(")) {
          const { args } = splitArgs(k + 1);
          const a = args[0];
          if (a && a[1] - a[0] === 1 && isStr(a[0])) f.imports.push({ spec: strOf(a[0]), names: "*", kind: "dynamic", line: t.line });
          continue;
        }
        if (isP(k + 1, ".")) continue;
        let j = k + 1;
        if (isStr(j)) {
          f.imports.push({ spec: strOf(j), names: [], kind: "static", line: t.line });
          continue;
        }
        if (isId(j, "type") && (isP(j + 1, "{") || isP(j + 1, "*") || (isId(j + 1) && !isId(j + 1, "from")))) j++;
        /** @type {{ spec: string, names: string[] | "*", default?: string, namespace?: string, locals?: string[], kind: "static", line: number }} */
        const imp = { spec: "", names: [], kind: "static", line: t.line };
        if (isId(j) && !isId(j, "from")) {
          imp.default = /** @type {JsToken} */ (tok(j)).value;
          j++;
          if (isP(j, ",")) j++;
        }
        if (isP(j, "*") && isId(j + 1, "as") && isId(j + 2)) {
          imp.names = "*";
          imp.namespace = /** @type {JsToken} */ (tok(j + 2)).value;
          j += 3;
        } else if (isP(j, "{")) {
          /** @type {string[]} */
          const names = [];
          /** @type {string[]} */
          const locals = [];
          for (const [s, e] of splitArgs(j).args) {
            let a = s;
            if (isId(a, "type") && e - a > 1) a++;
            const nameTok = tok(a);
            if (!nameTok || !(nameTok.type === "ident" || nameTok.type === "string")) continue;
            const name = nameTok.type === "string" ? strOf(a) : nameTok.value;
            const local = isId(a + 1, "as") && isId(a + 2) ? /** @type {JsToken} */ (tok(a + 2)).value : name;
            names.push(name);
            locals.push(local);
          }
          imp.names = names;
          imp.locals = locals;
          j = match[j] > j ? match[j] + 1 : N;
        }
        if (isId(j, "from") && isStr(j + 1)) {
          imp.spec = strOf(j + 1);
          f.imports.push(imp);
        }
        continue;
      }
      if (isId(k, "require") && !afterDot && isP(k + 1, "(")) {
        const a = splitArgs(k + 1).args[0];
        if (a && a[1] - a[0] === 1 && isStr(a[0])) f.imports.push({ spec: strOf(a[0]), names: "*", kind: "require", line: t.line });
        continue;
      }
      if (isId(k, "export") && !afterDot && depth[k] === 0) {
        let j = k + 1;
        while (isId(j, "declare") || isId(j, "abstract")) j++;
        if (isId(j, "type") && isP(j + 1, "{")) j++;
        if (isP(j, "{")) {
          /** @type {string[]} */
          const local = [];
          for (const [s, e] of splitArgs(j).args) {
            let a = s;
            if (isId(a, "type") && e - a > 1) a++;
            const nt = tok(a);
            if (!nt || !(nt.type === "ident" || nt.type === "string")) continue;
            const name = nt.type === "string" ? strOf(a) : nt.value;
            local.push(name);
            const asTok = isId(a + 1, "as") ? tok(a + 2) : null;
            f.exports.push(asTok ? (asTok.type === "string" ? strOf(a + 2) : asTok.value) : name);
          }
          const after = match[j] > j ? match[j] + 1 : N;
          if (isId(after, "from") && isStr(after + 1)) f.imports.push({ spec: strOf(after + 1), names: local, kind: "reexport", line: t.line });
          continue;
        }
        if (isP(j, "*")) {
          let a = j + 1;
          if (isId(a, "as") && (isId(a + 1) || isStr(a + 1))) {
            f.exports.push(isStr(a + 1) ? strOf(a + 1) : /** @type {JsToken} */ (tok(a + 1)).value);
            a += 2;
          }
          if (isId(a, "from") && isStr(a + 1)) f.imports.push({ spec: strOf(a + 1), names: "*", kind: "reexport", line: t.line });
          continue;
        }
        if (isId(j, "default")) {
          f.exports.push("default");
          continue;
        }
        if (isId(j, "async")) j++;
        if (isId(j, "function")) {
          j++;
          if (isP(j, "*")) j++;
          if (isId(j)) f.exports.push(/** @type {JsToken} */ (tok(j)).value);
          continue;
        }
        if ((isId(j, "class") || isId(j, "interface") || isId(j, "enum") || isId(j, "namespace") || isId(j, "module") || isId(j, "type")) && isId(j + 1)) {
          f.exports.push(/** @type {JsToken} */ (tok(j + 1)).value);
          continue;
        }
        if (isId(j, "const") && isId(j + 1, "enum") && isId(j + 2)) {
          f.exports.push(/** @type {JsToken} */ (tok(j + 2)).value);
          continue;
        }
        if (isId(j, "const") || isId(j, "let") || isId(j, "var")) {
          for (const dcl of declarators(j)) f.exports.push(...dcl.names);
        }
        continue;
      }

      // ---- top-level functions
      if (isId(k, "function") && depth[k] === 0 && !afterDot) {
        const p = tok(k - 1);
        const expr = p && p.type === "punct" && !(p.value === ";" || p.value === "}" || p.value === ")");
        let j = k + 1;
        if (isP(j, "*")) j++;
        let name = null;
        if (isId(j)) {
          name = /** @type {JsToken} */ (tok(j)).value;
          j++;
        } else if (isId(k - 1, "default") || (isId(k - 1, "async") && isId(k - 2, "default"))) name = "default";
        if (isP(j, "<")) {
          // type parameters: the parameter list is the next "(" within a short reach
          let g = j;
          while (g < N && g - j < 64 && !isP(g, "(") && !isId(g, "function")) g++;
          j = g;
        }
        if (name && !expr && isP(j, "(")) addFunction(name, params(j), exportedAt(k), t.line);
        continue;
      }
      if ((isId(k, "const") || isId(k, "let") || isId(k, "var")) && depth[k] === 0 && !afterDot) {
        for (const dcl of declarators(k)) {
          if (dcl.names.length !== 1 || dcl.init < 0) continue;
          let a = dcl.init;
          if (isId(a, "async")) a++;
          let list = null;
          if (isId(a, "function")) {
            a++;
            if (isP(a, "*")) a++;
            if (isId(a)) a++;
            if (isP(a, "(")) list = params(a);
          } else if (isP(a, "(") && match[a] > a && isP(match[a] + 1, "=>")) list = params(a);
          else if (isId(a) && isP(a + 1, "=>")) list = [/** @type {JsToken} */ (tok(a)).value];
          if (list) addFunction(/** @type {string} */ (dcl.names[0]), list, isId(k - 1, "export"), dcl.line);
        }
        continue;
      }

      // ---- RPC
      if (isId(k, "google") && isP(k + 1, ".") && isId(k + 2, "script") && isP(k + 3, ".") && isId(k + 4, "run")) {
        let j = k + 5;
        /** @type {string[]} */
        const withs = [];
        for (let guard = 0; ; guard++) {
          if (guard === 1000) {
            f.problems.push("line " + t.line + ": a google.script.run chain of more than 1000 calls was not read to its end");
            break;
          }
          if (!isP(j, ".") || !isId(j + 1) || !isP(j + 2, "(")) break;
          const name = /** @type {JsToken} */ (tok(j + 1)).value;
          if (/^with[A-Z]/.test(name)) {
            withs.push(name);
            if (match[j + 2] < 0) break;
            j = match[j + 2] + 1;
            continue;
          }
          f.rpc.push({ name, shape: "gsr-chain", line: /** @type {JsToken} */ (tok(j + 1)).line, with: withs, args: splitArgs(j + 2).args.length });
          break;
        }
        continue;
      }
      if (t.type === "ident" && rpcWrappers.includes(t.value) && isP(k + 1, "(") && !isId(k - 1, "function") && !isId(k - 1, "async")) {
        const owner = tok(k - 2);
        if (!afterDot || (owner && owner.type === "ident" && (owner.value === "rpc" || owner.value === "api"))) {
          const { args, close } = splitArgs(k + 1);
          const a = args[0];
          if (a && a[1] - a[0] === 1 && isStr(a[0]) && !isP(close + 1, "{")) {
            f.rpc.push({ name: strOf(a[0]), shape: t.value === "call" ? "call" : "wrapper", line: t.line, args: args.length - 1, via: t.value });
          }
        }
      }

      // ---- el() builder
      if (t.type === "ident" && elNames.includes(t.value) && isP(k + 1, "(") && !afterDot && !isId(k - 1, "function")) {
        const { args, close } = splitArgs(k + 1);
        if (isP(close + 1, "{")) continue; // a method definition, not a call
        const a0 = args[0];
        const tag = a0 && a0[1] - a0[0] === 1 && isStr(a0[0]) ? strOf(a0[0]) : null;
        const a1 = args[1];
        let literal = tag !== null;
        /** @type {string[]} */
        const keys = [];
        /** @type {{ key: string, k: number }[]} */
        let elKeys = [];
        if (a1) {
          const single = a1[1] - a1[0] === 1;
          if (single && (isId(a1[0], "null") || isId(a1[0], "undefined"))) {
            // no attributes
          } else if (isP(a1[0], "{") && match[a1[0]] === a1[1] - 1) {
            const ok = objectKeys(a1[0]);
            elKeys = ok.keys;
            if (!ok.clean) literal = false;
            for (const { key, k: kk } of ok.keys) {
              keys.push(key);
              const line = /** @type {JsToken} */ (tok(kk)).line;
              if (key === "title") f.titles.push({ line, via: "el" });
              if (/^on[a-z]+$/i.test(key)) f.handlers.push({ name: key.toLowerCase(), line, via: "el" });
            }
          } else literal = false;
        }
        const urlName = tag ? linkAttrOf(tag) : null;
        const urlKey = urlName && a1 && isP(a1[0], "{") ? elKeys.find((x) => x.key === urlName) : undefined;
        if (urlName && urlKey && isP(urlKey.k + 1, ":") && isStr(urlKey.k + 2) && (isP(urlKey.k + 3, ",") || isP(urlKey.k + 3, "}"))) {
          const href = strOf(urlKey.k + 2);
          const tk = elKeys.find((x) => x.key === "target");
          const litTarget = tk && isP(tk.k + 1, ":") && isStr(tk.k + 2) && (isP(tk.k + 3, ",") || isP(tk.k + 3, "}"));
          const target = !tk ? null : litTarget ? strOf(tk.k + 2) : HOLE;
          const rel = pageRewrite(href, new Map());
          if (rel) f.relativeLinks.push({ tag: /** @type {string} */ (tag), href: clip(href), page: rel.page, line: /** @type {JsToken} */ (tok(urlKey.k)).line, via: "el" });
          if (isHashUrl(href) && targetFix(target) !== "ok") f.hashLinks.push({ tag: /** @type {string} */ (tag), href: clip(href), target: target === HOLE ? "${...}" : target === null ? null : clip(target), line: /** @type {JsToken} */ (tok(urlKey.k)).line, via: "el" });
        }
        const endTok = tok(close);
        f.el.push({ line: t.line, start: t.start, end: endTok ? endTok.end : String(text ?? "").length, tag, literal, keys });
        continue;
      }

      // ---- member findings: sinks, titles, handlers, setAttribute
      if (afterDot && t.type === "ident") {
        const v = t.value;
        const assign = isP(k + 1, "=") || isP(k + 1, "+=");
        if ((v === "innerHTML" || v === "outerHTML") && assign) f.sinks.push({ kind: v, line: t.line });
        else if (v === "insertAdjacentHTML" && isP(k + 1, "(")) f.sinks.push({ kind: "insertAdjacentHTML", line: t.line });
        else if ((v === "write" || v === "writeln") && isId(k - 2, "document") && isP(k + 1, "(")) f.sinks.push({ kind: "document.write", line: t.line });
        else if (v === "title" && isP(k + 1, "=") && !isId(k - 2, "document")) f.titles.push({ line: t.line, via: "property" });
        else if (/^on[a-z]+$/.test(v) && EVENTS.has(v.slice(2)) && isP(k + 1, "=")) f.handlers.push({ name: v, line: t.line, via: "property" });
        else if (v === "setAttribute" && isP(k + 1, "(")) {
          const a = splitArgs(k + 1).args[0];
          if (a && a[1] - a[0] === 1 && isStr(a[0])) {
            const name = strOf(a[0]).toLowerCase();
            if (name === "title") f.titles.push({ line: t.line, via: "setAttribute" });
            else if (/^on[a-z]+$/.test(name)) f.handlers.push({ name, line: t.line, via: "setAttribute" });
          }
        } else if (v === "key" && !isId(k - 2, "localStorage")) keyCompare(k);
        else if (v === "includes" && isP(k - 2, "]") && match[k - 2] >= 0 && isP(k + 1, "(")) {
          const { args } = splitArgs(k + 1);
          const a = args[0];
          if (a && a[1] - a[0] === 3 && isP(a[0] + 1, ".") && isId(a[0] + 2, "key")) {
            for (const [s, e] of splitArgs(match[k - 2]).args) if (e - s === 1 && isStr(s)) f.keys.push({ key: strOf(s), line: /** @type {JsToken} */ (tok(s)).line });
          }
        }
      }
      // computed sink: el["innerHTML"] = ...
      if (isP(k, "[") && isStr(k + 1) && isP(k + 2, "]") && (isP(k + 3, "=") || isP(k + 3, "+="))) {
        const v = strOf(k + 1);
        if (v === "innerHTML" || v === "outerHTML") f.sinks.push({ kind: v, line: t.line });
      }

      // ---- storage
      if ((isId(k, "localStorage") || isId(k, "sessionStorage")) && isP(k + 1, ".") && isId(k + 2) && isP(k + 3, "(")) {
        const m = /** @type {JsToken} */ (tok(k + 2)).value;
        const op = m === "getItem" ? "get" : m === "setItem" ? "set" : m === "removeItem" ? "remove" : null;
        if (!op) continue;
        const { args, close } = splitArgs(k + 3);
        const a0 = args[0];
        /** @type {string | null} */
        let key = null;
        /** @type {string | undefined} */
        let keyPrefix;
        /** @type {string | undefined} */
        let keyVia;
        if (a0 && a0[1] - a0[0] === 1 && isStr(a0[0])) key = strOf(a0[0]);
        else if (a0 && isStr(a0[0]) && isP(a0[0] + 1, "+")) keyPrefix = strOf(a0[0]);
        else if (a0 && a0[1] - a0[0] === 4 && isId(a0[0]) && /key/i.test(tok(a0[0])?.value ?? "") && isP(a0[0] + 1, "(") && isStr(a0[0] + 2) && isP(a0[0] + 3, ")")) {
          // storageKey("theme"): a helper that puts the app's prefix in front of a literal name
          key = strOf(a0[0] + 2);
          keyVia = /** @type {string} */ (tok(a0[0])?.value);
        }
        /** @type {boolean | null} */
        let raw = null;
        if (op === "set") {
          const a1 = args[1];
          if (a1) {
            if (isId(a1[0], "JSON") && isP(a1[0] + 1, ".") && isId(a1[0] + 2, "stringify") && isP(a1[0] + 3, "(") && match[a1[0] + 3] === a1[1] - 1) raw = false;
            else if (a1[1] - a1[0] === 1 && (isStr(a1[0]) || tok(a1[0])?.type === "number")) raw = true;
            else if (isId(a1[0], "String") && isP(a1[0] + 1, "(") && match[a1[0] + 1] === a1[1] - 1) raw = true;
            else if (a1[1] - a1[0] >= 5 && isStr(a1[1] - 1) && isP(a1[1] - 2, ":") && isStr(a1[1] - 3) && isP(a1[1] - 4, "?")) raw = true; // on ? "1" : "0"
          }
        } else if (op === "get") {
          let head = k;
          if (isP(k - 1, ".") && isId(k - 2)) head = k - 2;
          if (isP(head - 1, "(") && isId(head - 2, "parse") && isP(head - 3, ".") && isId(head - 4, "JSON")) raw = false;
          else if (["===", "!==", "==", "!="].some((o) => isP(close + 1, o)) && isStr(close + 2)) raw = true;
          else if (["===", "!==", "==", "!="].some((o) => isP(head - 1, o)) && isStr(head - 2)) raw = true;
        }
        /** @type {JsFindings["storage"][number]} */
        const entry = { key, op, raw, store: t.value === "localStorage" ? "local" : "session", line: t.line };
        if (keyPrefix !== undefined) entry.keyPrefix = keyPrefix;
        if (keyVia !== undefined) entry.keyVia = keyVia;
        f.storage.push(entry);
        continue;
      }

      // ---- key literals: "x" === e.key, and switch (e.key) { case "x": }
      if (isId(k, "switch") && isP(k + 1, "(") && match[k + 1] > k + 1) {
        const close = match[k + 1];
        let last = close - 1;
        if (isP(last, ")") && isP(last - 1, "(") && (isId(last - 2, "toLowerCase") || isId(last - 2, "toUpperCase")) && isP(last - 3, ".")) last -= 4;
        if (isId(last, "key") && isP(last - 1, ".") && isP(close + 1, "{") && match[close + 1] > close + 1) {
          const body = close + 1;
          for (let j = body + 1; j < match[body]; j++) {
            if (opens(j)) {
              j = match[j];
              continue;
            }
            if (isId(j, "case") && isStr(j + 1)) f.keys.push({ key: strOf(j + 1), line: /** @type {JsToken} */ (tok(j + 1)).line });
          }
        }
      }
    }
    // A string compared to e.key from the left: "x" === e.key
    for (let k = 0; k < N; k++) {
      if (!isStr(k)) continue;
      const op = tok(k + 1);
      if (!op || op.type !== "punct" || !["===", "!==", "==", "!="].includes(op.value)) continue;
      if (isId(k + 2) && isP(k + 3, ".") && isId(k + 4, "key") && !isP(k + 5, ".") && !isP(k + 5, "(")) f.keys.push({ key: strOf(k), line: /** @type {JsToken} */ (tok(k)).line });
    }
  } catch (e) {
    // total: return what was found before the malformed part, and say so
    f.problems.push("the scan stopped early: " + (/** @type {Error} */ (e)?.message ?? String(e)));
  }
  f.exports = [...new Set(f.exports)];
  hashLinkFindings();
  scriptNavFindings();
  scriptPropFindings();
  return f;

  /**
   * Direct reads of Script Properties: getProperty, getProperties or getKeys called on
   * PropertiesService.getScriptProperties(), chained or through a variable bound to it
   * (const p = PropertiesService.getScriptProperties(), with or without a type annotation).
   */
  function scriptPropFindings() {
    try {
      /** @param {number} k @returns {boolean} the getScriptProperties() call of PropertiesService */
      const store = (k) => isId(k, "getScriptProperties") && isP(k - 1, ".") && isId(k - 2, "PropertiesService") && isP(k + 1, "(") && isP(k + 2, ")");
      /** @type {Set<string>} */
      const names = new Set();
      for (let k = 0; k < N; k++) {
        if (!store(k) || !isP(k - 3, "=")) continue;
        if (isId(k - 4) && !isP(k - 5, ".")) names.add(/** @type {JsToken} */ (tok(k - 4)).value);
        else {
          for (let j = k - 5; j >= Math.max(0, k - 16); j--) {
            if ((isId(j, "const") || isId(j, "let") || isId(j, "var")) && isId(j + 1) && isP(j + 2, ":")) {
              names.add(/** @type {JsToken} */ (tok(j + 1)).value);
              break;
            }
          }
        }
      }
      for (let k = 1; k < N; k++) {
        const m = tok(k + 1);
        if (!isP(k, ".") || !m || m.type !== "ident" || !SCRIPT_PROP_READS.has(m.value) || !isP(k + 2, "(")) continue;
        const chained = isP(k - 1, ")") && store(k - 3);
        const bound = isId(k - 1) && names.has(/** @type {JsToken} */ (tok(k - 1)).value) && !isP(k - 2, ".");
        if (chained || bound) f.scriptProps.push({ method: m.value, line: m.line });
      }
    } catch (e) {
      f.problems.push("the Script Properties scan stopped early: " + (/** @type {Error} */ (e)?.message ?? String(e)));
    }
  }

  /**
   * Script navigation to a literal relative URL: location = "...", location.href or .search =
   * "...", location.assign("...") or .replace("..."), window.open("..."). The value is a string, a
   * template's literal head, or a string followed by + (the rest is computed). In the frame each
   * loads the frame's own address with that query, not the app.
   */
  function scriptNavFindings() {
    try {
      /** @param {number} k the token of the value @returns {string | null} */
      const valueAt = (k) => {
        const t = tok(k);
        if (!t) return null;
        if (isStr(k)) return strOf(k) + (isP(k + 1, "+") ? HOLE : "");
        if (t.type === "template" && t.value.startsWith("`") && t.value.endsWith("${")) return t.value.slice(1, -2) + HOLE;
        return null;
      };
      for (let k = 0; k < N; k++) {
        if (isP(k - 1, ".") && !isId(k - 2, "window") && !isId(k - 2, "document")) continue;
        /** @type {string | null} */
        let api = null;
        let at = -1;
        if (isId(k, "location")) {
          if (isP(k + 1, "=")) [api, at] = ["location", k + 2];
          else if (isP(k + 1, ".") && (isId(k + 2, "href") || isId(k + 2, "search")) && isP(k + 3, "=")) [api, at] = ["location." + tok(k + 2)?.value, k + 4];
          else if (isP(k + 1, ".") && (isId(k + 2, "assign") || isId(k + 2, "replace")) && isP(k + 3, "(")) [api, at] = ["location." + tok(k + 2)?.value, k + 4];
        } else if (isId(k, "open") && isId(k - 2, "window") && isP(k + 1, "(")) [api, at] = ["window.open", k + 2];
        if (!api) continue;
        let v = valueAt(at);
        if (v === null) continue;
        if (api === "location.search") v = "?" + v.replace(/^\?/, "");
        const rel = pageRewrite(v, new Map());
        if (rel) f.relativeLinks.push({ tag: api, href: clip(v.split(HOLE).join("${...}")), page: rel.page, line: /** @type {JsToken} */ (tok(k)).line, via: "script" });
      }
    } catch (e) {
      f.problems.push("the script navigation scan stopped early: " + (/** @type {Error} */ (e)?.message ?? String(e)));
    }
  }

  /** Hash links that would leave the frame, in string literals and template literals of markup. */
  function hashLinkFindings() {
    try {
      const src = String(text ?? "");
      /** @type {number[]} */
      const starts = [0];
      for (let i = src.indexOf("\n"); i >= 0; i = src.indexOf("\n", i + 1)) starts.push(i + 1);
      /** @param {number} pos */
      const lineAt = (pos) => {
        let lo = 0;
        let hi = starts.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (/** @type {number} */ (starts[mid]) <= pos) lo = mid;
          else hi = mid - 1;
        }
        return lo + 1;
      };
      /** @param {import("../frameLinks.mjs").FrameLink} l @param {number} line */
      const push = (l, line) => f.hashLinks.push({ tag: l.tag, href: clip(l.href), target: l.target === null ? null : clip(l.target), line, via: "markup" });
      /** @param {import("../frameLinks.mjs").RelativeLink} l @param {number} line */
      const rel = (l, line) => f.relativeLinks.push({ tag: l.tag, href: clip(l.href), page: l.page, line, via: "markup" });
      for (let k = 0; k < N; k++) {
        const t = /** @type {JsToken} */ (toks[k]);
        if (t.type !== "string" || !t.value.includes("<")) continue;
        const r = frameLinkEdits(strOf(k));
        for (const l of r.links) push(l, t.line);
        for (const l of r.relative) rel(l, t.line);
      }
      for (const tpl of templateParts(toks)) {
        if (!tpl.parts.some((p) => p.includes("<"))) continue;
        const r = templateFrameEdits(tpl);
        for (const l of r.links) push(l, lineAt(l.pos));
        for (const l of r.relative) rel(l, lineAt(l.pos));
      }
    } catch (e) {
      f.problems.push("the hash link scan stopped early: " + (/** @type {Error} */ (e)?.message ?? String(e)));
    }
  }

  /** e.key [.toLowerCase()] === "x", at k (the "key" token). @param {number} k */
  function keyCompare(k) {
    let j = k + 1;
    if (isP(j, ".") && (isId(j + 1, "toLowerCase") || isId(j + 1, "toUpperCase")) && isP(j + 2, "(") && isP(j + 3, ")")) j += 4;
    const op = tok(j);
    if (op && op.type === "punct" && ["===", "!==", "==", "!="].includes(op.value) && isStr(j + 1)) f.keys.push({ key: strOf(j + 1), line: /** @type {JsToken} */ (tok(j + 1)).line });
  }
}
