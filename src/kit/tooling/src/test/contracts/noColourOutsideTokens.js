// Extracted from the author's production Apps Script apps; adapted.
// No colour literal (hex, colour function, named colour) outside the token files, in CSS
// declarations or in the CSS-like strings of browser code. Comments, quoted strings and the
// whole of url() are ignored in CSS, so a data URI or a quoted url("a)b") hides nothing and
// shows nothing.
//
// Policy for colour mixing: color-mix() and light-dark() whose colour arguments are all var(--x)
// tokens (without a fallback literal) are allowed, since they derive a colour from the palette
// without adding one; pass tokenMixes: false to ban them outside the token files as well. A
// literal inside them, or a var() fallback such as var(--a, #fff), is still flagged.
// Known limit of the JS scan: a whole-hex string is read as a colour, except after a hash or href
// comparison or assignment (location.hash === '#add'); other hash routes need an allow entry.
import { isAllowed, lineOf, read, stripComments, wire } from "./_util.js";

// Deliberately not flagged: transparent, currentColor (no palette value) and the CSS system
// colours (Canvas, LinkText, ...), which follow forced-colours settings on purpose.
const NAMED = "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen".split(" ");

const NAMED_RE = new RegExp("(?<![\\w-])(?:" + NAMED.join("|") + ")(?![\\w-])", "i");
const HEX_RE = /#[0-9a-f]{3,8}\b/i;
const FUNC_RE = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark|device-cmyk|cmyk)\(/i;

/**
 * One pass over CSS text that removes block comments, quoted strings (kept as "") and url(...)
 * (kept as url()). url() is read quote-aware, so url("a)b") ends at its real close paren; an
 * unquoted url ends at the first ")". Newlines inside what it removes are kept.
 * @param {string} css
 */
export function scrubCss(css) {
  let out = "";
  let i = 0;
  const keepNl = (/** @type {string} */ s) => s.replace(/[^\n]/g, "");
  while (i < css.length) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      const stop = end < 0 ? css.length : end + 2;
      out += keepNl(css.slice(i, stop));
      i = stop;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c) j += css[j] === "\\" ? 2 : 1;
      out += '""' + keepNl(css.slice(i, j + 1));
      i = j + 1;
    } else if ((c === "u" || c === "U") && /^url\(/i.test(css.slice(i, i + 4)) && !/[\w-]/.test(css[i - 1] || "")) {
      let j = i + 4;
      while (j < css.length && /\s/.test(css[j])) j++;
      if (css[j] === '"' || css[j] === "'") {
        const q = css[j];
        j++;
        while (j < css.length && css[j] !== q) j += css[j] === "\\" ? 2 : 1;
        j++;
      }
      while (j < css.length && css[j] !== ")") j++;
      out += "url()" + keepNl(css.slice(i, j + 1));
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const MIX_RE = /(?<![\w-])(?:color-mix|light-dark)\(/gi;
const MIX_FILLER = /\bin\s+[\w-]+|\b(?:shorter|longer|increasing|decreasing)\s+hue\b|[\d.]+%?|,|\btransparent\b|\bcurrentcolor\b/gi;

/** Index of the paren that closes the one at open, or -1. @param {string} s @param {number} open */
function closeParen(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

/**
 * A value with every token-only color-mix() / light-dark() call removed.
 * @param {string} v
 * @returns {string}
 */
export function withoutTokenMixes(v) {
  let out = "";
  let i = 0;
  MIX_RE.lastIndex = 0;
  for (let m = MIX_RE.exec(v); m; m = MIX_RE.exec(v)) {
    const open = m.index + m[0].length - 1;
    const close = closeParen(v, open);
    if (close < 0) break;
    const inner = withoutTokenMixes(v.slice(open + 1, close));
    const tokenOnly = !inner.replace(/var\(\s*--[\w-]+\s*\)/g, "").replace(MIX_FILLER, "").trim();
    out += v.slice(i, m.index) + (tokenOnly ? "" : v.slice(m.index, close + 1));
    i = close + 1;
    MIX_RE.lastIndex = i;
  }
  return out + v.slice(i);
}

/**
 * Colour literals in the declaration values of a CSS text (custom properties included).
 * @param {string} css @param {{ tokenMixes?: boolean }} [o] tokenMixes (default true): allow
 *   color-mix() and light-dark() built only from var(--x) tokens
 * @returns {{ line: number, text: string }[]}
 */
export function findColourLiterals(css, { tokenMixes = true } = {}) {
  const src = scrubCss(css);
  /** @type {{ line: number, text: string }[]} */ const hits = [];
  // prop: value, ended by ; or } (a selector ends in "{" and never matches)
  for (const m of src.matchAll(/([\w-]+)\s*:\s*([^;{}]*)(?=[;}])/g)) {
    const raw = tokenMixes ? withoutTokenMixes(m[2]) : m[2];
    const v = raw.replace(/var\(\s*--[\w-]+/g, "var(");
    if (HEX_RE.test(v) || FUNC_RE.test(v) || NAMED_RE.test(v)) hits.push({ line: lineOf(src, m.index), text: m[1] + ": " + m[2].trim() });
  }
  return hits;
}

const CSS_PROP = "color|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left))?(?:-color)?|outline(?:-color)?|fill|stroke|box-shadow|text-shadow|accent-color|caret-color|stop-color|flood-color";

const HEX = "#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![\\w-])";
// A hex inside a longer string counts after a colour-bearing declaration ("color: #fff", also a
// custom property) or an attribute value (fill="#fff"); a bare "#add li" or "#a, #cafe" selector
// does not.
const HEX_IN_DECL = new RegExp("(?:" + CSS_PROP + "|--[\\w-]+)\\s*:[^;]*?(?<![\\w&])" + HEX, "i");
const HEX_IN_ATTR = new RegExp("=\\s*(?:\\\\?[\"'])?" + HEX, "i");
const WHOLE_HEX = new RegExp("^" + HEX + "$", "i");
const WHOLE_NAMED = new RegExp("^(?:" + NAMED.join("|") + ")$", "i");
// The code just before a string that names a colour-bearing property: fill: 'x', color = 'x',
// setAttribute('stroke', 'x').
const COLOUR_CTX = new RegExp("(?:" + CSS_PROP + "|[a-z]Color)[\"']?\\s*[,=:(]\\s*$", "i");
// A string that is the first argument of a call (querySelector('#cafe'), $('#add')) is taken as
// an id selector unless the call is colour-bearing (fill('#abc')).
// A hash route compared or assigned: location.hash === '#add', hash = '#feed'.
const HASH_CTX = /(?:\.hash|\bhash|\.href)\s*(?:[!=]==?|=)\s*$/;
const CALL_CTX = /[\w$]\s*\(\s*$/;

/**
 * Colour literals inside the string literals of browser JS (inline styles, SVG attributes).
 * Inside a longer string a hex counts after a colour property or an attribute equals sign, and a
 * named colour only after a colour-bearing property and a colon, so a selector such as "#add li"
 * or a plain "red" or "white" key does not. A string that is a whole hex or a whole colour name
 * counts when it follows a colour-bearing property or call (el.style.color = 'red',
 * setAttribute('stroke', '#abc')) or, for a hex, anything but the first argument of a call, so a
 * palette array is caught and querySelector('#cafe') is not (a hex colour passed as the first
 * argument of an unrelated function is missed on purpose).
 * @param {string} js @param {{ tokenMixes?: boolean }} [o] as for findColourLiterals
 * @returns {{ line: number, text: string }[]}
 */
export function findJsColourLiterals(js, { tokenMixes = true } = {}) {
  const src = stripComments(js);
  /** @type {{ line: number, text: string }[]} */ const hits = [];
  const strRe = new RegExp("\"(?:[^\"\\\\\\n]|\\\\.)*\"|'(?:[^'\\\\\\n]|\\\\.)*'|\\x60(?:[^\\x60\\\\]|\\\\.)*\\x60", "g");
  const namedAfterProp = new RegExp("(?:^|[;\\s\"'{])(?:" + CSS_PROP + ")\\s*:\\s*[^;]*?(?<![\\w-])(?:" + NAMED.join("|") + ")(?![\\w-])", "i");
  for (const m of src.matchAll(strRe)) {
    const raw = m[0].slice(1, -1);
    const before = src.slice(Math.max(0, m.index - 80), m.index);
    let hit = false;
    if (WHOLE_HEX.test(raw)) hit = COLOUR_CTX.test(before) || !(CALL_CTX.test(before) || HASH_CTX.test(before));
    else if (WHOLE_NAMED.test(raw)) hit = COLOUR_CTX.test(before);
    else {
      const body = scrubCss(raw);
      const v = (tokenMixes ? withoutTokenMixes(body) : body).replace(/&#\w+;/g, "").replace(/var\(\s*--[\w-]+/g, "var(");
      hit = HEX_IN_DECL.test(v) || HEX_IN_ATTR.test(raw.replace(/&#\w+;/g, "")) || FUNC_RE.test(v) || namedAfterProp.test(v);
    }
    if (hit) hits.push({ line: lineOf(src, m.index), text: m[0].slice(0, 60) });
  }
  return hits;
}

/**
 * @param {{ cssFiles?: string[], jsFiles?: string[], allow?: string[], tokenMixes?: boolean }} opts
 *   tokenMixes (default true): allow color-mix() and light-dark() built only from var(--x) tokens. allow: the token
 *   files (relative-path suffix, file name or exact path) where colours are defined
 * @returns {string[]} violations
 */
export function check({ cssFiles = [], jsFiles = [], allow = [], tokenMixes = true }) {
  /** @type {string[]} */ const bad = [];
  const ok = (/** @type {string} */ f) => isAllowed(f.split("\\").join("/"), allow);
  for (const f of cssFiles) if (!ok(f)) for (const h of findColourLiterals(read(f), { tokenMixes })) bad.push(f + ":" + h.line + " colour literal outside tokens: " + h.text);
  for (const f of jsFiles) if (!ok(f)) for (const h of findJsColourLiterals(read(f), { tokenMixes })) bad.push(f + ":" + h.line + " colour literal in a string: " + h.text);
  return bad;
}

/** @param {any} describe @param {any} it @param {any} expect @param {Parameters<typeof check>[0]} opts */
export function register(describe, it, expect, opts) {
  wire(describe, it, expect, "no colour outside tokens", () => check(opts));
}
