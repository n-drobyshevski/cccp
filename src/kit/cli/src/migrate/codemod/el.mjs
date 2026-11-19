// The el() to html codemod. It reads one page module of an el()-builder app as tokens and turns
// each tree of el(tag, attrs, ...children) calls into one html tagged template when that is safe:
// a literal tag, an object-literal attribute list with plain keys, children that are literals,
// nested el() calls (through a ternary, a logical operator, an array or a .map arrow), names and
// other expressions (interpolated, so escaped). title becomes data-tip, plus aria-label when the
// element shows no text (the title was its name), or, when it has a name of its own (its text or an
// aria-label), aria-describedby pointing at a hidden span inside it that holds the same text (the
// title was a description; an id unique in the page). An on<event> handler becomes data-act, wired by a generated
// bind<Page>Acts function. A hash link stays in Apps Script's frame under <base target="_top">: a
// literal hash href gets target="_self" and a computed href is built with attrs(linkAttrs(href)).
// A literal ?page= href to a page the app has becomes its hash route first (frameLinks.mjs
// pageRewrite); one to another page is kept after a "migrate: page link not rewritten" comment.
// A tree is converted whole or not at all: a DOM node from el() can not be interpolated into html,
// and html can not be appended as a node, so a tree whose node is changed after it is built,
// passed to a DOM method or mixed with an unconverted one stays el(), each call prefixed with a
// /* migrate: el() not converted: <reason> */ comment. No shim: an el() runtime next to
// renderRegion would be a second, unchecked markup sink.
import { HOLE, SELF_ATTR, isHashUrl, leaveReason, linkAttrOf, pageMarkComment, pageRewrite, targetFix } from "../frameLinks.mjs";
import { TEMPLATES, addImport, analyze, applyEdits, bindings, codeProblem, commentSafe, freeNames, isId, isP, isStr, slice, splitArgs, splitTop, strOf } from "./js.mjs";

/** @typedef {import("./js.mjs").Js} Js */
/** @typedef {{ code: string, msg: string }} Problem */
/**
 * @typedef {object} Attr
 * @property {string} name the attribute name as written into the markup
 * @property {"lit" | "bool" | "expr" | "act"} kind
 * @property {string} [value] lit: the decoded literal; expr: the source text; act: the act name
 * @property {[number, number]} [range] the value's token range
 */
/**
 * @typedef {object} ElCall
 * @property {number} s the el identifier's token index
 * @property {number} open
 * @property {number} close
 * @property {[number, number][]} args
 * @property {number} line
 * @property {ElCall | null} parent the call it is a child of, in the same tree
 * @property {ElCall} root
 * @property {Problem[]} own
 * @property {Problem[]} ctx root only: problems of where the tree's node goes, or of its dependencies
 * @property {string | null} tag
 * @property {Attr[]} attrs
 * @property {{ key: string, range: [number, number] } | null} handler
 * @property {[number, number] | null} title
 * @property {boolean} hasAria
 * @property {{ calls: Set<number>, idents: number[], ok: boolean }[]} kids per child argument (index 0 is args[2])
 */
/**
 * @typedef {object} Act
 * @property {string} act the data-act value
 * @property {string} event the DOM event
 * @property {"bindActs" | "delegate"} via
 * @property {string} fn the handler's source text
 * @property {number} line
 */
/**
 * @typedef {object} ElResult
 * @property {string} text the rewritten module, header included
 * @property {number} total el() calls found
 * @property {number} converted el() calls turned into markup
 * @property {{ line: number, code: string, reason: string }[]} bailed one entry per call left as el()
 * @property {Act[]} acts
 * @property {string | null} actsFn the name of the generated wiring function
 * @property {string[]} notes
 */

const TAG = /^[a-z][a-z0-9-]*$/;
const ATTR_NAME = /^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/;
const VOID = new Set("area base br col embed hr img input link meta source track wbr".split(" "));
const RAW = new Set("script style iframe object embed template textarea title noscript frame frameset".split(" "));
/** Elements a hidden span may not sit in (the parser moves or drops it, or it is content). */
const NO_SPAN = new Set("select option optgroup datalist textarea table thead tbody tfoot tr colgroup ul ol dl picture audio video".split(" "));
const BOOLEAN = new Set("checked disabled selected hidden readonly required multiple autofocus open novalidate inert defer async allowfullscreen formnovalidate itemscope reversed".split(" "));
const DOM_PROPS = new Set(["innerHTML", "outerHTML", "textContent", "innerText"]);
const RENAME = { className: "class", htmlFor: "for" };
const NODE_MAKERS = new Set(["createElement", "createElementNS", "createTextNode", "createDocumentFragment", "cloneNode", "querySelector", "getElementById", "importNode"]);

/** @param {string} s */
const escText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/`/g, "&#96;").replace(/\$/g, "&#36;").replace(/\\/g, "&#92;");
/** @param {string} s */
const escAttr = (s) => escText(s).replace(/"/g, "&quot;");
/** @param {string} s */
const kebabData = (s) => s.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
/** @param {string} s */
const pascal = (s) => s.split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0]?.toUpperCase() + w.slice(1)).join("") || "Page";

/**
 * Convert the el() calls of one page module.
 * @param {string} text the module source
 * @param {{ elNames: string[], page: string, sourceKey: string, stepId: string, pages?: import("../frameLinks.mjs").AppPages }} opts page: the act prefix (kebab);
 *   pages: the app's pages, for a literal ?page= href (none: each is left, marked)
 * @returns {ElResult}
 */
export function convertElFile(text, { elNames, page, sourceKey, stepId, pages = new Map() }) {
  const J = analyze(text);
  const N = J.toks.length;
  const B = bindings(J);
  const header = "// Generated by gas-kit migrate (" + stepId + ") from " + sourceKey + "; edit freely.\n";

  /** @type {ElCall[]} */
  const calls = [];
  /** @type {Map<number, ElCall>} */
  const at = new Map();
  for (let k = 0; k < N; k++) {
    const t = J.toks[k];
    if (t?.type !== "ident" || !elNames.includes(t.value) || isP(J, k - 1, ".") || isP(J, k - 1, "?.") || isId(J, k - 1, "function")) continue;
    if (!isP(J, k + 1, "(") || !(J.match[k + 1] > k + 1) || isP(J, J.match[k + 1] + 1, "{")) continue;
    /** @type {ElCall} */
    const c = /** @type {any} */ ({ s: k, open: k + 1, close: J.match[k + 1], args: splitArgs(J, k + 1), line: t.line, parent: null, own: [], ctx: [], tag: null, attrs: [], handler: null, title: null, hasAria: false, kids: [] });
    c.root = c;
    calls.push(c);
    at.set(k, c);
  }
  /** @param {number} k */
  const isElAt = (k) => at.has(k) && /** @type {ElCall} */ (at.get(k)).close > k;
  /** @param {number} s @param {number} e */
  const hasEl = (s, e) => {
    for (let k = s; k < e; k++) if (at.has(k)) return true;
    return false;
  };

  /**
   * The el() calls and names an expression yields as its value (so a parent can interpolate them).
   * @param {number} s @param {number} e
   */
  const walk = (s, e) => {
    /** @type {Set<number>} */
    const found = new Set();
    /** @type {number[]} */
    const idents = [];
    let ok = true;
    /** @param {number} a @param {number} b */
    const value = (a, b) => {
      if (b <= a) return;
      if (isElAt(a) && J.match[a + 1] === b - 1) return void found.add(a);
      if (b - a === 1 && isId(J, a)) return void idents.push(a);
      if (isP(J, a, "...")) return value(a + 1, b);
      if ((isP(J, a, "(") || isP(J, a, "[")) && J.match[a] === b - 1) {
        if (isP(J, a, "(")) return value(a + 1, b - 1);
        for (const [x, y] of splitArgs(J, a)) value(x, y);
        return;
      }
      const tern = splitTop(J, a, b, ["?", ":"]);
      if (tern.ops.includes("?")) {
        tern.parts.forEach(([x, y], i) => {
          if (tern.ops[i] === "?") {
            if (hasEl(x, y)) ok = false;
          } else value(x, y);
        });
        return;
      }
      const logic = splitTop(J, a, b, ["&&", "||", "??"]);
      if (logic.parts.length > 1) {
        for (const [x, y] of logic.parts) value(x, y);
        return;
      }
      // receiver.map((x) => el(...))
      if (isP(J, b - 1, ")")) {
        const o = J.match[b - 1];
        if (o > a + 1 && (isId(J, o - 1, "map") || isId(J, o - 1, "flatMap")) && (isP(J, o - 2, ".") || isP(J, o - 2, "?."))) {
          const fa = splitArgs(J, o);
          const arg = fa[0];
          if (fa.length === 1 && arg && !hasEl(a, o - 2)) {
            let body = -1;
            if (isP(J, arg[0], "(") && isP(J, J.match[arg[0]] + 1, "=>")) body = J.match[arg[0]] + 2;
            else if (isId(J, arg[0]) && isP(J, arg[0] + 1, "=>")) body = arg[0] + 2;
            if (body > 0 && !isP(J, body, "{")) return value(body, arg[1]);
          }
        }
      }
      if (hasEl(a, b)) ok = false;
    };
    value(s, e);
    return { calls: found, idents, ok };
  };

  // ---- trees: which call is a child of which
  /** @type {ElCall[]} */
  const stack = [];
  for (const c of calls) {
    while (stack.length && /** @type {ElCall} */ (stack[stack.length - 1]).close < c.s) stack.pop();
    const p = stack[stack.length - 1];
    if (p) {
      if (!p.kids.length) p.kids = p.args.slice(2).map(([x, y]) => walk(x, y));
      const i = p.args.findIndex(([x, y]) => x <= c.s && c.s < y);
      if (i === 0) addOnce(p.own, "el-in-tag", "an el() call inside its tag");
      else if (i === 1) addOnce(p.own, "el-in-attrs", "an el() call inside its attributes");
      else if (i >= 2 && p.kids[i - 2]?.calls.has(c.s)) c.parent = p;
      else if (i >= 2) addOnce(p.own, "child-expression", "a child expression holds an el() call it cannot follow");
    }
    stack.push(c);
  }
  for (const c of calls) {
    if (!c.kids.length) c.kids = c.args.slice(2).map(([x, y]) => walk(x, y));
    let r = c;
    while (r.parent) r = r.parent;
    c.root = r;
  }

  // ---- each call's own shape
  for (const c of calls) ownShape(c);

  // ---- where each tree's node goes
  /** @type {Map<string, ElCall>} */
  const bound = new Map();
  /** @type {Set<number>} declaration name tokens */
  const declTok = new Set();
  for (const c of calls) {
    if (c.root !== c) continue;
    const where = context(c);
    if (where.kind === "bind") {
      const name = /** @type {string} */ (where.name);
      if (bound.has(name)) {
        addOnce(c.ctx, "context", name + " is bound twice");
        addOnce(/** @type {ElCall} */ (bound.get(name)).ctx, "context", name + " is bound twice");
      } else bound.set(name, c);
      declTok.add(/** @type {number} */ (where.tok));
    } else if (where.problem) c.ctx.push(where.problem);
  }
  // A child name: which call interpolates it.
  /** @type {Map<number, ElCall>} */
  const childUse = new Map();
  for (const c of calls) for (const kid of c.kids) for (const k of kid.idents) childUse.set(k, c);
  /** @type {{ a: ElCall, b: ElCall, name: string, line: number }[]} */
  const edges = [];
  for (const [k, c] of childUse) {
    const name = /** @type {string} */ (J.toks[k]?.value);
    const u = bound.get(name);
    if (u) edges.push({ a: c.root, b: u, name, line: J.toks[k]?.line ?? 0 });
    else if (nodeMaker(name)) addOnce(c.own, "node-child", "the child " + name + " is a DOM node");
  }
  for (const [name, u] of bound) {
    for (let k = 0; k < N; k++) {
      if (!isId(J, k, name) || declTok.has(k) || childUse.has(k) || isP(J, k - 1, ".") || isP(J, k - 1, "?.")) continue;
      if (isP(J, k + 1, ":") && (isP(J, k - 1, "{") || isP(J, k - 1, ",")) && isP(J, J.parent[k], "{")) continue;
      if (k >= u.s && k <= u.close) continue;
      if (isId(J, k - 1, "return") && endsStatement(k + 1) && returnsFromTop(k - 1)) continue;
      const nx = J.toks[k + 1];
      if (u.ctx.some((p) => p.code === "mutated")) continue;
      if (isP(J, k + 1, ".") || isP(J, k + 1, "?.") || isP(J, k + 1, "[")) addOnce(u.ctx, "mutated", name + " is changed after it is built (" + name + (isP(J, k + 1, "[") ? "[...]" : "." + (J.toks[k + 2]?.value ?? "")) + ", source line " + J.toks[k]?.line + ")");
      else if (nx && nx.type === "punct" && /^(?:[-+*/%&|^]|\*\*|<<|>>>?|&&|\|\||\?\?)?=$/.test(nx.value)) addOnce(u.ctx, "mutated", name + " is assigned again (source line " + J.toks[k]?.line + ")");
      else {
        const o = J.parent[k];
        if (isP(J, o, "(") && (isId(J, o - 1) || isP(J, o - 1, ")"))) addOnce(u.ctx, "dom-arg", "its node " + name + " is passed to " + callee(o) + "() at source line " + J.toks[k]?.line);
        else addOnce(u.ctx, "context", "its node " + name + " is used outside an el() tree at source line " + J.toks[k]?.line);
      }
    }
  }

  // ---- whole or nothing: a tree converts only with every tree it shares a node with
  /** @param {ElCall} r */
  const selfBad = (r) => r.ctx.length > 0 || calls.some((c) => c.root === r && c.own.length > 0);
  /** @type {Set<ElCall>} */
  const bad = new Set(calls.filter((c) => c.root === c && selfBad(c)));
  for (let changed = true; changed; ) {
    changed = false;
    for (const e of edges) {
      if (bad.has(e.b) && !bad.has(e.a)) {
        bad.add(e.a);
        addOnce(e.a.ctx, "node-child", "the child " + e.name + " (source line " + e.line + ") is a node from an el() call that is not converted (source line " + J.toks[e.b.s]?.line + ")");
        changed = true;
      }
      if (bad.has(e.a) && !bad.has(e.b)) {
        bad.add(e.b);
        addOnce(e.b.ctx, "used-in-bailed", e.name + " is a child of the el() call at source line " + J.toks[e.a.s]?.line + ", which is not converted");
        changed = true;
      }
    }
  }

  // ---- write
  /** @type {{ start: number, end: number, text: string }[]} */
  const edits = [];
  /** @type {Act[]} */
  const acts = [];
  /** @type {Map<string, string>} fn text to act */
  const actOf = new Map();
  /** @type {ElResult["bailed"]} */
  const bailed = [];
  /** @type {string[]} notes about titles that became descriptions, and links left for a person */
  const tipNotes = [];
  /** Whether a converted tree builds a link with attrs(linkAttrs()). */
  let usesLinks = false;
  /** Whether attrs and linkAttrs can be imported under their own names. */
  const linkNamesFree = !["attrs", "linkAttrs"].some((n) => B.module.has(n) || B.local.has(n));
  let tipCount = 0;
  /** @type {Set<string> | null} */
  let ids = null;
  let converted = 0;
  let returned = 0;
  for (const c of calls) {
    if (c.root !== c) continue;
    const members = calls.filter((m) => m.root === c);
    if (bad.has(c)) {
      for (const m of members) {
        let reason;
        let code;
        if (m.own.length) {
          code = /** @type {Problem} */ (m.own[0]).code;
          reason = m.own.map((x) => x.msg).join("; ");
        } else if (m === c && c.ctx.length) {
          code = /** @type {Problem} */ (c.ctx[0]).code;
          reason = c.ctx.map((x) => x.msg).join("; ");
        } else if (m === c) {
          const inner = /** @type {ElCall} */ (members.find((x) => x.own.length));
          code = "inner";
          reason = "the el() call inside it at source line " + inner.line + " is not converted";
        } else {
          code = "in-bailed-tree";
          reason = "inside the el() call at source line " + c.line + ", which is not converted";
        }
        const hints = [];
        if (m.title) hints.push("make its title a data-tip");
        if (m.handler) hints.push("make " + m.handler.key + " a data-act");
        const full = reason + (hints.length ? " (then " + hints.join(", ") + ")" : "");
        bailed.push({ line: m.line, code, reason: full });
        edits.push({ start: /** @type {any} */ (J.toks[m.s]).start, end: /** @type {any} */ (J.toks[m.s]).start, text: "/* migrate: el() not converted: " + commentSafe(full) + " */ " });
      }
      continue;
    }
    const markup = render(c);
    edits.push({ start: /** @type {any} */ (J.toks[c.s]).start, end: /** @type {any} */ (J.toks[c.close]).end, text: "html`" + markup + "`" });
    converted += members.length;
    if (context(c).kind === "return") returned++;
  }

  const left = calls.length - converted;
  if (converted && !left) {
    const imp = elImport();
    if (imp) edits.push(imp);
  }
  let out = applyEdits(text, edits);
  const actsFn = acts.length ? uniqueName("bind" + pascal(page) + "Acts") : null;
  if (converted) out = addImport(out, (usesLinks ? TEMPLATES["importHtmlLinks"] : TEMPLATES["importHtml"]) ?? "");
  if (acts.length) {
    if (acts.some((a) => a.via === "bindActs")) out = addImport(out, TEMPLATES["importBindActs"] ?? "");
    if (acts.some((a) => a.via === "delegate")) out = addImport(out, TEMPLATES["importDelegate"] ?? "");
    out = out.replace(/\s*$/, "\n") + "\n" + actsBlock(/** @type {string} */ (actsFn), acts);
  }
  /** @type {string[]} */
  const notes = [...tipNotes];
  const summary = ["/* migrate: el-to-html converted " + converted + " of " + calls.length + " el() call" + (calls.length === 1 ? "" : "s") + " to html templates" + (left ? "; each call left as el() says why it is not converted" : "") + "."];
  if (converted) summary.push("   A converted call yields SafeHtml, not a node: the route that shows it mounts it with renderRegion(el, view), and a name or expression child is interpolated as escaped text (check none holds a DOM node).");
  if (returned) summary.push("   " + returned + " page function" + (returned === 1 ? " returns" : "s return") + " SafeHtml now.");
  if (usesLinks) summary.push("   A computed href is built with attrs(linkAttrs(href)), so a hash route stays in the frame (target _self); linkAttrs throws on an empty or unsafe URL, so test one that may be empty with isSafeUrl first.");
  if (acts.length) summary.push("   The on* handlers became data-act attributes: call " + actsFn + "(el) after renderRegion and return its result as the teardown.");
  summary.push("   The imports point where the page will live: src/client/migrated/pages/. */");
  out = header + summary.join("\n") + "\n" + out;
  const why = codeProblem(out);
  if (why) {
    notes.push(sourceKey + ": the rewrite was refused (" + why + "); the page is parked as it was");
    return { text: header + "/* migrate: el-to-html could not rewrite this file safely (" + commentSafe(why) + "); it is the original. */\n" + text, total: calls.length, converted: 0, bailed: calls.map((c) => ({ line: c.line, code: "refused", reason: why })), acts: [], actsFn: null, notes };
  }
  return { text: out, total: calls.length, converted, bailed, acts, actsFn, notes };

  // ---------------------------------------------------------------- helpers

  /** @param {Problem[]} list @param {string} code @param {string} msg */
  function addOnce(list, code, msg) {
    if (!list.some((p) => p.code === code && p.msg === msg)) list.push({ code, msg });
  }

  /** The callee of the call whose argument list opens at o, as written. @param {number} o */
  function callee(o) {
    let j = o - 1;
    if (isP(J, j, ")")) return "a call";
    let s = j;
    while ((isP(J, s - 1, ".") || isP(J, s - 1, "?.")) && isId(J, s - 2)) s -= 2;
    return slice(J, s, j + 1);
  }

  /** Whether the statement ends right before k. @param {number} k */
  function endsStatement(k) {
    const t = J.toks[k];
    const p = J.toks[k - 1];
    return !t || isP(J, k, ";") || isP(J, k, "}") || (!!p && t.line > p.line + (p.value.split("\n").length - 1));
  }

  /** Whether the return at r returns from a top-level function. @param {number} r */
  function returnsFromTop(r) {
    let o = J.parent[r];
    while (o >= 0) {
      if (!isP(J, o, "{")) return false;
      const p = J.toks[o - 1];
      if (isP(J, o - 1, "=>")) return J.depth[o - 1] === 0;
      if (isP(J, o - 1, ")")) {
        const q = J.match[o - 1];
        if (isId(J, q - 1, "function")) return J.depth[q - 1] === 0;
        if (isId(J, q - 1) && isId(J, q - 2, "function")) return J.depth[q - 2] === 0;
        if (["if", "for", "while", "switch", "catch", "with"].some((w) => isId(J, q - 1, w))) {
          o = J.parent[o];
          continue;
        }
        return false;
      }
      if (!p || (p.type === "ident" && ["else", "try", "finally", "do"].includes(p.value)) || isP(J, o - 1, "{") || isP(J, o - 1, "}") || isP(J, o - 1, ";")) {
        o = J.parent[o];
        continue;
      }
      return false;
    }
    return false;
  }

  /**
   * Where a tree's node goes.
   * @param {ElCall} c
   * @returns {{ kind: "return" | "bind" | "other", name?: string, tok?: number, problem?: Problem }}
   */
  function context(c) {
    let a = c.s;
    let b = c.close;
    while (isP(J, a - 1, "(") && isP(J, b + 1, ")") && J.match[a - 1] === b + 1 && !(isId(J, a - 2) && !["return", "typeof", "void", "in", "of"].includes(/** @type {string} */ (J.toks[a - 2]?.value))) && !isP(J, a - 2, ")") && !isP(J, a - 2, "]")) {
      a--;
      b++;
    }
    if (isId(J, a - 1, "return") && endsStatement(b + 1)) {
      return returnsFromTop(a - 1) ? { kind: "return" } : { kind: "other", problem: { code: "return-nested", msg: "it is returned from a nested function, whose caller needs a DOM node" } };
    }
    if (isP(J, a - 1, "=>")) {
      return J.depth[a - 1] === 0 ? { kind: "return" } : { kind: "other", problem: { code: "return-nested", msg: "it is the value of a nested arrow function, whose caller needs a DOM node" } };
    }
    if (isP(J, a - 1, "=") && isId(J, a - 2) && (isId(J, a - 3, "const") || isId(J, a - 3, "let") || isId(J, a - 3, "var") || isP(J, a - 3, ",")) && (endsStatement(b + 1) || isP(J, b + 1, ","))) {
      if (isP(J, a - 3, ",")) {
        // const a = 1, b = el(...): find the keyword at the same depth
        let j = a - 3;
        while (j >= 0 && J.depth[j] >= J.depth[a - 3] && !isP(J, j, ";") && !(isId(J, j, "const") || isId(J, j, "let") || isId(J, j, "var"))) j--;
        if (!(isId(J, j, "const") || isId(J, j, "let") || isId(J, j, "var"))) return { kind: "other", problem: { code: "context", msg: "its node is used in an expression" } };
      }
      return { kind: "bind", name: J.toks[a - 2]?.value, tok: a - 2 };
    }
    const o = J.parent[a];
    if ((isP(J, a - 1, "(") || isP(J, a - 1, ",") || isP(J, a - 1, "...")) && isP(J, o, "(") && (isId(J, o - 1) || isP(J, o - 1, ")"))) {
      return { kind: "other", problem: { code: "dom-arg", msg: "its node is passed to " + callee(o) + "()" } };
    }
    return { kind: "other", problem: { code: "context", msg: "its node is used where a DOM node is needed" } };
  }

  /** Whether a name is bound to something that makes a DOM node. @param {string} name */
  function nodeMaker(name) {
    for (let k = 0; k < N; k++) {
      if (!isId(J, k, name) || !isP(J, k + 1, "=") || !(isId(J, k - 1, "const") || isId(J, k - 1, "let") || isId(J, k - 1, "var"))) continue;
      for (let j = k + 2; j < N && !isP(J, j, ";") && (J.depth[j] ?? 0) >= (J.depth[k] ?? 0); j++) {
        const t = J.toks[j];
        if (t?.type === "ident" && NODE_MAKERS.has(t.value) && isP(J, j - 1, ".")) return true;
        if (J.toks[j + 1] && /** @type {any} */ (J.toks[j + 1]).line > /** @type {any} */ (t).line && J.depth[j + 1] === J.depth[k]) break;
      }
    }
    return false;
  }

  /** @param {ElCall} c */
  function ownShape(c) {
    const a0 = c.args[0];
    if (!a0) return addOnce(c.own, "no-args", "it has no arguments");
    if (a0[1] - a0[0] === 1 && isStr(J, a0[0])) {
      const tag = strOf(J, a0[0]);
      if (!TAG.test(tag)) addOnce(c.own, "bad-tag", "the tag " + JSON.stringify(tag) + " is not a plain lowercase name");
      else if (RAW.has(tag)) addOnce(c.own, "raw-element", "a <" + tag + "> element takes no markup children in the html template");
      else c.tag = tag;
    } else addOnce(c.own, "dynamic-tag", "the tag is not a string literal");
    if (c.tag && VOID.has(c.tag) && c.args.length > 2 && c.args.slice(2).some(([x, y]) => !(y - x === 1 && (isId(J, x, "null") || isId(J, x, "undefined") || isId(J, x, "false"))))) addOnce(c.own, "void-children", "<" + c.tag + "> is a void element but has children");
    for (let i = 0; i < c.kids.length; i++) if (!c.kids[i]?.ok) addOnce(c.own, "child-expression", "a child expression holds an el() call it cannot follow");
    const a1 = c.args[1];
    if (a1 && !(a1[1] - a1[0] === 1 && (isId(J, a1[0], "null") || isId(J, a1[0], "undefined")))) {
      if (isP(J, a1[0], "{") && J.match[a1[0]] === a1[1] - 1) attrsOf(c, a1[0]);
      else addOnce(c.own, "dynamic-attrs", "the attributes are not an object literal");
    }
    // a double slash anywhere in the call's own text (outside its el() children) would reach the bundle
    for (let k = c.open; k < c.close; k++) {
      const ch = at.get(k);
      if (ch && ch !== c && ch.parent === c) {
        k = ch.close;
        continue;
      }
      const t = J.toks[k];
      if (t && (t.type === "string" || t.type === "template" || t.type === "regex") && t.value.includes("//")) {
        addOnce(c.own, "double-slash", "a string holds a double slash (build the URL with a join)");
        break;
      }
    }
  }

  /** @param {ElCall} c @param {number} open */
  function attrsOf(c, open) {
    let handlers = 0;
    for (const [s, e] of splitArgs(J, open)) {
      if (isP(J, s, "...")) {
        addOnce(c.own, "spread-attrs", "the attributes spread another object");
        continue;
      }
      let key = null;
      if (isId(J, s)) key = /** @type {string} */ (J.toks[s]?.value);
      else if (J.toks[s]?.type === "string") key = strOf(J, s);
      if (key === null || !(isP(J, s + 1, ":") || (e - s === 1 && isId(J, s)))) {
        addOnce(c.own, "computed-key", "an attribute key is computed or a method");
        continue;
      }
      /** @type {[number, number]} */
      const range = e - s === 1 ? [s, e] : [s + 2, e];
      const name = /** @type {Record<string, string>} */ (RENAME)[key] ?? key;
      if (name === "style") addOnce(c.own, "style", "a style attribute (move it into a class)");
      else if (DOM_PROPS.has(key)) addOnce(c.own, "dom-property", "the " + key + " key sets a DOM property");
      else if (key === "ref") addOnce(c.own, "ref", "a ref callback reaches the node");
      else if (/^on[a-z]+$/i.test(key)) {
        handlers++;
        c.handler = { key: key.toLowerCase(), range };
      } else if (key === "dataset") {
        const [x, y] = range;
        if (isP(J, x, "{") && J.match[x] === y - 1) {
          for (const [ds, de] of splitArgs(J, x)) {
            const dk = isId(J, ds) ? J.toks[ds]?.value : J.toks[ds]?.type === "string" ? strOf(J, ds) : null;
            if (!dk || !(isP(J, ds + 1, ":") || de - ds === 1) || !/^[A-Za-z][A-Za-z0-9]*$/.test(dk)) {
              addOnce(c.own, "dynamic-attrs", "a dataset key is not a plain name");
              continue;
            }
            valueAttr(c, "data-" + kebabData(dk), de - ds === 1 ? [ds, de] : [ds + 2, de]);
          }
        } else addOnce(c.own, "dynamic-attrs", "the dataset is not an object literal");
      } else if (!ATTR_NAME.test(name) || name.toLowerCase() === "srcdoc") addOnce(c.own, "bad-attr", "the attribute " + JSON.stringify(key) + " is not one the html template takes");
      else if (name === "title") c.title = range;
      else {
        if (name === "aria-label") c.hasAria = true;
        if (name === "data-act" && handlers) addOnce(c.own, "act-taken", "it has a data-act already");
        valueAttr(c, name, range);
      }
    }
    if (handlers > 1) addOnce(c.own, "two-handlers", "two on* handlers on one element (one data-act each)");
    if (handlers && c.attrs.some((x) => x.name === "data-act")) addOnce(c.own, "act-taken", "it has a data-act already");
    if (c.handler) checkHandler(c, c.handler);
  }

  /** @param {ElCall} c @param {string} name @param {[number, number]} range */
  function valueAttr(c, name, [x, y]) {
    if (y - x === 1 && isStr(J, x)) return void c.attrs.push({ name, kind: "lit", value: strOf(J, x) });
    if (y - x === 1 && J.toks[x]?.type === "number") return void c.attrs.push({ name, kind: "lit", value: /** @type {string} */ (J.toks[x]?.value) });
    if (y - x === 1 && isId(J, x, "true")) return void c.attrs.push({ name, kind: "bool" });
    if (y - x === 1 && (isId(J, x, "false") || isId(J, x, "null") || isId(J, x, "undefined"))) return;
    if (BOOLEAN.has(name.toLowerCase())) return addOnce(c.own, "dynamic-boolean", "the boolean attribute " + name + " takes a computed value");
    c.attrs.push({ name, kind: "expr", value: slice(J, x, y), range: [x, y] });
  }

  /** @param {ElCall} c @param {{ key: string, range: [number, number] }} h */
  function checkHandler(c, h) {
    const [x, y] = h.range;
    let chain = true;
    for (let k = x; k < y; k++) if (!((k - x) % 2 === 0 ? isId(J, k) : isP(J, k, "."))) chain = false;
    chain = chain && (y - x) % 2 === 1;
    const arrow = (isP(J, x, "(") && isP(J, J.match[x] + 1, "=>")) || (isId(J, x) && isP(J, x + 1, "=>")) || (isId(J, x, "async") && (isP(J, x + 2, "=>") || (isP(J, x + 1, "(") && isP(J, J.match[x + 1] + 1, "=>"))));
    const fn = isId(J, x, "function") || (isId(J, x, "async") && isId(J, x + 1, "function"));
    if (!chain && !arrow && !fn) return addOnce(c.own, "handler-shape", "the " + h.key + " handler is not a function, an arrow or a name");
    if (hasEl(x, y)) return addOnce(c.own, "el-in-attrs", "the " + h.key + " handler builds nodes with el()");
    const { free, usesThis } = chain ? { free: [/** @type {string} */ (J.toks[x]?.value)], usesThis: false } : freeNames(J, x, y);
    if (usesThis) return addOnce(c.own, "handler-this", "the " + h.key + " handler reads this or arguments");
    const locals = free.filter((f) => B.local.has(f));
    if (locals.length) addOnce(c.own, "handler-closure", "the " + h.key + " handler uses " + locals.join(", ") + " from the code around it (give the element data-* attributes and wire it with bindActs by hand)");
    if (chain && y - x === 1 && isTopFunctionUsingThis(/** @type {string} */ (J.toks[x]?.value))) addOnce(c.own, "handler-this", "the " + h.key + " handler reads this");
  }

  /** @param {string} name */
  function isTopFunctionUsingThis(name) {
    for (let k = 0; k < N; k++) {
      if (!isId(J, k, "function") || J.depth[k] !== 0 || !isId(J, k + 1, name)) continue;
      const p = k + 2;
      if (!isP(J, p, "(")) continue;
      const body = J.match[p] + 1;
      if (!isP(J, body, "{")) continue;
      for (let j = body; j < J.match[body]; j++) if (isId(J, j, "this") || isId(J, j, "arguments")) return true;
    }
    return false;
  }

  /** Whether an element shows text of its own. @param {ElCall} c @returns {boolean} */
  function hasText(c) {
    for (let i = 2; i < c.args.length; i++) {
      const [x, y] = /** @type {[number, number]} */ (c.args[i]);
      if (y - x === 1 && isStr(J, x)) {
        if (strOf(J, x).trim()) return true;
        continue;
      }
      if (y - x === 1 && (isId(J, x, "null") || isId(J, x, "undefined") || isId(J, x, "false"))) continue;
      const ch = at.get(x);
      if (ch && ch.close === y - 1) {
        if (hasText(ch)) return true;
        continue;
      }
      return true;
    }
    return false;
  }

  /** @param {string} t */
  function norm(t) {
    return t.replace(/\s+/g, " ").trim().toLowerCase();
  }

  /** The text an element shows when every child is a literal or such an element, else null. @param {ElCall} c @returns {string | null} */
  function staticText(c) {
    let out = "";
    for (let i = 2; i < c.args.length; i++) {
      const [x, y] = /** @type {[number, number]} */ (c.args[i]);
      if (y - x === 1 && isStr(J, x)) out += strOf(J, x);
      else if (y - x === 1 && J.toks[x]?.type === "number") out += J.toks[x]?.value ?? "";
      else if (y - x === 1 && (isId(J, x, "null") || isId(J, x, "undefined") || isId(J, x, "false"))) continue;
      else {
        const ch = at.get(x);
        const inner = ch && ch.close === y - 1 ? staticText(ch) : null;
        if (inner === null) return null;
        out += " " + inner + " ";
      }
    }
    return out;
  }

  /** A fresh id for a hidden description span, unique among this module's literal ids. */
  function tipId() {
    if (!ids) ids = new Set(calls.flatMap((x) => x.attrs.filter((a) => a.name === "id" && a.kind === "lit").map((a) => /** @type {string} */ (a.value))));
    let id = "";
    do id = page + "-tip-" + ++tipCount;
    while (ids.has(id));
    ids.add(id);
    return id;
  }

  /**
   * The markup of a convertible call.
   * @param {ElCall} c @param {boolean} [repeated] inside a function in the tree (a .map arrow), so it may be drawn more than once
   * @returns {string}
   */
  function render(c, repeated = false) {
    const tag = /** @type {string} */ (c.tag);
    let s = "<" + tag;
    /** @param {string} name @param {Attr} a */
    const put = (name, a) => {
      if (a.kind === "lit") s += " " + name + '="' + escAttr(/** @type {string} */ (a.value)) + '"';
      else if (a.kind === "bool") s += " " + name;
      else if (a.kind === "expr") s += " " + name + '="${' + a.value + '}"';
      else if (a.kind === "act") s += " " + name + '="' + escAttr(/** @type {string} */ (a.value)) + '"';
    };
    const link = linkPlan(c);
    if (link?.mark) s = link.mark + s;
    for (const a of c.attrs) {
      if (link && a === link.url && link.href !== undefined) put(a.name, { ...a, value: link.href });
      else if (link && a === link.url && link.mode === "linkAttrs") {
        // a computed href: linkAttrs gives a hash target _self (and an absolute one _top and rel)
        s += " ${attrs(linkAttrs(" + a.value + "))}";
        usesLinks = true;
      } else if (link && a === link.target && link.mode === "replace") s += " " + SELF_ATTR;
      else put(a.name, a);
      if (link && a === link.url && link.mode === "add") s += " " + SELF_ATTR;
    }
    /** @type {string} the hidden description span, when the title describes an element with a name of its own */
    let described = "";
    if (c.title) {
      const t = /** @type {Attr} */ ({ name: "data-tip", kind: "expr" });
      const [x, y] = c.title;
      if (y - x === 1 && isStr(J, x)) Object.assign(t, { kind: "lit", value: strOf(J, x) });
      else Object.assign(t, { kind: "expr", value: slice(J, x, y) });
      put("data-tip", t);
      if (!c.hasAria && !hasText(c)) put("aria-label", t);
      else if (!c.hasAria && t.kind === "lit" && norm(staticText(c) ?? "\u0000") === norm(/** @type {string} */ (t.value))) {
        // the title only repeats the text the element shows: nothing more to say
      } else if (VOID.has(tag) || NO_SPAN.has(tag) || c.attrs.some((a) => a.name.toLowerCase() === "aria-describedby")) {
        tipNotes.push(sourceKey + ":" + c.line + ": the title of this <" + tag + "> describes it (it has a name of its own), but " + (c.attrs.some((a) => a.name.toLowerCase() === "aria-describedby") ? "it has an aria-describedby already" : "a <" + tag + "> cannot hold the hidden description span") + ": give screen readers the text by hand");
      } else {
        const id = tipId();
        s += ' aria-describedby="' + id + '"';
        described = '<span id="' + id + '" hidden>' + (t.kind === "lit" ? escText(/** @type {string} */ (t.value)) : "${" + t.value + "}") + "</span>";
        if (repeated) tipNotes.push(sourceKey + ":" + c.line + ": the description id " + id + " repeats with each item drawn: make it unique (add the item's id) when you port the page");
      }
    }
    if (c.handler) put("data-act", { name: "data-act", kind: "act", value: registerAct(c) });
    s += ">";
    if (VOID.has(tag)) return s;
    for (let i = 2; i < c.args.length; i++) {
      const [x, y] = /** @type {[number, number]} */ (c.args[i]);
      if (y - x === 1 && isStr(J, x)) s += escText(strOf(J, x));
      else if (y - x === 1 && J.toks[x]?.type === "number") s += escText(/** @type {string} */ (J.toks[x]?.value));
      else if (y - x === 1 && (isId(J, x, "null") || isId(J, x, "undefined") || isId(J, x, "false"))) s += "";
      else if (y - x === 1 && isId(J, x, "true")) s += "true";
      else {
        const ch = at.get(x);
        if (ch && ch.close === y - 1 && ch.parent === c) s += render(ch, repeated);
        else s += "${" + expr(c, i, isP(J, x, "...") ? x + 1 : x, y, repeated) + "}";
      }
    }
    return s + described + "</" + tag + ">";
  }

  /**
   * How a link keeps in the frame (frameLinks.mjs): a literal hash URL gains target="_self" (add),
   * or its _top, _parent or empty target becomes _self (replace); a computed href is built with
   * attrs(linkAttrs()) when the element sets no target or rel of its own. Anything else is written
   * as it was, with a note when it may leave the frame. Null when there is nothing to do.
   * A literal ?page= href to a page the app has is written as its hash route (href) and then
   * follows the hash rule; one to another page is kept after a marker comment (mark).
   * @param {ElCall} c
   * @returns {{ url: Attr, target: Attr | null, mode: "add" | "replace" | "linkAttrs" | "ok", href?: string, mark?: string } | null}
   */
  function linkPlan(c) {
    const name = linkAttrOf(/** @type {string} */ (c.tag));
    const url = name ? c.attrs.find((a) => a.name.toLowerCase() === name) : undefined;
    if (!url) return null;
    const target = c.attrs.find((a) => a.name.toLowerCase() === "target") ?? null;
    /** @param {string} why */
    const note = (why) => {
      const n = sourceKey + ":" + c.line + ": " + why;
      if (!tipNotes.includes(n)) tipNotes.push(n);
    };
    if (url.kind === "lit") {
      const rel = pageRewrite(/** @type {string} */ (url.value), pages);
      if (rel?.fix === "left") {
        note("the page link " + JSON.stringify(url.value) + " of this <" + c.tag + "> is not rewritten: " + rel.why);
        return { url, target, mode: "ok", mark: pageMarkComment(rel.why) };
      }
      if (rel?.fix === "report") note("the link " + JSON.stringify(url.value) + " of this <" + c.tag + "> " + rel.why + ": make it a hash route, or a full reload with the service URL and target _top");
      const href = rel?.fix === "route" ? rel.href : undefined;
      if (!isHashUrl(href ?? url.value)) return null;
      const tv = !target ? null : target.kind === "lit" ? /** @type {string} */ (target.value) : target.kind === "bool" ? "" : HOLE;
      const fix = targetFix(tv);
      if (fix === "add" || fix === "replace") return { url, target, mode: fix, ...(href === undefined ? {} : { href }) };
      if (fix === "keep") note("the hash link of this <" + c.tag + "> " + (tv === HOLE ? "has a computed target" : leaveReason(tv)) + ", so it may leave the frame: make it _self unless it opens a new window on purpose");
      return href === undefined ? null : { url, target, mode: "ok", href };
    }
    if (url.kind !== "expr" || name !== "href") return null;
    if (!target && linkNamesFree && !c.attrs.some((a) => a.name.toLowerCase() === "rel")) return { url, target, mode: "linkAttrs" };
    note("the href of this <" + c.tag + "> is computed and " + (linkNamesFree ? "the element sets its own target or rel" : "attrs or linkAttrs is a name in this module") + ": if it can be a hash route, build it with attrs(linkAttrs(href)) so it carries target _self");
    return null;
  }

  /**
   * A child expression with its followed el() calls rendered in place.
   * @param {ElCall} c @param {number} i @param {number} x @param {number} y @param {boolean} repeated
   */
  function expr(c, i, x, y, repeated) {
    const kid = c.kids[i - 2];
    const base = /** @type {any} */ (J.toks[x]).start;
    const inFn = repeated || /=>|\bfunction\b/.test(slice(J, x, y));
    /** @type {{ start: number, end: number, text: string }[]} */
    const ed = [];
    for (const k of kid ? kid.calls : []) {
      const ch = /** @type {ElCall} */ (at.get(k));
      ed.push({ start: /** @type {any} */ (J.toks[ch.s]).start - base, end: /** @type {any} */ (J.toks[ch.close]).end - base, text: "html`" + render(ch, inFn) + "`" });
    }
    return applyEdits(slice(J, x, y), ed);
  }

  /** @param {ElCall} c */
  function registerAct(c) {
    const h = /** @type {{ key: string, range: [number, number] }} */ (c.handler);
    const [x, y] = h.range;
    const fn = slice(J, x, y);
    const event = h.key.slice(2);
    const via = elementEvent(c) === event ? "bindActs" : "delegate";
    const had = actOf.get(fn + "\n" + event + "\n" + via);
    if (had) return had;
    let isName = (y - x) % 2 === 1;
    for (let k = x; k < y; k++) if (!((k - x) % 2 === 0 ? isId(J, k) : isP(J, k, "."))) isName = false;
    const named = isName ? /** @type {string} */ (J.toks[y - 1]?.value) : event;
    let act = page + ":" + named;
    for (let n = 2; acts.some((a) => a.act === act); n++) act = page + ":" + named + "-" + n;
    actOf.set(fn + "\n" + event + "\n" + via, act);
    acts.push({ act, event, via, fn, line: c.line });
    return act;
  }

  /** The event bindActs routes for this element (see acts.js), or null when it cannot tell. @param {ElCall} c */
  function elementEvent(c) {
    const tag = c.tag;
    const type = c.attrs.find((a) => a.name.toLowerCase() === "type");
    if (tag === "select") return "change";
    if (tag === "textarea") return "input";
    if (tag === "input") {
      if (type && type.kind !== "lit") return null;
      const t = (type?.value ?? "").toLowerCase();
      return t === "checkbox" || t === "radio" ? "change" : "input";
    }
    return "click";
  }

  /** @param {string} base */
  function uniqueName(base) {
    let name = base;
    for (let n = 2; B.module.has(name) || B.local.has(name); n++) name = base + n;
    return name;
  }

  /** @param {string} name @param {Act[]} list */
  function actsBlock(name, list) {
    const viaBind = list.filter((a) => a.via === "bindActs");
    const viaDelegate = list.filter((a) => a.via === "delegate");
    const lines = [
      "/* Generated by gas-kit migrate (" + stepId + "): the on* handlers of the el() attributes, as data-act. Call it after",
      "   renderRegion(el, view) in the route's mount and return what it returns as the teardown. */",
      "export function " + name + "(root) {",
    ];
    const bindLines = ["bindActs(root, {", ...viaBind.map((a) => "    " + JSON.stringify(a.act) + ": " + indentMore(a.fn) + ","), "  })"];
    if (!viaDelegate.length) lines.push("  return " + bindLines.join("\n") + ";");
    else {
      lines.push("  const offs = [");
      if (viaBind.length) lines.push("    " + bindLines.join("\n  ") + ",");
      for (const a of viaDelegate) lines.push("    delegate(root, " + JSON.stringify(a.event) + ", " + JSON.stringify('[data-act="' + a.act + '"]') + ", " + indentMore(a.fn) + "),");
      lines.push("  ];", "  return () => offs.forEach((off) => off());");
    }
    lines.push("}", "");
    return lines.join("\n");
  }

  /** @param {string} s */
  function indentMore(s) {
    return s.replace(/\n/g, "\n  ");
  }

  /** The edit that drops el from its import when no el() call is left. */
  function elImport() {
    for (let k = 0; k < N; k++) {
      if (!isId(J, k, "import") || J.depth[k] !== 0 || !isP(J, k + 1, "{")) continue;
      const open = k + 1;
      const close = J.match[open];
      if (close < 0) continue;
      const specs = splitArgs(J, open);
      const keep = specs.filter(([x, y]) => !(elNames.includes(/** @type {string} */ (J.toks[y - 1]?.value)) && (y - x === 1 || isId(J, y - 2, "as"))));
      if (keep.length === specs.length) continue;
      if (keep.length) return { start: /** @type {any} */ (J.toks[open]).start, end: /** @type {any} */ (J.toks[close]).end, text: "{ " + keep.map(([x, y]) => slice(J, x, y)).join(", ") + " }" };
      let j = close + 1;
      while (j < N && !isStr(J, j)) j++;
      if (isP(J, j + 1, ";")) j++;
      const start = /** @type {any} */ (J.toks[k]).start;
      let end = /** @type {any} */ (J.toks[j]).end;
      if (text[end] === "\n") end++;
      return { start, end, text: "" };
    }
    return null;
  }
}
