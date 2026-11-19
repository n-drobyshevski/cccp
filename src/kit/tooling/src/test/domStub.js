// Extracted from the author's production Apps Script apps; adapted.
// A minimal DOM for client tests, without jsdom. It is NOT a browser: no layout, no CSS, no
// real focus model. It covers what the client kernel touches, and no more:
//  - elements and text nodes, attributes, className and classList, hidden, style
//  - the innerHTML setter parses simple markup (tags, quoted or bare attributes, void
//    elements, entities, comments skipped); the getter serializes
//  - querySelector(All), closest, matches for tag, #id, .class, [attr], [attr=value],
//    compound selectors, comma lists, descendant and child combinators
//  - focus() and blur() with activeElement and focusin/focusout events; replacing a subtree
//    that holds the active element drops focus to the body, as a browser does
//  - scrollTop and scrollLeft as plain numbers (a freshly parsed element starts at 0)
//  - checked from the checked attribute; a select takes the value of its selected option, else the first
//  - selectionStart, selectionEnd and setSelectionRange on input and textarea
//  - animate() and getAnimations() on elements (a recorded stand-in that finishes on a microtask)
//  - events: addEventListener, removeEventListener, dispatchEvent with bubbling to the document
//    and then the window, click(), preventDefault, stopPropagation
//  - rect and size fields that tests set by hand: getBoundingClientRect, offsetWidth, offsetHeight,
//    documentElement.clientWidth and clientHeight
//  - a window with location.hash, matchMedia (driven by window.reducedMotion), requestAnimationFrame and listeners, and installDom() to put the
//    document and window on globalThis for the code under test.

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "wbr"]);
const TEXTY = new Set(["input", "textarea"]);
const ENT = /** @type {Record<string, string>} */ ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " });

/** @param {string} s */
const decode = (s) => s.replace(/&(amp|lt|gt|quot|nbsp|#39);/g, (m) => ENT[m] || m);
/** @param {string} s */
const escText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** @param {string} s */
const escAttr = (s) => escText(s).replace(/"/g, "&quot;");

export class StubEvent {
  /**
   * @param {string} type
   * @param {Record<string, any>} [init]
   */
  constructor(type, init) {
    this.type = type;
    this.bubbles = true;
    /** @type {any} */
    this.target = null;
    /** @type {any} */
    this.currentTarget = null;
    this.defaultPrevented = false;
    this.cancelBubble = false;
    Object.assign(this, init || {});
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.cancelBubble = true; }
}

/** An event target with listeners. */
class Target {
  constructor() {
    /** @type {Map<string, Array<{ fn: any, once: boolean }>>} */
    this._l = new Map();
  }
  /**
   * @param {string} type
   * @param {any} fn
   * @param {any} [opts]
   */
  addEventListener(type, fn, opts) {
    const list = this._l.get(type) || [];
    if (!list.some((x) => x.fn === fn)) list.push({ fn, once: !!(opts && typeof opts === "object" && opts.once) });
    this._l.set(type, list);
  }
  /** @param {string} type @param {any} fn */
  removeEventListener(type, fn) {
    const list = this._l.get(type);
    if (list) this._l.set(type, list.filter((x) => x.fn !== fn));
  }
  /** @param {StubEvent} ev */
  _fire(ev) {
    ev.currentTarget = this;
    for (const x of (this._l.get(ev.type) || []).slice()) {
      if (x.once) this.removeEventListener(ev.type, x.fn);
      x.fn.call(this, ev);
    }
  }
  /** Number of listeners of a type, for tests that check cleanup. @param {string} type */
  listenerCount(type) { return (this._l.get(type) || []).length; }
}

/** @param {StubNode | null} n */
function isEl(n) { return !!n && n.nodeType === 1; }

class StubNode extends Target {
  /** @param {StubDocument | null} doc @param {number} nodeType */
  constructor(doc, nodeType) {
    super();
    this.ownerDocument = /** @type {StubDocument} */ (doc);
    this.nodeType = nodeType;
    /** @type {StubNode | null} */
    this.parentNode = null;
    /** @type {StubNode[]} */
    this.childNodes = [];
  }
  /** @returns {StubNode | null} */
  get parentElement() { return isEl(this.parentNode) ? this.parentNode : null; }
  get children() { return this.childNodes.filter(isEl); }
  get firstChild() { return this.childNodes[0] || null; }
  /** @param {StubNode} n */
  appendChild(n) {
    if (n.parentNode) n.parentNode.removeChild(n);
    n.parentNode = this;
    this.childNodes.push(n);
    return n;
  }
  /** @param {StubNode} n */
  removeChild(n) {
    const i = this.childNodes.indexOf(n);
    if (i < 0) throw new Error("removeChild: not a child");
    this.childNodes.splice(i, 1);
    n.parentNode = null;
    this._dropFocusIn(n);
    return n;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  /** @returns {boolean} true while the node is attached under its document */
  get isConnected() {
    let x = /** @type {StubNode | null} */ (this);
    while (x && x.parentNode) x = x.parentNode;
    return !!x && x === /** @type {any} */ (this.ownerDocument || null) || (!!x && x.nodeType === 9);
  }
  /** @param {StubNode | null} n */
  contains(n) {
    for (let x = n; x; x = x.parentNode) if (x === this) return true;
    return false;
  }
  /** @param {StubNode} removed */
  _dropFocusIn(removed) {
    const doc = this.ownerDocument;
    if (doc && doc.activeElement && removed.contains(doc.activeElement)) doc._active = null;
  }
  /** @returns {string} */
  get textContent() {
    return this.nodeType === 3 ? /** @type {any} */ (this).data : this.childNodes.map((/** @type {StubNode} */ c) => /** @type {string} */ (c.textContent)).join("");
  }
  set textContent(v) {
    for (const c of this.childNodes.slice()) this.removeChild(c);
    if (v !== "" && v != null) this.appendChild(new StubText(this.ownerDocument, String(v)));
  }
}

class StubText extends StubNode {
  /** @param {StubDocument | null} doc @param {string} data */
  constructor(doc, data) {
    super(doc, 3);
    this.data = data;
  }
}

/**
 * @typedef {{ tag: string | null, id: string | null, classes: string[], attrs: Array<{ name: string, op: string | null, value: string | null }> }} Compound
 */

/**
 * @param {string} sel
 * @returns {Array<Array<{ comb: string, c: Compound }>>}
 */
function parseSelector(sel) {
  /** @type {string[]} */
  const alts = [];
  let depth = 0;
  let quote = "";
  let esc = false;
  let cur = "";
  for (const ch of sel) {
    if (quote) {
      if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === quote) quote = "";
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === "[") depth++;
    if (ch === "]") depth--;
    if (ch === "," && depth === 0) { alts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  alts.push(cur);
  return alts.map((a) => parseComplex(a.trim()));
}

/** @param {string} s */
function parseComplex(s) {
  /** @type {Array<{ comb: string, c: Compound }>} */
  const out = [];
  let i = 0;
  let comb = " ";
  while (i < s.length) {
    while (s[i] === " ") i++;
    if (s[i] === ">") { comb = ">"; i++; continue; }
    /** @type {Compound} */
    const c = { tag: null, id: null, classes: [], attrs: [] };
    let any = false;
    while (i < s.length && s[i] !== " " && s[i] !== ">") {
      const ch = s[i];
      if (ch === "#" || ch === ".") {
        let j = i + 1;
        while (j < s.length && /[-\w]/.test(s[j])) j++;
        const name = s.slice(i + 1, j);
        if (ch === "#") c.id = name; else c.classes.push(name);
        i = j;
      } else if (ch === "[") {
        let j = i + 1;
        let q = "";
        while (j < s.length && (q || s[j] !== "]")) {
          if (q) { if (s[j] === "\\") j++; else if (s[j] === q) q = ""; } else if (s[j] === '"' || s[j] === "'") q = s[j];
          j++;
        }
        const body = s.slice(i + 1, j);
        const m = /^([-\w:]+)\s*(?:(=)\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^\s\]]*)))?$/.exec(body);
        if (!m) throw new Error("domStub: unsupported selector part [" + body + "]");
        const v = m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5];
        c.attrs.push({ name: m[1], op: m[2] || null, value: v === undefined ? null : v.replace(/\\(.)/g, "$1") });
        i = j + 1;
      } else if (/[-\w*]/.test(ch)) {
        let j = i;
        while (j < s.length && /[-\w*]/.test(s[j])) j++;
        c.tag = s.slice(i, j).toLowerCase();
        i = j;
      } else throw new Error("domStub: unsupported selector " + s);
      any = true;
    }
    if (any) { out.push({ comb, c }); comb = " "; }
  }
  return out;
}

/** @param {StubElement} el @param {Compound} c */
function matchCompound(el, c) {
  if (c.tag && c.tag !== "*" && c.tag !== el.tagName.toLowerCase()) return false;
  if (c.id && el.id !== c.id) return false;
  for (const k of c.classes) if (!el.classList.contains(k)) return false;
  for (const a of c.attrs) {
    if (!el.hasAttribute(a.name)) return false;
    if (a.op === "=" && el.getAttribute(a.name) !== a.value) return false;
  }
  return true;
}

/** @param {StubElement} el @param {Array<{ comb: string, c: Compound }>} chain @param {number} idx @returns {boolean} */
function matchChain(el, chain, idx) {
  const link = chain[idx];
  if (!matchCompound(el, link.c)) return false;
  if (idx === 0) return true;
  if (link.comb === ">") {
    const p = el.parentNode;
    return isEl(p) && matchChain(/** @type {StubElement} */ (p), chain, idx - 1);
  }
  for (let p = el.parentNode; isEl(p); p = /** @type {StubNode} */ (p).parentNode) {
    if (matchChain(/** @type {StubElement} */ (p), chain, idx - 1)) return true;
  }
  return false;
}

export class StubElement extends StubNode {
  /** @param {StubDocument | null} doc @param {string} tag */
  constructor(doc, tag) {
    super(doc, 1);
    this.tagName = tag.toUpperCase();
    /** @type {Map<string, string>} */
    this._attrs = new Map();
    this.scrollTop = 0;
    this.scrollLeft = 0;
    /** @type {any[]} every animation started with animate(), for tests */
    this._anims = [];
    /** @type {{ left: number, right: number, top: number, bottom: number, width: number, height: number }} */
    this.rect = { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
    this.offsetWidth = 0;
    this.offsetHeight = 0;
    this.clientWidth = 0;
    this.clientHeight = 0;
    this.hidden = false;
    this.value = "";
    this.checked = false;
    /** @type {number | null} */
    this.selectionStart = TEXTY.has(tag.toLowerCase()) ? 0 : null;
    /** @type {number | null} */
    this.selectionEnd = this.selectionStart;
    /** @type {Record<string, string> & { setProperty: (k: string, v: string) => void, removeProperty: (k: string) => void }} */
    this.style = /** @type {any} */ ({
      setProperty(/** @type {string} */ k, /** @type {string} */ v) { this[k] = v; },
      removeProperty(/** @type {string} */ k) { delete this[k]; },
    });
    const self = this;
    this.classList = {
      /** @param {string} c */
      contains: (c) => self.className.split(/\s+/).indexOf(c) >= 0,
      /** @param {string} c */
      add(c) { if (!this.contains(c)) self.className = (self.className + " " + c).trim(); },
      /** @param {string} c */
      remove(c) { self.className = self.className.split(/\s+/).filter((x) => x && x !== c).join(" "); },
      /** @param {string} c */
      toggle(c) { if (this.contains(c)) this.remove(c); else this.add(c); },
    };
  }
  get id() { return this.getAttribute("id") || ""; }
  set id(v) { this.setAttribute("id", v); }
  get className() { return this.getAttribute("class") || ""; }
  set className(v) { this.setAttribute("class", v); }
  /** @param {string} n */
  getAttribute(n) { return this._attrs.has(n) ? /** @type {string} */ (this._attrs.get(n)) : null; }
  /** @param {string} n @param {unknown} v */
  setAttribute(n, v) { this._attrs.set(n, String(v)); }
  /** @param {string} n */
  removeAttribute(n) { this._attrs.delete(n); }
  /** @param {string} n */
  hasAttribute(n) { return this._attrs.has(n); }
  get dataset() {
    /** @type {Record<string, string>} */
    const out = {};
    for (const [k, v] of this._attrs) {
      if (k.indexOf("data-") === 0) out[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v;
    }
    return out;
  }
  getBoundingClientRect() { return this.rect; }
  /** @param {string} sel */
  matches(sel) { return parseSelector(sel).some((chain) => chain.length > 0 && matchChain(this, chain, chain.length - 1)); }
  /** @param {string} sel */
  closest(sel) {
    for (let n = /** @type {StubNode | null} */ (this); isEl(n); n = /** @type {StubNode} */ (n).parentNode) {
      if (/** @type {StubElement} */ (n).matches(sel)) return /** @type {StubElement} */ (n);
    }
    return null;
  }
  /** @param {string} sel @returns {StubElement[]} */
  querySelectorAll(sel) {
    const chains = parseSelector(sel);
    /** @type {StubElement[]} */
    const out = [];
    /** @param {StubNode} n */
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (!isEl(c)) continue;
        const el = /** @type {StubElement} */ (c);
        if (chains.some((ch) => ch.length > 0 && matchChain(el, ch, ch.length - 1))) out.push(el);
        walk(el);
      }
    };
    walk(this);
    return out;
  }
  /** @param {string} sel */
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  focus() {
    const doc = this.ownerDocument;
    if (!doc.contains(this) || doc.activeElement === this) return;
    const prev = doc._active;
    doc._active = this;
    if (prev) prev.dispatchEvent(new StubEvent("focusout"));
    this.dispatchEvent(new StubEvent("focusin"));
  }
  blur() {
    const doc = this.ownerDocument;
    if (doc._active !== this) return;
    doc._active = null;
    this.dispatchEvent(new StubEvent("focusout"));
  }
  click() { this.dispatchEvent(new StubEvent("click")); }
  /**
   * A minimal Web Animations stand-in: it records the call and "finishes" on a microtask.
   * @param {any} keyframes
   * @param {any} [opts]
   */
  animate(keyframes, opts) {
    /** @type {any} */
    const anim = { keyframes, opts, playState: "running" };
    anim.finished = new Promise((resolve) => {
      Promise.resolve().then(() => {
        if (anim.playState === "running") anim.playState = "finished";
        resolve(anim);
      });
    });
    anim.cancel = () => { anim.playState = "idle"; };
    anim.finish = () => { anim.playState = "finished"; };
    this._anims.push(anim);
    return anim;
  }
  /** Animations that are still running. */
  getAnimations() { return this._anims.filter((a) => a.playState === "running"); }
  select() { this.selectionStart = 0; this.selectionEnd = String(this.value).length; }
  /** @param {number} a @param {number} b */
  setSelectionRange(a, b) {
    if (this.selectionStart === null) throw new Error("setSelectionRange: not a text control");
    this.selectionStart = a;
    this.selectionEnd = b;
  }
  /** Dispatch with bubbling: target, ancestors, the document, then the window. @param {StubEvent} ev */
  dispatchEvent(ev) {
    ev.target = ev.target || this;
    /** @type {Target[]} */
    const path = [];
    for (let n = /** @type {StubNode | null} */ (this); n; n = n.parentNode) path.push(n);
    const doc = this.ownerDocument;
    if (path[path.length - 1] === doc && doc.defaultView) path.push(doc.defaultView);
    for (const t of path) {
      t._fire(ev);
      if (ev.cancelBubble || !ev.bubbles) break;
    }
    return !ev.defaultPrevented;
  }
  get innerHTML() { return this.childNodes.map(serialize).join(""); }
  set innerHTML(markup) {
    for (const c of this.childNodes.slice()) this.removeChild(c);
    parseInto(this, String(markup));
  }
}

/** @param {StubNode} n @returns {string} */
function serialize(n) {
  if (n.nodeType === 3) return escText(/** @type {StubText} */ (n).data);
  const el = /** @type {StubElement} */ (n);
  const tag = el.tagName.toLowerCase();
  let a = "";
  for (const [k, v] of el._attrs) a += " " + k + '="' + escAttr(v) + '"';
  if (VOID.has(tag)) return "<" + tag + a + ">";
  return "<" + tag + a + ">" + el.childNodes.map(serialize).join("") + "</" + tag + ">";
}

/** @param {StubElement} parent @param {string} markup */
function parseInto(parent, markup) {
  const doc = parent.ownerDocument;
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][-\w]*)\s*>|<([a-zA-Z][-\w]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+|<)/g;
  /** @type {StubElement[]} */
  const stack = [parent];
  let m;
  while ((m = re.exec(markup))) {
    const top = stack[stack.length - 1];
    if (m[0].indexOf("<!--") === 0) continue;
    if (m[1]) {
      const name = m[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName.toLowerCase() === name) { stack.length = i; break; }
      }
    } else if (m[2]) {
      const el = doc.createElement(m[2]);
      const ar = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let am;
      while ((am = ar.exec(m[3] || ""))) {
        const v = am[2] !== undefined ? am[2] : am[3] !== undefined ? am[3] : am[4];
        el.setAttribute(am[1], v === undefined ? "" : decode(v));
        if (am[1] === "value" && v !== undefined) el.value = decode(v);
        if (am[1] === "checked") el.checked = true;
      }
      top.appendChild(el);
      if (!VOID.has(m[2].toLowerCase()) && !m[4]) stack.push(el);
    } else if (m[5]) {
      top.appendChild(new StubText(doc, decode(m[5])));
    }
  }
  // Once the whole fragment is parsed (so an implied closing tag is covered too): a select takes
  // the value of its selected option, else of the first.
  for (const sel of parent.querySelectorAll("select")) {
    const opts = sel.querySelectorAll("option");
    const pick = opts.find((o) => o.hasAttribute("selected")) || opts[0];
    if (pick) { const v = pick.getAttribute("value"); sel.value = v ?? pick.textContent; }
  }
}

export class StubDocument extends StubNode {
  constructor() {
    super(null, 9);
    this.ownerDocument = /** @type {any} */ (this);
    /** @type {StubElement | null} */
    this._active = null;
    /** @type {StubWindow | null} */
    this.defaultView = null;
    this.documentElement = this.createElement("html");
    this.documentElement.clientWidth = 1024;
    this.documentElement.clientHeight = 768;
    this.body = this.createElement("body");
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.body);
  }
  /** @param {string} tag */
  createElement(tag) { return new StubElement(this, tag); }
  /** @param {string} s */
  createTextNode(s) { return new StubText(this, s); }
  get activeElement() { return this._active || this.body; }
  /** @param {string} id */
  getElementById(id) { return this.documentElement.querySelector("#" + id); }
  /** @param {string} sel */
  querySelector(sel) { return this.documentElement.matches(sel) ? this.documentElement : this.documentElement.querySelector(sel); }
  /** @param {string} sel */
  querySelectorAll(sel) { return this.documentElement.querySelectorAll(sel); }
  /** Not a browser API: dispatch an event that starts at the document. @param {StubEvent} ev */
  dispatchEvent(ev) {
    ev.target = ev.target || this;
    this._fire(ev);
    if (!ev.cancelBubble && ev.bubbles && this.defaultView) this.defaultView._fire(ev);
    return !ev.defaultPrevented;
  }
}

class StubWindow extends Target {
  /** @param {StubDocument} doc */
  constructor(doc) {
    super();
    this.document = doc;
    this.location = { hash: "" };
    this._rm = false;
    /** @type {Set<{ q: string, fns: Set<any> }>} */
    this._mq = new Set();
  }
  /** Tests set this to simulate prefers-reduced-motion; change listeners fire. */
  get reducedMotion() { return this._rm; }
  set reducedMotion(v) {
    this._rm = !!v;
    for (const m of this._mq) for (const fn of Array.from(m.fns)) fn({ type: "change", matches: this._rm && m.q.indexOf("reduce") >= 0, media: m.q });
  }
  /** @param {string} q */
  matchMedia(q) {
    const w = this;
    const rec = { q, fns: /** @type {Set<any>} */ (new Set()) };
    w._mq.add(rec);
    return {
      get matches() { return w._rm && q.indexOf("reduce") >= 0; },
      media: q,
      /** @param {string} t @param {any} fn */
      addEventListener(t, fn) { if (t === "change") rec.fns.add(fn); },
      /** @param {string} t @param {any} fn */
      removeEventListener(t, fn) { if (t === "change") rec.fns.delete(fn); },
    };
  }
  /** @param {(ts: number) => void} cb @returns {any} */
  requestAnimationFrame(cb) { return setTimeout(() => cb(Date.now()), 16); }
  /** @param {any} id */
  cancelAnimationFrame(id) { clearTimeout(id); }
  /** @param {StubEvent} ev */
  dispatchEvent(ev) { ev.target = ev.target || this; this._fire(ev); return !ev.defaultPrevented; }
}

/**
 * A fresh document and window.
 * @returns {{ document: StubDocument, window: StubWindow }}
 */
export function createDom() {
  const document = new StubDocument();
  const window = new StubWindow(document);
  document.defaultView = window;
  return { document, window };
}

/**
 * Put a fresh document and window on globalThis (document, window, and an empty-handed
 * location is on window only). Call uninstall() in afterEach.
 * @returns {{ document: StubDocument, window: StubWindow, uninstall: () => void }}
 */
export function installDom() {
  const dom = createDom();
  const g = /** @type {any} */ (globalThis);
  const had = { document: g.document, window: g.window, raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame, mm: g.matchMedia };
  g.document = dom.document;
  g.window = dom.window;
  g.requestAnimationFrame = (/** @type {any} */ cb) => dom.window.requestAnimationFrame(cb);
  g.cancelAnimationFrame = (/** @type {any} */ id) => dom.window.cancelAnimationFrame(id);
  g.matchMedia = (/** @type {string} */ q) => dom.window.matchMedia(q);
  return {
    ...dom,
    uninstall() {
      if (had.document === undefined) delete g.document; else g.document = had.document;
      if (had.window === undefined) delete g.window; else g.window = had.window;
      if (had.raf === undefined) delete g.requestAnimationFrame; else g.requestAnimationFrame = had.raf;
      if (had.caf === undefined) delete g.cancelAnimationFrame; else g.cancelAnimationFrame = had.caf;
      if (had.mm === undefined) delete g.matchMedia; else g.matchMedia = had.mm;
    },
  };
}
