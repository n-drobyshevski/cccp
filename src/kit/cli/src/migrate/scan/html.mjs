// Findings from an Apps Script HTML template: scriptlets and the include graph, inline handlers,
// title attributes, script and style blocks, links, external URLs, hash links that would leave the
// frame, relative links that resolve against the frame's own address, the document title, ids and classes. Scriptlets are read first (Apps Script evaluates them anywhere, even inside a comment or
// a script block) and masked, so the tag scan is not confused by a ">" inside one. Total: malformed
// markup yields what could be read, never an exception.
import { HOLE, isHashUrl, linkAttrOf, pageRewrite, targetFix } from "../frameLinks.mjs";

/**
 * @typedef {object} HtmlFindings
 * @property {{ kind: "print" | "raw" | "code", code: string, line: number }[]} scriptlets
 * @property {string[]} includes names from include("x") and HtmlService.createHtmlOutputFromFile("x") in raw scriptlets
 * @property {{ attr: string, value: string, line: number }[]} handlers
 * @property {{ value: string, line: number }[]} titles title attributes (not the title element)
 * @property {{ src: string | null, inline: string, line: number }[]} scripts inline is the original text, scriptlets included
 * @property {{ inline: string, line: number }[]} styles
 * @property {{ rel: string, href: string, line: number }[]} links
 * @property {{ value: string, line: number }[]} urls attribute values that hold a double slash
 * @property {{ tag: string, href: string, target: string | null, line: number }[]} hashLinks links
 *   to a hash (#...) with no target, or one other than _self: in Apps Script's frame, under
 *   <base target="_top">, they leave the frame (frameLinks.mjs)
 * @property {{ tag: string, href: string, page: string | null, line: number }[]} relativeLinks
 *   relative, non-hash links (?page=x, ?, other.html, ""): they resolve against the frame's own
 *   address, not the app's, and <base target="_top"> loads that into the top window
 *   (frameLinks.mjs pageRewrite; page: the ?page= parameter, null when there is none)
 * @property {string | null} docTitle the title element's text, scriptlets left as written
 * @property {string[]} ids
 * @property {string[]} classes
 * @property {string[]} problems where the scan stopped early (empty for ordinary markup)
 */

/** A value as a finding keeps it: at most 120 characters. @param {string} s */
const clip = (s) => (s.length > 120 ? s.slice(0, 117) + "..." : s);

/** @param {string} text */
function lineIndex(text) {
  /** @type {number[]} */
  const starts = [0];
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  /** @param {number} pos */
  return (pos) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (/** @type {number} */ (starts[mid]) <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/** The text with every character but a newline replaced by a space. @param {string} s */
function blank(s) {
  return s.replace(/[^\n]/g, " ");
}

/** Elements whose content is text up to their own end tag. */
const RAW_TEXT = new Set(["script", "style", "title", "textarea"]);

const INCLUDE_RE = /\binclude\s*\(\s*(["'])([^"'\\\n]+)\1\s*\)/g;
const FROM_FILE_RE = /\bcreate(?:Html|Template)(?:Output)?FromFile\s*\(\s*(["'])([^"'\\\n]+)\1\s*\)/g;

/**
 * @param {string} text
 * @returns {HtmlFindings}
 */
export function scanHtml(text) {
  const src = typeof text === "string" ? text : "";
  const lineAt = lineIndex(src);
  /** @type {HtmlFindings} */
  const f = { scriptlets: [], includes: [], handlers: [], titles: [], scripts: [], styles: [], links: [], urls: [], hashLinks: [], relativeLinks: [], docTitle: null, ids: [], classes: [], problems: [] };
  /** @type {Set<string>} */
  const ids = new Set();
  /** @type {Set<string>} */
  const classes = new Set();
  /** @type {Set<string>} */
  const includes = new Set();

  // 1. Scriptlets, masked to spaces of the same length so offsets and lines survive.
  let masked = "";
  let at = 0;
  for (;;) {
    const open = src.indexOf("<?", at);
    if (open < 0) break;
    const close = src.indexOf("?>", open + 2);
    const end = close < 0 ? src.length : close + 2;
    let kind = /** @type {"print" | "raw" | "code"} */ ("code");
    let body = src.slice(open + 2, close < 0 ? src.length : close);
    if (body.startsWith("!=")) {
      kind = "raw";
      body = body.slice(2);
    } else if (body.startsWith("=")) {
      kind = "print";
      body = body.slice(1);
    }
    const code = body.trim();
    f.scriptlets.push({ kind, code, line: lineAt(open) });
    if (kind === "raw") {
      for (const re of [INCLUDE_RE, FROM_FILE_RE]) for (const m of code.matchAll(re)) includes.add(/** @type {string} */ (m[2]));
    }
    masked += src.slice(at, open) + blank(src.slice(open, end));
    at = end;
  }
  masked += src.slice(at);

  // 2. Tags, on the masked text; values are read from the original at the same offsets.
  try {
    let i = 0;
    const n = masked.length;
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
      const nameM = /^<(\/?)([A-Za-z][A-Za-z0-9:-]*)/.exec(masked.slice(lt, lt + 64));
      if (!nameM) {
        i = lt + 1;
        continue;
      }
      const closing = nameM[1] === "/";
      const tag = /** @type {string} */ (nameM[2]).toLowerCase();
      // attributes
      let j = lt + nameM[0].length;
      /** @type {Map<string, { value: string, pos: number }>} */
      const attrs = new Map();
      /** @type {{ name: string, value: string, bare: string, pos: number }[]} */
      const list = [];
      while (j < n) {
        while (j < n && /\s/.test(/** @type {string} */ (masked[j]))) j++;
        if (j >= n) break;
        const c = masked[j];
        if (c === ">") {
          j++;
          break;
        }
        if (c === "/" && masked[j + 1] === ">") {
          j += 2;
          break;
        }
        const am = /^[^\s"'>/=]+/.exec(masked.slice(j, j + 256));
        if (!am) {
          j++;
          continue;
        }
        const name = am[0].toLowerCase();
        const pos = j;
        j += am[0].length;
        let k = j;
        while (k < n && /\s/.test(/** @type {string} */ (masked[k]))) k++;
        let value = "";
        let bare = "";
        if (masked[k] === "=") {
          k++;
          while (k < n && /\s/.test(/** @type {string} */ (masked[k]))) k++;
          const q = masked[k];
          if (q === '"' || q === "'") {
            const e = masked.indexOf(q, k + 1);
            const stop = e < 0 ? n : e;
            value = src.slice(k + 1, stop);
            bare = masked.slice(k + 1, stop);
            j = stop + 1;
          } else {
            let e = k;
            while (e < n && !/[\s>]/.test(/** @type {string} */ (masked[e]))) e++;
            value = src.slice(k, e);
            bare = masked.slice(k, e);
            j = e;
          }
        }
        if (!attrs.has(name)) attrs.set(name, { value, pos });
        list.push({ name, value, bare, pos });
      }
      i = j;
      if (closing) continue;

      for (const a of list) {
        const line = lineAt(a.pos);
        if (/^on[a-z]+$/.test(a.name)) f.handlers.push({ attr: a.name, value: a.value, line });
        else if (a.name === "title") f.titles.push({ value: a.value, line });
        // ids and classes are read with scriptlets blanked: a computed one is not a name
        else if (a.name === "id" && a.bare.trim() && a.bare.trim() === a.value.trim()) ids.add(a.value.trim());
        else if (a.name === "class") for (const c of a.bare.split(/\s+/)) if (c) classes.add(c);
        if (a.value.includes("//")) f.urls.push({ value: a.value, line });
      }
      const urlName = linkAttrOf(tag);
      const url = urlName ? attrs.get(urlName) : undefined;
      const href = url ? url.value.replace(/<\?[\s\S]*?(?:\?>|$)/g, HOLE) : "";
      if (url && !href.startsWith(HOLE) && isHashUrl(href)) {
        const t = attrs.get("target");
        const target = t ? t.value.replace(/<\?[\s\S]*?(?:\?>|$)/g, HOLE) : null;
        if (targetFix(target) !== "ok") f.hashLinks.push({ tag, href: clip(url.value), target: target === null ? null : clip(t?.value ?? ""), line: lineAt(lt) });
      }
      const rel = url ? pageRewrite(href, new Map()) : null;
      if (url && rel) f.relativeLinks.push({ tag, href: clip(url.value), page: rel.page, line: lineAt(lt) });
      if (tag === "link") {
        const rel = attrs.get("rel")?.value ?? "";
        const href = attrs.get("href")?.value ?? "";
        f.links.push({ rel, href, line: lineAt(lt) });
      }
      if (RAW_TEXT.has(tag)) {
        const endRe = new RegExp("</" + tag + "\\s*>", "ig");
        endRe.lastIndex = i;
        const em = endRe.exec(masked);
        const stop = em ? em.index : n;
        const inner = src.slice(i, stop);
        if (tag === "script") f.scripts.push({ src: attrs.has("src") ? (attrs.get("src")?.value ?? "") : null, inline: inner, line: lineAt(lt) });
        else if (tag === "style") f.styles.push({ inline: inner, line: lineAt(lt) });
        else if (tag === "title" && f.docTitle === null) f.docTitle = inner.trim().replace(/\s+/g, " ");
        i = em ? em.index + em[0].length : n;
      }
    }
  } catch (e) {
    // total: keep what was found, and say so
    f.problems.push("the scan stopped early: " + (/** @type {Error} */ (e)?.message ?? String(e)));
  }
  f.includes = [...includes];
  f.ids = [...ids];
  f.classes = [...classes];
  return f;
}
