// Findings from a CSS text: custom property definitions (with their selector and media query),
// var() uses, colour literals, class selectors, url() values, @import targets, font families and
// layer names. Comments, strings and url() bodies are masked before the structure is read, so a
// brace or a colour in one of them is not seen. Whether a declaration holds a colour is decided by
// the kit's own findColourLiterals, so what this reports is what the colour contract would flag.
// Total: malformed CSS yields what could be read, never an exception.
import { findColourLiterals } from "../../../../tooling/src/test/contracts/noColourOutsideTokens.js";

/**
 * @typedef {object} CssFindings
 * @property {{ name: string, value: string, selector: string, media: string | null, line: number }[]} defines
 *   name keeps its leading dashes; media is the condition of the innermost media block, null outside one
 * @property {string[]} uses custom property names read through var(), in first-use order
 * @property {{ value: string, line: number, prop: string }[]} colours each colour literal, with its declaration's property
 * @property {string[]} classes
 * @property {{ value: string, line: number, bytes?: number }[]} urls a data: URL is shortened to "data:<type>" with its length in bytes
 * @property {string[]} imports
 * @property {string[]} fonts font families named in font-family declarations (generic families left out)
 * @property {string[]} fontFaces families declared by a font-face rule
 * @property {string[]} layers
 * @property {string[]} problems where the scan read something by its fallback rules or stopped early
 */

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

/** @param {string} s @param {string} ch */
const fill = (s, ch) => s.replace(/[^\n]/g, ch);

/**
 * Two same-length views of a CSS text: noComments (comments blanked) and masked (comments blanked,
 * string and url() bodies replaced by underscores, their delimiters kept). Also every url() and
 * every quoted string, with offsets.
 * @param {string} css
 */
function mask(css) {
  let noComments = "";
  let masked = "";
  /** @type {{ value: string, pos: number }[]} */
  const urls = [];
  /** @type {{ value: string, pos: number }[]} */
  const strings = [];
  let i = 0;
  const n = css.length;
  while (i < n) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const e = css.indexOf("*/", i + 2);
      const stop = e < 0 ? n : e + 2;
      const b = fill(css.slice(i, stop), " ");
      noComments += b;
      masked += b;
      i = stop;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && css[j] !== c && css[j] !== "\n") j += css[j] === "\\" ? 2 : 1;
      const stop = Math.min(n, j + 1);
      const s = css.slice(i, stop);
      strings.push({ value: s.slice(1, css[j] === c ? -1 : undefined), pos: i });
      noComments += s;
      masked += c + fill(s.slice(1, -1), "_") + (s.length > 1 ? s.slice(-1) : "");
      i = stop;
    } else if ((c === "u" || c === "U") && /^url\(/i.test(css.slice(i, i + 4)) && !/[\w-]/.test(css[i - 1] || "")) {
      let j = i + 4;
      while (j < n && /\s/.test(/** @type {string} */ (css[j]))) j++;
      let value;
      if (css[j] === '"' || css[j] === "'") {
        const q = css[j];
        let k = j + 1;
        while (k < n && css[k] !== q) k += css[k] === "\\" ? 2 : 1;
        value = css.slice(j + 1, Math.min(k, n));
        j = k + 1;
      }
      let k = j;
      while (k < n && css[k] !== ")") k++;
      if (value === undefined) value = css.slice(i + 4, k).trim();
      const stop = Math.min(n, k + 1);
      const s = css.slice(i, stop);
      urls.push({ value, pos: i });
      noComments += s;
      masked += "url(" + fill(s.slice(4, -1), "_") + (s.endsWith(")") ? ")" : s.slice(-1).replace(/[^\n]/, "_"));
      i = stop;
    } else {
      noComments += c;
      masked += c;
      i++;
    }
  }
  return { noComments, masked, urls, strings };
}

const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "math", "emoji", "fangsong", "inherit", "initial", "unset", "revert", "revert-layer"]);

const FUNC_AT = /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark|device-cmyk|cmyk)\(/iy;
const HEX_AT = /#[0-9a-f]{3,8}(?![\w-])/iy;
const WORD_AT = /[a-z]+(?![\w(-])/iy;

/** Index of the paren closing the one at open, or the end. @param {string} s @param {number} open */
function closeParen(s, open) {
  let d = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") d++;
    else if (s[i] === ")" && --d === 0) return i;
  }
  return s.length - 1;
}

/** The deepest paren nesting in a text. @param {string} s */
function parenDepth(s) {
  let d = 0;
  let max = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") max = Math.max(max, ++d);
    else if (s[i] === ")" && d > 0) d--;
  }
  return max;
}

/** Deeper than this, the kit's own colour check (which recurses per nested mix) is not asked. */
const ORACLE_DEPTH = 32;

/** @type {Map<string, boolean>} */
const namedCache = new Map();

/** Whether a bare word is a colour name to the kit's guard. @param {string} word */
function isNamedColour(word) {
  const k = word.toLowerCase();
  let hit = namedCache.get(k);
  if (hit === undefined) {
    hit = findColourLiterals("a{b:" + k + "}").length > 0;
    if (namedCache.size < 4096) namedCache.set(k, hit);
  }
  return hit;
}

/**
 * The colour literals inside one declaration value, in one left-to-right pass: a hex, a colour
 * function (rgb(), hsl(), color() ...; taken whole, its insides skipped), or a word the kit's guard
 * reads as a colour name. color-mix() and light-dark() are read through: a token-only mix holds no
 * literal (the guard allows it), a literal inside one is reported. Linear, no recursion.
 * @param {string} value masked value (strings, url() bodies and comments blanked), var() names removed
 * @returns {string[]}
 */
function literalsIn(value) {
  /** @type {string[]} */
  const out = [];
  const n = value.length;
  let i = 0;
  while (i < n) {
    const c = /** @type {string} */ (value[i]);
    const boundary = i === 0 || !/[\w-]/.test(/** @type {string} */ (value[i - 1]));
    if (boundary && /[a-z]/i.test(c)) {
      FUNC_AT.lastIndex = i;
      const fm = FUNC_AT.exec(value);
      if (fm) {
        const name = fm[0].slice(0, -1).toLowerCase();
        if (name === "color-mix" || name === "light-dark") {
          i += fm[0].length;
          continue;
        }
        const end = closeParen(value, i + fm[0].length - 1);
        out.push(value.slice(i, end + 1));
        i = end + 1;
        continue;
      }
      WORD_AT.lastIndex = i;
      const wm = WORD_AT.exec(value);
      if (wm) {
        if (isNamedColour(wm[0])) out.push(wm[0]);
        i += wm[0].length;
        continue;
      }
      while (i < n && /[\w-]/.test(/** @type {string} */ (value[i]))) i++;
      continue;
    }
    if (c === "#") {
      HEX_AT.lastIndex = i;
      const hm = HEX_AT.exec(value);
      if (hm) {
        out.push(hm[0]);
        i += hm[0].length;
        continue;
      }
    }
    i++;
  }
  return out;
}

/**
 * The first entry of a list sorted by pos with from <= pos < to, by binary search.
 * @template {{ pos: number }} T
 * @param {T[]} list @param {number} from @param {number} to
 * @returns {T | undefined}
 */
function firstIn(list, from, to) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (/** @type {T} */ (list[mid]).pos < from) lo = mid + 1;
    else hi = mid;
  }
  const hit = list[lo];
  return hit && hit.pos < to ? hit : undefined;
}

/**
 * @param {string} text
 * @returns {CssFindings}
 */
export function scanCss(text) {
  const css = typeof text === "string" ? text : "";
  /** @type {CssFindings} */
  const f = { defines: [], uses: [], colours: [], classes: [], urls: [], imports: [], fonts: [], fontFaces: [], layers: [], problems: [] };
  /** @type {Set<string>} */
  const uses = new Set();
  /** @type {Set<string>} */
  const classes = new Set();
  /** @type {Set<string>} */
  const imports = new Set();
  /** @type {Set<string>} */
  const fonts = new Set();
  /** @type {Set<string>} */
  const faces = new Set();
  /** @type {Set<string>} */
  const layers = new Set();
  try {
    const lineAt = lineIndex(css);
    const { noComments, masked, urls, strings } = mask(css);

    for (const u of urls) {
      if (/^data:/i.test(u.value)) {
        const type = /^data:([^;,]*)/i.exec(u.value);
        f.urls.push({ value: "data:" + (type ? type[1] : ""), line: lineAt(u.pos), bytes: u.value.length });
      } else f.urls.push({ value: u.value, line: lineAt(u.pos) });
    }
    for (const m of masked.matchAll(/var\(\s*(--[\w-]+)/g)) uses.add(/** @type {string} */ (m[1]));

    // Each frame carries what it inherits (the innermost media and rule, whether inside a font
    // face), so a declaration reads its context in constant time at any nesting depth.
    /** @typedef {{ prelude: string, kind: "rule" | "media" | "font-face" | "layer" | "other", media: string | null, rule: string | null, inFace: boolean }} Frame */
    /** @type {Frame[]} */
    const stack = [];
    let start = 0;
    /** @param {number} from @param {number} to */
    const statement = (from, to) => {
      const raw = masked.slice(from, to);
      const lead = raw.length - raw.trimStart().length;
      const s = raw.trim();
      if (!s) return;
      const pos = from + lead;
      if (s.startsWith("@")) {
        atStatement(s, pos);
        return;
      }
      const colon = s.indexOf(":");
      if (colon <= 0) return;
      const prop = s.slice(0, colon).trim();
      if (!/^-{0,2}[\w-]+$/.test(prop)) return;
      const value = noComments.slice(pos + colon + 1, pos + s.length).trim();
      const top = stack[stack.length - 1];
      const media = top ? top.media : null;
      const rule = top ? top.rule : null;
      const line = lineAt(pos);
      if (prop.startsWith("--")) {
        f.defines.push({ name: prop, value, selector: rule ?? "", media, line });
      }
      // read from the masked value, so a hex inside a string or a url() body is not taken
      const bare = masked.slice(pos + colon + 1, pos + s.length).replace(/var\(\s*--[\w-]+/g, "var(");
      /** @type {boolean | null} null: the kit's check was not asked (too deep) or broke */
      let flagged = null;
      if (parenDepth(bare) <= ORACLE_DEPTH) {
        try {
          flagged = findColourLiterals("a{" + prop + ": " + value + "}").length > 0;
        } catch {
          flagged = null;
        }
      }
      const found = flagged === false ? [] : literalsIn(bare);
      if (flagged === null && found.length) f.problems.push("line " + line + ": " + prop + " nests too deep for the kit's colour check; its colours were read by this scanner's own rules");
      // the guard flags it but no single literal could be cut out: report the whole value, never nothing
      if (flagged === true && !found.length) found.push(value);
      for (const v of found) f.colours.push({ value: v, line, prop });
      if (prop.toLowerCase() === "font-family") {
        const inFace = top ? top.inFace : false;
        for (const fam of value.split(",")) {
          const name = fam.trim().replace(/^(["'])(.*)\1$/, "$2").trim();
          if (!name || GENERIC.has(name.toLowerCase()) || name.startsWith("var(")) continue;
          if (inFace) faces.add(name);
          else fonts.add(name);
        }
      }
    };
    /** @param {string} s masked statement text @param {number} pos */
    const atStatement = (s, pos) => {
      const m = /^@([\w-]+)/.exec(s);
      if (!m) return;
      const name = /** @type {string} */ (m[1]).toLowerCase();
      if (name === "import") {
        const u = firstIn(urls, pos, pos + s.length);
        const q = firstIn(strings, pos, pos + s.length);
        const target = u && (!q || u.pos < q.pos) ? u.value : q ? q.value : null;
        if (target !== null) imports.add(target);
        const lm = /\blayer\(\s*([\w.-]+)\s*\)/i.exec(s);
        if (lm) layers.add(/** @type {string} */ (lm[1]));
      } else if (name === "layer") {
        for (const l of s.slice(6).split(",")) if (l.trim()) layers.add(l.trim());
      }
    };

    for (let i = 0; i < masked.length; i++) {
      const c = masked[i];
      if (c === "{") {
        const prelude = noComments.slice(start, i).trim().replace(/\s+/g, " ");
        const bare = masked.slice(start, i).trim().replace(/\s+/g, " ");
        /** @type {"rule" | "media" | "font-face" | "layer" | "other"} */
        let kind = "rule";
        if (/^@media\b/i.test(bare)) kind = "media";
        else if (/^@font-face\b/i.test(prelude)) kind = "font-face";
        else if (/^@layer\b/i.test(prelude)) {
          kind = "layer";
          const l = prelude.slice(6).trim();
          if (l) layers.add(l);
        } else if (prelude.startsWith("@")) kind = "other";
        if (kind === "rule") {
          for (const m of bare.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) classes.add(/** @type {string} */ (m[1]));
        }
        const up = stack[stack.length - 1];
        stack.push({
          prelude,
          kind,
          media: kind === "media" ? prelude.replace(/^@media\s*/i, "") : up ? up.media : null,
          rule: kind === "rule" || kind === "font-face" ? prelude : up ? up.rule : null,
          inFace: kind === "font-face" || (up ? up.inFace : false),
        });
        start = i + 1;
      } else if (c === "}") {
        statement(start, i);
        stack.pop();
        start = i + 1;
      } else if (c === ";") {
        statement(start, i);
        start = i + 1;
      }
    }
    statement(start, masked.length);
  } catch (e) {
    // total: keep what was found, and say so
    f.problems.push("the scan stopped early: " + (/** @type {Error} */ (e)?.message ?? String(e)));
  }
  f.uses = [...uses];
  f.classes = [...classes];
  f.imports = [...imports];
  f.fonts = [...fonts];
  f.fontFaces = [...faces];
  f.layers = [...layers];
  return f;
}
