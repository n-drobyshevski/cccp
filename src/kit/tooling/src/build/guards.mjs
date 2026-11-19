// Extracted from the author's production Apps Script apps; adapted.
//
// Build guards, importable by the build and by tests.
//
// The Apps Script middlebox "strips comments" from served documents with a tokenizer that
// understands quoted strings but not template literals or regexes. A bare double slash in a
// string, regex or CSS url() would truncate the line. These guards replay that rewrite and
// fail the build when anything would be corrupted.

/**
 * Replay the proxy's comment stripping: string-aware, template/regex-unaware.
 * @param {string} code
 * @returns {string}
 */
export function stripCommentsLikeMiddlebox(code) {
  let out = "";
  let i = 0;
  /** @type {string | null} */
  let quote = null;
  while (i < code.length) {
    const c = code[i];
    const n = code[i + 1];
    if (quote) {
      out += c;
      if (c === "\\" && n !== undefined) { out += n; i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; out += c; i++; continue; }
    if (c === "/" && n === "/") { while (i < code.length && code[i] !== "\n") i++; continue; }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < code.length && !(code[i] === "*" && code[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Throws when the client JS contains a backtick, a double slash that survives the replay, or
 * when the middlebox replay would change the code at all. The replay does not understand regex
 * literals, so a comment opener inside a regex (a star after a slash) opens a fake block comment
 * and silently deletes code up to the next closer. A minified bundle built with legalComments
 * none holds no comment, so the replay must be the identity; any difference is corruption,
 * reported at the first differing offset.
 * @param {string} label
 * @param {string} code
 */
export function guardJs(label, code) {
  if (code.includes("`")) {
    throw new Error("middlebox guard: " + label + " still contains backticks");
  }
  const stripped = stripCommentsLikeMiddlebox(code);
  if (stripped.includes("//")) {
    const line = stripped.slice(0, stripped.indexOf("//")).split("\n").length;
    throw new Error(
      "middlebox guard: bare double slash survives comment stripping in " + label +
      " (in a string or regex) near stripped line " + line,
    );
  }
  if (stripped !== code) {
    let at = 0;
    while (at < stripped.length && stripped[at] === code[at]) at++;
    throw new Error(
      "middlebox guard: comment stripping would change " + label + " near " +
      JSON.stringify(code.slice(Math.max(0, at - 40), at + 40)) +
      " (a slash-star in a string or regex, or a comment left in the code)",
    );
  }
}

/**
 * Guard for hand-written, non-minified JS (an inline script, a served plain js file, the dev
 * shim). Comments are legitimate there, so the identity rule of guardJs does not apply: no
 * backtick, no double slash left after the replay, and it must still compile. Keep such code free
 * of regex literals that hold a slash-star; move it to a bundle, which guardJs checks strictly.
 * @param {string} label
 * @param {string} code
 */
export function guardInlineJs(label, code) {
  if (code.includes("`")) {
    throw new Error("middlebox guard: " + label + " still contains backticks");
  }
  const stripped = stripCommentsLikeMiddlebox(code);
  if (stripped.includes("//")) {
    const line = stripped.slice(0, stripped.indexOf("//")).split("\n").length;
    throw new Error(
      "middlebox guard: bare double slash survives comment stripping in " + label +
      " (in a string or regex) near stripped line " + line,
    );
  }
  try {
    new Function(stripped);
  } catch (e) {
    throw new Error("middlebox guard: " + label + " breaks under comment stripping: " + (/** @type {Error} */ (e)).message);
  }
}

/**
 * Throws when the stylesheet has a double slash outside a block comment, or a "</style" anywhere.
 * CSS has no line comments, so a double slash is always a url() or string, and the middlebox
 * would either keep it (quoted) or silently eat the rest of the line (unquoted url). Both are
 * corruption. The build inlines the stylesheet in a <style> element, and the HTML parser ends
 * that element at the first "</style" in any case, wherever it sits (a comment, a string, a
 * selector or a custom property value, which esbuild keeps as written): the rest would be
 * parsed as markup. No stylesheet needs one, so it is refused outright.
 * @param {string} label
 * @param {string} css
 */
export function guardCss(label, css) {
  const close = /<\/style/i.exec(css);
  if (close) {
    const line = css.slice(0, close.index).split("\n").length;
    throw new Error(
      "style guard: " + label + " holds \"</style\" near line " + line +
      ", which would close the inlined <style> element and turn the rest into markup",
    );
  }
  const noBlocks = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const stripped = stripCommentsLikeMiddlebox(css);
  const bad = noBlocks.includes("//") ? noBlocks : stripped.includes("//") ? stripped : null;
  if (bad) {
    const at = bad.indexOf("//");
    throw new Error(
      "middlebox guard: bare double slash in " + label + " near " +
      JSON.stringify(bad.slice(Math.max(0, at - 60), at + 20)),
    );
  }
}

/**
 * Throws when markup text (an html file or a bundled client string) carries a title attribute.
 * Tooltips are data-tip. Matches a tag followed by title=, with the value quote plain or
 * backslash-escaped, so it also fires inside bundled string literals.
 * @param {string} label
 * @param {string} text
 */
export function guardNoTitle(label, text) {
  // A tag name, then at most 2000 characters of attributes (so a "<" comparison in minified code
  // cannot reach a far-away " title="), where title follows whitespace (or the escape of one in a
  // bundled string: backslash then t, n or r), a closing quote with no space (the tokenizer starts
  // a new attribute there), or a slash right after the tag name or a closing quote. A quote
  // directly after "=" opens a value, so "x" inside a value that begins title= is not an attribute.
  const sep = String.raw`(?:\s|\\[tnr]|(?<!=\s*\\?)\\?["']\/?|(?<=<[a-zA-Z][a-zA-Z0-9-]*)\/)`;
  const re = new RegExp(
    String.raw`<[a-zA-Z][a-zA-Z0-9-]*(?=[\s/]|\\[tnr])[^<>]{0,2000}?` + sep + String.raw`title\s*=\s*(?:\\?["']|[^\s>"'\\])`,
    "i",
  );
  const m = re.exec(text);
  if (m) {
    const line = text.slice(0, m.index).split("\n").length;
    throw new Error(
      "title guard: " + label + " has a title attribute near line " + line +
      ". Use data-tip (and aria-label or visible text).",
    );
  }
}

/**
 * Guards an html file. The middlebox strips comments from the whole served document, not only
 * from script and style text, so three things are checked:
 * - each inline script body goes through guardJs (module and data scripts only get the double
 *   slash test), after GAS scriptlets (<?= ?>, <?!= ?>, <? ?>) are swapped for a placeholder so
 *   the standard boot pattern parses; the comment replay still runs on the raw text;
 * - each style body goes through guardCss;
 * - the markup outside script and style (comments, text, attributes) is replayed through
 *   stripCommentsLikeMiddlebox and must come out unchanged. The replay is string-aware, so a
 *   quoted attribute URL passes; a double slash in a comment, in text or in an unquoted
 *   attribute does not.
 *
 * Known limitation: a scriptlet is replaced by the placeholder null as a value, so only the
 * value form (<?!= x ?>, <?= x ?>) parses. A scriptlet used as control flow inside a classic
 * inline script, such as <? if (a) { ?> ... <? } ?>, becomes bare null tokens that no longer
 * parse, and the build fails with "breaks under comment stripping". Compute the value on the
 * server and print it with <?!= ?>, or move the script to a bundled file.
 * With opts.scriptlets (defineBuild passes it for index.html), the scriptlets are held to an
 * allow-list too, see guardScriptlets.
 * @param {string} label
 * @param {string} html
 * @param {{ scriptlets?: ScriptletOpts | boolean }} [opts]
 */
export function guardHtml(label, html, opts = {}) {
  if (opts.scriptlets) guardScriptlets(label, html, opts.scriptlets === true ? {} : opts.scriptlets);
  const markup = html.replace(
    /<!--[\s\S]*?-->|<script\b([^>]*)>([\s\S]*?)<\/script\s*>|<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi,
    (whole, attrs, scriptBody, styleBody) => {
      if (whole.startsWith("<!--")) return whole;
      if (attrs !== undefined) {
        if (scriptBody.trim()) guardScript(label, attrs, scriptBody);
      } else if (styleBody.trim()) {
        guardCss(label + " inline style", styleBody);
      }
      return "";
    },
  );
  const replayed = stripCommentsLikeMiddlebox(markup);
  if (replayed !== markup) {
    let at = 0;
    while (at < replayed.length && replayed[at] === markup[at]) at++;
    throw new Error(
      "middlebox guard: comment stripping would change the markup of " + label + " near " +
      JSON.stringify(markup.slice(Math.max(0, at - 40), at + 40)) +
      " (a double slash in a comment, text or unquoted attribute; quote the URL or drop it)",
    );
  }
}

/**
 * @typedef {{ bootSlots?: string[], allow?: (string | RegExp)[] }} ScriptletOpts
 *   bootSlots: template variables that may be force-printed alone (default bootJson, the escaped
 *   boot JSON slot). allow: further scriptlets, as the exact text or a RegExp over it.
 */

/** A force-printed include: <?!= include('name') ?>, the semicolon optional. */
const INCLUDE_SCRIPTLET = /^<\?!=\s*include\s*\(\s*(["'])[\w.-]+\1\s*\)\s*;?\s*\?>$/;

/**
 * Throws on any scriptlet of a served template that is not on the allow-list. A force-printing
 * scriptlet (<?!= ?>) writes its value unescaped, and a code scriptlet (<? ?>) runs on the server
 * with the page's data, so only the include calls and the boot slots are allowed by default;
 * anything else (a printed setting, <?= ?> of a row) belongs in the boot data, rendered by the
 * client through the html template.
 * @param {string} label
 * @param {string} html
 * @param {ScriptletOpts} [opts]
 */
export function guardScriptlets(label, html, opts = {}) {
  const boot = opts.bootSlots ?? ["bootJson"];
  const allow = opts.allow ?? [];
  for (const m of html.matchAll(/<\?[\s\S]*?\?>/g)) {
    const t = m[0];
    if (INCLUDE_SCRIPTLET.test(t)) continue;
    const slot = /^<\?!=\s*([\w$]+)\s*;?\s*\?>$/.exec(t);
    if (slot && boot.includes(slot[1])) continue;
    if (allow.some((a) => (typeof a === "string" ? a === t : a.test(t)))) continue;
    const line = html.slice(0, m.index).split("\n").length;
    throw new Error(
      "scriptlet guard: " + label + " has the scriptlet " + JSON.stringify(t.length > 60 ? t.slice(0, 60) + "..." : t) + " near line " + line +
      ". Only include('name') and the boot slot (" + boot.join(", ") + ") may be printed; put other values in the boot data.",
    );
  }
}

/**
 * @param {string} label
 * @param {string} attrs
 * @param {string} body
 */
function guardScript(label, attrs, body) {
  const type = /\btype\s*=\s*["']?([^\s"'>]+)/i.exec(attrs)?.[1] ?? "";
  const classic = type === "" || /^(text|application)\/(x-)?(javascript|ecmascript)$/i.test(type);
  if (classic) {
    if (stripCommentsLikeMiddlebox(body).includes("//")) {
      throw new Error("middlebox guard: bare double slash survives comment stripping in " + label + " inline script");
    }
    guardInlineJs(label + " inline script", body.replace(/<\?[\s\S]*?\?>/g, "null"));
  } else if (stripCommentsLikeMiddlebox(body).includes("//")) {
    throw new Error("middlebox guard: bare double slash in " + label + " inline script (" + type + ")");
  }
}

/**
 * Names of the api_<name> delegators declared in entry.js.
 * @param {string} entryJs
 * @returns {string[]}
 */
export function delegatedNames(entryJs) {
  return [...entryJs.matchAll(/^function api_(\w+)\s*\(/gm)].map((m) => m[1]);
}

/**
 * True when a line has a comma outside every bracket and string: `export let a = 1, b = 2`
 * declares b too, while `export const a = f(x, y)` does not.
 * @param {string} line
 */
function hasTopLevelComma(line) {
  const flat = line.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, '""');
  let depth = 0;
  for (const c of flat) {
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) return true;
  }
  return false;
}

/**
 * Names exported from api.ts as RPC endpoints: `export function`, `export async function` and
 * `export const|let|var name =`. Type-only exports (type, interface, declare) are ignored. Any
 * other export form (default, a brace list, star, class, enum, namespace) cannot be matched to
 * a delegator by name, so it throws instead of passing unseen. So does a comma declarator
 * (`export let a = 1, b = 2`), which would hide b.
 * @param {string} apiTs
 * @returns {string[]}
 */
export function exportedNames(apiTs) {
  const names = [];
  for (const line of apiTs.split("\n")) {
    if (!/^export\b/.test(line)) continue;
    let m = /^export\s+(?:async\s+)?function\s*\*?\s*(\w+)\s*[(<]/.exec(line);
    if (!m) m = /^export\s+(?:const|let|var)\s+(?!enum\b)(\w+)\b/.exec(line);
    if (m) {
      if (/^export\s+(?:const|let|var)\b/.test(line) && hasTopLevelComma(line)) {
        throw new Error("entry.js guard: cannot classify this api.ts export (one declarator per export, a comma would hide the others): " + line.trim());
      }
      names.push(m[1]);
      continue;
    }
    if (/^export\s+(?:type|interface|declare)\b/.test(line)) continue;
    throw new Error("entry.js guard: cannot classify this api.ts export (use export function or export const): " + line.trim());
  }
  return names;
}

/**
 * entry.js drift guard. GAS resolves google.script.run targets against top-level functions,
 * so the delegators are hand-written; this fails in both directions: an export with no
 * delegator is unreachable, a delegator with no export throws at call time.
 * @param {string} entryJs
 * @param {string} apiTs
 */
export function guardEntryDrift(entryJs, apiTs) {
  const declared = new Set(delegatedNames(entryJs));
  const exported = new Set(exportedNames(apiTs));
  const missing = [...exported].filter((n) => !declared.has(n));
  const stale = [...declared].filter((n) => !exported.has(n));
  if (missing.length || stale.length) {
    throw new Error(
      "entry.js guard: src/gas/entry.js and src/server/api.ts disagree" +
      (missing.length ? "\n  exported by api.ts but unreachable from GAS: " + missing.join(", ") : "") +
      (stale.length ? "\n  delegated in entry.js but not exported: " + stale.join(", ") : ""),
    );
  }
}
