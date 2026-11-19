// Extracted from the author's production Apps Script apps; adapted.
// No title attribute in markup or in the HTML strings of browser code: tooltips are data-tip.
// Caught: title= in a tag (every one in a file, not only the first), setAttribute("title", ...)
// with any quote including a backtick, setAttributeNS(ns, "title", ...), el.title = x and
// el["title"] = x. The property form is limited to element-looking receivers: el, $el, node, btn,
// this, and names ending in El, Element, Node, Btn or Button (a.b.saveBtn.title counts, the last
// name decides). A plain data object such as row.title = name is not flagged, and neither is
// document.title (or document .title), the page title. Name an element variable so it matches, or
// use data-tip.
// Not caught, on purpose: an attribute object such as { title: x } handed to a builder, because a
// plain data key called title is common; the html template and ESLint cover browser code.
import { guardNoTitle } from "../../build/guards.mjs";
import { lineOf, read, wire } from "./_util.js";

const SET_ATTR = /\bsetAttribute\s*\(\s*["'`]title["'`]/gi;
const SET_ATTR_NS = /\bsetAttributeNS\s*\(\s*[^,()]*,\s*["'`]title["'`]/gi;
const PROP_ASSIGN = /(?<![\w$])(?:\$?el|node|btn|this|[A-Za-z_$][\w$]*(?:El|Element|Node|Btn|Button))\s*\.\s*title\s*=(?!=)/g;
const KEY_ASSIGN = /\[\s*["'`]title["'`]\s*\]\s*=(?!=)/g;

/**
 * Every title attribute in a text, as { line, message }. The tag guard throws at its first hit,
 * so each hit's line is blanked out and the guard runs again.
 * @param {string} label @param {string} text
 * @returns {{ line: number, message: string }[]}
 */
export function findTitles(label, text) {
  /** @type {{ line: number, message: string }[]} */ const out = [];
  let work = text;
  for (let n = 0; n < 1000; n++) {
    try {
      guardNoTitle(label, work);
      break;
    } catch (e) {
      const message = String(/** @type {Error} */ (e).message);
      const line = Number(/near line (\d+)/.exec(message)?.[1]);
      out.push({ line, message });
      if (!line) break;
      const lines = work.split("\n");
      lines[line - 1] = "";
      work = lines.join("\n");
    }
  }
  const named = /** @type {[RegExp, string][]} */ ([
    [SET_ATTR, "sets a title attribute with setAttribute. Use data-tip."],
    [SET_ATTR_NS, "sets a title attribute with setAttributeNS. Use data-tip."],
    [PROP_ASSIGN, "assigns the title property of an element. Use data-tip."],
    [KEY_ASSIGN, "assigns the title property of an element by key. Use data-tip."],
  ]);
  for (const [re, what] of named) {
    for (const m of text.matchAll(re)) {
      const line = lineOf(text, m.index);
      out.push({ line, message: label + ":" + line + " " + what });
    }
  }
  return out;
}

/**
 * @param {{ files: string[] }} opts js, ts, html and built bundle files
 * @returns {string[]} violations
 */
export function check({ files }) {
  /** @type {string[]} */ const bad = [];
  for (const f of files) for (const h of findTitles(f, read(f))) bad.push(h.message);
  return bad;
}

/** @param {any} describe @param {any} it @param {any} expect @param {Parameters<typeof check>[0]} opts */
export function register(describe, it, expect, opts) {
  wire(describe, it, expect, "no title attributes", () => check(opts));
}
