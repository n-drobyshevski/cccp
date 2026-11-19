// Extracted from the author's production Apps Script apps; adapted.
// The DOM seam. renderRegion is the only function in the client that writes markup, and it
// accepts only SafeHtml from the html template, so a plain string can never reach innerHTML.
import { isSafe } from "./html.js";

/**
 * Escape a value for use inside a double-quoted attribute selector.
 * @param {string} s
 */
export const quote = (s) =>
  String(s).replace(/["\\]|[\u0000-\u001f\u007f]/g, (c) =>
    c === '"' || c === "\\" ? "\\" + c : "\\" + c.charCodeAt(0).toString(16) + " ");

/**
 * @param {Element} el
 * @returns {{ k: string, start?: number | null, end?: number | null } | null}
 */
function captureFocus(el) {
  const doc = el.ownerDocument;
  const a = /** @type {any} */ (doc && doc.activeElement);
  if (!a || a === doc.body || !el.contains(a) || typeof a.getAttribute !== "function") return null;
  const k = a.getAttribute("data-k");
  if (k == null) return null;
  /** @type {{ k: string, start?: number | null, end?: number | null }} */
  const f = { k };
  if (typeof a.selectionStart === "number") { f.start = a.selectionStart; f.end = a.selectionEnd; }
  return f;
}

/**
 * @param {Element} el
 * @returns {any[]}
 */
function scrollers(el) {
  const list = Array.prototype.slice.call(el.querySelectorAll("[data-keep-scroll]"));
  if (typeof el.hasAttribute === "function" && el.hasAttribute("data-keep-scroll")) list.unshift(el);
  return list;
}

/** @param {Element} el */
function captureScroll(el) {
  return scrollers(el).map((s, i) => ({
    id: s.getAttribute("data-keep-scroll") || String(i), top: s.scrollTop, left: s.scrollLeft,
  }));
}

/**
 * @param {Element} el
 * @param {Array<{ id: string, top: number, left: number }>} saved
 */
function restoreScroll(el, saved) {
  if (!saved.length) return;
  const now = scrollers(el);
  for (const s of saved) {
    const hit = now.find((n, i) => (n.getAttribute("data-keep-scroll") || String(i)) === s.id);
    if (hit) { hit.scrollTop = s.top; hit.scrollLeft = s.left; }
  }
}

/**
 * @param {Element} el
 * @param {{ k: string, start?: number | null, end?: number | null } | null} f
 */
function restoreFocus(el, f) {
  if (!f) return;
  const t = /** @type {any} */ (el.querySelector('[data-k="' + quote(f.k) + '"]'));
  if (!t || typeof t.focus !== "function") return;
  t.focus({ preventScroll: true });
  if (f.start != null && typeof t.setSelectionRange === "function") {
    try { t.setSelectionRange(f.start, f.end); } catch (e) { /* inputs without a selection */ }
  }
}

/**
 * Whether `n` is a native popover that is showing. A browser without :popover-open (or a test
 * DOM) answers false.
 * @param {any} n
 */
function isOpenPopover(n) {
  try { return !!(n && typeof n.matches === "function" && n.matches(":popover-open")); } catch (e) { return false; }
}

/**
 * The open native popovers inside `el` (not `el` itself), by id, in document order, with the
 * inline style an island placed them with.
 * @param {Element} el
 * @returns {Array<{ id: string, style: string | null }>}
 */
function captureOpen(el) {
  /** @type {any[]} */
  const list = Array.prototype.slice.call(el.querySelectorAll("[popover]"));
  return list.filter((p) => p.getAttribute("id") && isOpenPopover(p)).map((p) => ({ id: p.getAttribute("id"), style: p.getAttribute("style") }));
}

/**
 * Show again each popover of the new markup whose id was open before, parents first. One whose
 * id is gone, or that is not a popover any more, stays closed. The old inline style goes over
 * only when the new element has none, so the panel opens where it was until its island places it.
 * @param {Element} el
 * @param {Array<{ id: string, style: string | null }>} saved
 */
function restoreOpen(el, saved) {
  for (const s of saved) {
    const n = /** @type {any} */ (el.querySelector('[id="' + quote(s.id) + '"]'));
    if (!n || !n.hasAttribute("popover") || typeof n.showPopover !== "function" || isOpenPopover(n)) continue;
    if (s.style != null && !n.hasAttribute("style")) n.setAttribute("style", s.style);
    try { n.showPopover(); } catch (e) { /* a region outside the document: the popover stays closed */ }
  }
}

/**
 * Replace the contents of `el` with `safe`. An open native popover ([popover], such as a
 * dropdown menu's panel) whose id is in the new markup is shown again; focus returns to the
 * element with the same data-k (caret and selection included), also inside that popover; and
 * the scroll position of every [data-keep-scroll] element is kept. All three default on.
 * Throws a TypeError on anything that is not SafeHtml.
 * @param {Element} el
 * @param {unknown} safe
 * @param {{ keepFocus?: boolean, keepScroll?: boolean, keepOpen?: boolean }} [opts]
 */
export function renderRegion(el, safe, opts) {
  if (!isSafe(safe)) throw new TypeError("renderRegion needs SafeHtml from the html template, not " + typeof safe);
  const o = opts || {};
  const focus = o.keepFocus === false ? null : captureFocus(el);
  const scroll = o.keepScroll === false ? [] : captureScroll(el);
  const open = o.keepOpen === false ? [] : captureOpen(el);
  el.innerHTML = String(safe);
  // Shown before scroll and focus are restored: a closed popover is display none, so neither
  // its scrollTop nor a focus inside it would hold.
  restoreOpen(el, open);
  restoreScroll(el, scroll);
  restoreFocus(el, focus);
}

/**
 * Event delegation: fn(event, matchedElement) for events whose target is inside `selector`.
 * Returns a function that removes the listener.
 * @param {Element | Document} root
 * @param {string} type
 * @param {string} selector
 * @param {(ev: any, el: Element) => void} fn
 * @returns {() => void}
 */
export function delegate(root, type, selector, fn) {
  /** @param {any} ev */
  const handler = (ev) => {
    const t = ev.target;
    const m = t && typeof t.closest === "function" ? t.closest(selector) : null;
    if (m && root.contains(m)) fn(ev, m);
  };
  root.addEventListener(type, handler);
  return () => root.removeEventListener(type, handler);
}

/**
 * @param {Element | Document} root
 * @param {string} sel
 * @returns {Element | null}
 */
export const qs = (root, sel) => root.querySelector(sel);

/**
 * @param {Element | Document} root
 * @param {string} sel
 * @returns {Element[]}
 */
export const qsa = (root, sel) => Array.prototype.slice.call(root.querySelectorAll(sel));
