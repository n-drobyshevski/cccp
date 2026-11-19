// Extracted from the author's production Apps Script apps; adapted.
// The build guards (middlebox comment replay, backticks, double slashes, title attributes) pass
// over the served files in dist: html pages (inline script and style bodies included), css, and
// any plain js that is served. The server bundle and entry.js run on Apps Script, never reach
// the middlebox, and defineBuild does not guard them, so they are skipped by default.
import { guardCss, guardHtml, guardInlineJs, guardNoTitle } from "../../build/guards.mjs";
import { listFiles, read, relPath, wire } from "./_util.js";

/**
 * @param {{ distDir: string, skip?: string[], scriptlets?: import("../../build/guards.mjs").ScriptletOpts | boolean }} opts
 *   skip: built files (relative path or file name) that are not served; default server.js and
 *   entry.js. scriptlets: the scriptlet allow-list applied to index.html, the one template the
 *   server evaluates (default true: include calls and the bootJson slot); false turns it off
 * @returns {string[]} violations
 */
export function check({ distDir, skip = ["server.js", "entry.js"], scriptlets = true }) {
  const files = listFiles(distDir, [".js", ".css", ".html"]).filter((f) => {
    const rel = relPath(distDir, f);
    return !skip.some((s) => rel === s || rel.endsWith("/" + s));
  });
  /** @type {string[]} */ const bad = [];
  if (!files.length) return ["no served built files found in " + distDir + " (run the build first)"];
  for (const f of files) {
    const label = relPath(distDir, f);
    const text = read(f);
    try {
      if (f.endsWith(".css")) guardCss(label, text);
      else if (f.endsWith(".html")) { guardHtml(label, text, label === "index.html" ? { scriptlets } : {}); guardNoTitle(label, text); }
      else { guardInlineJs(label, text); guardNoTitle(label, text); }
    } catch (e) {
      bad.push(String(/** @type {Error} */ (e).message));
    }
  }
  return bad;
}

/** @param {any} describe @param {any} it @param {any} expect @param {Parameters<typeof check>[0]} opts */
export function register(describe, it, expect, opts) {
  wire(describe, it, expect, "build guards pass on dist", () => check(opts));
}
