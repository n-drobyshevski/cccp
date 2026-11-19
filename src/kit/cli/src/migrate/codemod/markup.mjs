// Markup helpers for the classic codemods: Apps Script scriptlets masked (so a ">" inside one does
// not end a tag), the tags of a page with the offsets of every attribute, the script and style
// elements, the pages doGet can serve (html files no other file includes) and the include graph
// flattened into one page per entry, a cycle refused. Offsets are character offsets into the
// original text, so edits can be applied back to it.
import { kebab } from "../maps.mjs";

/** @typedef {{ start: number, end: number, kind: "print" | "raw" | "code", code: string }} Scriptlet */
/** @typedef {{ name: string, start: number, end: number, valueStart: number, valueEnd: number, quoted: boolean, value: string }} TagAttr */
/** @typedef {{ start: number, end: number, name: string, closing: boolean, attrs: TagAttr[] }} Tag */
/** @typedef {{ tag: Tag, contentStart: number, contentEnd: number, closeEnd: number }} RawElement */

/** Elements whose content is text up to their own end tag. */
const RAW_TEXT = new Set(["script", "style", "textarea", "title"]);
export const VOID = new Set("area base br col embed hr img input link meta source track wbr".split(" "));

/** The exact form of an include scriptlet: <?!= include('name') ?>. */
export const INCLUDE = /^<\?!=\s*include\s*\(\s*(["'])([^"'\\\n]+)\1\s*\)\s*;?\s*\?>$/;

/**
 * @param {string} src
 * @returns {{ masked: string, scriptlets: Scriptlet[] }}
 */
export function maskScriptlets(src) {
  /** @type {Scriptlet[]} */
  const scriptlets = [];
  let masked = "";
  let at = 0;
  for (;;) {
    const open = src.indexOf("<?", at);
    if (open < 0) break;
    const close = src.indexOf("?>", open + 2);
    const end = close < 0 ? src.length : close + 2;
    let body = src.slice(open + 2, close < 0 ? src.length : close);
    /** @type {Scriptlet["kind"]} */
    let kind = "code";
    if (body.startsWith("!=")) {
      kind = "raw";
      body = body.slice(2);
    } else if (body.startsWith("=")) {
      kind = "print";
      body = body.slice(1);
    }
    scriptlets.push({ start: open, end, kind, code: body.trim() });
    masked += src.slice(at, open) + src.slice(open, end).replace(/[^\n]/g, " ");
    at = end;
  }
  return { masked: masked + src.slice(at), scriptlets };
}

/**
 * The tags of a page and its raw-text elements (script, style, textarea, title).
 * @param {string} src
 * @returns {{ masked: string, scriptlets: Scriptlet[], tags: Tag[], raws: RawElement[] }}
 */
export function scanTags(src) {
  const { masked, scriptlets } = maskScriptlets(src);
  /** @type {Tag[]} */
  const tags = [];
  /** @type {RawElement[]} */
  const raws = [];
  const n = masked.length;
  let i = 0;
  while (i < n) {
    const lt = masked.indexOf("<", i);
    if (lt < 0) break;
    if (masked.startsWith("<!--", lt)) {
      const e = masked.indexOf("-->", lt + 4);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (masked[lt + 1] === "!" || masked[lt + 1] === "?") {
      const e = masked.indexOf(">", lt + 2);
      i = e < 0 ? n : e + 1;
      continue;
    }
    const m = /^<(\/?)([A-Za-z][A-Za-z0-9:-]*)/.exec(masked.slice(lt, lt + 64));
    if (!m) {
      i = lt + 1;
      continue;
    }
    const closing = m[1] === "/";
    const name = /** @type {string} */ (m[2]).toLowerCase();
    let j = lt + m[0].length;
    /** @type {TagAttr[]} */
    const attrs = [];
    while (j < n) {
      while (j < n && /\s/.test(/** @type {string} */ (masked[j]))) j++;
      if (j >= n) break;
      if (masked[j] === ">") {
        j++;
        break;
      }
      if (masked[j] === "/" && masked[j + 1] === ">") {
        j += 2;
        break;
      }
      const am = /^[^\s"'>/=]+/.exec(masked.slice(j, j + 256));
      if (!am) {
        j++;
        continue;
      }
      const start = j;
      j += am[0].length;
      let k = j;
      while (k < n && /\s/.test(/** @type {string} */ (masked[k]))) k++;
      let valueStart = j;
      let valueEnd = j;
      let quoted = false;
      if (masked[k] === "=") {
        k++;
        while (k < n && /\s/.test(/** @type {string} */ (masked[k]))) k++;
        const q = masked[k];
        if (q === '"' || q === "'") {
          const e = masked.indexOf(q, k + 1);
          valueStart = k + 1;
          valueEnd = e < 0 ? n : e;
          quoted = true;
          j = e < 0 ? n : e + 1;
        } else {
          let e = k;
          while (e < n && !/[\s>]/.test(/** @type {string} */ (masked[e]))) e++;
          valueStart = k;
          valueEnd = e;
          j = e;
        }
      }
      attrs.push({ name: am[0].toLowerCase(), start, end: j, valueStart, valueEnd, quoted, value: src.slice(valueStart, valueEnd) });
    }
    /** @type {Tag} */
    const tag = { start: lt, end: j, name, closing, attrs };
    tags.push(tag);
    i = j;
    if (!closing && RAW_TEXT.has(name)) {
      const re = new RegExp("</" + name + "\\s*>", "ig");
      re.lastIndex = i;
      const em = re.exec(masked);
      raws.push({ tag, contentStart: i, contentEnd: em ? em.index : n, closeEnd: em ? em.index + em[0].length : n });
      i = em ? em.index + em[0].length : n;
    }
  }
  return { masked, scriptlets, tags, raws };
}

/** The raw-text element holding an offset, or null. @param {RawElement[]} raws @param {number} pos */
export function rawAt(raws, pos) {
  return raws.find((r) => pos >= r.contentStart && pos < r.contentEnd) ?? null;
}

/** The tag whose text holds an offset, or null. @param {Tag[]} tags @param {number} pos */
export function tagAt(tags, pos) {
  return tags.find((t) => pos > t.start && pos < t.end) ?? null;
}

/** An HTML comment that can hold any text. @param {string} s */
export function htmlComment(s) {
  return "<!-- " + s.replace(/--+/g, "-").replace(/<\?|\?>/g, "").replace(/\/\//g, "/ /").replace(/[\r\n]+/g, " ") + " -->";
}

/** A page key's name without folders and the .html extension. @param {string} key */
export const stem = (key) => (key.split("/").pop() ?? "").replace(/\.html$/i, "");

/**
 * The source key an include("name") from fromKey names, or null: a file next to the includer,
 * then one at the root, with or without the .html extension.
 * @param {import("../sourceTree.mjs").SourceTree} tree @param {string} fromKey @param {string} name
 */
export function includeKey(tree, fromKey, name) {
  if (name.includes("..") || name.startsWith("/")) return null;
  const dir = fromKey.includes("/") ? fromKey.slice(0, fromKey.lastIndexOf("/") + 1) : "";
  for (const c of [dir + name + ".html", dir + name, name + ".html", name]) if (!c.startsWith("@") && tree.files.has(c) && /\.html$/i.test(c)) return c;
  return null;
}

/**
 * The pages doGet can serve: html files of the source root that no other html file includes, index
 * first, then by key. The page name is the kebab-case stem.
 * @param {import("../sourceTree.mjs").SourceTree} tree
 * @returns {{ page: string, key: string }[]}
 */
export function pagesOf(tree) {
  const html = [...tree.files.keys()].filter((k) => !k.startsWith("@") && /\.html$/i.test(k)).sort();
  /** @type {Set<string>} */
  const included = new Set();
  for (const k of html) {
    for (const s of maskScriptlets(tree.read(k)).scriptlets) {
      const m = INCLUDE.exec(tree.read(k).slice(s.start, s.end));
      const to = m ? includeKey(tree, k, /** @type {string} */ (m[2])) : null;
      if (to && to !== k) included.add(to);
    }
  }
  const keys = html.filter((k) => !included.has(k));
  keys.sort((a, b) => Number(!/^index$/i.test(stem(a))) - Number(!/^index$/i.test(stem(b))) || (a < b ? -1 : 1));
  /** @type {{ page: string, key: string }[]} */
  const out = [];
  for (const key of keys) {
    const page = kebab(stem(key));
    if (page && !out.some((o) => o.page === page)) out.push({ page, key });
  }
  return out;
}

/**
 * A page with every include scriptlet replaced by the file it names, recursively, between begin and
 * end markers (HTML comments in markup, CSS/JS comments inside a script or style). Throws on a cycle.
 * An include that names no source file stays, after a marker.
 * @param {import("../sourceTree.mjs").SourceTree} tree @param {string} key
 * @returns {{ text: string, order: string[], missing: string[] }}
 */
export function flatten(tree, key) {
  /** @type {string[]} */
  const order = [];
  /** @type {string[]} */
  const missing = [];
  /** @param {string} k @param {string[]} chain @returns {string} */
  const go = (k, chain) => {
    const src = tree.read(k);
    const { scriptlets, raws } = scanTags(src);
    let out = "";
    let at = 0;
    for (const s of scriptlets) {
      const m = INCLUDE.exec(src.slice(s.start, s.end));
      if (!m) continue;
      const name = /** @type {string} */ (m[2]);
      const inRaw = rawAt(raws, s.start) !== null;
      /** @param {string} t */
      const mark = (t) => (inRaw ? "/* migrate: " + t.replace(/\*\//g, "* /") + " */" : htmlComment("migrate: " + t));
      const to = includeKey(tree, k, name);
      out += src.slice(at, s.start);
      if (!to) {
        missing.push(name);
        out += mark("include(" + JSON.stringify(name) + ") names no file of the source") + src.slice(s.start, s.end);
      } else {
        if (chain.includes(to)) throw new Error("the include graph has a cycle: " + [...chain, to].join(" -> "));
        if (!order.includes(to)) order.push(to);
        out += mark("begin include " + to) + go(to, [...chain, to]) + mark("end include " + to);
      }
      at = s.end;
    }
    return out + src.slice(at);
  };
  return { text: go(key, [key]), order, missing };
}

/**
 * The offset of an element's end tag (the matching one, nesting of the same name counted), or null
 * for a void element and one whose end tag is missing.
 * @param {{ tags: Tag[] }} scan @param {number} index of the start tag in scan.tags
 * @returns {number | null}
 */
export function closeTagAt(scan, index) {
  const open = /** @type {Tag} */ (scan.tags[index]);
  if (VOID.has(open.name)) return null;
  let depth = 0;
  for (let i = index + 1; i < scan.tags.length; i++) {
    const t = /** @type {Tag} */ (scan.tags[i]);
    if (t.name !== open.name) continue;
    if (!t.closing) depth++;
    else if (depth === 0) return t.start;
    else depth--;
  }
  return null;
}

/**
 * The text an element shows: whether anything but whitespace, tags and comments sits between its
 * start tag and its end tag (a print scriptlet counts as text).
 * @param {string} src @param {{ masked: string, scriptlets: Scriptlet[], tags: Tag[] }} scan @param {number} index of the start tag in scan.tags
 */
export function showsText(src, scan, index) {
  const open = /** @type {Tag} */ (scan.tags[index]);
  if (VOID.has(open.name)) return false;
  const end = closeTagAt(scan, index) ?? src.length;
  if (scan.scriptlets.some((s) => s.kind !== "code" && s.start >= open.end && s.start < end)) return true;
  let inner = scan.masked.slice(open.end, end).replace(/<!--[\s\S]*?-->/g, "");
  inner = inner.replace(/<[^>]*>/g, "");
  return inner.trim().length > 0;
}
