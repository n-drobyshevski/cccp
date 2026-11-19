// The role run() enforces is looked up by the name passed to it, so every export of api.ts must
// call run with its own name as a string literal, exactly once. A body copied from another
// endpoint (a stale name) would otherwise be gated by the other endpoint's role while the roles
// table claims a stricter one.
//
// Only the closure passed to run() is gated: a statement before the call, a parameter default or
// an argument that is computed rather than a function runs for every caller, refused ones
// included. And the envelope run() returns is the answer: a body that ignores it, wraps it or
// falls back on a refusal hands back something run() did not decide. So each export's body is
// exactly one statement, `return run("<its own name>", <a function>)` (or an arrow whose
// expression body is that call), with nothing before it or after it. A shape the check does not
// understand is reported, never passed. The export is read from its line to the next top-level
// export.
//
// The run that is called must be the real one: api.ts imports it by name from its run module
// (runModule, default ./run) and binds the name nowhere else. A module-level function, variable,
// class, destructuring or declare of run, an import of run from any other module (or of another
// export renamed to run, or as a default or namespace), and an endpoint parameter named run are
// reported: any of them can answer the refusal envelope while doing the work for everyone.
import { readFileSync } from "node:fs";
import { blockRange, functionBodies, inside, maskCode, wire } from "./_util.js";
import { apiExports } from "./endpointsClassified.js";

/** @param {string} s */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const OPEN = "([{<";
const CLOSE = ")]}>";

/**
 * Offset just past the bracket that closes the one at offset at, counted on masked text over
 * (), [] and {} (and <> when angle). -1 when it never closes before limit.
 * @param {string} m @param {number} at @param {number} limit @param {boolean} [angle]
 */
function closeOf(m, at, limit, angle = false) {
  /** @type {string[]} */ const stack = [];
  for (let i = at; i < limit; i++) {
    const c = m[i];
    if (c === "=" && m[i + 1] === ">") { i++; continue; }
    const o = OPEN.indexOf(c);
    if (o >= 0 && (o < 3 || angle)) { stack.push(CLOSE[o]); continue; }
    const k = CLOSE.indexOf(c);
    if (k >= 0 && (k < 3 || angle)) {
      if (stack.pop() !== c) return -1;
      if (!stack.length) return i + 1;
    }
  }
  return -1;
}

/** First offset at or after i that is not white space. @param {string} m @param {number} i */
const skipWs = (m, i) => {
  while (i < m.length && /\s/.test(m[i])) i++;
  return i;
};

/**
 * Skip a return type annotation that starts at a colon at offset i, up to the body's opening
 * brace or the arrow. A brace right after :, |, &, <, ( , [ or , is an object type; any other
 * brace at depth 0 opens the body. Returns the offset of the brace (or of "=>"), or -1.
 * @param {string} m @param {number} i @param {number} limit @param {"body" | "arrow"} until
 */
function skipType(m, i, limit, until) {
  let prev = ":";
  for (let k = i + 1; k < limit; k++) {
    const c = m[k];
    if (/\s/.test(c)) continue;
    if (until === "arrow" && c === "=" && m[k + 1] === ">") return k;
    if (c === "=" && m[k + 1] === ">") { prev = ">"; k++; continue; }
    if (c === "{" && until === "body" && !":|&<([,".includes(prev)) return k;
    if (OPEN.includes(c)) {
      const e = closeOf(m, k, limit, true);
      if (e < 0) return -1;
      k = e - 1;
      prev = CLOSE[OPEN.indexOf(c)];
      continue;
    }
    prev = c;
  }
  return -1;
}

/**
 * Parse a parameter list at offset i (an opening paren, or a bare identifier for an arrow).
 * @param {string} m @param {number} i @param {number} limit
 * @returns {{ end: number, defaults: boolean } | null}
 */
function params(m, i, limit) {
  if (m[i] === "(") {
    const end = closeOf(m, i, limit);
    if (end < 0) return null;
    return { end, defaults: /=(?!>)/.test(m.slice(i, end).replace(/=>/g, "  ")) };
  }
  const id = /^[A-Za-z_$][\w$]*/.exec(m.slice(i, limit));
  return id ? { end: i + id[0].length, defaults: false } : null;
}

/**
 * True when the text in [a, b) is exactly one function: an arrow, a function expression or a
 * bare identifier naming one. Anything else (a call, a member read, a wrapped expression) runs
 * before run() does.
 * @param {string} m @param {number} a @param {number} b
 */
function isFunction(m, a, b) {
  let i = skipWs(m, a);
  const end = b;
  const rest = m.slice(i, end).trimEnd();
  if (/^[A-Za-z_$][\w$]*$/.test(rest) && !/^(?:async|function|new|void|typeof|await|yield|this)$/.test(rest)) return true;
  const as = /^async\b\s*/.exec(m.slice(i, end));
  if (as) i += as[0].length;
  const fn = /^function\b\s*\*?\s*(?:[A-Za-z_$][\w$]*\s*)?/.exec(m.slice(i, end));
  if (fn) {
    const p = params(m, skipWs(m, i + fn[0].length), end);
    if (!p || p.defaults) return false;
    let k = skipWs(m, p.end);
    if (m[k] === ":") k = skipType(m, k, end, "body");
    if (k < 0 || m[k] !== "{") return false;
    const [, close] = blockRange(m, k);
    return m.slice(close, end).trim() === "";
  }
  if (m[i] === "<") {
    const e = closeOf(m, i, end, true);
    if (e < 0) return false;
    i = skipWs(m, e);
  }
  const p = params(m, i, end);
  if (!p || p.defaults) return false;
  let k = skipWs(m, p.end);
  if (m[k] === ":") k = skipType(m, k, end, "arrow");
  if (k < 0 || m[k] !== "=" || m[k + 1] !== ">") return false;
  k = skipWs(m, k + 2);
  if (m[k] === "{") {
    const [, close] = blockRange(m, k);
    return m.slice(close, end).trim() === "";
  }
  return k < end;
}

/**
 * Parse the run call whose runner name starts at offset at.
 * @param {string} m masked text @param {string} kept text with strings kept @param {number} at
 * @param {string} runner @param {number} limit
 * @returns {{ end: number, name: string | null, args: number, fnArg: boolean } | null}
 */
function runCall(m, kept, at, runner, limit) {
  let i = skipWs(m, at + runner.length);
  if (m[i] === "<") {
    const e = closeOf(m, i, limit, true);
    if (e < 0) return null;
    i = skipWs(m, e);
  }
  if (m[i] !== "(") return null;
  const end = closeOf(m, i, limit);
  if (end < 0) return null;
  /** @type {number[]} */ const commas = [];
  /** @type {string[]} */ const stack = [];
  for (let k = i + 1; k < end - 1; k++) {
    const c = m[k];
    if (c === "=" && m[k + 1] === ">") { k++; continue; }
    if (OPEN.slice(0, 3).includes(c)) stack.push(c);
    else if (CLOSE.slice(0, 3).includes(c)) stack.pop();
    else if (c === "," && !stack.length) commas.push(k);
  }
  const bounds = [i + 1, ...commas.map((c) => c + 1)].map((a, n) => [a, n < commas.length ? commas[n] : end - 1]);
  if (bounds.length > 1 && m.slice(bounds[bounds.length - 1][0], bounds[bounds.length - 1][1]).trim() === "") bounds.pop();
  const lit = /^\s*(["'])([^"'\n]*)\1\s*$/.exec(kept.slice(bounds[0][0], bounds[0][1]));
  return { end, name: lit ? lit[2] : null, args: bounds.length, fnArg: bounds.length === 2 && isFunction(m, bounds[1][0], bounds[1][1]) };
}

/**
 * Where the body of export name starts and what kind it is, or a reason it cannot be read.
 * @param {string} m @param {RegExpExecArray} head @param {number} limit
 * @returns {{ kind: "block", open: number } | { kind: "expr", at: number } | { problem: string }}
 */
function bodyOf(m, head, limit) {
  let i = head.index + head[0].length;
  if (/\basync\b/.test(head[0]) || /\*/.test(head[0])) return { problem: "is async or a generator, so its value is not run()'s envelope" };
  if (/\bfunction\b/.test(head[0])) {
    i = skipWs(m, i);
    if (m[i] === "<") {
      const e = closeOf(m, i, limit, true);
      if (e < 0) return { problem: "cannot be read" };
      i = skipWs(m, e);
    }
    const p = params(m, i, limit);
    if (!p || m[i] !== "(") return { problem: "cannot be read" };
    if (p.defaults) return { problem: "has a parameter default, which runs before run()" };
    let k = skipWs(m, p.end);
    if (m[k] === ":") k = skipType(m, k, limit, "body");
    if (k < 0 || m[k] !== "{") return { problem: "cannot be read" };
    return { kind: "block", open: k };
  }
  i = skipWs(m, i);
  if (m[i] === ":") {
    let k = i + 1;
    for (; k < limit; k++) {
      if (m[k] === "=" && m[k + 1] === ">") { k++; continue; }
      if (m[k] === "=") break;
      if (OPEN.includes(m[k])) {
        const e = closeOf(m, k, limit, true);
        if (e < 0) return { problem: "cannot be read" };
        k = e - 1;
      }
    }
    i = k;
  }
  if (m[i] !== "=" || m[i + 1] === "=") return { problem: "is not a function" };
  i = skipWs(m, i + 1);
  if (/^async\b/.test(m.slice(i, i + 6))) return { problem: "is async or a generator, so its value is not run()'s envelope" };
  const fn = /^function\b\s*(\*)?\s*(?:[A-Za-z_$][\w$]*\s*)?/.exec(m.slice(i, limit));
  if (fn) {
    if (fn[1]) return { problem: "is async or a generator, so its value is not run()'s envelope" };
    i = skipWs(m, i + fn[0].length);
  } else if (m[i] === "<") {
    const e = closeOf(m, i, limit, true);
    if (e < 0) return { problem: "cannot be read" };
    i = skipWs(m, e);
  }
  const p = params(m, i, limit);
  if (!p) return { problem: "is not a function" };
  if (p.defaults) return { problem: "has a parameter default, which runs before run()" };
  let k = skipWs(m, p.end);
  if (fn) {
    if (m[k] === ":") k = skipType(m, k, limit, "body");
    if (k < 0 || m[k] !== "{") return { problem: "cannot be read" };
    return { kind: "block", open: k };
  }
  if (m[k] === ":") k = skipType(m, k, limit, "arrow");
  if (k < 0 || m[k] !== "=" || m[k + 1] !== ">") return { problem: "is not a function" };
  k = skipWs(m, k + 2);
  return m[k] === "{" ? { kind: "block", open: k } : { kind: "expr", at: k };
}

/**
 * Offset just past the last ; or closing brace at bracket depth 0 of masked text, else 0: what
 * comes before it is a finished statement.
 * @param {string} m
 */
function lastStatementEnd(m) {
  let depth = 0;
  let last = 0;
  for (let i = 0; i < m.length; i++) {
    const c = m[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (c === "}" && depth === 0) last = i + 1;
    } else if (c === ";" && depth === 0) last = i + 1;
  }
  return last;
}

/** The run modules accepted by default: the app's server/run.ts, imported as ./run. */
export const DEFAULT_RUN_MODULE = ["./run", "./run.js", "./run.ts"];

/**
 * Split masked text at depth-0 commas. @param {string} m @returns {string[]}
 */
function splitTop(m) {
  /** @type {string[]} */ const out = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < m.length; i++) {
    const c = m[i];
    if (c === "=" && m[i + 1] === ">") { i++; continue; }
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) { out.push(m.slice(from, i)); from = i + 1; }
  }
  out.push(m.slice(from));
  return out;
}

/**
 * The binding part of a declarator or parameter: the text before its depth-0 type colon or =.
 * @param {string} d
 */
function bindingOf(d) {
  let depth = 0;
  for (let i = 0; i < d.length; i++) {
    const c = d[i];
    if ("([{<".includes(c)) depth++;
    else if (")]}>".includes(c)) depth--;
    else if (depth === 0 && (c === ":" || (c === "=" && d[i + 1] !== ">" && d[i + 1] !== "="))) return d.slice(0, i);
  }
  return d;
}

/** True when the binding text binds name (a key before a colon, { name: x }, does not). @param {string} binding @param {string} name */
const binds = (binding, name) => new RegExp("(?<![\\w$.])" + escapeRe(name) + "(?![\\w$])(?!\\s*\\??\\s*:)").test(binding) || new RegExp("^\\s*\\.{0,3}" + escapeRe(name) + "\\s*\\??\\s*$").test(binding);

/**
 * True when the parameter list in the text between an export's name and its body binds name.
 * @param {string} m @param {string} name
 */
function paramBinds(m, name) {
  const open = m.indexOf("(");
  if (open < 0) {
    const bare = /([A-Za-z_$][\w$]*)\s*=>/.exec(m);
    return !!bare && bare[1] === name;
  }
  let depth = 0;
  let close = m.length;
  for (let i = open; i < m.length; i++) {
    if (m[i] === "(") depth++;
    else if (m[i] === ")" && --depth === 0) { close = i; break; }
  }
  return splitTop(m.slice(open + 1, close)).some((p) => binds(bindingOf(p), name));
}

/**
 * Where api.ts binds the runner name other than by importing it from a run module.
 * @param {string} masked @param {string} kept @param {string} runner @param {string[]} modules
 * @returns {string[]}
 */
function runBindings(masked, kept, runner, modules) {
  /** @type {string[]} */ const bad = [];
  const id = escapeRe(runner);
  const word = new RegExp("(?<![\\w$.])" + id + "(?![\\w$])");
  for (const m of kept.matchAll(/^[ \t]*import\s+(type\s+)?([^;]*?)\s*from\s*(["'])([^"'\n]*)\3/gm)) {
    if (m[1]) continue;
    const clause = m[2];
    const from = m[4];
    const brace = /\{([^}]*)\}/.exec(clause);
    const outside = clause.replace(/\{[^}]*\}/, " ");
    if (word.test(outside)) bad.push("api.ts imports " + runner + " as a default or namespace import from " + JSON.stringify(from) + "; import { " + runner + " } from " + JSON.stringify(modules[0]));
    if (!brace) continue;
    for (const part of brace[1].split(",")) {
      const p = /^\s*(?:type\s+)?([\w$]+)(?:\s+as\s+([\w$]+))?\s*$/.exec(part);
      if (!p || /^\s*type\s/.test(part)) continue;
      const local = p[2] ?? p[1];
      if (local !== runner) continue;
      if (!modules.includes(from)) bad.push("api.ts imports " + runner + " from " + JSON.stringify(from) + ", not from its run module (" + modules.join(", ") + ")");
      else if (p[1] !== runner) bad.push("api.ts imports " + p[1] + " as " + runner + " from " + JSON.stringify(from) + "; import the real " + runner);
    }
  }
  const bodies = functionBodies(masked);
  const decl = new RegExp("^[ \\t]*(?:export\\s+)?(?:declare\\s+)?(?:async\\s+)?(?:function\\s*\\*?|class|enum|namespace|module)\\s+" + id + "(?![\\w$])", "gm");
  for (const m of masked.matchAll(decl)) {
    if (!inside(bodies, /** @type {number} */ (m.index))) bad.push("api.ts declares its own " + runner + "; the endpoints must call the one imported from " + modules[0]);
  }
  for (const m of masked.matchAll(/^[ \t]*(?:export\s+)?(?:declare\s+)?(?:const|let|var)\b/gm)) {
    const at = /** @type {number} */ (m.index);
    if (inside(bodies, at)) continue;
    const start = at + m[0].length;
    let end = masked.indexOf(";", start);
    const nextStmt = /\n(?=[ \t]*(?:export|import|function|const|let|var|type|interface|class|declare|enum)\b)/.exec(masked.slice(start));
    if (nextStmt && (end < 0 || start + nextStmt.index < end)) end = start + nextStmt.index;
    const stmt = masked.slice(start, end < 0 ? masked.length : end);
    for (const d of splitTop(stmt)) {
      if (binds(bindingOf(d), runner)) {
        bad.push("api.ts declares its own " + runner + "; the endpoints must call the one imported from " + modules[0]);
        break;
      }
    }
  }
  return bad;
}

/**
 * @param {{ apiPath?: string, apiTs?: string, runner?: string, runModule?: string | string[] }} opts
 *   apiPath: the api.ts file (or apiTs, its text). runner: the name of the run function (default
 *   run). runModule: the module specifier(s) api.ts may import it from (default ./run, ./run.js,
 *   ./run.ts).
 * @returns {string[]} violations
 */
export function check({ apiPath, apiTs, runner = "run", runModule = DEFAULT_RUN_MODULE }) {
  const text = apiTs ?? (apiPath ? readFileSync(apiPath, "utf8") : null);
  if (text === null) return ["runNames needs apiPath or apiTs"];
  const kept = maskCode(text, { keepStrings: true });
  const masked = maskCode(text);
  const { names } = apiExports(text);
  /** @type {string[]} */ const bad = runBindings(masked, kept, runner, [].concat(/** @type {any} */ (runModule)));
  const starts = [...kept.matchAll(/^export\b/gm)].map((m) => /** @type {number} */ (m.index));
  const anyCall = new RegExp("(?<![\\w$])(?<!(?<!\\.)\\.)" + escapeRe(runner) + "\\s*(?:<[^>()]*>\\s*)?\\(", "g");
  const shape = "its body must be exactly return " + runner + "(";
  for (const name of names) {
    const head = new RegExp("^export\\s+(?:async\\s+)?(?:function\\s*\\*?\\s*|(?:const|let|var)\\s+)" + escapeRe(name) + "\\b", "m").exec(masked);
    if (!head) continue;
    const from = head.index;
    const to = starts.find((s) => s > from) ?? kept.length;
    const want = shape + JSON.stringify(name) + ", () => ...)";
    const calls = [...masked.slice(from, to).matchAll(anyCall)];
    if (calls.length !== 1) {
      bad.push("api.ts " + name + " calls " + runner + "() " + calls.length + " times; it must call it exactly once, with " + JSON.stringify(name));
      continue;
    }
    const callAt = from + /** @type {number} */ (calls[0].index);
    const call = runCall(masked, kept, callAt, runner, to);
    if (!call) {
      bad.push("api.ts " + name + " has a " + runner + "() call the check cannot read; " + want);
      continue;
    }
    if (call.name === null) {
      bad.push("api.ts " + name + " calls " + runner + "() with a name that is not a string literal; pass " + JSON.stringify(name));
      continue;
    }
    if (call.name !== name) {
      bad.push("api.ts " + name + " calls " + runner + "(" + JSON.stringify(call.name) + "), so it is gated by the role of " + call.name + "; pass " + JSON.stringify(name));
      continue;
    }
    if (!call.fnArg) {
      bad.push("api.ts " + name + " passes " + runner + "() " + (call.args === 2 ? "a second argument that is not a function, so it is computed before the role check" : call.args + " arguments") + "; " + want);
      continue;
    }
    const body = bodyOf(masked, head, to);
    if ("problem" in body) {
      bad.push("api.ts " + name + " " + body.problem + "; " + want);
      continue;
    }
    if (paramBinds(masked.slice(head.index + head[0].length, body.kind === "block" ? body.open : body.at), runner)) {
      bad.push("api.ts " + name + " has a parameter named " + runner + ", so the " + runner + "() it calls is the caller's; " + want);
      continue;
    }
    if (body.kind === "expr") {
      const after = masked.slice(call.end, to);
      const ends = /^\s*(?:;|$|\n\s*(?=export\b|function\b|const\b|let\b|var\b|type\b|interface\b|import\b|class\b|enum\b|declare\b|$))/.test(after);
      if (body.at !== callAt || !ends) bad.push("api.ts " + name + " does not return " + runner + "()'s value as is; " + want);
      continue;
    }
    const [, close] = blockRange(masked, body.open);
    const inner = masked.slice(body.open + 1, close - 1);
    const callIn = callAt - body.open - 1;
    if (callIn < 0 || callAt >= close) {
      bad.push("api.ts " + name + " calls " + runner + "() outside its body; " + want);
      continue;
    }
    const pre = inner.slice(0, callIn);
    const post = inner.slice(callIn + (call.end - callAt));
    const ret = /(?<![\w$.])return[ \t]+$/.exec(pre);
    const earlier = pre.slice(0, ret ? ret.index : lastStatementEnd(pre));
    if (earlier.trim() !== "") bad.push("api.ts " + name + " runs code before " + runner + "(), which runs for every caller, refused ones included; " + want);
    else if (!ret || !/^\s*;?\s*$/.test(post)) bad.push("api.ts " + name + " does not return " + runner + "()'s value as is (ignored, wrapped or with a fallback); " + want);
  }
  return bad;
}

/** @param {any} describe @param {any} it @param {any} expect @param {Parameters<typeof check>[0]} opts */
export function register(describe, it, expect, opts) {
  wire(describe, it, expect, "every endpoint runs under its own name", () => check(opts));
}
