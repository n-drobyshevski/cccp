// Hash links that stay in the frame. Apps Script serves a web app inside a sandboxed iframe, and
// the page (the kit's index.html, and most source pages) sets <base target="_top">. A hash link
// (href="#/item/a1") with no target of its own inherits _top: a click loads the frame's document
// URL into the top window, a blank page with no hashchange, so the route never changes. The kit's
// linkAttrs gives a hash href target "_self". Everything migrate writes or keeps follows the same
// rule: a hash link gains target="_self", a _top or _parent target on one (or an empty one, which
// falls back to the base) becomes _self, a link that already says _self is left as it is, another
// target (a new window, a named frame) is kept and named, and a link that is not a hash (absolute,
// mailto, relative) is never touched by that rule. The scanners use the same reading to report, by
// file and line, the source's hash links that would leave the frame.
//
// A relative link that is not a hash breaks in the frame as well: "?page=item" resolves against the
// frame's own document address (not the app's), and <base target="_top"> loads that into the top
// window, a blank page or an error. pageRewrite is the one rule for it: a bare query naming a page
// the app has (?page=item&id=1) becomes that page's hash route with the other parameters as the
// hash's query, as written (#/item?id=1, which the router hands the page as ctx.query), and then
// takes target _self like any hash link; a page the app does not have, a computed page, a fragment
// or a path in front of the query is never guessed: the link is left as written with a
// PAGE_MARK marker. Any other relative link (a bare "?", "?id=1", "other.html", "/x", "") is only
// reported. A full reload of the app goes through the server's service URL (absolute, target _top).

/** @typedef {{ start: number, end: number, text: string }} Edit */
/** @typedef {Map<string, string>} AppPages a page name (pageName) to the kit path of its hash route ("/item", "/" for home) */
/**
 * @typedef {object} PageFix what pageRewrite makes of a relative link
 * @property {string | null} page the page parameter as it reads (decoded; a hole as ${...}), null
 *   when there is none
 * @property {string} [path] the kit path of the page's route (route)
 * @property {"route" | "left" | "report"} fix route: rewritten to a hash route; left: a page link
 *   that is not rewritten (marked); report: another relative link, only reported
 * @property {string} [href] the hash route (route), holes as in the value
 * @property {{ len: number, text: string }} [prefix] the edit that writes it: the first len
 *   characters of the value (up to its first hole) become text
 * @property {string} why what it does in the frame, or why it is left
 */
/**
 * @typedef {object} RelativeLink a relative, non-hash link in markup
 * @property {string} tag
 * @property {string} href as written (a masked hole shown as ${...})
 * @property {string | null} page
 * @property {PageFix["fix"]} fix
 * @property {string | undefined} to the hash route it becomes (route)
 * @property {string} why
 * @property {number} start the offset of its tag
 */
/** @typedef {"ok" | "add" | "replace" | "keep"} TargetFix */
/**
 * @typedef {object} FrameLink a hash link in markup that would leave the frame
 * @property {string} tag
 * @property {string} href the URL as written (a masked hole shown as ${...})
 * @property {string | null} target as written, null when there is none
 * @property {TargetFix} fix what apply does: add, replace, or keep (another target)
 * @property {number} start the offset of its tag
 */

/** The attribute that holds the URL each element navigates to. @param {string} tag */
export function linkAttrOf(tag) {
  const t = tag.toLowerCase();
  return t === "a" || t === "area" ? "href" : t === "form" ? "action" : null;
}

/** The attribute every hash link migrate writes carries. */
export const SELF_ATTR = 'target="_self"';

/** A hole of masked markup (a template's interpolation, a scriptlet), one character per hole. */
export const HOLE = "\u0000";

/**
 * True when a URL is a fragment (#...), read as linkAttrs reads it: spaces and control
 * characters are dropped first, as the browser drops them.
 * @param {unknown} v
 */
export function isHashUrl(v) {
  return typeof v === "string" && v.replace(/[\u0000- \u007f-\u009f]/g, "").charAt(0) === "#";
}

/**
 * What a hash link's target needs. A missing target is added; _top, _parent and an empty value
 * (which falls back to the base target) become _self; _self stays; any other target is kept.
 * @param {string | null} target as written, null when there is none
 * @returns {TargetFix}
 */
export function targetFix(target) {
  if (target === null) return "add";
  if (target.includes(HOLE)) return "keep";
  const t = target.trim().toLowerCase();
  if (t === "_self") return "ok";
  if (t === "" || t === "_top" || t === "_parent") return "replace";
  return "keep";
}

/** Why a hash link with this target leaves the frame, for a finding. @param {string | null} target */
export function leaveReason(target) {
  if (target === null) return "has no target, so it inherits <base target=\"_top\">";
  if (!target.trim()) return "has an empty target, so it inherits <base target=\"_top\">";
  return "has target " + JSON.stringify(target.trim()) + ", not _self";
}

/** The marker a page link apply does not rewrite carries (an HTML comment just before its tag). */
export const PAGE_MARK = "migrate: page link not rewritten";

/** A page name as the kit route takes it (as maps.kebab): lowercase, runs of other characters as "-". @param {string} s */
export const pageName = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || null;

/**
 * True when a URL is relative to the document and not a fragment: no scheme, not protocol-relative,
 * not a hash, not computed (a value that starts with a hole). An empty value is relative (it names
 * the document itself). Read as linkAttrs reads a URL: spaces and control characters are dropped.
 * @param {unknown} v
 */
export function isRelativeUrl(v) {
  if (typeof v !== "string") return false;
  const t = v.replace(/[\u0001- \u007f-\u009f]/g, "");
  if (t.startsWith(HOLE) || t.charAt(0) === "#" || /^[/\\]{2}/.test(t)) return false;
  return !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(t);
}

/**
 * The pages a migrated app has, each with the kit path of its hash route: the classic pages (the
 * first is home, "/"), the plan's maps.pages (el-builder: name to { path }), and the inventory's
 * hash routes of one segment ("#/list" is page list at "/list"). A path with a :param is left out
 * (a query cannot fill it).
 * @param {{ classic?: { page: string }[], pages?: Record<string, unknown>, routes?: string[] }} o
 * @returns {AppPages}
 */
export function appPages({ classic = [], pages = {}, routes = [] }) {
  /** @type {AppPages} */
  const out = new Map();
  const put = (/** @type {unknown} */ name, /** @type {unknown} */ path) => {
    const k = typeof name === "string" ? pageName(name) : null;
    if (k && typeof path === "string" && /^\/[A-Za-z0-9_-]*$/.test(path) && !out.has(k)) out.set(k, path);
  };
  classic.forEach((p, i) => put(p.page, i === 0 ? "/" : "/" + pageName(p.page)));
  for (const [name, v] of Object.entries(pages && typeof pages === "object" ? pages : {})) put(name, /** @type {any} */ (v)?.path);
  for (const r of routes) {
    const m = typeof r === "string" ? /^#\/([A-Za-z0-9_-]+)$/.exec(r) : null;
    if (m) put(m[1], "/" + m[1]);
  }
  return out;
}

/** @param {string} s */
function decodeSafe(s) {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
}

/**
 * What a link URL does in the frame, and what apply makes of it (see the file comment). Null for a
 * URL that is not relative (a hash, an absolute or mailto link, a computed one). The other query
 * parameters are kept as written, entities and separators included, so the value stays valid
 * markup where the old one was; a hole (a scriptlet, a template's ${...}) may sit in them.
 * @param {string} value the URL as written, its holes masked by HOLE
 * @param {AppPages} pages
 * @returns {PageFix | null}
 */
export function pageRewrite(value, pages) {
  const v = String(value);
  if (!isRelativeUrl(v)) return null;
  const q = v.indexOf("?");
  const hash = v.indexOf("#", q < 0 ? 0 : q);
  const query = q < 0 ? "" : v.slice(q + 1, hash < 0 ? v.length : hash);
  const bits = query.split(/(&amp;|&)/);
  const at = bits.findIndex((b, i) => i % 2 === 0 && decodeSafe(b.split("=")[0] ?? "") === "page");
  const relWhy = "is relative, so it loads the frame's own address, not the app's";
  if (q < 0 || at < 0) return { page: null, fix: "report", why: relWhy };
  const pair = /** @type {string} */ (bits[at]);
  const raw = pair.includes("=") ? decodeSafe(pair.slice(pair.indexOf("=") + 1)) : "";
  const name = raw.includes(HOLE) ? null : pageName(raw);
  const shown = raw.split(HOLE).join("${...}");
  /** @param {string} why @returns {PageFix} */
  const left = (why) => ({ page: shown, fix: "left", why });
  if (v.trim() !== v || q !== 0) return left("it is not a bare query on the app's own address");
  if (hash >= 0) return left("it carries a fragment as well");
  if (!raw) return left("it names no page");
  if (!name) return left("its page is computed");
  const path = pages.get(name);
  if (path === undefined) return left("the app has no page " + JSON.stringify(shown));
  const rest = bits.slice();
  // the page parameter goes with the separator after it (before it, when it is the last)
  if (at + 1 < rest.length) rest.splice(at, 2);
  else rest.splice(Math.max(0, at - 1), at > 0 ? 2 : 1);
  // and empty pairs at either end
  while (rest.length && (rest[0] === "" || rest[0] === "&" || rest[0] === "&amp;")) rest.shift();
  while (rest.length && (rest[rest.length - 1] === "" || rest[rest.length - 1] === "&" || rest[rest.length - 1] === "&amp;")) rest.pop();
  const href = "#" + path + (rest.length ? "?" + rest.join("") : "");
  const h = v.indexOf(HOLE);
  if (h < 0) return { page: shown, fix: "route", path, href, prefix: { len: v.length, text: href }, why: relWhy };
  const k = href.indexOf(HOLE);
  if (k < 0 || v.slice(h) !== href.slice(k)) return left("a computed part comes before its page");
  return { page: shown, fix: "route", path, href, prefix: { len: h, text: href.slice(0, k) }, why: relWhy };
}

/**
 * The marker of a page link apply leaves, as an HTML comment: safe in markup and in a JavaScript
 * string or template (no backtick, no ${, no double hyphen, no double slash).
 * @param {string} why
 */
export function pageMarkComment(why) {
  return "<!-- " + pageMarkText(why) + " -->";
}

/** The text of a PAGE_MARK comment (pageMarkComment), cleaned as it says. @param {string} why */
export function pageMarkText(why) {
  return (PAGE_MARK + ": " + why + "; make it a hash route by hand, or a full reload with the service URL").replace(/[`\\]|\$\{|<|>/g, "").replace(/--+/g, "-").replace(/\/\//g, "/ /").replace(/[\r\n]+/g, " ");
}

/** Elements whose content is text up to their own end tag. */
const RAW_TEXT = new Set(["script", "style", "textarea", "title"]);

/**
 * The start tags of markup with the offsets of each attribute, in one linear pass: comments,
 * declarations and the text of raw-text elements are skipped, and an unterminated tag or quoted
 * value ends the scan (it is read as far as it goes). Names are lowercased; a value is as written.
 * @param {string} src
 * valueStart: the offset of the value's first character (after its quote).
 * @returns {{ name: string, start: number, closing: boolean, attrs: { name: string, value: string, start: number, end: number, valueStart: number }[] }[]}
 */
export function tagsOf(src) {
  /** @type {{ name: string, start: number, closing: boolean, attrs: { name: string, value: string, start: number, end: number, valueStart: number }[] }[]} */
  const out = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt < 0) break;
    if (src.startsWith("<!--", lt)) {
      const e = src.indexOf("-->", lt + 4);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (src[lt + 1] === "!" || src[lt + 1] === "?") {
      const e = src.indexOf(">", lt + 2);
      i = e < 0 ? n : e + 1;
      continue;
    }
    const m = /^<(\/?)([A-Za-z][A-Za-z0-9:-]*)/.exec(src.slice(lt, lt + 64));
    if (!m) {
      i = lt + 1;
      continue;
    }
    const name = /** @type {string} */ (m[2]).toLowerCase();
    /** @type {{ name: string, value: string, start: number, end: number, valueStart: number }[]} */
    const attrs = [];
    let j = lt + m[0].length;
    let closed = false;
    while (j < n) {
      while (j < n && /\s/.test(/** @type {string} */ (src[j]))) j++;
      if (j >= n) break;
      if (src[j] === ">") {
        j++;
        closed = true;
        break;
      }
      if (src[j] === "/" && src[j + 1] === ">") {
        j += 2;
        closed = true;
        break;
      }
      const am = /^[^\s"'>/=]+/.exec(src.slice(j, j + 256));
      if (!am) {
        j++;
        continue;
      }
      const start = j;
      j += am[0].length;
      let k = j;
      while (k < n && /\s/.test(/** @type {string} */ (src[k]))) k++;
      let value = "";
      let valueStart = j;
      if (src[k] === "=") {
        k++;
        while (k < n && /\s/.test(/** @type {string} */ (src[k]))) k++;
        const q = src[k];
        if (q === '"' || q === "'") {
          const e = src.indexOf(q, k + 1);
          if (e < 0) return out;
          value = src.slice(k + 1, e);
          valueStart = k + 1;
          j = e + 1;
        } else {
          let e = k;
          while (e < n && !/[\s>]/.test(/** @type {string} */ (src[e]))) e++;
          value = src.slice(k, e);
          valueStart = k;
          j = e;
        }
      }
      attrs.push({ name: am[0].toLowerCase(), value, start, end: j, valueStart });
    }
    if (!closed) return out;
    out.push({ name, start: lt, closing: m[1] === "/", attrs });
    i = j;
    if (m[1] !== "/" && RAW_TEXT.has(name)) {
      const re = new RegExp("</" + name + "\\s*>", "ig");
      re.lastIndex = i;
      const em = re.exec(src);
      i = em ? em.index + em[0].length : n;
    }
  }
  return out;
}

/**
 * The hash links of a run of markup that would leave the frame, and the edits that keep each in
 * it. Tags are read in one linear pass (tagsOf). A value that starts with a hole is computed and
 * is not read as a hash. relative: the relative, non-hash links (pageRewrite). With pages, a page
 * link the app has becomes its hash route (and then takes _self), and one it does not have gets
 * the PAGE_MARK comment before its tag; without pages they are only read.
 * @param {string} text markup, its holes masked by HOLE
 * @param {AppPages} [pages]
 * @returns {{ links: FrameLink[], edits: Edit[], relative: RelativeLink[] }}
 */
export function frameLinkEdits(text, pages) {
  const src = String(text);
  /** @type {FrameLink[]} */
  const links = [];
  /** @type {Edit[]} */
  const edits = [];
  /** @type {RelativeLink[]} */
  const relative = [];
  for (const tag of tagsOf(src)) {
    const name = tag.closing ? null : linkAttrOf(tag.name);
    const url = name ? tag.attrs.find((a) => a.name === name) : undefined;
    if (!url || url.value.startsWith(HOLE)) continue;
    const rel = pageRewrite(url.value, pages ?? new Map());
    if (rel) {
      relative.push({ tag: tag.name, href: url.value.split(HOLE).join("${...}"), page: rel.page, fix: rel.fix, to: rel.href?.split(HOLE).join("${...}"), why: rel.why, start: tag.start });
      const mark = pageMarkComment(rel.why);
      if (pages && rel.fix === "left" && !src.slice(0, tag.start).endsWith(mark)) edits.push({ start: tag.start, end: tag.start, text: mark });
      if (!pages || rel.fix !== "route" || !rel.prefix) continue;
      edits.push({ start: url.valueStart, end: url.valueStart + rel.prefix.len, text: rel.prefix.text });
    } else if (!isHashUrl(url.value)) continue;
    const target = tag.attrs.find((a) => a.name === "target");
    const fix = targetFix(target ? target.value : null);
    if (fix === "ok") continue;
    links.push({ tag: tag.name, href: (rel?.href ?? url.value).split(HOLE).join("${...}"), target: target ? target.value.split(HOLE).join("${...}") : null, fix, start: tag.start });
    if (fix === "add") edits.push({ start: url.end, end: url.end, text: " " + SELF_ATTR + (/[\s/>]/.test(src.charAt(url.end)) ? "" : " ") });
    else if (fix === "replace" && target) edits.push({ start: target.start, end: target.end, text: SELF_ATTR });
  }
  return { links, edits, relative };
}

/**
 * The template literals of a token list, each with its literal parts, the source offset of each
 * part, and the identifier that tags it (null when untagged). Nested templates come out too.
 * @param {import("./scan/js.mjs").JsToken[]} toks comments may be in the list or not
 * @returns {{ tag: string | null, parts: string[], starts: number[], line: number }[]}
 */
export function templateParts(toks) {
  /** @type {{ tag: string | null, parts: string[], starts: number[], line: number }[]} */
  const out = [];
  /** @type {{ tag: string | null, parts: string[], starts: number[], line: number }[]} */
  const stack = [];
  /** @type {import("./scan/js.mjs").JsToken | null} */
  let prev = null;
  for (const t of toks) {
    if (t.type === "comment") continue;
    if (t.type === "template") {
      const opens = t.value.endsWith("${") && !(t.value.length >= 2 && t.value.startsWith("`") && t.value.endsWith("`"));
      const inner = t.value.slice(1, opens ? -2 : t.value.length > 1 && t.value.endsWith("`") ? -1 : t.value.length);
      if (t.value.startsWith("`")) {
        const tpl = { tag: prev && prev.type === "ident" ? prev.value : null, parts: [inner], starts: [t.start + 1], line: t.line };
        if (opens) stack.push(tpl);
        else out.push(tpl);
      } else {
        const top = stack[stack.length - 1];
        if (top) {
          top.parts.push(inner);
          top.starts.push(t.start + 1);
          if (!opens) out.push(/** @type {any} */ (stack.pop()));
        }
      }
    }
    prev = t;
  }
  return out;
}

/**
 * The frame-link edits of a template, as source offsets (pages as in frameLinkEdits).
 * @param {{ parts: string[], starts: number[] }} tpl
 * @param {AppPages} [pages]
 * @returns {{ links: (FrameLink & { pos: number })[], edits: Edit[], relative: (RelativeLink & { pos: number })[] }}
 */
export function templateFrameEdits(tpl, pages) {
  const text = tpl.parts.join(HOLE);
  /** @type {number[]} the offset in text where each part begins */
  const begins = [];
  let n = 0;
  for (const p of tpl.parts) {
    begins.push(n);
    n += p.length + 1;
  }
  /** @param {number} at an offset in text that is in a literal part (or at its end) */
  const toSource = (at) => {
    let i = begins.length - 1;
    while (i > 0 && /** @type {number} */ (begins[i]) > at) i--;
    return /** @type {number} */ (tpl.starts[i]) + at - /** @type {number} */ (begins[i]);
  };
  const r = frameLinkEdits(text, pages);
  return {
    links: r.links.map((l) => ({ ...l, pos: toSource(l.start) })),
    edits: r.edits.map((e) => ({ start: toSource(e.start), end: toSource(e.end), text: e.text })),
    relative: r.relative.map((l) => ({ ...l, pos: toSource(l.start) })),
  };
}
