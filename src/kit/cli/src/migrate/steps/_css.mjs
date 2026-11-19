// A small CSS reader the tokens and css-import steps share. It masks comments, strings and url()
// bodies (same length), parses blocks and statements over the masked text, and describes edits as
// offsets into the original text, so the stylesheet's own formatting survives. It knows which
// custom properties sit in a theme block (:root, the dark media block, the data-theme blocks), where
// the colour literals are in the declaration values, and which declarations point outside the app.
import { findColourLiterals } from "../../../../tooling/src/test/contracts/noColourOutsideTokens.js";
import { scanHtml } from "../scan/html.mjs";
import { sortedKeys } from "./_common.mjs";

/** @typedef {{ start: number, end: number, head: string, headEnd: number, block: boolean, children: CssNode[], bodyStart: number, bodyEnd: number }} CssNode */
/** @typedef {"light" | "dark" | "mediaDark"} ThemeBlock */

/** @typedef {{ start: number, end: number, value: string, where: "code" | "string" | "url" }} CssEscape */

/** CSS whitespace (after the preprocessing that folds \r\n, \r and \f into \n). @param {string | undefined} c */
const isWs = (c) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";
/** @param {string | undefined} c */
const isNl = (c) => c === "\n" || c === "\r" || c === "\f";

/**
 * Read a text the way the CSS tokenizer does, for the parts that decide where a block or a statement
 * ends: comments, strings, url() bodies and backslash escapes. Returns a same-length copy in which
 * comments are spaces and string bodies, url() bodies and escapes (the backslash and what it escapes)
 * are underscores, so no brace, semicolon or bracket in them is read as structure; every escape with
 * the character it stands for; and what the tokenizer would have to recover from (an unterminated
 * comment, string or url(), a bad url(), a backslash before a line break or at the end).
 * @param {string} css
 * @returns {{ masked: string, escapes: CssEscape[], problems: string[] }}
 */
export function lexCss(css) {
  let out = "";
  let i = 0;
  const n = css.length;
  /** where the last escape outside strings ended: a url( right after one is part of a longer name */
  let escEnd = -1;
  /** @type {CssEscape[]} */
  const escapes = [];
  /** @type {string[]} */
  const problems = [];
  /** @param {string} s @param {string} ch */
  const fill = (s, ch) => s.replace(/[^\n]/g, ch);
  /** @param {number} at */
  const lineOf = (at) => css.slice(0, at).split("\n").length;
  /**
   * The escape whose backslash is at k, or null when the backslash escapes nothing (a line break or
   * the end of the text follows it).
   * @param {number} k @param {CssEscape["where"]} where
   */
  const escapeAt = (k, where) => {
    const next = css[k + 1];
    if (next === undefined || isNl(next)) return null;
    const hex = /^[0-9a-fA-F]{1,6}/.exec(css.slice(k + 1, k + 7));
    let end;
    let value;
    if (hex) {
      end = k + 1 + hex[0].length;
      if (css[end] === "\r" && css[end + 1] === "\n") end += 2;
      else if (isWs(css[end])) end++;
      const cp = Number.parseInt(hex[0], 16);
      value = cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? "�" : String.fromCodePoint(cp);
    } else {
      const cp = /** @type {number} */ (css.codePointAt(k + 1));
      end = k + 1 + (cp > 0xffff ? 2 : 1);
      value = String.fromCodePoint(cp);
    }
    const e = { start: k, end, value, where };
    escapes.push(e);
    return e;
  };
  while (i < n) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const e = css.indexOf("*/", i + 2);
      if (e < 0) problems.push("line " + lineOf(i) + ": a comment that is never closed");
      const stop = e < 0 ? n : e + 2;
      out += fill(css.slice(i, stop), " ");
      i = stop;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        const d = css[j];
        if (d === c) {
          closed = true;
          break;
        }
        if (isNl(d)) break;
        if (d === "\\") {
          const e = escapeAt(j, "string");
          // a backslash before a line break continues the string on the next line
          j = e ? e.end : css[j + 1] === "\r" && css[j + 2] === "\n" ? j + 3 : j + 2;
          continue;
        }
        j++;
      }
      if (!closed) problems.push("line " + lineOf(i) + ": a string that is never closed");
      const stop = Math.min(n, closed ? j + 1 : j);
      const s = css.slice(i, stop);
      out += c + fill(s.slice(1, closed ? -1 : undefined), "_") + (closed ? c : "");
      i = stop;
    } else if ((c === "u" || c === "U") && /^url\(/i.test(css.slice(i, i + 4)) && !/[\w-]/.test(css[i - 1] || "") && escEnd !== i) {
      let j = i + 4;
      while (j < n && isWs(css[j])) j++;
      if (css[j] === '"' || css[j] === "'") {
        // url("..."): a function holding a string; the string branch masks it, the rest is read as written
        out += css.slice(i, j);
        i = j;
        continue;
      }
      let k = j;
      let bad = false;
      let closed = false;
      while (k < n) {
        const d = css[k];
        if (d === ")") {
          closed = true;
          break;
        }
        if (d === "\\") {
          const e = escapeAt(k, "url");
          if (!e) bad = true;
          k = e ? e.end : k + 1;
          continue;
        }
        if (isWs(d)) {
          let w = k;
          while (w < n && isWs(css[w])) w++;
          if (css[w] !== ")") bad = true;
          k = w;
          continue;
        }
        if (d === '"' || d === "'" || d === "(" || /[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(/** @type {string} */ (d))) bad = true;
        k++;
      }
      if (!closed) problems.push("line " + lineOf(i) + ": a url( that is never closed");
      else if (bad) problems.push("line " + lineOf(i) + ": a url( the tokenizer reads as a bad url");
      const stop = Math.min(n, k + 1);
      out += "url(" + fill(css.slice(i + 4, closed ? stop - 1 : stop), "_") + (closed ? ")" : "");
      i = stop;
    } else if (c === "\\") {
      const e = escapeAt(i, "code");
      if (!e) {
        problems.push("line " + lineOf(i) + ": a backslash that escapes nothing");
        out += c;
        i++;
      } else {
        out += fill(css.slice(i, e.end), "_");
        i = e.end;
        escEnd = i;
      }
    } else {
      out += c;
      i++;
    }
  }
  return { masked: out.slice(0, n), escapes, problems };
}

/**
 * Same-length copy of a CSS text: comments become spaces, string bodies, url() bodies and backslash
 * escapes underscores (lexCss).
 * @param {string} css
 */
export function maskCss(css) {
  return lexCss(css).masked;
}

/**
 * Parse the masked text into blocks and statements, with offsets. A brace or a semicolon inside
 * parentheses or brackets is not a delimiter (as in CSS Syntax, where a ( or [ block runs to its own
 * closer). Total: stray braces are skipped (cssProblems names them).
 * @param {string} m masked text
 * @returns {CssNode[]}
 */
export function parseCss(m) {
  /** @param {number} pos @returns {{ nodes: CssNode[], pos: number }} */
  const list = (pos) => {
    /** @type {CssNode[]} */
    const nodes = [];
    while (pos < m.length) {
      while (pos < m.length && /\s/.test(/** @type {string} */ (m[pos]))) pos++;
      if (pos >= m.length || m[pos] === "}") return { nodes, pos };
      const s = pos;
      let j = pos;
      let depth = 0;
      for (; j < m.length; j++) {
        const c = m[j];
        if (c === "(" || c === "[") depth++;
        else if ((c === ")" || c === "]") && depth > 0) depth--;
        else if (depth === 0 && (c === "{" || c === ";" || c === "}")) break;
      }
      const head = m.slice(s, j);
      if (j >= m.length || m[j] === "}" || m[j] === ";") {
        const end = j < m.length && m[j] === ";" ? j + 1 : j;
        if (head.trim()) nodes.push({ start: s, end, head, headEnd: j, block: false, children: [], bodyStart: j, bodyEnd: j });
        pos = m[j] === ";" ? j + 1 : j;
        if (j >= m.length || m[j] === "}") return { nodes, pos };
        continue;
      }
      const inner = list(j + 1);
      const close = inner.pos < m.length ? inner.pos : m.length;
      nodes.push({ start: s, end: Math.min(m.length, close + 1), head, headEnd: j, block: true, children: inner.nodes, bodyStart: j + 1, bodyEnd: close });
      pos = close + 1;
    }
    return { nodes, pos };
  };
  /** @type {CssNode[]} */
  const top = [];
  let pos = 0;
  while (pos < m.length) {
    const r = list(pos);
    top.push(...r.nodes);
    pos = r.pos + 1;
  }
  return top;
}

/**
 * What makes a stylesheet unsafe to read with parseCss, because a browser would recover from it in a
 * way this reader does not follow: what lexCss reports, a closer that does not match its opener, a
 * block or bracket left open, a brace or a semicolon inside parentheses or brackets, an HTML comment
 * marker (<!-- or -->), and a function name written with an escape (the tokenizer reads an escaped
 * url( as url()). Empty for a well-formed stylesheet: then parseCss reads its blocks as a browser does.
 * @param {string} css
 * @returns {string[]}
 */
export function cssProblems(css) {
  const { masked: m, escapes, problems } = lexCss(css);
  const out = [...problems];
  /** @param {number} at */
  const lineOf = (at) => css.slice(0, at).split("\n").length;
  /** @type {{ ch: string, at: number }[]} */
  const stack = [];
  const CLOSE = { "(": ")", "[": "]", "{": "}" };
  /** @param {string} ch */
  const closer = (ch) => CLOSE[/** @type {"(" | "[" | "{"} */ (ch)];
  // The first structural problem is the one to name: what follows it is read differently anyway.
  let bad = "";
  for (let i = 0; i < m.length && !bad; i++) {
    const c = /** @type {string} */ (m[i]);
    const top = stack[stack.length - 1];
    if (c === "(" || c === "[" || c === "{") {
      if (c === "{" && top && top.ch !== "{") bad = "line " + lineOf(i) + ": a { inside " + top.ch + " ... " + closer(top.ch);
      stack.push({ ch: c, at: i });
    } else if (c === ")" || c === "]" || c === "}") {
      if (!top || closer(top.ch) !== c) bad = "line " + lineOf(i) + ": a " + c + " that closes nothing open" + (top ? " (the open " + top.ch + " is on line " + lineOf(top.at) + ")" : "");
      else stack.pop();
    } else if (c === ";" && top && top.ch !== "{") bad = "line " + lineOf(i) + ": a ; inside " + top.ch + " ... " + closer(top.ch);
  }
  if (bad) out.push(bad);
  else for (const o of stack) out.push("line " + lineOf(o.at) + ": a " + o.ch + " that is never closed");
  for (const mk of m.matchAll(/<!--|-->/g)) out.push("line " + lineOf(mk.index) + ": an HTML comment marker " + mk[0]);
  for (const mk of m.matchAll(/[\w-]+\(/g)) {
    const from = mk.index;
    const to = from + mk[0].length - 1;
    if (escapes.some((e) => e.where === "code" && e.start < to && e.end > from)) out.push("line " + lineOf(from) + ": a function name written with an escape");
  }
  return [...new Set(out)];
}

/**
 * The escapes of a text that stand for a "<", in a string or not. esbuild writes such an escape back
 * as a bare "<" outside strings, so "\3c/style" reaches the inlined <style> element as "</style".
 * @param {string} css
 * @returns {string[]} one description per escape
 */
export function escapedLt(css) {
  return lexCss(css).escapes.filter((e) => e.value === "<").map((e) => "line " + css.slice(0, e.start).split("\n").length + ": the escape " + css.slice(e.start, e.end).trim() + " stands for <");
}

/** @param {string} s */
const norm = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();
const THEME = /\[\s*data-theme\s*=\s*(?:"|')?(light|dark)(?:"|')?\s*\]/;

/**
 * Which theme block a rule's selector and enclosing media condition belong to, or null when the rule
 * is not a plain theme selector (then it is styling and stays where it is).
 * @param {string} selector @param {string | null} media
 * @returns {ThemeBlock | null}
 */
export function themeBlock(selector, media) {
  const parts = norm(selector).split(/\s*,\s*/);
  /** @type {Set<string>} */
  const kinds = new Set();
  for (const p of parts) {
    const m = /^(:root|html|)((?:\[[^\]]*\])|(?::not\(\s*\[[^\]]*\]\s*\)))?$/.exec(p);
    if (!m || (!m[1] && !m[2])) return null;
    const attr = m[2] ?? "";
    if (!attr) {
      if (!m[1]) return null;
      kinds.add("base");
    } else if (attr.startsWith(":not(")) {
      const t = THEME.exec(attr);
      if (!t || t[1] !== "light") return null;
      kinds.add("notLight");
    } else {
      const t = THEME.exec(attr);
      if (!t) return null;
      kinds.add(t[1] === "light" ? "light" : "dark");
    }
  }
  if (kinds.size !== 1) return null;
  const kind = [...kinds][0];
  const md = media === null ? null : norm(media);
  if (md === null) return kind === "base" || kind === "light" ? "light" : kind === "dark" ? "dark" : null;
  if (/^\(\s*prefers-color-scheme\s*:\s*dark\s*\)$/.test(md)) return kind === "base" || kind === "notLight" ? "mediaDark" : null;
  if (/^\(\s*prefers-color-scheme\s*:\s*light\s*\)$/.test(md)) return kind === "base" ? "light" : null;
  return null;
}

/** @param {string} head @returns {string | null} the condition of an @media head */
function mediaOf(head) {
  const m = /^\s*@media\b([\s\S]*)$/i.exec(head);
  return m ? /** @type {string} */ (m[1]).trim() : null;
}

/**
 * Every theme block of a text with its custom property declaration nodes.
 * @param {string} css
 * @returns {{ node: CssNode, block: ThemeBlock, decls: { node: CssNode, name: string, value: string, line: number }[], parent: CssNode | null }[]}
 */
function themeRules(css) {
  const m = maskCss(css);
  /** @type {ReturnType<typeof themeRules>} */
  const out = [];
  /** @param {CssNode[]} nodes @param {CssNode | null} parent @param {string | null} media */
  const walk = (nodes, parent, media) => {
    for (const nd of nodes) {
      if (!nd.block) continue;
      // The masked head hides the quotes of an attribute selector: read the real one.
      const head = css.slice(nd.start, nd.headEnd).replace(/\/\*[\s\S]*?\*\//g, " ");
      const md = mediaOf(head);
      if (md !== null) {
        walk(nd.children, nd, md);
        continue;
      }
      if (head.trim().startsWith("@")) continue;
      const block = themeBlock(head, media);
      if (!block) continue;
      const decls = nd.children.filter((c) => !c.block).flatMap((c) => {
        const d = /^\s*(--[\w-]+)\s*:/.exec(c.head);
        if (!d) return [];
        const colon = c.start + c.head.indexOf(":") + 1;
        const value = css.slice(colon, c.headEnd).replace(/\/\*[\s\S]*?\*\//g, "").trim();
        return [{ node: c, name: /** @type {string} */ (d[1]), value, line: css.slice(0, c.start).split("\n").length }];
      });
      out.push({ node: nd, block, decls, parent });
    }
  };
  walk(parseCss(m), null, null);
  return out;
}

/**
 * The custom properties a text defines in theme blocks, in source order.
 * @param {string} css
 * @returns {{ name: string, value: string, block: ThemeBlock, line: number }[]}
 */
export function rootDefines(css) {
  return themeRules(css).flatMap((r) => r.decls.map((d) => ({ name: d.name, value: d.value, block: r.block, line: d.line })));
}

/**
 * Whether a text has anything to port besides the custom properties of its theme blocks and its
 * import and charset lines.
 * @param {string} css
 */
export function hasPortableRules(css) {
  const stripped = stripRootDefines(css);
  const m = maskCss(stripped);
  for (const nd of parseCss(m)) {
    if (!nd.block && /^\s*@(import|charset)\b/i.test(nd.head)) continue;
    return true;
  }
  return false;
}

/**
 * Apply non-overlapping edits to a text.
 * @param {string} text @param {{ start: number, end: number, text: string }[]} edits
 */
export function applyEdits(text, edits) {
  let out = "";
  let at = 0;
  for (const e of [...edits].sort((a, b) => a.start - b.start)) {
    if (e.start < at) continue;
    out += text.slice(at, e.start) + e.text;
    at = e.end;
  }
  return out + text.slice(at);
}

/**
 * The text without the custom property declarations of its theme blocks (the tokens step carries
 * them); a block or media block left empty goes too.
 * @param {string} css
 */
export function stripRootDefines(css) {
  const rules = themeRules(css);
  /** @type {{ start: number, end: number, text: string }[]} */
  const edits = [];
  /** @type {Map<CssNode, number>} */
  const emptied = new Map();
  for (const r of rules) {
    const left = r.node.children.filter((c) => !r.decls.some((d) => d.node === c));
    if (left.length === 0) {
      edits.push({ start: r.node.start, end: r.node.end, text: "" });
      if (r.parent) emptied.set(r.parent, (emptied.get(r.parent) ?? 0) + 1);
    } else {
      for (const d of r.decls) edits.push({ start: d.node.start, end: d.node.end, text: "" });
    }
  }
  for (const [parent, n] of emptied) if (n === parent.children.length) edits.push({ start: parent.start, end: parent.end, text: "" });
  const kept = edits.filter((e) => !edits.some((w) => w !== e && w.text === "" && e.start >= w.start && e.end <= w.end && (e.start > w.start || e.end < w.end)));
  return applyEdits(css, kept).replace(/\n{3,}/g, "\n\n");
}

const SKIP_NAMED = /^(?:font|font-family|animation|animation-name|counter-.*|grid.*|will-change|transition|transition-property|list-style|list-style-type|quotes|content)$/i;
const FUNC_NAMES = "rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark|device-cmyk|cmyk";
const TOKEN_RE = new RegExp("#[0-9a-f]{3,8}(?![\\w-])|(?<![\\w-])(?:" + FUNC_NAMES + ")\\(|(?<![\\w#.-])[a-z]+(?![\\w(-])", "gi");
/** @type {Map<string, boolean>} */
const namedCache = new Map();

/** Whether a bare word is a colour name to the kit's own colour check. @param {string} word */
function isNamedColour(word) {
  const w = word.toLowerCase();
  let v = namedCache.get(w);
  if (v === undefined) {
    v = findColourLiterals("a{color:" + w + "}").length > 0;
    namedCache.set(w, v);
  }
  return v;
}

/** @param {string} s @param {number} open index of the paren */
function closeParen(s, open) {
  let d = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") d++;
    else if (s[i] === ")" && --d === 0) return i;
  }
  return s.length - 1;
}

/**
 * The colour literals in the declaration values of a text: where they are and their value. A
 * colour function that holds a var() is replaced whole unless it is a color-mix or light-dark, which
 * the colour contract allows when built from tokens only (a literal inside one is replaced alone).
 * @param {string} css
 * @returns {{ start: number, end: number, value: string, key: string }[]}
 */
export function colourSpans(css) {
  const m = maskCss(css);
  /** @type {{ start: number, end: number, value: string, key: string }[]} */
  const out = [];
  /** @param {CssNode[]} nodes */
  const walk = (nodes) => {
    for (const nd of nodes) {
      if (nd.block) {
        walk(nd.children);
        continue;
      }
      const d = /^\s*([\w-]+)\s*:/.exec(nd.head);
      if (!d || nd.head.trim().startsWith("@")) continue;
      const prop = /** @type {string} */ (d[1]);
      const off = nd.start + d[0].length;
      const val = m.slice(off, nd.headEnd);
      TOKEN_RE.lastIndex = 0;
      for (let t = TOKEN_RE.exec(val); t; t = TOKEN_RE.exec(val)) {
        const text = t[0];
        let end = t.index + text.length;
        if (text[0] === "#") {
          if (![3, 4, 6, 8].includes(text.length - 1)) continue;
        } else if (text.endsWith("(")) {
          const close = closeParen(val, end - 1);
          const inner = val.slice(end, close);
          if (/^(?:color-mix|light-dark)\($/i.test(text) && /var\(/i.test(inner)) continue;
          end = close + 1;
          TOKEN_RE.lastIndex = end;
        } else if (SKIP_NAMED.test(prop) || !isNamedColour(text)) continue;
        const start = off + t.index;
        const value = css.slice(start, off + end).replace(/\s+/g, " ").trim();
        out.push({ start, end: off + end, value, key: value.toLowerCase() });
      }
    }
  };
  walk(parseCss(m));
  return out;
}

/**
 * Replace every colour literal by var(<token>) where the map has one.
 * @param {string} css @param {Record<string, string>} map lower-cased value to custom property name
 */
export function replaceColours(css, map) {
  const edits = colourSpans(css).flatMap((s) => (Object.prototype.hasOwnProperty.call(map, s.key) ? [{ start: s.start, end: s.end, text: "var(" + map[s.key] + ")" }] : []));
  return applyEdits(css, edits);
}

const OUTSIDE = /\/\/|(?:^|[\s(:"'])https?:/i;

/**
 * Remove what points outside the app: external imports and url() declarations (a font-face whose
 * src goes is dropped whole). Returns the text and what was removed. An import of a stylesheet of the
 * source is passed to onImport (which returns "" to drop it, or text to keep).
 * @param {string} css
 * @param {(spec: string) => string} onImport called for every import that is not external
 * @returns {{ css: string, removed: string[] }}
 */
export function dropOutside(css, onImport) {
  const m = maskCss(css);
  /** @type {{ start: number, end: number, text: string }[]} */
  const edits = [];
  /** @type {string[]} */
  const removed = [];
  /** @param {string} s */
  const short = (s) => s.replace(/[\u0000-\u001f\u007f-\u009f\s]+/g, " ").trim().slice(0, 90);
  /** @param {CssNode[]} nodes @param {CssNode | null} parent */
  const walk = (nodes, parent) => {
    for (const nd of nodes) {
      if (nd.block) {
        walk(nd.children, nd);
        continue;
      }
      const orig = css.slice(nd.start, nd.end);
      if (/^\s*@import\b/i.test(nd.head)) {
        const sp = /@import\s+(?:url\(\s*)?(["']?)([^"')\s;]+)\1/i.exec(orig);
        const spec = sp ? /** @type {string} */ (sp[2]) : "";
        if (!spec || OUTSIDE.test(spec)) {
          removed.push(spec ? "@import " + short(spec) : short(orig));
          edits.push({ start: nd.start, end: nd.end, text: "" });
        } else edits.push({ start: nd.start, end: nd.end, text: onImport(spec) });
        continue;
      }
      if (/url\(/i.test(orig) && /\/\/|https?:/i.test(orig.replace(/\/\*[\s\S]*?\*\//g, ""))) {
        const d = /^\s*([\w-]+)\s*:/.exec(nd.head);
        if (!d) continue;
        removed.push(short(orig));
        if (parent && /^\s*@font-face\b/i.test(parent.head) && /^src$/i.test(/** @type {string} */ (d[1]))) edits.push({ start: parent.start, end: parent.end, text: "" });
        else edits.push({ start: nd.start, end: nd.end, text: "" });
      }
    }
  };
  walk(parseCss(m), null);
  // A removed font-face covers the edits of the declarations inside it.
  const kept = edits.filter((e) => !edits.some((w) => w !== e && w.text === "" && e.start >= w.start && e.end <= w.end && (e.start > w.start || e.end < w.end)));
  return { css: applyEdits(css, kept), removed };
}

/**
 * Make a text safe for the middlebox: block comments that hold a double slash go, and a double
 * slash inside a string becomes the CSS escape for the slash (which reads the same).
 * @param {string} css
 */
export function noDoubleSlash(css) {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, (c) => (c.includes("//") ? "" : c));
  let out = "";
  let i = 0;
  while (i < noComments.length) {
    const c = noComments[i];
    if (c === "/" && noComments[i + 1] === "*") {
      const e = noComments.indexOf("*/", i + 2);
      const stop = e < 0 ? noComments.length : e + 2;
      out += noComments.slice(i, stop);
      i = stop;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < noComments.length && noComments[j] !== c && noComments[j] !== "\n") j += noComments[j] === "\\" ? 2 : 1;
      const body = noComments.slice(i + 1, j);
      out += c + body.replace(/\/{2,}/g, (s) => "\\2f ".repeat(s.length)) + (noComments[j] === c ? c : "");
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** A text without the indent every non-blank line shares, and without blank lines at the ends. @param {string} s */
function dedent(s) {
  const lines = s.replace(/\t/g, "  ").split("\n");
  const pad = Math.min(...lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)?.[0].length ?? 0));
  return lines.map((l) => l.slice(Number.isFinite(pad) ? pad : 0)).join("\n").replace(/^\s*\n/, "").replace(/\s+$/, "") + "\n";
}

/** A key inside a build output folder (dist/ or build/) at the top of a source root. */
const BUILT = /^(?:@[^/]+\/)?(?:dist|build)\//;

/**
 * The source stylesheets a migration ports: every css file, and the <style> text of every html file
 * (joined), in the order the steps read them. An html file whose style holds a scriptlet is left
 * out and named in skippedInline. An html file in a build output folder (dist/, build/) is left out
 * and named in skippedBuilt when the tree has css files outside one: its style is the built copy of
 * those files (a committed styles.html partial), and porting both would carry every rule twice.
 * @param {{ inv: import("../schema.mjs").Inventory, tree: import("../sourceTree.mjs").SourceTree }} ctx
 * @returns {{ key: string, css: string, inline: boolean }[] & { skippedInline?: string[], skippedBuilt?: string[] }}
 */
export function cssSources({ inv, tree }) {
  const skipped = new Set(inv.skipped.map((s) => s.key));
  /** @type {{ key: string, css: string, inline: boolean }[] & { skippedInline?: string[], skippedBuilt?: string[] }} */
  const out = [];
  /** @type {string[]} */
  const skippedInline = [];
  /** @type {string[]} */
  const skippedBuilt = [];
  const hasSourceCss = inv.files.some((f) => f.kind === "css" && !skipped.has(f.key) && !BUILT.test(f.key));
  for (const key of sortedKeys(inv.files.map((f) => f.key))) {
    if (skipped.has(key)) continue;
    const kind = inv.files.find((f) => f.key === key)?.kind;
    if (kind === "css") out.push({ key, css: tree.read(key), inline: false });
    else if (kind === "html" && inv.css?.[key]) {
      const styles = scanHtml(tree.read(key)).styles.map((s) => s.inline);
      const css = dedent(styles.join("\n"));
      if (!css.trim()) continue;
      if (hasSourceCss && BUILT.test(key)) skippedBuilt.push(key);
      else if (/<\?/.test(css)) skippedInline.push(key);
      else out.push({ key, css, inline: true });
    }
  }
  out.skippedInline = skippedInline;
  out.skippedBuilt = skippedBuilt;
  return out;
}

/** The key a stylesheet import names: a bare "b.css" is relative, as in CSS. @param {import("../sourceTree.mjs").SourceTree} tree @param {string} from @param {string} spec */
export function resolveCss(tree, from, spec) {
  return tree.resolve(from, /^(?:\.{0,2}\/|[a-z][a-z0-9+.-]*:)/i.test(spec) ? spec : "./" + spec);
}

/**
 * The css files in the order a browser would meet them: each file after the stylesheets it
 * imports, files nobody imports in key order.
 * @param {{ tree: import("../sourceTree.mjs").SourceTree }} ctx
 * @param {{ key: string, css: string, inline: boolean }[]} sources
 * @returns {string[]} keys of the css files (not the inline ones)
 */
export function cssOrder({ tree }, sources) {
  const files = sources.filter((s) => !s.inline);
  const byKey = new Map(files.map((f) => [f.key, f]));
  /** @type {Map<string, string[]>} */
  const deps = new Map();
  const imported = new Set();
  for (const f of files) {
    /** @type {string[]} */
    const list = [];
    for (const nd of parseCss(maskCss(f.css))) {
      if (nd.block || !/^\s*@import\b/i.test(nd.head)) continue;
      const sp = /@import\s+(?:url\(\s*)?(["']?)([^"')\s;]+)\1/i.exec(f.css.slice(nd.start, nd.end));
      const spec = sp ? /** @type {string} */ (sp[2]) : "";
      if (!spec || OUTSIDE.test(spec)) continue;
      const key = resolveCss(tree, f.key, spec);
      if (key && byKey.has(key) && key !== f.key) {
        list.push(key);
        imported.add(key);
      }
    }
    deps.set(f.key, list);
  }
  /** @type {string[]} */
  const order = [];
  /** @type {Set<string>} */
  const seen = new Set();
  /** @param {string} k */
  const visit = (k) => {
    if (seen.has(k)) return;
    seen.add(k);
    for (const d of deps.get(k) ?? []) visit(d);
    order.push(k);
  };
  for (const f of files) if (!imported.has(f.key)) visit(f.key);
  for (const f of files) visit(f.key);
  return order;
}

/**
 * The custom property to name every distinct colour literal of the stylesheets that are ported:
 * --legacy-c1, c2, ... in first-appearance order (by key, then by place in the text).
 * @param {{ key: string, css: string, inline: boolean }[]} sources
 * @returns {{ map: Record<string, string>, values: Record<string, string> }} map: lower-cased value to name; values: name to the value as first written
 */
export function colourTokens(sources) {
  /** @type {Record<string, string>} */
  const map = {};
  /** @type {Record<string, string>} */
  const values = {};
  let n = 0;
  for (const s of sources) {
    if (!hasPortableRules(s.css)) continue;
    for (const c of colourSpans(stripRootDefines(s.css))) {
      if (!Object.prototype.hasOwnProperty.call(map, c.key)) {
        const name = "--legacy-c" + ++n;
        map[c.key] = name;
        values[name] = c.value;
      }
    }
  }
  return { map, values };
}

/**
 * The attribute the routes step sets on <html> while a migrated route is shown (and removes on a kit
 * page). Every ported rule applies only under it, so the old element rules never restyle the kit's own
 * pages. The name is a contract between css-import and routes.
 */
export const LEGACY_ATTR = "data-legacy";
const UNDER = ":where(html[" + LEGACY_ATTR + "])";
/** A selector whose first compound is the root element. */
const ROOT_HEAD = /^(?:html|:root)(?![\w-])/i;
/** At-rules whose block holds style rules that are scoped one by one. */
const GROUP_AT = /^(?:media|supports|container|layer|document|-moz-document|starting-style)$/i;
/**
 * At-rules whose block holds no selector to scope (descriptors, keyframe stops, page margins). They are
 * kept as written, and they are global by nature: a name the kit also defines (a font family, a
 * keyframes name, a registered custom property) changes the kit's pages too.
 */
const KEEP_AT = /^(?:font-face|(?:-webkit-|-moz-|-o-)?keyframes|counter-style|property|font-feature-values|font-palette-values|page|view-transition|(?:-ms-|-webkit-|-o-)?viewport)$/i;
/** At-rule statements a ported stylesheet may hold: import (dropOutside drops or keeps it first), charset, layer. */
const STATEMENT_AT = /^(?:import|charset|layer)$/i;
/** The start of a selector scopeLegacy wrote: under the attribute, or the root element carrying it. */
const SCOPED = new RegExp("^(?::where\\(html\\[" + LEGACY_ATTR + "\\]\\)(?:\\s|$)|(?:html|:root):where\\(\\[" + LEGACY_ATTR + "\\]\\))", "i");

/**
 * The selectors of a masked rule head, split at the commas outside parentheses and brackets.
 * @param {string} head masked head text
 * @returns {[number, number][]} start and end of each selector, relative to the head
 */
export function splitSelectors(head) {
  /** @type {[number, number][]} */
  const out = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < head.length; i++) {
    const c = head[i];
    if (c === "(" || c === "[") depth++;
    else if ((c === ")" || c === "]") && depth > 0) depth--;
    else if (c === "," && depth === 0) {
      out.push([from, i]);
      from = i + 1;
    }
  }
  out.push([from, head.length]);
  return out;
}

/**
 * Whether a nested selector stays inside the rule it is nested in: one with no & is relative to it
 * (CSS Nesting puts "& " in front), and one with an & outside every parenthesis matches the parent's
 * element or something next to or inside it. An & only inside a pseudo-class (:not(&), :is(&, p))
 * can match elements the parent never matches, so the parent's scope does not hold for it.
 * @param {string} part masked selector text
 */
function nestedStaysInside(part) {
  if (!part.includes("&")) return true;
  let depth = 0;
  for (const c of part) {
    if (c === "(" || c === "[") depth++;
    else if ((c === ")" || c === "]") && depth > 0) depth--;
    else if (c === "&" && depth === 0) return true;
  }
  return false;
}

/**
 * Walk the rules of a stylesheet as scopeLegacy reads them, calling onRule for every style rule that
 * is not nested in another (at the top or inside the group at-rules). Returns what it cannot vouch
 * for: an at-rule statement other than import, charset or layer, a declaration outside a rule, a block
 * at-rule outside the group and descriptor sets (@scope among them), and a nested selector that can
 * leave its parent (nestedStaysInside). The text must be free of cssProblems.
 * @param {string} css @param {string} m its masked text
 * @param {(nd: CssNode, head: string) => void} onRule head: the masked head
 * @returns {string[]}
 */
function walkStyleRules(css, m, onRule) {
  /** @type {string[]} */
  const problems = [];
  /** @param {CssNode} nd */
  const where = (nd) => "line " + css.slice(0, nd.start).split("\n").length;
  /** @param {CssNode} nd */
  const shown = (nd) => JSON.stringify(selText(css.slice(nd.start, nd.headEnd)).slice(0, 60));
  /** The at-keyword as written (an escaped one reads as no known name). @param {CssNode} nd */
  const atName = (nd) => JSON.stringify(selText(css.slice(nd.start, nd.headEnd)).split(" ")[0]?.slice(0, 40) ?? "@");
  /** @param {CssNode[]} nodes */
  const group = (nodes) => {
    for (const nd of nodes) {
      const head = m.slice(nd.start, nd.headEnd);
      const at = /^\s*@([\w-]*)/.exec(head);
      const name = at ? /** @type {string} */ (at[1]) : "";
      if (!nd.block) {
        if (!at) problems.push(where(nd) + ": a declaration outside any rule: " + shown(nd));
        else if (!STATEMENT_AT.test(name)) problems.push(where(nd) + ": an " + atName(nd) + " statement");
        continue;
      }
      if (at) {
        if (GROUP_AT.test(name)) group(nd.children);
        else if (!KEEP_AT.test(name)) problems.push(where(nd) + ": an " + atName(nd) + " block, which cannot be scoped to " + LEGACY_ATTR);
        continue;
      }
      onRule(nd, head);
      nested(nd);
    }
  };
  /** @param {CssNode} rule a style rule, or a group at-rule nested in one */
  const nested = (rule) => {
    for (const c of rule.children) {
      if (!c.block) continue;
      const head = m.slice(c.start, c.headEnd);
      const at = /^\s*@([\w-]*)/.exec(head);
      if (at) {
        if (GROUP_AT.test(/** @type {string} */ (at[1]))) nested(c);
        else problems.push(where(c) + ": an " + atName(c) + " block nested in a rule");
        continue;
      }
      for (const [s, e] of splitSelectors(head)) {
        if (!nestedStaysInside(head.slice(s, e))) problems.push(where(c) + ": the nested selector " + JSON.stringify(selText(css.slice(c.start + s, c.start + e)).slice(0, 60)) + " uses & only inside a pseudo-class, so it can match outside its parent");
      }
      nested(c);
    }
  };
  group(parseCss(m));
  return problems;
}

/**
 * Every style rule of a text that does not start at the legacy attribute, and everything
 * walkStyleRules and cssProblems cannot vouch for: empty when every rule applies only under
 * html[data-legacy]. scopeLegacy runs it on its own output, so a mistake of the scoper fails closed.
 * @param {string} css
 * @returns {string[]}
 */
export function unscopedRules(css) {
  const broken = cssProblems(css);
  if (broken.length) return broken;
  const m = maskCss(css);
  /** @type {string[]} */
  const out = [];
  const problems = walkStyleRules(css, m, (nd, head) => {
    for (const [s, e] of splitSelectors(head)) {
      const part = head.slice(s, e).trim();
      if (part && !SCOPED.test(part)) out.push("line " + css.slice(0, nd.start).split("\n").length + ": the selector " + JSON.stringify(selText(css.slice(nd.start + s, nd.start + e)).slice(0, 60)) + " does not start at " + LEGACY_ATTR);
    }
  });
  return [...problems, ...out];
}

/**
 * Scope every style rule of a ported stylesheet to the legacy attribute, adding no specificity: a
 * selector that starts at the root element (html, :root) gets :where([data-legacy]) on that compound,
 * every other one the prefix :where(html[data-legacy]). Rules inside @media, @supports, @container,
 * @layer and @starting-style are scoped the same; @font-face, @keyframes and the other descriptor
 * blocks are kept as written; a nested rule follows its parent.
 * Fails closed: a text with cssProblems, a block at-rule of another kind (@scope among them), a
 * statement or declaration out of place, or a nested selector that can leave its parent is refused,
 * and so is an output that unscopedRules does not pass. Then css is "" and refused says why.
 * @param {string} css
 * @returns {{ css: string, refused: string[], kept: string[] }} kept: the descriptor at-rules kept as written
 */
export function scopeLegacy(css) {
  const broken = cssProblems(css);
  if (broken.length) return { css: "", refused: broken, kept: [] };
  const m = maskCss(css);
  /** @type {{ start: number, end: number, text: string }[]} */
  const edits = [];
  const problems = walkStyleRules(css, m, (nd, head) => {
    for (const [s, e] of splitSelectors(head)) {
      const part = head.slice(s, e);
      const body = part.trimStart();
      if (!body.trim()) continue;
      const pos = nd.start + s + (part.length - body.length);
      const r = ROOT_HEAD.exec(body);
      if (r) edits.push({ start: pos + r[0].length, end: pos + r[0].length, text: ":where([" + LEGACY_ATTR + "])" });
      else edits.push({ start: pos, end: pos, text: UNDER + " " });
    }
  });
  if (problems.length) return { css: "", refused: problems, kept: [] };
  const out = applyEdits(css, edits);
  const left = unscopedRules(out);
  if (left.length) return { css: "", refused: left.map((l) => "after scoping, " + l), kept: [] };
  /** @type {Set<string>} */
  const kept = new Set();
  /** @param {CssNode[]} nodes */
  const keptIn = (nodes) => {
    for (const nd of nodes) {
      const at = nd.block ? /^\s*@([\w-]+)/.exec(m.slice(nd.start, nd.headEnd)) : null;
      if (!at) continue;
      if (GROUP_AT.test(/** @type {string} */ (at[1]))) keptIn(nd.children);
      else kept.add("@" + /** @type {string} */ (at[1]).toLowerCase());
    }
  };
  keptIn(parseCss(m));
  return { css: out, refused: [], kept: [...kept].sort() };
}

/** The selector text of a rule head: comments gone, whitespace collapsed. @param {string} s */
const selText = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ").trim();

/**
 * What the kit's own markup carries, as the argument of a :not(): every element with a gk- class or
 * inside one, and every class or id the kit's component stylesheets style on its own (a compound with
 * no gk- class), with what is inside it. The UA revert leaves those alone, so a kit component on a
 * migrated page keeps the base it was drawn on.
 * @param {string[]} texts the component and block stylesheets the app imports
 */
export function kitExclusion(texts) {
  /** @type {Set<string>} */
  const roots = new Set();
  for (const css of texts) {
    const m = maskCss(css);
    /** @param {CssNode[]} nodes */
    const walk = (nodes) => {
      for (const nd of nodes) {
        if (!nd.block) continue;
        const head = m.slice(nd.start, nd.headEnd);
        if (/^\s*@/.test(head)) {
          walk(nd.children);
          continue;
        }
        for (const [s, e] of splitSelectors(head)) {
          for (const compound of head.slice(s, e).split(/\s*[\s>+~]\s*/)) {
            const names = [...compound.matchAll(/([.#])(-?[A-Za-z_][\w-]*)/g)];
            if (names.some((n) => n[1] === "." && /** @type {string} */ (n[2]).startsWith("gk-"))) continue;
            for (const n of names) roots.add(/** @type {string} */ (n[1]) + n[2]);
          }
        }
        walk(nd.children);
      }
    };
    walk(parseCss(m));
  }
  const list = ['[class^="gk-"]', '[class*=" gk-"]', ...[...roots].sort()];
  return list.flatMap((r) => [r, r + " *"]).join(", ");
}

/** A selector's trailing pseudo-element, which may not sit inside :where(). */
const PSEUDO_END = /(?:::[\w-]+(?:\([^)]*\))?|:(?:before|after|first-line|first-letter))$/i;

/**
 * The UA revert layer of a preserve migration: for every rule of the kit's base stylesheets that
 * styles elements (no class, no id, no focus state), the same properties set to revert, under the
 * legacy attribute and at zero specificity, and never on the kit's own markup (exclusion). revert in
 * an author layer goes back to the browser's own style, which is what the source's CSS was written
 * against. Custom properties are left alone (the tokens step owns them). Read from the kit's text, so
 * it follows the kit: a new element rule in base.css is reverted on the next run.
 * @param {{ label: string, css: string }[]} kit the kit's base stylesheets (tokens.base.css, base.css)
 * @param {string} exclusion the :not() argument from kitExclusion
 * @returns {{ css: string, skipped: string[] }} skipped: what was not understood, for the notes
 */
export function uaRevert(kit, exclusion) {
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const skipped = [];
  for (const f of kit) {
    const m = maskCss(f.css);
    /** @param {CssNode[]} nodes @param {string[]} wrap the heads of the enclosing conditional rules */
    const walk = (nodes, wrap) => {
      for (const nd of nodes) {
        if (!nd.block) continue;
        const head = m.slice(nd.start, nd.headEnd);
        const at = /^\s*@([\w-]+)/.exec(head);
        if (at) {
          if (/^(?:media|supports)$/i.test(/** @type {string} */ (at[1]))) walk(nd.children, [...wrap, selText(f.css.slice(nd.start, nd.headEnd))]);
          continue;
        }
        const decls = nd.children.flatMap((c) => {
          if (c.block) {
            skipped.push(f.label + ": a nested rule in " + selText(f.css.slice(nd.start, nd.headEnd)).slice(0, 60));
            return [];
          }
          const d = /^\s*([\w-]+)\s*:/.exec(c.head);
          if (!d || /** @type {string} */ (d[1]).startsWith("--")) return [];
          return [/** @type {string} */ (d[1]).toLowerCase() + ": revert" + (/!\s*important\s*$/i.test(c.head) ? " !important" : "") + ";"];
        });
        if (!decls.length) continue;
        /** @type {string[]} */
        const rootSels = [];
        /** @type {Map<string, string[]>} pseudo-element to the selectors that carry it */
        const groups = new Map();
        for (const [s, e] of splitSelectors(head)) {
          const masked = head.slice(s, e).trim();
          const sel = selText(f.css.slice(nd.start + s, nd.start + e));
          if (!sel || /[.#&]/.test(masked) || /:focus/i.test(masked)) continue;
          const r = ROOT_HEAD.exec(sel);
          if (r) {
            rootSels.push(":where(" + r[0] + "[" + LEGACY_ATTR + "]" + sel.slice(r[0].length) + ")");
            continue;
          }
          const pe = PSEUDO_END.exec(sel);
          const base = (pe ? sel.slice(0, pe.index) : sel).trim() || "*";
          const key = pe ? pe[0] : "";
          groups.set(key, [...(groups.get(key) ?? []), base]);
        }
        const sels = [...rootSels, ...[...groups].map(([pe, bases]) => ":where(html[" + LEGACY_ATTR + "] :is(" + bases.join(", ") + "):not(" + exclusion + "))" + pe)];
        if (!sels.length) continue;
        const pad = "  ".repeat(wrap.length);
        let rule = pad + sels.join(",\n" + pad) + " {\n" + decls.map((d) => pad + "  " + d + "\n").join("") + pad + "}\n";
        for (let i = wrap.length - 1; i >= 0; i--) rule = "  ".repeat(i) + wrap[i] + " {\n" + rule + "  ".repeat(i) + "}\n";
        out.push(rule);
      }
    };
    walk(parseCss(m), []);
  }
  return { css: out.join(""), skipped };
}
