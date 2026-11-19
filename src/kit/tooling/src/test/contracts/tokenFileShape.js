// A token file (brand.css, legacy-tokens.css) may hold colour literals, so it is held to a narrow
// shape: comments, whitespace, rule blocks whose selector is exactly :root (optionally with a
// data-theme attribute, or its :not() form), prefers-color-scheme media blocks holding only such
// rules, and inside them only custom-property declarations. No normal property, class selector,
// at-rule (@import, @font-face, @layer), nested rule, url(), expression(), backslash escape, "<" or
// stray brace. A token file therefore cannot carry styling, a fetch or a script sink, whatever
// colours it names, and cannot end the <style> element the build inlines it in (esbuild keeps a
// custom property value as written, so a "</style>" there would turn the rest into markup). Problems name file:line and the reason, and quote at most 40 characters.
import { read, wire } from "./_util.js";

const SELECTOR = /^:root(?:\[\s*data-theme\s*=\s*(["'])(?:light|dark)\1\s*\]|:not\(\s*\[\s*data-theme\s*=\s*(["'])(?:light|dark)\2\s*\]\s*\))?$/;
const MEDIA = /^@media\s*\(\s*prefers-color-scheme\s*:\s*(?:dark|light)\s*\)$/i;
const DECL = /^(--[\w-]+)\s*:([\s\S]*)$/;
/** @type {[RegExp, string][]} */
const BAD_VALUE = [
  [/url\s*\(/i, "url() is not allowed in a token value"],
  [/@import/i, "@import is not allowed in a token value"],
  [/expression\s*\(/i, "expression() is not allowed in a token value"],
  [/\\/, "a backslash escape is not allowed in a token value"],
  [/[{}]/, "a brace is not allowed in a token value"],
  [/</, "a < is not allowed in a token value (it could close the inlined <style>)"],
];

/** @param {string} s */
const clip = (s) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 40 ? t.slice(0, 40) + "..." : t;
};

/** Comments blanked (quote-aware), newlines kept. Returns the text and the line of an open comment. @param {string} css */
function stripComments(css) {
  let out = "";
  let i = 0;
  let open = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      const stop = end < 0 ? css.length : end + 2;
      if (end < 0) open = out.split("\n").length;
      out += css.slice(i, stop).replace(/[^\n]/g, "");
      i = stop;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c && css[j] !== "\n") j += css[j] === "\\" ? 2 : 1;
      out += css.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return { text: out, open };
}

/**
 * Everything in a CSS text that is not a comment, a theme rule block or a custom property.
 * @param {string} css
 * @returns {{ line: number, reason: string }[]}
 */
export function findProblems(css) {
  /** @type {{ line: number, reason: string }[]} */ const bad = [];
  const { text, open } = stripComments(css);
  if (open) bad.push({ line: open, reason: "unterminated comment" });
  /** @type {("media" | "rule" | "skip")[]} */ const stack = [];
  const lineAt = (/** @type {number} */ at) => text.slice(0, at).split("\n").length;
  let i = 0;
  while (i < text.length) {
    let j = i;
    while (j < text.length && !"{;}".includes(text[j])) {
      if (text[j] === '"' || text[j] === "'") {
        const q = text[j++];
        while (j < text.length && text[j] !== q && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
      }
      j++;
    }
    const seg = text.slice(i, j);
    const term = text[j] || "";
    const lead = seg.length - seg.trimStart().length;
    const line = lineAt(i + lead);
    const s = seg.trim();
    /** @type {"top" | "media" | "rule" | "skip"} */
    const ctx = stack[stack.length - 1] || "top";
    /** @param {string} reason */
    const add = (reason) => bad.push({ line, reason });
    if (term === "{") {
      const sel = s.replace(/\s+/g, " ");
      if (ctx === "skip") stack.push("skip");
      else if (ctx === "rule") { add("nested rule: " + clip(s)); stack.push("skip"); }
      else if (MEDIA.test(sel) && ctx !== "media") stack.push("media");
      else if (SELECTOR.test(sel)) stack.push("rule");
      else {
        add((s[0] === "@" ? "at-rule not allowed: " : "selector not allowed: ") + clip(s));
        stack.push("skip");
      }
    } else if (s) {
      if (ctx === "rule") {
        const m = DECL.exec(s);
        if (!m) add("only custom properties are allowed in a token file: " + clip(s));
        else for (const [re, why] of BAD_VALUE) if (re.test(m[2])) { add(why + ": " + clip(m[1] + ":" + m[2])); break; }
      } else if (ctx === "skip") {
        // already reported with its block
      } else add((s[0] === "@" ? "at-rule not allowed: " : "declaration outside a rule block: ") + clip(s));
    }
    if (term === "}") {
      if (!stack.length) bad.push({ line: lineAt(j), reason: "unbalanced }" });
      else stack.pop();
    }
    i = j + 1;
  }
  if (stack.length) bad.push({ line: lineAt(text.length), reason: "unclosed block (missing closing brace)" });
  return bad;
}

/**
 * @param {{ files: string[], minFiles?: number }} opts absolute paths of the token files
 * @returns {string[]} violations
 */
export function check({ files, minFiles = 0 }) {
  /** @type {string[]} */ const bad = [];
  if (files.length < minFiles) bad.push("scanned " + files.length + " token file(s), expected at least " + minFiles);
  for (const f of files) for (const p of findProblems(read(f))) bad.push(f + ":" + p.line + " " + p.reason);
  return bad;
}

/** @param {any} describe @param {any} it @param {any} expect @param {Parameters<typeof check>[0]} opts */
export function register(describe, it, expect, opts) {
  wire(describe, it, expect, "token file shape", () => check(opts));
}
