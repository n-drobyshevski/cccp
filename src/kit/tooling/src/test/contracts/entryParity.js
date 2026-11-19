// Extracted from the author's production Apps Script apps; adapted.
// Every api.ts export has a delegator in entry.js, there is no stale delegator, and every
// delegator goes through the timing wrapper (timedApi_ by default) with its own endpoint name.
//
// An allow-list for the rest. Every function entry.js defines outside another function body is a
// global, and any global whose name does not end in an underscore is callable from the browser
// through google.script.run (from the denial page too, by anyone the domain fence lets in). So
// each one, whatever its body, must be an api_ delegator or be named in allowFunctions (default
// doGet and include; doPost is not pre-approved). Declarations count at any indentation and in
// these forms: function f(), var|let|const f = function | arrow | a reference, and
// this.f = / globalThis.f = assignments. A name only counts as a delegator when it is a
// `function api_<name>(` declaration that api.ts exports; an api_-prefixed var or arrow is
// reported like any other global. A delegator that references the server global itself (a direct
// call on one branch) is reported too.
//
// Every allowed global except those in ungated (default doGet and include) must gate itself: its
// body must contain one of the gates calls (default assertOwner(, denyResult(, deniedPage(,
// assertTriggerRun(), or call Server.<handler>( for a handler named in triggerHandlers, whose
// server function checks the trigger event and is tested by the app itself. Presence is checked,
// not order (beginExecution() may come first). An allowFunctions name that entry.js does not
// define is reported, so the list cannot pre-approve a future global.
//
// checkDist runs the same check over the built files: dist/entry.js, the server bundle (which may
// declare only the server global, and no globalThis.<name> assignment) and any other pushed .js
// or .gs file, whose every public global is reported.
import { delegatedNames } from "../../build/guards.mjs";
import { blockRange, functionBodies, inside, listFiles, maskCode, read, relPath, wire } from "./_util.js";
import { apiExports } from "./endpointsClassified.js";

/** The gates an allowed global may call, by default. */
export const DEFAULT_GATES = ["assertOwner(", "denyResult(", "deniedPage(", "assertTriggerRun("];
/** Allowed globals that need no gate of their own by default. */
export const DEFAULT_UNGATED = ["doGet", "include"];
/** The public globals allowed besides the delegators, by default. */
export const DEFAULT_ALLOW = ["doGet", "include"];

/** @param {string} s */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Words after which a function keyword or an identifier starts an expression, not a statement.
const EXPR_WORDS = new Set(["return", "typeof", "void", "yield", "await", "case", "in", "of", "delete", "instanceof", "throw", "new"]);
const KEYWORDS = new Set([...EXPR_WORDS, "var", "let", "const", "function", "async", "class", "if", "else", "for", "while", "do", "switch", "try", "catch", "finally", "break", "continue", "default", "export", "import", "this", "super", "true", "false", "null", "undefined", "debugger", "with"]);

/** Offset just past the bracket matching the one at at (masked text), or the text's end. @param {string} m @param {number} at */
function closeAt(m, at) {
  let depth = 0;
  for (let i = at; i < m.length; i++) {
    const c = m[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") { if (--depth === 0) return i + 1; }
  }
  return m.length;
}

/** The previous non-space offset before at, and whether a newline was crossed. @param {string} m @param {number} at */
function prevChar(m, at) {
  let k = at - 1;
  let nl = false;
  while (k >= 0 && /\s/.test(m[k])) { if (m[k] === "\n") nl = true; k--; }
  return { k, nl };
}

/** The word that ends at offset k (inclusive), or "". @param {string} m @param {number} k */
function wordEndingAt(m, k) {
  let s = k;
  while (s >= 0 && /[\w$]/.test(m[s])) s--;
  return m.slice(s + 1, k + 1);
}

/**
 * True when the token at offset at begins a statement (judged on the text before it): the start
 * of the text, after ; { } or the ) of an if, for or while head, after else or do, or on a new
 * line after a finished expression (automatic semicolon insertion).
 * @param {string} m @param {number} at
 */
function statementStart(m, at) {
  const { k, nl } = prevChar(m, at);
  if (k < 0) return true;
  const c = m[k];
  if (c === ";" || c === "{" || c === "}" || c === ")") return true;
  if (/[\w$]/.test(c)) {
    const w = wordEndingAt(m, k);
    if (w === "else" || w === "do") return true;
    return nl && !EXPR_WORDS.has(w);
  }
  return nl && c === "]";
}

/**
 * The end of an expression that starts at offset from (masked text): a depth-0 comma or
 * semicolon, a closing bracket of an enclosing level, or a new line at depth 0 that the next line
 * does not continue.
 * @param {string} m @param {number} from
 */
function expressionEnd(m, from) {
  let depth = 0;
  for (let i = from; i < m.length; i++) {
    const c = m[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") { if (depth === 0) return i; depth--; }
    else if (depth === 0 && (c === "," || c === ";")) return i;
    else if (depth === 0 && c === "\n") {
      const before = m.slice(from, i).trimEnd();
      const after = m.slice(i).trimStart();
      if (!before || /[=+\-*/%&|^!?:<>,.(~]$/.test(before)) continue;
      if (/^(?:[.?:+\-*/%&|^<>=,([]|instanceof\b|in\b)/.test(after)) continue;
      return i;
    }
  }
  return m.length;
}

/**
 * The body range of a function value that starts at offset at (masked text): a function
 * expression, an arrow with a block or expression body, async allowed; null for any other value
 * (a call, a reference, a literal).
 * @param {string} m @param {number} at @param {number} end the value's end
 * @returns {[number, number] | null}
 */
function functionValueBody(m, at, end) {
  let i = at;
  const skip = () => { while (i < end && /\s/.test(m[i])) i++; };
  skip();
  const as = /^async\b/.exec(m.slice(i, end));
  if (as) { i += as[0].length; skip(); }
  const fn = /^function\b\s*\*?\s*[\w$]*\s*/.exec(m.slice(i, end));
  if (fn) {
    i += fn[0].length;
    if (m[i] !== "(") return null;
    i = closeAt(m, i);
    skip();
    return m[i] === "{" ? blockRange(m, i) : null;
  }
  if (m[i] === "(") i = closeAt(m, i);
  else {
    const id = /^[A-Za-z_$][\w$]*/.exec(m.slice(i, end));
    if (!id) return null;
    i += id[0].length;
  }
  skip();
  if (m[i] !== "=" || m[i + 1] !== ">") return null;
  i += 2;
  skip();
  return m[i] === "{" ? blockRange(m, i) : [i, end];
}

/** Identifiers a binding pattern binds ({ a, b: c, ...d } binds a, c and d). @param {string} pat */
function patternNames(pat) {
  // Drop default values, then the keys of renamed properties.
  let t = "";
  let depth = 0;
  let skipping = false;
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (skipping) {
      if ("([{".includes(c)) depth++;
      else if (")]}".includes(c)) { if (depth === 0) { skipping = false; t += c; } else depth--; }
      else if (c === "," && depth === 0) { skipping = false; t += c; }
      continue;
    }
    if (c === "=") { skipping = true; depth = 0; continue; }
    t += c;
  }
  return [...t.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)(?![\w$])(?!\s*:)/g)].map((x) => x[1]).filter((n) => !KEYWORDS.has(n));
}

/**
 * Assignments to a property of a global object (receiver), dotted or with a string key: found on
 * the masked text so a mention inside a string does not count, named from the kept text.
 * @param {string} masked @param {string} kept @param {RegExp} receiver
 * @returns {{ name: string, at: number, after: number }[]}
 */
function globalAssigns(masked, kept, receiver) {
  const re = new RegExp("(?<![\\w$.])" + receiver.source + "\\s*(?:\\.\\s*([\\w$]+)|\\[\\s*([\"'])[^\"'\\n]*\\2\\s*\\])\\s*=(?![=>])", "g");
  /** @type {{ name: string, at: number, after: number }[]} */ const out = [];
  for (const m of masked.matchAll(re)) {
    const at = /** @type {number} */ (m.index);
    const name = m[1] ?? (/\[\s*(["'])([^"'\n]*)\1/.exec(kept.slice(at, at + m[0].length)) || [])[2] ?? "";
    out.push({ name, at, after: at + m[0].length });
  }
  return out;
}

/**
 * The public and private globals of a script file: every name bound outside a function or class
 * body, in any form. Function declarations (any indentation, several on one line, async and
 * generator, inside a top-level block), every var, let and const declarator (comma lists and
 * destructuring included, whatever the value: a function, an arrow with default parameters, a
 * wrapped function expression, a call, a reference or a literal), a bare assignment to an
 * undeclared name (declare then assign, or an implicit global), and this.x, globalThis.x and
 * globalThis["x"] assignments. body is the comment-free text of the function's body ("" when the
 * value is not a function literal); code is the same with string, template and regex contents
 * blanked.
 * @param {string} src
 * @returns {{ name: string, kind: "function" | "var" | "assign", at: number, body: string, code: string }[]}
 */
export function globalsOf(src) {
  const masked = maskCode(src);
  const kept = maskCode(src, { keepStrings: true });
  const fnBodies = functionBodies(masked);
  /** @type {[number, number][]} */ const classBodies = [];
  for (const m of masked.matchAll(/\bclass\b[^{;]*\{/g)) classBodies.push(blockRange(masked, /** @type {number} */ (m.index) + m[0].length - 1));
  const nested = (/** @type {number} */ at) => inside(fnBodies, at) || inside(classBodies, at);
  /** @type {{ name: string, kind: "function" | "var" | "assign", at: number, body: string, code: string }[]} */ const out = [];
  /** @param {string} name @param {"function" | "var" | "assign"} kind @param {number} at @param {[number, number] | null} r */
  const add = (name, kind, at, r) => {
    const [a, b] = r || [0, 0];
    out.push({ name, kind, at, body: kept.slice(a, b), code: masked.slice(a, b) });
  };
  /** @type {[number, number][]} */ const declRanges = [];

  for (const m of masked.matchAll(/(?<![\w$.])function\b\s*\*?\s*([\w$]+)\s*\(/g)) {
    const at = /** @type {number} */ (m.index);
    if (nested(at)) continue;
    let k = prevChar(masked, at).k;
    let from = at;
    if (k >= 0 && wordEndingAt(masked, k) === "async") { from = k - 4; k = prevChar(masked, from).k; }
    if (!statementStart(masked, from)) continue;
    const close = closeAt(masked, at + m[0].length - 1);
    const open = masked.indexOf("{", close);
    add(m[1], "function", at, open >= 0 ? blockRange(masked, open) : null);
  }

  for (const m of masked.matchAll(/(?<![\w$.])(?:var|let|const)\b/g)) {
    const at = /** @type {number} */ (m.index);
    if (nested(at)) continue;
    const { k } = prevChar(masked, at);
    if (!(statementStart(masked, at) || (k >= 0 && masked[k] === "("))) continue;
    let i = at + m[0].length;
    for (;;) {
      while (i < masked.length && /\s/.test(masked[i])) i++;
      const nameAt = i;
      /** @type {string[]} */ let names = [];
      if (masked[i] === "{" || masked[i] === "[") {
        const e = closeAt(masked, i);
        names = patternNames(masked.slice(i + 1, e - 1));
        i = e;
      } else {
        const id = /^[A-Za-z_$][\w$]*/.exec(masked.slice(i));
        if (!id) break;
        names = [id[0]];
        i += id[0].length;
      }
      while (i < masked.length && /[ \t]/.test(masked[i])) i++;
      /** @type {[number, number] | null} */ let body = null;
      let end = i;
      if (masked[i] === "=" && masked[i + 1] !== "=") {
        end = expressionEnd(masked, i + 1);
        body = functionValueBody(masked, i + 1, end);
      } else {
        end = expressionEnd(masked, i);
      }
      for (const n of names) add(n, "var", nameAt, body);
      declRanges.push([at, end]);
      if (masked[end] !== ",") break;
      i = end + 1;
    }
  }
  const inDecl = (/** @type {number} */ at) => declRanges.some(([a, b]) => at >= a && at <= b);

  for (const m of masked.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*=(?![=>])/g)) {
    const at = /** @type {number} */ (m.index);
    if (KEYWORDS.has(m[1]) || m[1] === "globalThis" || nested(at) || inDecl(at) || !statementStart(masked, at)) continue;
    const after = at + m[0].length;
    const end = expressionEnd(masked, after);
    add(m[1], "assign", at, functionValueBody(masked, after, end) || [after, end]);
  }

  for (const a of globalAssigns(masked, kept, /(?:this|globalThis)/)) {
    if (nested(a.at)) continue;
    const end = expressionEnd(masked, a.after);
    add(a.name, "assign", a.at, functionValueBody(masked, a.after, end) || [a.after, end]);
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * Why the body of an allowed global does not enforce one of its gates, or null when it does.
 * A gate counts only where its result is acted on, before the global does anything else:
 *   - a gate that throws on refusal (asserts: assertOwner, assertTriggerRun, any name starting
 *     with assert) as a bare call statement: Server.access.assertOwner("setup");
 *   - any gate in the condition of an if whose consequent returns or throws:
 *     if (Server.access.denyResult("x") || Server.gateResult("x")) return "";
 *   - a gate assigned to a variable that the next statement tests and returns:
 *     var d = Server.access.deniedPage(); if (d) return d;
 *   - a gate whose value is returned: return Server.access.deniedPage() || Server.page();
 * The statement sits at the top of the body or directly inside a try whose catch returns or
 * throws, never inside another block or a nested function, and only Server.beginExecution() and
 * Server assert calls (assertSetupReady) may come before it. A call of a declared trigger handler
 * (Server.<handler>() for a name in triggerHandlers) counts wherever it is: the handler is the
 * work, and it checks the trigger event itself.
 * @param {string} code the masked body, braces included
 * @param {{ gates: string[], asserts: string[], triggerHandlers: string[], serverRef: string }} o
 * @returns {string | null}
 */
export function gateProblem(code, { gates, asserts, triggerHandlers, serverRef }) {
  if (code[0] !== "{") return "its value is not a function literal with a block body, so no gate can be read in it";
  const nestedFns = functionBodies(code).filter(([a]) => a > 0);
  const sr = escapeRe(serverRef);
  for (const h of triggerHandlers) {
    for (const m of code.matchAll(new RegExp("(?<![\\w$.])" + sr + "\\s*\\.\\s*" + escapeRe(h) + "\\s*\\(", "g"))) if (!inside(nestedFns, /** @type {number} */ (m.index))) return null;
  }
  const preamble = new RegExp("^\\s*" + sr + "(?:\\s*\\.\\s*[\\w$]+)*\\s*\\.\\s*(?:beginExecution|assert[\\w$]*)\\s*\\([^;{}]*\\)\\s*$");
  const isAssert = (/** @type {string} */ g) => asserts.includes(g) || /(?:^|\.)assert[\w$]*\($/.test(g.replace(/\s+/g, ""));
  let reason = "calls no gate";
  for (const g of gates) {
    const gname = g.replace(/\(\s*$/, "");
    for (const m of code.matchAll(new RegExp("(?<![\\w$])" + escapeRe(gname) + "\\s*\\(", "g"))) {
      const p = /** @type {number} */ (m.index);
      if (inside(nestedFns, p)) { reason = "calls " + gname + "( only inside a nested function"; continue; }
      // The chain the call hangs on: Server.access.denyResult
      let chain = p;
      for (;;) {
        let k = chain - 1;
        while (k >= 0 && /\s/.test(code[k])) k--;
        if (code[k] !== ".") break;
        k--;
        if (code[k] === "?") k--;
        while (k >= 0 && /\s/.test(code[k])) k--;
        let s = k;
        while (s >= 0 && /[\w$]/.test(code[s])) s--;
        if (s === k) break;
        chain = s + 1;
      }
      const callEnd = closeAt(code, p + m[0].length - 1);
      // The enclosing blocks between the body and the call.
      /** @type {number[]} */ const stack = [];
      for (let i = 1; i < p; i++) {
        if (code[i] === "{") stack.push(i);
        else if (code[i] === "}") stack.pop();
      }
      let blockOpen = 0;
      let topStmt = -1;
      let ok = true;
      for (const b of stack) {
        if (!/\btry\s*$/.test(code.slice(0, b))) { ok = false; break; }
        const tryAt = code.slice(0, b).search(/\btry\s*$/);
        if (topStmt < 0) topStmt = tryAt;
        const [, tryEnd] = blockRange(code, b);
        const c = /^\s*catch\b\s*(?:\([^)]*\))?\s*\{/.exec(code.slice(tryEnd));
        if (c) {
          const [ca, cb] = blockRange(code, tryEnd + c[0].length - 1);
          if (!/\b(?:return|throw)\b/.test(code.slice(ca, cb))) { ok = false; break; }
        }
        blockOpen = b;
      }
      if (!ok) { reason = "calls " + gname + "( inside a block that may skip it or a try that swallows its refusal"; continue; }
      // The start of the statement that holds the call.
      let start = blockOpen + 1;
      let depth = 0;
      for (let k = p - 1; k > blockOpen; k--) {
        const c = code[k];
        if (c === ")" || c === "]") depth++;
        else if (c === "(" || c === "[") { if (depth > 0) depth--; }
        else if ((c === ";" || c === "{" || c === "}") && depth === 0) { start = k + 1; break; }
      }
      if (topStmt < 0) topStmt = start;
      const before = code.slice(1, topStmt).split(";").filter((x) => x.trim());
      if (!before.every((x) => preamble.test(x))) { reason = "calls " + gname + "( only after other work (only " + serverRef + ".beginExecution() and assert calls may come first)"; continue; }
      const stmt = code.slice(start, p);
      const after = code.slice(callEnd);
      let enforced = false;
      const ifHead = /^\s*if\s*\(/.exec(stmt);
      if (ifHead) {
        const condOpen = start + ifHead[0].length - 1;
        const condEnd = closeAt(code, condOpen);
        const negated = /!\s*$/.test(code.slice(condOpen + 1, chain));
        enforced = !negated && callEnd <= condEnd && /^\s*(?:\{\s*)?(?:return|throw)\b/.test(code.slice(condEnd));
      } else if (/^\s*return\s+$/.test(code.slice(start, chain))) {
        enforced = /^\s*(?:;|\|\||\}|$)/.test(after);
      } else {
        const v = /^\s*(?:var|let|const)\s+([\w$]+)\s*=\s*$/.exec(code.slice(start, chain));
        if (v) {
          enforced = new RegExp("^\\s*;\\s*if\\s*\\(\\s*" + escapeRe(v[1]) + "\\s*\\)\\s*(?:\\{\\s*)?(?:return|throw)\\b").test(after);
        } else if (code.slice(start, chain).trim() === "" && isAssert(g)) {
          enforced = /^\s*(?:;|\}|$)/.test(after);
        }
      }
      if (enforced) return null;
      reason = "calls " + gname + "( but drops its result (use if (...) return, var d = ...; if (d) return d, or a bare assert call)";
    }
  }
  return reason;
}

/**
 * @typedef {{ apiTs: string, entryJs: string, wrapper?: string, allowFunctions?: string[],
 *   serverRef?: string, gates?: string[], asserts?: string[], ungated?: string[], triggerHandlers?: string[] }} EntryOpts
 *   wrapper: the function every delegator must call with its own endpoint name as a string
 *   literal (default timedApi_). allowFunctions: public globals that may exist besides the
 *   delegators (default doGet, include). serverRef: the global that holds the server bundle
 *   (default Server). gates: calls one of which every allowed global outside ungated must make
 *   (default assertOwner(, denyResult(, deniedPage(, assertTriggerRun(), acted on as
 *   gateProblem says. asserts: the gates that throw on refusal, so a bare call statement enforces
 *   them (default: the gates whose name starts with assert). ungated: allowed
 *   globals exempt from the gate rule (default doGet, include). triggerHandlers: server functions
 *   (Server.<name>) that check the trigger event themselves, so a global calling one is gated;
 *   the app's own test must call each with no event and with a forged one.
 */

/**
 * @param {EntryOpts} opts
 * @returns {string[]} violations
 */
export function check({ apiTs, entryJs, wrapper = "timedApi_", allowFunctions = DEFAULT_ALLOW, serverRef = "Server", gates = DEFAULT_GATES, asserts, ungated = DEFAULT_UNGATED, triggerHandlers = [] }) {
  const entry = maskCode(entryJs, { keepStrings: true });
  const { names: exported, other } = apiExports(apiTs);
  const declared = delegatedNames(entry);
  /** @type {string[]} */ const bad = [];
  for (const o of other) bad.push("api.ts has an export that cannot be matched to a delegator by name: " + o);
  for (const n of exported) if (!declared.includes(n)) bad.push("api.ts exports " + n + " but entry.js has no api_" + n + " delegator");
  for (const n of declared) if (!exported.includes(n)) bad.push("entry.js delegates api_" + n + " but api.ts does not export " + n);
  const callRe = new RegExp("(?<![\\w$.])" + escapeRe(wrapper) + "\\s*\\(\\s*([\"'])([^\"']*)\\1", "g");
  const anyCall = new RegExp("(?<![\\w$.])" + escapeRe(wrapper) + "\\s*\\(");
  const direct = new RegExp("(?<![\\w$.])" + escapeRe(serverRef) + "\\b");
  const globals = globalsOf(entryJs);
  for (const n of declared) {
    const g = globals.find((x) => x.kind === "function" && x.name === "api_" + n);
    const body = g ? g.body : "";
    if (!anyCall.test(g ? g.code : "")) { bad.push("api_" + n + " does not go through " + wrapper); continue; }
    const named = [...body.matchAll(callRe)].map((m) => m[2]);
    if (!named.includes(n)) bad.push("api_" + n + " calls " + wrapper + " with " + (named.length ? named.map((x) => JSON.stringify(x)).join(", ") : "a name that is not a string literal") + " instead of " + JSON.stringify(n));
    if (direct.test(g ? g.code : "")) bad.push("api_" + n + " references " + serverRef + " directly; every path must go through " + wrapper);
  }
  const gateOpts = { gates, asserts: asserts ?? gates.filter((x) => /(?:^|\.)assert[\w$]*\($/.test(x.replace(/\s+/g, ""))), triggerHandlers, serverRef };
  const seen = new Set();
  /** @type {Map<string, number>} */ const count = new Map();
  for (const g of globals) count.set(g.name, (count.get(g.name) ?? 0) + 1);
  for (const g of globals) {
    if (g.name.endsWith("_")) continue;
    const first = !seen.has(g.name);
    seen.add(g.name);
    if (g.kind === "function" && g.name.startsWith("api_") && declared.includes(g.name.slice(4)) && count.get(g.name) === 1) continue;
    if (!allowFunctions.includes(g.name)) {
      if (first) bad.push("entry.js " + (g.kind === "function" ? "function " : "global ") + g.name + " is callable from the browser through google.script.run but is neither an api_ delegator nor in allowFunctions; classify it as an endpoint, end its name with an underscore, or allow it with a gate");
      continue;
    }
    if (count.get(g.name) !== 1) {
      if (first) bad.push("entry.js binds " + g.name + " more than once; the last binding wins at run time, so each must be one function declaration");
      continue;
    }
    if (ungated.includes(g.name)) continue;
    const problem = gateProblem(g.code, gateOpts);
    if (problem) {
      bad.push("entry.js function " + g.name + " is allowed but " + problem + " (gates: " + [...gates, ...triggerHandlers.map((h) => serverRef + "." + h + "(")].join(", ") + ")");
    }
  }
  for (const a of allowFunctions) {
    if (!seen.has(a) && !DEFAULT_ALLOW.includes(a)) bad.push("allowFunctions lists " + a + " but entry.js defines no such global; drop it so the list does not pre-approve one");
  }
  return bad;
}

/**
 * The same rules over the built files that clasp pushes: entry.js in distDir is checked with
 * check(), the server bundle may declare only the server global and assign nothing to
 * globalThis, and every public global of any other .js or .gs file is reported.
 * @param {Omit<EntryOpts, "entryJs"> & { distDir: string, entryFile?: string, serverFile?: string }} opts
 * @returns {string[]} violations
 */
export function checkDist({ distDir, entryFile = "entry.js", serverFile = "server.js", ...rest }) {
  const files = listFiles(distDir, [".js", ".gs"]);
  if (!files.some((f) => relPath(distDir, f) === entryFile)) return ["no " + entryFile + " in " + distDir + " (run the build first)"];
  /** @type {string[]} */ const bad = [];
  const entry = files.find((f) => relPath(distDir, f) === entryFile);
  if (entry) bad.push(...check({ ...rest, entryJs: read(entry) }).map((v) => entryFile + ": " + v));
  bad.push(...checkPushedGlobals({ distDir, entryFile, serverFile, serverRef: rest.serverRef }));
  return bad;
}

/**
 * The part of checkDist that needs no api.ts, which the build runs on its fresh output: the
 * server bundle may declare only the server global and assign nothing to globalThis, and every
 * other pushed .js or .gs file except entryFile may declare no public global.
 * @param {{ distDir: string, entryFile?: string, serverFile?: string, serverRef?: string }} opts
 * @returns {string[]} violations
 */
export function checkPushedGlobals({ distDir, entryFile = "entry.js", serverFile = "server.js", serverRef = "Server" }) {
  /** @type {string[]} */ const bad = [];
  for (const f of listFiles(distDir, [".js", ".gs"])) {
    const rel = relPath(distDir, f);
    if (rel === entryFile) continue;
    const text = read(f);
    if (rel === serverFile) {
      for (const g of globalsOf(text)) if (g.name !== serverRef && !g.name.endsWith("_")) bad.push(rel + ": declares the global " + g.name + "; the server bundle may declare only " + serverRef);
      for (const a of globalAssigns(maskCode(text), maskCode(text, { keepStrings: true }), /globalThis/)) {
        if (!a.name.endsWith("_")) bad.push(rel + ": assigns globalThis." + a.name + ", a global callable through google.script.run");
      }
      continue;
    }
    for (const g of globalsOf(text)) if (!g.name.endsWith("_")) bad.push(rel + ": declares the public global " + g.name + "; every pushed file shares one global scope, so it is callable through google.script.run");
  }
  return bad;
}

/** @param {any} r */
const defaultRefused = (r) => r === undefined || r === null || r === "" || r === false || (!!r && typeof r === "object" && r.ok === false && r.errorKind === "forbidden");

/**
 * The runtime form of the allow-list: call every public global entry.js defines as a caller on no
 * list, the way google.script.run would, and expect each one to refuse. The static check reads
 * shapes; this one runs them, so a gate that the shape rules accept but that does not refuse (or
 * a global they cannot see) is caught by its result.
 *
 * The app loads entry.js in a vm context over the kit's fakes (its loadEntry helper) and passes
 * the context as globals, with entryJs (the source, whose globals are probed: globalsOf, every
 * name without a trailing underscore whose value in the context is a function). asStranger puts
 * the fakes in the state of a signed-in caller on no list; it runs before every call. A call is
 * refused when it throws, or answers undefined, null, "", false or the kit's refusal envelope
 * ({ ok: false, errorKind: "forbidden" }); refusals overrides that per name (doGet's denial page,
 * say). args: the argument lists each global is called with (default: none, then one empty
 * object). state, as in roleMatrix (storeState(fakes)): a refused call that changed it is
 * reported too.
 * @param {{ globals: Record<string, unknown>, entryJs: string, asStranger: () => void,
 *   refusals?: Record<string, (result: unknown) => boolean>, args?: unknown[][],
 *   state?: () => unknown }} opts
 * @returns {Promise<string[]>} violations
 */
export async function probeGlobals({ globals, entryJs, asStranger, refusals = {}, args = [[], [{}]], state }) {
  /** @type {string[]} */ const bad = [];
  const names = [...new Set(globalsOf(entryJs).map((g) => g.name).filter((n) => !n.endsWith("_")))];
  const snap = () => { try { return JSON.stringify(state ? state() : null); } catch (e) { return "unreadable: " + String(e); } };
  let probed = 0;
  for (const name of names) {
    const fn = globals[name];
    if (typeof fn !== "function") continue;
    probed++;
    for (const a of args) {
      asStranger();
      const before = snap();
      let refused = false;
      /** @type {unknown} */ let result;
      try {
        result = await fn(...a);
        refused = (refusals[name] ?? defaultRefused)(result);
      } catch {
        refused = true;
      }
      const label = name + "(" + a.map((x) => JSON.stringify(x)).join(", ") + ")";
      if (!refused) {
        let shown = "";
        try { shown = typeof result === "string" ? "a string of " + result.length + " characters" : JSON.stringify(result).slice(0, 80); } catch { shown = typeof result; }
        bad.push("entry.js " + label + " answered a stranger with " + shown + " instead of a refusal");
      } else if (state && snap() !== before) {
        bad.push("entry.js " + label + " refused a stranger but changed the stored state first");
      }
    }
  }
  if (!probed) bad.push("probeGlobals found no public function global of entry.js in the globals given (load entry.js into them first)");
  return bad;
}

/** @param {any} describe @param {any} it @param {any} expect @param {Parameters<typeof check>[0]} opts */
export function register(describe, it, expect, opts) {
  wire(describe, it, expect, "entry.js parity", () => check(opts));
}

/** @param {any} describe @param {any} it @param {any} expect @param {Parameters<typeof checkDist>[0]} opts */
export function registerDist(describe, it, expect, opts) {
  wire(describe, it, expect, "built globals parity", () => checkDist(opts));
}
