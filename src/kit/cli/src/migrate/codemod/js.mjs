// Token-level helpers the migrate codemods share: a bracket-matched view of a JavaScript text
// (built on the scanner's tokenizer, so strings, templates, regexes and comments are known), the
// argument ranges of a call, the names bound at module scope and anywhere else, the free names of
// an expression, text edits applied back to front, and the checks a rewritten file must pass
// (balanced brackets, no double slash in a string). Nothing here runs the code it reads.
import { readFileSync } from "node:fs";
import { tokenizeJs, unquote } from "../scan/js.mjs";

/** @typedef {import("../scan/js.mjs").JsToken} JsToken */

/** The generated lines that hold an import, kept as data (see templates.json). @type {Record<string, string>} */
export const TEMPLATES = JSON.parse(readFileSync(new URL("./templates.json", import.meta.url), "utf8"));

/** Words that are never a variable reference. */
export const KEYWORDS = new Set(
  "await break case catch class const continue debugger default delete do else export extends false finally for function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while with yield async get set as from".split(" "),
);

/**
 * A text as matched tokens. match[k] is the index of the bracket that closes (or opens) the one at k,
 * -1 when it has none; parent[k] the innermost opener holding k (-1 at the top); depth[k] how many
 * openers hold k. A template head or middle counts as an opener, its middle or tail as a closer.
 * @typedef {object} Js
 * @property {string} text
 * @property {JsToken[]} toks significant tokens (no comments)
 * @property {number[]} match
 * @property {number[]} parent
 * @property {number[]} depth
 * @property {number} unbalanced openers never closed plus closers never opened
 */

/** @param {JsToken | undefined} t */
const isHead = (t) => !!t && t.type === "template" && t.value.startsWith("`") && t.value.endsWith("${") && t.value.length >= 3;
/** @param {JsToken | undefined} t */
const isMid = (t) => !!t && t.type === "template" && t.value.startsWith("}") && t.value.endsWith("${");
/** @param {JsToken | undefined} t */
const isTail = (t) => !!t && t.type === "template" && t.value.startsWith("}") && !t.value.endsWith("${");

/**
 * @param {string} text
 * @returns {Js}
 */
export function analyze(text) {
  const toks = tokenizeJs(text).filter((t) => t.type !== "comment");
  const n = toks.length;
  const match = new Array(n).fill(-1);
  const parent = new Array(n).fill(-1);
  const depth = new Array(n).fill(0);
  /** @type {number[]} */
  const st = [];
  let unbalanced = 0;
  const want = { ")": "(", "]": "[", "}": "{" };
  for (let k = 0; k < n; k++) {
    const t = /** @type {JsToken} */ (toks[k]);
    if (isMid(t) || isTail(t)) {
      const top = st[st.length - 1];
      if (top !== undefined && toks[top]?.type === "template") {
        st.pop();
        match[top] = k;
        match[k] = top;
      } else unbalanced++;
      parent[k] = st.length ? /** @type {number} */ (st[st.length - 1]) : -1;
      depth[k] = st.length;
      if (isMid(t)) st.push(k);
      continue;
    }
    parent[k] = st.length ? /** @type {number} */ (st[st.length - 1]) : -1;
    depth[k] = st.length;
    if (isHead(t) || (t.type === "punct" && (t.value === "(" || t.value === "[" || t.value === "{"))) {
      st.push(k);
      continue;
    }
    if (t.type === "punct" && (t.value === ")" || t.value === "]" || t.value === "}")) {
      const top = st[st.length - 1];
      if (top !== undefined && toks[top]?.value === want[/** @type {")" | "]" | "}"} */ (t.value)]) {
        st.pop();
        match[top] = k;
        match[k] = top;
        parent[k] = st.length ? /** @type {number} */ (st[st.length - 1]) : -1;
        depth[k] = st.length;
      } else unbalanced++;
    }
  }
  unbalanced += st.length;
  return { text, toks, match, parent, depth, unbalanced };
}

/** @param {Js} J @param {number} k @param {string} v */
export const isP = (J, k, v) => J.toks[k]?.type === "punct" && J.toks[k]?.value === v;
/** @param {Js} J @param {number} k @param {string} [v] */
export const isId = (J, k, v) => J.toks[k]?.type === "ident" && (v === undefined || J.toks[k]?.value === v);
/** A string literal or a template literal with no expression. @param {Js} J @param {number} k */
export const isStr = (J, k) => {
  const t = J.toks[k];
  return !!t && (t.type === "string" || (t.type === "template" && t.value.startsWith("`") && t.value.endsWith("`") && t.value.length >= 2 && !t.value.endsWith("${")));
};
/** @param {Js} J @param {number} k */
export const strOf = (J, k) => unquote(/** @type {JsToken} */ (J.toks[k]).value);

/**
 * The top-level comma-separated token ranges [start, end) inside the bracket that opens at open.
 * @param {Js} J @param {number} open
 * @returns {[number, number][]}
 */
export function splitArgs(J, open) {
  const close = J.match[open] > open ? J.match[open] : J.toks.length;
  /** @type {[number, number][]} */
  const args = [];
  let s = open + 1;
  for (let k = open + 1; k < close; k++) {
    if (J.match[k] > k) {
      k = J.match[k];
      continue;
    }
    if (isP(J, k, ",")) {
      args.push([s, k]);
      s = k + 1;
    }
  }
  if (s < close) args.push([s, close]);
  return args;
}

/** The source text of tokens [s, e), comments between them included. @param {Js} J @param {number} s @param {number} e */
export function slice(J, s, e) {
  if (e <= s) return "";
  return J.text.slice(/** @type {JsToken} */ (J.toks[s]).start, /** @type {JsToken} */ (J.toks[e - 1]).end);
}

/**
 * Split the range [s, e) at the top level (relative to s) on the given operators.
 * @param {Js} J @param {number} s @param {number} e @param {string[]} ops
 * @returns {{ parts: [number, number][], ops: string[] }}
 */
export function splitTop(J, s, e, ops) {
  /** @type {[number, number][]} */
  const parts = [];
  /** @type {string[]} */
  const seen = [];
  let from = s;
  for (let k = s; k < e; k++) {
    if (J.match[k] > k && J.match[k] < e) {
      k = J.match[k];
      continue;
    }
    const t = J.toks[k];
    if (t?.type === "punct" && ops.includes(t.value)) {
      parts.push([from, k]);
      seen.push(t.value);
      from = k + 1;
    }
  }
  parts.push([from, e]);
  return { parts, ops: seen };
}

/**
 * Binding names of the file: at module scope (imports, top-level function, class and
 * const/let/var declarations) and everywhere else (parameters, nested declarations, catch
 * bindings). Generous on purpose: a name read as bound by mistake only makes a codemod bail.
 * @param {Js} J
 * @returns {{ module: Set<string>, local: Set<string> }}
 */
export function bindings(J) {
  /** @type {Set<string>} */
  const module = new Set();
  /** @type {Set<string>} */
  const local = new Set();
  const N = J.toks.length;
  /** @param {number} k @param {Set<string>} into */
  const pattern = (k, into) => {
    if (isId(J, k)) {
      const v = /** @type {JsToken} */ (J.toks[k]).value;
      if (!KEYWORDS.has(v)) into.add(v);
      return k + 1;
    }
    if ((isP(J, k, "{") || isP(J, k, "[")) && J.match[k] > k) {
      for (let j = k + 1; j < J.match[k]; j++) {
        if (isId(J, j) && !isP(J, j - 1, ".") && !isP(J, j + 1, ":") && !KEYWORDS.has(/** @type {JsToken} */ (J.toks[j]).value)) into.add(/** @type {JsToken} */ (J.toks[j]).value);
      }
      return J.match[k] + 1;
    }
    return k + 1;
  };
  /** Every name inside a parameter group. @param {number} open */
  const params = (open) => {
    for (let j = open + 1; j < J.match[open]; j++) if (isId(J, j) && !isP(J, j - 1, ".") && !KEYWORDS.has(/** @type {JsToken} */ (J.toks[j]).value)) local.add(/** @type {JsToken} */ (J.toks[j]).value);
  };
  for (let k = 0; k < N; k++) {
    const t = /** @type {JsToken} */ (J.toks[k]);
    if (t.type !== "ident" || isP(J, k - 1, ".") || isP(J, k - 1, "?.")) {
      if (isP(J, k, "=>")) {
        if (isP(J, k - 1, ")") && J.match[k - 1] >= 0) params(J.match[k - 1]);
        else if (isId(J, k - 1)) local.add(/** @type {JsToken} */ (J.toks[k - 1]).value);
      }
      continue;
    }
    const top = J.depth[k] === 0;
    if (t.value === "import" && top && !isP(J, k + 1, "(") && !isP(J, k + 1, ".")) {
      // import a, { b as c, d }, * as e from "x"
      let j = k + 1;
      for (; j < N && !isId(J, j, "from") && !isStr(J, j); j++) {
        if (isId(J, j) && !isId(J, j, "as") && !isId(J, j, "type") && !isId(J, j + 1, "as")) module.add(/** @type {JsToken} */ (J.toks[j]).value);
      }
      k = j;
      continue;
    }
    if (t.value === "const" || t.value === "let" || t.value === "var") {
      const into = top ? module : local;
      let j = pattern(k + 1, into);
      // later declarators: after a comma at the declaration's own depth, before a ; or a lower depth
      const d = J.depth[k];
      for (; j < N; j++) {
        if (J.match[j] > j) {
          j = J.match[j];
          continue;
        }
        if ((J.depth[j] ?? 0) < d || isP(J, j, ";")) break;
        const nt = J.toks[j];
        if (nt?.type === "ident" && ["const", "let", "var", "return", "if", "for", "while", "function", "export", "import", "class"].includes(nt.value)) break;
        if (isP(J, j, ",") && J.depth[j] === d) j = pattern(j + 1, into) - 1;
      }
      continue;
    }
    if (t.value === "function") {
      let j = k + 1;
      if (isP(J, j, "*")) j++;
      if (isId(J, j)) {
        const name = /** @type {JsToken} */ (J.toks[j]).value;
        const expr = J.toks[k - 1]?.type === "punct" && !["}", ";", ")"].includes(/** @type {JsToken} */ (J.toks[k - 1]).value);
        (top && !expr ? module : local).add(name);
        j++;
      }
      if (isP(J, j, "(")) params(j);
      continue;
    }
    if (t.value === "class" && isId(J, k + 1)) {
      (top ? module : local).add(/** @type {JsToken} */ (J.toks[k + 1]).value);
      continue;
    }
    if (t.value === "catch" && isP(J, k + 1, "(")) {
      params(k + 1);
      continue;
    }
    // a method: name(params) {
    if (isP(J, k + 1, "(") && J.match[k + 1] > k + 1 && isP(J, J.match[k + 1] + 1, "{") && !KEYWORDS.has(t.value) && !["if", "for", "while", "switch", "with"].includes(t.value)) params(k + 1);
  }
  return { module, local };
}

/**
 * The names an expression [s, e) reads that it does not bind itself (its own parameters and
 * declarations), and whether it reads this or arguments. Property names and object keys are not
 * reads.
 * @param {Js} J @param {number} s @param {number} e
 * @returns {{ free: string[], usesThis: boolean }}
 */
export function freeNames(J, s, e) {
  /** @type {Set<string>} */
  const own = new Set();
  /** @type {string[]} */
  const reads = [];
  let usesThis = false;
  for (let k = s; k < e; k++) {
    const t = /** @type {JsToken} */ (J.toks[k]);
    if (isP(J, k, "=>")) {
      if (isP(J, k - 1, ")") && J.match[k - 1] >= s) for (let j = J.match[k - 1] + 1; j < k - 1; j++) if (isId(J, j) && !isP(J, j - 1, ".")) own.add(/** @type {JsToken} */ (J.toks[j]).value);
      if (isId(J, k - 1)) own.add(/** @type {JsToken} */ (J.toks[k - 1]).value);
      continue;
    }
    if (t.type !== "ident") continue;
    if (t.value === "this" || t.value === "arguments") usesThis = true;
    if (isP(J, k - 1, ".") || isP(J, k - 1, "?.")) continue;
    if (t.value === "function") {
      let j = k + 1;
      if (isId(J, j)) own.add(/** @type {JsToken} */ (J.toks[j++]).value);
      if (isP(J, j, "(") && J.match[j] > j) for (let x = j + 1; x < J.match[j]; x++) if (isId(J, x) && !isP(J, x - 1, ".")) own.add(/** @type {JsToken} */ (J.toks[x]).value);
      continue;
    }
    if (t.value === "const" || t.value === "let" || t.value === "var") {
      const j = k + 1;
      if (isId(J, j)) own.add(/** @type {JsToken} */ (J.toks[j]).value);
      else if ((isP(J, j, "{") || isP(J, j, "[")) && J.match[j] > j) for (let x = j + 1; x < J.match[j]; x++) if (isId(J, x) && !isP(J, x + 1, ":")) own.add(/** @type {JsToken} */ (J.toks[x]).value);
      continue;
    }
    if (KEYWORDS.has(t.value)) continue;
    // an object key ({ a: 1 }) is not a read; a shorthand ({ a }) is
    if (isP(J, k + 1, ":") && (isP(J, k - 1, "{") || isP(J, k - 1, ",")) && isP(J, J.parent[k], "{")) continue;
    reads.push(t.value);
  }
  return { free: [...new Set(reads.filter((r) => !own.has(r)))], usesThis };
}

/**
 * Apply edits ({start, end, text} over character offsets, never overlapping) to a text.
 * @param {string} text @param {{ start: number, end: number, text: string }[]} edits
 */
export function applyEdits(text, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let out = text;
  let floor = Infinity;
  for (const e of sorted) {
    if (e.end > floor) throw new Error("overlapping codemod edits at offset " + e.start);
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    floor = e.start;
  }
  return out;
}

/**
 * Why a rewritten script is not safe to hand on, or null: brackets and template literals must
 * balance.
 * @param {string} text
 * @returns {string | null}
 */
export function codeProblem(text) {
  const J = analyze(text);
  return J.unbalanced ? J.unbalanced + " unbalanced bracket(s)" : null;
}

/**
 * The first string, template or regex that holds a double slash (the Apps Script middlebox strips
 * from one to the end of the line), as a message, or null.
 * @param {string} text
 * @returns {string | null}
 */
export function slashProblem(text) {
  for (const t of analyze(text).toks) {
    if ((t.type === "string" || t.type === "template" || t.type === "regex") && t.value.includes("//")) return "a double slash in a " + t.type + " at line " + t.line;
  }
  return null;
}

/**
 * The end offset of the last top-level import statement, or -1.
 * @param {Js} J
 */
export function lastImportEnd(J) {
  let end = -1;
  for (let k = 0; k < J.toks.length; k++) {
    if (!isId(J, k, "import") || J.depth[k] !== 0 || isP(J, k + 1, "(") || isP(J, k + 1, ".")) continue;
    let j = k + 1;
    while (j < J.toks.length && !isStr(J, j)) j++;
    if (j >= J.toks.length) break;
    if (isP(J, j + 1, ";")) j++;
    end = /** @type {JsToken} */ (J.toks[j]).end;
    k = j;
  }
  return end;
}

/**
 * Text with one line inserted after the imports (or at the top), unless it is there already.
 * @param {string} text @param {string} line
 */
export function addImport(text, line) {
  if (text.split("\n").some((l) => l.trim() === line)) return text;
  const at = lastImportEnd(analyze(text));
  if (at < 0) return line + "\n" + text;
  return text.slice(0, at) + "\n" + line + text.slice(at);
}

/** A comment that can hold any text: no closer, no double slash, one line. @param {string} s */
export function commentSafe(s) {
  return s.replace(/\*\//g, "* /").replace(/\/\//g, "/ /").replace(/[\r\n]+/g, " ").replace(/<\?/g, "< ?").replace(/\?>/g, "? >");
}
