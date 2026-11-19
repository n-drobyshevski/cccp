// Extracted from the author's production Apps Script apps; adapted.
// The html tagged template: every interpolation is escaped into SafeHtml. Literal template
// text is trusted markup; raw() is the one reviewed escape hatch.
// The literal parts are scanned once per call site (the result is memoised by the strings
// array) for the context of each interpolation, and a value that does not fit it throws:
//   text                 any plain value, escaped; an html template; raw(); attrs() and
//                        cssValue() output, which is inert there (so a fragment can carry it)
//   a quoted attribute   any plain value, escaped, or an html template; in a URL attribute (href,
//                        src, action...) the whole value, as the browser reads it, must pass the
//                        isSafeUrl rule; in style only a number, cssValue(), styleDecls() or an
//                        html template; in an on* handler or srcdoc nothing
//   inside a tag         attrs() (after a space), an html template, "", null or false: a plain
//                        string could add attributes such as onfocus
//   after "<" or "</"    only an html template; after a literal name start ("<h") also a whole
//                        number (a heading level), "", null or false
//   an unquoted value    nothing: wrap the attribute value in quotes
//   script or style text raw(), an html template or a number
//   textarea or title    any plain value, escaped, or an html template
//   anything else        nothing: a comment, a <! or <? declaration, xmp, iframe, noembed,
//                        noframes, noscript, and everything after plaintext or a CDATA section
// Every SafeHtml remembers its producer. An html template placed anywhere but text is not
// trusted as rendered: its literal parts are scanned again from the state of the hole it lands
// in, each of its values is checked against the context it really lands in (recursively), and
// it must end where it started (leave no quote, tag or comment open, close no tag). A template
// that ends inside a tag, a value, a comment or a raw-text element throws when it is made.
// html() must be called as a template tag: a plain array would mark any string as safe.

/* SafeHtml producers. */
const P_TPL = 1;
const P_ATTRS = 2;
const P_CSS = 3;
const P_RAW = 4;

class SafeHtml {
  /**
   * @param {string} s the markup
   * @param {number} p the producer: P_TPL, P_ATTRS, P_CSS or P_RAW
   * @param {ReadonlyArray<string> | null} t a template's strings array
   * @param {ReadonlyArray<unknown> | null} v a template's values
   * @param {string} e attrs(): the name of a trailing bare attribute, else ""
   */
  constructor(s, p, t, v, e) {
    this.s = s;
    this.p = p;
    this.t = t;
    this.v = v;
    this.e = e;
    Object.freeze(this);
  }
  toString() { return this.s; }
}

/** @type {Record<string, string>} */
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
// A backtick is not escaped: views always quote attribute values, and a literal backtick
// would trip the build guard that keeps the served bundle free of them.
const MARKUP = /[&<>"']/;
const MARKUP_ALL = /[&<>"']/g;

/**
 * Escape the five markup characters.
 * @param {unknown} v
 * @returns {string}
 */
export function escapeHtml(v) {
  const s = String(v);
  return MARKUP.test(s) ? s.replace(MARKUP_ALL, (c) => ESC[c]) : s;
}

/**
 * @param {unknown} v
 * @returns {v is SafeHtml}
 */
export function isSafe(v) {
  return v instanceof SafeHtml;
}

/**
 * Mark a string as already-safe markup. Needs review at every call site: put a comment next
 * to it saying why the string cannot carry user data. It goes only in text or in the text of a
 * script or style element; in a tag or an attribute value it throws.
 * @param {unknown} s
 * @returns {SafeHtml}
 */
export function raw(s) {
  return new SafeHtml(s == null ? "" : String(s), P_RAW, null, null, "");
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function render(v) {
  if (v == null || v === false) return "";
  if (v instanceof SafeHtml) return v.s;
  if (Array.isArray(v)) return v.map(render).join("");
  return escapeHtml(v);
}

const ATTR_NAME = /^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/;

const URL_ATTRS = ["href", "src", "action", "formaction", "xlink:href", "poster", "data"];

/* Interpolation contexts. */
const K_TEXT = 0;
const K_TAGNAME = 1;
const K_TAGNAME_NUM = 2;
const K_TAG = 3;
const K_VALUE = 4;
const K_RAWTEXT = 5;
const K_RCDATA = 6;
const K_BAD = 7;

/* Scanner states, after the HTML tokenizer. */
const S_TEXT = 0;
const S_TAGNAME = 1;
const S_TAG = 2; /* before an attribute name */
const S_ATTRNAME = 3;
const S_AFTERNAME = 4;
const S_BEFOREVALUE = 5;
const S_UNQUOTED = 6;
const S_QUOTED = 7;
const S_COMMENT = 8;
const S_BOGUS = 9; /* a <! or <? declaration or a bogus comment: ends at the first > */
const S_RAW = 10; /* script or style text */
const S_RCDATA = 11; /* textarea or title text */
const S_RAWOTHER = 12; /* xmp, iframe, noembed, noframes or noscript text */
const S_LOST = 13; /* after plaintext, a CDATA section or a script comment: the scanner cannot follow */

const RAWOTHER_TAGS = ["xmp", "iframe", "noembed", "noframes", "noscript"];

/**
 * A scanner state. `tag` is the current element name (lower case), `closing` whether it is an
 * end tag, `name` the current attribute name, `quote` the quote of an open value, `flag` (in
 * textarea or title) whether a literal "<" was seen, which the scanner cannot read in svg.
 * @typedef {{ st: number, tag: string, closing: boolean, name: string, quote: string, flag: boolean }} Work
 * @typedef {Work & { key: string }} State
 */

/**
 * The context of one interpolation. `s` is the scanner state at it. For a value: `a` the
 * attribute name, `url` and `css` its kind, `inh` whether the value was opened before this
 * template began (the enclosing template checks the URL), `first` whether no earlier
 * interpolation is in the same value, `pre` the literal value text before this one in its own
 * literal part, `tail` the literal value text after it up to the closing quote when the value
 * closes in the next part (else null). `conv` memoises which end states the text after the hole
 * brings back to this hole's state.
 * @typedef {{ s: State, k: number, a: string, url: boolean, css: boolean, inh: boolean, first: boolean, pre: string, tail: string | null, msg: string, conv: Map<string, { conv: boolean, end: State }> | null }} Hole
 * @typedef {{ holes: Hole[], end: State }} Scan
 */

/** @param {string} c */
const isSpace = (c) => c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f";
/** @param {string} c */
const isLetter = (c) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
/** @param {number} st */
const inTag = (st) => st === S_TAGNAME || st === S_TAG || st === S_ATTRNAME || st === S_AFTERNAME;

/** @param {Work} w @returns {string} */
function keyOf(w) {
  const st = w.st;
  if (st === S_TEXT || st === S_COMMENT || st === S_BOGUS || st === S_LOST) return String(st);
  if (st === S_RAW || st === S_RCDATA || st === S_RAWOTHER) return st + "|" + w.tag + "|" + (w.flag ? 1 : 0);
  const base = st + "|" + w.tag + "|" + (w.closing ? 1 : 0);
  if (st === S_TAGNAME || st === S_TAG) return base;
  return st === S_QUOTED ? base + "|" + w.name + "|" + w.quote : base + "|" + w.name;
}

/** @param {Work} w @returns {State} */
function snap(w) {
  return Object.freeze({ st: w.st, tag: w.tag, closing: w.closing, name: w.name, quote: w.quote, flag: w.flag, key: keyOf(w) });
}

/** @param {State} s @returns {Work} */
function work(s) {
  return { st: s.st, tag: s.tag, closing: s.closing, name: s.name, quote: s.quote, flag: s.flag };
}

const TEXT = snap({ st: S_TEXT, tag: "", closing: false, name: "", quote: "", flag: false });

/** The end of a start or end tag: which text follows it. @param {Work} w */
function closeTag(w) {
  const t = w.tag;
  w.flag = false;
  if (w.closing) w.st = S_TEXT;
  else if (t === "script" || t === "style") w.st = S_RAW;
  else if (t === "textarea" || t === "title") w.st = S_RCDATA;
  else if (RAWOTHER_TAGS.indexOf(t) >= 0) w.st = S_RAWOTHER;
  else if (t === "plaintext") w.st = S_LOST;
  else w.st = S_TEXT;
}

/**
 * One tokenizer step at s[i]: updates w and returns the next index (the same index when the
 * character is reconsumed in the new state).
 * @param {Work} w
 * @param {string} s
 * @param {number} i
 * @returns {number}
 */
function adv(w, s, i) {
  const c = s.charAt(i);
  switch (w.st) {
    case S_TEXT: {
      if (c !== "<") {
        const j = s.indexOf("<", i);
        return j < 0 ? s.length : j;
      }
      const n = s.charAt(i + 1);
      if (n === "" || isLetter(n)) { w.st = S_TAGNAME; w.tag = ""; w.closing = false; return i + 1; }
      if (n === "/") {
        const m = s.charAt(i + 2);
        if (m === "" || isLetter(m)) { w.st = S_TAGNAME; w.tag = ""; w.closing = true; return i + 2; }
        if (m === ">") return i + 3; /* "</>" is dropped */
        w.st = S_BOGUS;
        return i + 2;
      }
      if (n === "!") {
        if (s.startsWith("<!--", i)) {
          /* "<!-->" and "<!--->" are whole (empty) comments */
          const j = i + 4;
          if (s.charAt(j) === ">") return j + 1;
          if (s.startsWith("->", j)) return j + 2;
          w.st = S_COMMENT;
          return j;
        }
        /* A CDATA section is text in svg and a bogus comment in html: the scanner cannot know. */
        if (s.startsWith("<![CDATA[", i)) { w.st = S_LOST; return s.length; }
        w.st = S_BOGUS;
        return i + 2;
      }
      if (n === "?") { w.st = S_BOGUS; return i + 2; }
      return i + 1;
    }
    case S_TAGNAME:
      if (isSpace(c) || c === "/" || c === ">") { w.st = S_TAG; return i; }
      w.tag += c.toLowerCase();
      return i + 1;
    case S_TAG:
      if (c === ">") { closeTag(w); return i + 1; }
      if (isSpace(c) || c === "/") return i + 1;
      w.st = S_ATTRNAME;
      /* An = here is the first character of a name, as in the tokenizer, not a separator. */
      if (c === "=") { w.name = "="; return i + 1; }
      w.name = "";
      return i;
    case S_ATTRNAME:
      if (isSpace(c)) { w.st = S_AFTERNAME; return i + 1; }
      if (c === "/") { w.st = S_TAG; return i + 1; }
      if (c === ">") { closeTag(w); return i + 1; }
      if (c === "=") { w.st = S_BEFOREVALUE; return i + 1; }
      w.name += c.toLowerCase();
      return i + 1;
    case S_AFTERNAME:
      if (c === ">") { closeTag(w); return i + 1; }
      if (isSpace(c)) return i + 1;
      /* A slash ends the attribute: an = after it starts a new name. */
      if (c === "/") { w.st = S_TAG; return i + 1; }
      if (c === "=") { w.st = S_BEFOREVALUE; return i + 1; }
      w.st = S_ATTRNAME;
      w.name = "";
      return i;
    case S_BEFOREVALUE:
      if (isSpace(c)) return i + 1;
      if (c === '"' || c === "'") { w.st = S_QUOTED; w.quote = c; return i + 1; }
      if (c === ">") { closeTag(w); return i + 1; }
      w.st = S_UNQUOTED;
      return i;
    case S_UNQUOTED:
      if (isSpace(c)) { w.st = S_TAG; return i + 1; }
      if (c === ">") { closeTag(w); return i + 1; }
      return i + 1;
    case S_QUOTED: {
      const j = s.indexOf(w.quote, i);
      if (j < 0) return s.length;
      if (j > i) return j;
      w.st = S_TAG;
      return i + 1;
    }
    case S_COMMENT:
      if (s.startsWith("-->", i)) { w.st = S_TEXT; return i + 3; }
      if (s.startsWith("--!>", i)) { w.st = S_TEXT; return i + 4; }
      return i + 1;
    case S_BOGUS:
      if (c === ">") w.st = S_TEXT;
      return i + 1;
    case S_RAW:
    case S_RCDATA:
    case S_RAWOTHER: {
      if (c !== "<") return i + 1;
      const end = "</" + w.tag;
      if (s.slice(i, i + end.length).toLowerCase() === end) {
        const d = s.charAt(i + end.length);
        /* The end tag needs a delimiter after its name: "</scripts>" is still script text. */
        if (isSpace(d) || d === "/" || d === ">") { w.st = S_TAGNAME; w.closing = true; w.flag = false; return i + end.length; }
      }
      /* A script comment opens the escaped states, where "</script>" may not end the script. */
      if (w.st === S_RAW && w.tag === "script" && s.startsWith("<!--", i)) { w.st = S_LOST; return s.length; }
      w.flag = true;
      return i + 1;
    }
    default:
      return s.length;
  }
}

/**
 * Whether literal text s, in raw text, ends with part of the element's end tag, which the
 * next value could complete.
 * @param {Work} w
 * @param {string} s
 */
function cutsEndTag(w, s) {
  if (w.st !== S_RAW && w.st !== S_RCDATA && w.st !== S_RAWOTHER) return false;
  const j = s.lastIndexOf("<");
  if (j < 0) return false;
  const t = s.slice(j).toLowerCase();
  const end = "</" + w.tag;
  return t.length <= end.length && end.indexOf(t) === 0;
}

/**
 * The context kind of a state.
 * @param {Work} w
 * @returns {{ k: number, msg: string }}
 */
function classify(w) {
  switch (w.st) {
    case S_TEXT: return { k: K_TEXT, msg: "" };
    case S_TAGNAME: return { k: w.tag === "" ? K_TAGNAME : K_TAGNAME_NUM, msg: "" };
    case S_TAG:
    case S_ATTRNAME:
    case S_AFTERNAME: return { k: K_TAG, msg: "" };
    case S_BEFOREVALUE:
    case S_UNQUOTED: return { k: K_BAD, msg: "follows an = with no opening quote; wrap the attribute value in quotes" };
    case S_QUOTED:
      if (w.name.indexOf("on") === 0 || w.name === "srcdoc") {
        return { k: K_BAD, msg: "is inside a " + w.name + " attribute, which takes no interpolation (use delegate; srcdoc is a markup sink)" };
      }
      return { k: K_VALUE, msg: "" };
    case S_RAW: return { k: K_RAWTEXT, msg: "" };
    case S_RCDATA:
      if (w.flag) return { k: K_BAD, msg: "is inside a " + w.tag + " element after a literal <, which the scanner cannot follow (svg reads it as markup)" };
      return { k: K_RCDATA, msg: "" };
    case S_RAWOTHER: return { k: K_BAD, msg: "is inside a " + w.tag + " element, whose text the browser reads raw; nothing may go there" };
    case S_COMMENT: return { k: K_BAD, msg: "is inside a comment, which takes no interpolation" };
    case S_BOGUS: return { k: K_BAD, msg: "is inside a markup declaration or a processing instruction, which takes no interpolation" };
    default: return { k: K_BAD, msg: "follows a plaintext element, a CDATA section or a script comment, which the scanner cannot follow; nothing may go there" };
  }
}

/**
 * @param {State} s
 * @returns {Hole}
 */
function holeAt(s) {
  const c = classify(s);
  const h = { s, k: c.k, a: "", url: false, css: false, inh: false, first: false, pre: "", tail: null, msg: c.msg, conv: null };
  if (s.st === S_QUOTED && c.k === K_VALUE) {
    h.a = s.name;
    h.url = URL_ATTRS.indexOf(s.name) >= 0;
    h.css = s.name === "style";
    h.inh = true;
  }
  return h;
}

/**
 * Scan the literal parts once from a start state: the context of every interpolation, in order,
 * and the state at the end.
 * @param {ReadonlyArray<string>} strings
 * @param {State} start
 * @returns {Scan}
 */
function scan(strings, start) {
  /** @type {Hole[]} */
  const holes = [];
  const w = work(start);
  /** Value text seen so far in the current literal part, and whether a hole is already in it. */
  let valStart = 0;
  let valHoled = false;
  /* A value open at the start was opened by the enclosing template, which checks its URL. */
  let inh = w.st === S_QUOTED;
  /** @type {Hole | null} */
  let lastValueHole = null;

  for (let p = 0; p < strings.length; p++) {
    const s = strings[p];
    let i = 0;
    if (w.st === S_QUOTED) valStart = 0;
    while (i < s.length) {
      const was = w.st;
      const j = adv(w, s, i);
      if (was !== w.st) {
        if (w.st === S_QUOTED) { valStart = j; valHoled = false; lastValueHole = null; inh = false; }
        else if (was === S_QUOTED) {
          if (lastValueHole) lastValueHole.tail = s.slice(valStart, i);
          lastValueHole = null;
          inh = false;
        }
      }
      i = j;
    }
    const cut = cutsEndTag(w, s);
    if (p === strings.length - 1) {
      if (cut) w.st = S_LOST;
      break;
    }
    /* The hole after part p. */
    const c = classify(w);
    /** @type {Hole} */
    const h = { s: snap(w), k: c.k, a: "", url: false, css: false, inh: false, first: false, pre: "", tail: null, msg: c.msg, conv: null };
    if (cut) {
      h.k = K_BAD;
      h.msg = "follows part of a </" + w.tag + " end tag, which a value could complete; nothing may go there";
    } else if (w.st === S_QUOTED && h.k === K_VALUE) {
      h.a = w.name;
      h.url = URL_ATTRS.indexOf(w.name) >= 0;
      h.css = w.name === "style";
      h.inh = inh;
      h.first = !valHoled;
      h.pre = s.slice(valStart);
      valHoled = true;
      lastValueHole = h;
    }
    holes.push(h);
  }
  /* A value still open at the end is checked on what this template wrote of it (the template
     is refused anyway unless it began inside that value). */
  if (w.st === S_QUOTED && lastValueHole) lastValueHole.tail = strings[strings.length - 1].slice(valStart);
  return { holes, end: snap(w) };
}

/** @type {WeakMap<ReadonlyArray<string>, Scan>} */
const TEXT_SCANS = new WeakMap();
/** @type {WeakMap<ReadonlyArray<string>, Map<string, Scan>>} */
const SCANS = new WeakMap();
/** @type {Map<string, Hole>} */
const HOLES = new Map();
/** @type {Map<string, State>} */
const STATES = new Map();
/* The memo maps keyed by a state are capped: a state can carry an attribute name from attrs(). */
const MEMO_CAP = 512;

/**
 * Put a value in a capped memo map, emptying it first when it is full.
 * @template T
 * @param {Map<string, T>} m
 * @param {string} k
 * @param {T} v
 * @returns {T}
 */
function memo(m, k, v) {
  if (m.size >= MEMO_CAP) m.clear();
  m.set(k, v);
  return v;
}

/**
 * @param {ReadonlyArray<string>} strings
 * @param {State} start
 * @returns {Scan}
 */
function scanFrom(strings, start) {
  if (start === TEXT) {
    let t = TEXT_SCANS.get(strings);
    if (!t) { t = scan(strings, TEXT); TEXT_SCANS.set(strings, t); }
    return t;
  }
  let m = SCANS.get(strings);
  if (!m) { m = new Map(); SCANS.set(strings, m); }
  let sc = m.get(start.key);
  if (!sc) sc = memo(m, start.key, scan(strings, start));
  return sc;
}

/** The context of a state reached at run time (in a tag, after a value). @param {State} s */
function holeFor(s) {
  let h = HOLES.get(s.key);
  if (!h) h = memo(HOLES, s.key, holeAt(s));
  return h;
}

/**
 * The state after an attrs() list placed in state s.
 * @param {State} s
 * @param {string} e the trailing bare attribute name, or ""
 */
function afterAttrs(s, e) {
  const st = e ? S_ATTRNAME : S_TAG;
  if (s.st === st && (!e || s.name === e)) return s;
  const k = st + "|" + s.tag + "|" + (s.closing ? 1 : 0) + (e ? "|" + e : "");
  let r = STATES.get(k);
  if (!r) r = memo(STATES, k, snap({ st, tag: s.tag, closing: s.closing, name: e, quote: "", flag: false }));
  return r;
}

/**
 * Run the literal text s after a hole from both the hole's scanned state a and the real state
 * b that a value left. They converge when they meet at the same index in the same state outside
 * a quoted value: from there the rest of the template reads the same as scanned. Otherwise
 * `end` is the real state at the end of s.
 * @param {State} a
 * @param {State} b
 * @param {string} s
 * @returns {{ conv: boolean, end: State }}
 */
function converge(a, b, s) {
  const A = work(a);
  const B = work(b);
  let ia = 0;
  let ib = 0;
  for (;;) {
    if (ia === ib && A.st === B.st && A.st !== S_QUOTED && keyOf(A) === keyOf(B)) return { conv: true, end: b };
    if (ia <= ib) {
      if (ia >= s.length) break;
      ia = adv(A, s, ia);
    } else {
      ib = adv(B, s, ib);
    }
  }
  while (ib < s.length) ib = adv(B, s, ib);
  return { conv: false, end: snap(B) };
}

/**
 * converge(), memoised on the hole by the real state's key.
 * @param {Hole} h
 * @param {State} r
 * @param {string} s
 */
function follows(h, r, s) {
  let m = h.conv;
  if (!m) { m = new Map(); h.conv = m; }
  let c = m.get(r.key);
  if (c === undefined) c = memo(m, r.key, converge(h.s, r, s));
  return c;
}

/**
 * @param {number} i
 * @param {string} why
 */
function refuse(i, why) {
  return new TypeError("html: interpolation " + i + " " + why);
}

/** Where a hole is, for a message. @param {Hole} h */
function where(h) {
  switch (h.k) {
    case K_TEXT: return "text";
    case K_TAGNAME: return "tag-name position";
    case K_TAGNAME_NUM:
    case K_TAG: return "a tag";
    case K_VALUE: return "a " + h.a + " value";
    case K_RAWTEXT: return "a script or style element";
    case K_RCDATA: return "a textarea or title element";
    default: return "a place that takes nothing";
  }
}

/**
 * Check an html template placed in a hole that is not text: scan it again from the hole's
 * state, check its values where they really land, and require it to end where it started.
 * @param {SafeHtml} v
 * @param {State} s
 * @param {Hole} h
 * @param {number} i
 * @returns {State}
 */
function recheck(v, s, h, i) {
  const t = /** @type {ReadonlyArray<string>} */ (v.t);
  let r;
  try {
    r = fill(t, /** @type {ReadonlyArray<unknown>} */ (v.v), scanFrom(t, s));
  } catch (e) {
    throw refuse(i, "is an html template in " + where(h) + ", and in it " + String(/** @type {Error} */ (e).message).replace(/^html: /, ""));
  }
  if (r.key === s.key) return s;
  const ok = inTag(s.st) && inTag(r.st) && r.closing === s.closing && (s.tag === "" || r.tag === s.tag);
  if (!ok) throw refuse(i, "is an html template in " + where(h) + " that does not end where it starts (it leaves a quote, a tag, a comment or an element open, or closes the tag it is in)");
  return r;
}

/**
 * Check one value against the context it lands in.
 * @param {unknown} v
 * @param {State} s the state at the value
 * @param {Hole} h the context of s
 * @param {number} i
 * @returns {State} the state after the value (s itself when unchanged)
 */
function fit(v, s, h, i) {
  const k = h.k;
  if (k === K_BAD) throw refuse(i, h.msg);
  if (v instanceof SafeHtml) {
    switch (v.p) {
      case P_TPL:
        if (k === K_TEXT) return s;
        return recheck(v, s, h, i);
      case P_RAW:
        if (k === K_TEXT || k === K_RAWTEXT) return s;
        throw refuse(i, "is raw() markup in " + where(h) + "; raw() goes only in text or in script or style element text");
      case P_ATTRS:
        /* In text an attrs() list is inert (escaped values, checked names), so a template
           built in text to be placed in a tag may carry one; the tag it lands in checks it. */
        if (k === K_TEXT || (v.s === "" && (k === K_TAG || k === K_TAGNAME_NUM))) return s;
        if (k === K_TAG && (s.st === S_TAG || s.st === S_AFTERNAME)) return afterAttrs(s, v.e);
        if (k === K_TAG || k === K_TAGNAME_NUM) throw refuse(i, "is an attrs() list right after a name; put a space before it");
        throw refuse(i, "is an attrs() list in " + where(h) + "; attrs() goes only inside a tag");
      default:
        /* Likewise a CSS value holds no markup character, so a style fragment built in text
           may carry one; the style value it lands in checks it. */
        if (k === K_TEXT || (k === K_VALUE && h.css)) return s;
        throw refuse(i, "is a cssValue() or styleDecls() value in " + where(h) + "; it goes only in a style value");
    }
  }
  if (k === K_TAGNAME) throw refuse(i, "is in tag-name position; only an html template may go there");
  if (v == null || v === false) return s;
  if (Array.isArray(v)) {
    let cur = s;
    let ch = h;
    for (let j = 0; j < v.length; j++) {
      const r = fit(v[j], cur, ch, i);
      if (r !== cur) { cur = r; ch = holeFor(r); }
    }
    return cur;
  }
  switch (k) {
    case K_TEXT:
    case K_RCDATA:
      return s;
    case K_VALUE:
      if (h.css && v !== "" && !(typeof v === "number" && Number.isFinite(v))) throw refuse(i, "is a plain value inside style; pass a number, cssValue(value) or styleDecls({...})");
      return s;
    case K_TAG:
      if (v === "") return s;
      throw refuse(i, "is a plain value inside a tag; pass attrs({...}), an html template, \"\", null or false");
    case K_TAGNAME_NUM:
      if (v === "" || (typeof v === "number" && Number.isInteger(v) && v >= 0)) return s;
      throw refuse(i, "completes a tag name; only a whole number (such as a heading level) or an html template may go there");
    default:
      if (typeof v === "number" && Number.isFinite(v)) return s;
      throw refuse(i, "is inside a script or style element; only raw(), an html template or a number may go there");
  }
}

/* Character references the URL check reads: numeric ones and the five escapeHtml writes. */
const REF = /&(?:#[xX]([0-9a-fA-F]+);?|#([0-9]+);?|(amp|lt|gt|quot|apos);|[a-zA-Z][a-zA-Z0-9]*;?)/g;
/** @type {Record<string, string>} */
const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const UNREAD = "\uffff";

/** @param {number} n */
function codePoint(n) {
  if (!(n > 0 && n <= 0x10ffff) || (n >= 0xd800 && n <= 0xdfff)) return "\ufffd";
  return String.fromCodePoint(n);
}

/**
 * Whether an attribute value, as markup, is a safe URL once the browser has decoded it. A
 * named character reference the check does not read, before the query or fragment, refuses.
 * @param {string} m
 */
function urlOk(m) {
  const t = m.indexOf("&") < 0 ? m : m.replace(REF, (all, hex, dec, name) => {
    if (hex) return codePoint(parseInt(hex, 16));
    if (dec) return codePoint(parseInt(dec, 10));
    if (name) return NAMED[name];
    return UNREAD;
  });
  const u = t.indexOf(UNREAD);
  if (u >= 0) {
    const q = t.search(/[?#]/);
    if (q < 0 || u < q) return false;
  }
  return safeUrl(t);
}

/**
 * Check every value of a template against its scan and return the state at its end.
 * @param {ReadonlyArray<string>} strings
 * @param {ReadonlyArray<unknown>} values
 * @param {Scan} sc
 * @returns {State}
 */
function fill(strings, values, sc) {
  const holes = sc.holes;
  /** The real state at the next hole, when a value left the scanner in a state that the text
      after it did not bring back to the scanned one (only ever inside a tag). */
  /** @type {State | null} */
  let carry = null;
  let end = sc.end;
  let url = "";
  for (let i = 0; i < values.length; i++) {
    const rec = holes[i];
    const s = carry || rec.s;
    const h = carry ? holeFor(carry) : rec;
    const v = values[i];
    const r = fit(v, s, h, i);
    if (h.url && !h.inh) {
      if (h.first) url = "";
      url += h.pre + render(v);
      if (h.tail !== null && !urlOk(url + h.tail)) throw refuse(i, "makes an unsafe URL in " + h.a + " (only http, https, mailto and relative URLs pass)");
    }
    if (r === rec.s || r.key === rec.s.key) { carry = null; continue; }
    const c = follows(rec, r, strings[i + 1]);
    if (c.conv) { carry = null; continue; }
    if (i + 1 === values.length) { end = c.end; continue; }
    /* The next hole is checked in the real state, which must still be inside the tag. */
    if (!inTag(c.end.st)) throw refuse(i, "leaves the scanner in a state the template text after it does not undo (" + where(h) + ")");
    carry = c.end;
  }
  return end;
}

/** Where a template ends, for a message. @param {State} e */
function endsIn(e) {
  if (inTag(e.st) || e.st === S_BEFOREVALUE || e.st === S_UNQUOTED) return "inside a tag";
  if (e.st === S_QUOTED) return "inside a quoted " + e.name + " value";
  if (e.st === S_COMMENT || e.st === S_BOGUS) return "inside a comment or declaration";
  if (e.st === S_LOST) return "where the scanner cannot follow";
  return "inside a " + e.tag + " element";
}

/**
 * The template tag. Interpolated strings and numbers are escaped, SafeHtml passes through,
 * arrays are joined, null and false render nothing. A value that does not fit its context
 * throws a TypeError (see the table at the top of this file), and so does a template that
 * ends inside a tag, a value, a comment or a raw-text element.
 * @param {TemplateStringsArray} strings
 * @param {...unknown} values
 * @returns {SafeHtml}
 */
export function html(strings, ...values) {
  if (!Array.isArray(strings) || !Object.isFrozen(strings) || !Array.isArray(/** @type {any} */ (strings).raw)) {
    throw new TypeError("html: call it as a template tag, never with a plain array; use raw() for reviewed markup");
  }
  let sc = TEXT_SCANS.get(strings);
  if (!sc) { sc = scan(strings, TEXT); TEXT_SCANS.set(strings, sc); }
  const end = fill(strings, values, sc);
  if (end !== TEXT && end.st !== S_TEXT) {
    throw new TypeError("html: the template ends " + endsIn(end) + "; a template must leave every tag, quote and comment it opens closed");
  }
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new SafeHtml(out, P_TPL, strings, values, "");
}

/* A conservative CSS value: words, numbers, units, #hex, var(--x), calc() and commas; no
   quotes, colons, semicolons, braces, slashes, backslashes or !important, so it cannot end the
   declaration, open a comment or escape a character. */
const CSS_VALUE = /^[-\w#%.,()+* ]*$/;
const CSS_FETCH = /(?:url|src|image(?:-set)?|element|cross-fade|paint|expression)\s*\(/i;
/* A CSS property name: a custom property or a (possibly vendor-prefixed) standard name. */
const CSS_PROP = /^(?:--[a-zA-Z0-9_-]+|-?[a-zA-Z][a-zA-Z0-9-]*)$/;

/**
 * A value for a style attribute, as SafeHtml: a finite number, or a string of words, numbers,
 * units, #hex, var(--x), calc(...) and commas. Anything else throws a TypeError, including a
 * url(...) or image(...) function (a fetch), a quote, colon, semicolon, slash, backslash or
 * brace (a new declaration, comment or escape) and !important.
 * style="--c:${cssValue(color)}" is the form html() accepts for a string in style.
 * @param {unknown} v
 * @returns {SafeHtml}
 */
export function cssValue(v) {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new TypeError("cssValue: not a finite number");
    return new SafeHtml(String(v), P_CSS, null, null, "");
  }
  if (typeof v !== "string") throw new TypeError("cssValue: expected a string or a number");
  if (!CSS_VALUE.test(v) || CSS_FETCH.test(v)) throw new TypeError("cssValue: unsafe CSS value " + JSON.stringify(v.slice(0, 40)));
  return new SafeHtml(v, P_CSS, null, null, "");
}

/**
 * A declaration list for a style attribute, as SafeHtml: each name must be a CSS property
 * name (a custom property such as --gk-pct, or a standard name), and each value goes through
 * cssValue(); null, undefined and false omit the declaration. For attrs({ style }) or
 * style="${...}": styleDecls({ "--gk-pct": 40, width: "12rem" }) gives --gk-pct:40;width:12rem.
 * @param {Record<string, unknown> | null | undefined} obj
 * @returns {SafeHtml}
 */
export function styleDecls(obj) {
  /** @type {string[]} */
  const out = [];
  for (const name of Object.keys(obj || {})) {
    if (!CSS_PROP.test(name)) throw new TypeError("styleDecls: invalid property name " + JSON.stringify(name.slice(0, 40)));
    const v = /** @type {any} */ (obj)[name];
    if (v == null || v === false) continue;
    out.push(name + ":" + cssValue(v).s);
  }
  return new SafeHtml(out.join(";"), P_CSS, null, null, "");
}

/** Allow http(s), mailto, and scheme-less (relative, fragment) URLs only; a leading double
 * slash or any leading backslash is refused. This is the rule attrs() applies to URL attributes;
 * a view that would rather drop a bad link than throw tests it first with isSafeUrl.
 * @param {unknown} u
 * @returns {boolean} */
export function isSafeUrl(u) {
  if (u == null || u === "") return false;
  return safeUrl(String(u));
}

/** @param {string} u */
function safeUrl(u) {
  const t = u.replace(/[\u0000- \u007f-\u009f]/g, "");
  /* A protocol-relative or backslash-led value navigates to a foreign host (browsers read a
     backslash as a slash), so it is not relative. */
  if (/^[/\\]{2}/.test(t) || t.charAt(0) === "\\") return false;
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(t);
  return !m || /^(https?|mailto)$/i.test(m[1]);
}

/**
 * The attributes of a link, for attrs(). The app runs in a sandboxed frame whose page sets
 * <base target="_top">, so every link names its own target:
 * - a fragment (hash) URL such as "#/item/1" gets target "_self": it stays in the frame, where
 *   the hash router hears hashchange. Under the base target it would load the frame's own
 *   document URL into the top window instead (a blank page, or nothing);
 * - an absolute (http, https) or mailto URL opens in the top window (target "_top") by default,
 *   or in a new tab with { newTab: true }, and always carries rel "noopener noreferrer";
 * - any other relative URL is { href } alone.
 * An unsafe URL throws a TypeError, as attrs() would: test it with isSafeUrl first to drop it
 * instead.
 * @param {unknown} href
 * @param {{ newTab?: boolean }} [opts]
 * @returns {{ href: string, target?: string, rel?: string }}
 */
export function linkAttrs(href, opts) {
  if (!isSafeUrl(href)) throw new TypeError("linkAttrs: unsafe URL");
  const h = String(href);
  const bare = h.replace(/[\u0000- \u007f-\u009f]/g, "");
  if (bare.charAt(0) === "#") return { href: h, target: "_self" };
  if (!/^([a-zA-Z][a-zA-Z0-9+.-]*):/.test(bare)) return { href: h };
  return { href: h, target: opts && opts.newTab ? "_blank" : "_top", rel: "noopener noreferrer" };
}

/**
 * An attribute list as SafeHtml, for use inside a tag of an html template (only there).
 * A value of true gives a bare attribute; false, null and undefined omit it; anything else is
 * escaped. URL-bearing names (href, src, action...) accept only http(s), mailto or relative
 * values; style accepts only a finite number, cssValue() or styleDecls(), never a string.
 * Names are validated, and an inline handler (on...), a title attribute or srcdoc throws,
 * because the kit forbids both (use delegate and data-tip).
 * @param {Record<string, unknown> | null | undefined} obj
 * @returns {SafeHtml}
 */
export function attrs(obj) {
  /** @type {string[]} */
  const out = [];
  let bare = "";
  for (const name of Object.keys(obj || {})) {
    if (!ATTR_NAME.test(name)) throw new TypeError("attrs: invalid attribute name " + JSON.stringify(name));
    const lower = name.toLowerCase();
    if (lower.indexOf("on") === 0 || lower === "title" || lower === "srcdoc") {
      throw new TypeError("attrs: " + name + " is banned (use delegate or data-tip; srcdoc is a markup sink)");
    }
    const v = /** @type {any} */ (obj)[name];
    if (v == null || v === false) continue;
    if (URL_ATTRS.indexOf(lower) >= 0 && v !== true && !safeUrl(String(v))) {
      throw new TypeError("attrs: unsafe URL in " + name);
    }
    if (lower === "style" && !(typeof v === "number" && Number.isFinite(v)) && !(v instanceof SafeHtml && v.p === P_CSS)) {
      throw new TypeError("attrs: " + name + " takes a finite number, cssValue() or styleDecls({...}), never a string");
    }
    out.push(v === true ? name : name + '="' + escapeHtml(v) + '"');
    bare = v === true ? lower : "";
  }
  return new SafeHtml(out.join(" "), P_ATTRS, null, null, bare);
}
