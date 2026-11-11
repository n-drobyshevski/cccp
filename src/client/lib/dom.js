// The DOM seam. renderRegion is the only function in the client that writes markup, and it
// accepts only SafeHtml from the html template, so a plain string can never reach innerHTML.
import { isSafe } from "./html.js";

const quote = (s) => String(s).replace(/["\\]/g, "\\$&");

function captureFocus(el) {
  const doc = el.ownerDocument;
  const a = doc && doc.activeElement;
  if (!a || a === doc.body || !el.contains(a) || typeof a.getAttribute !== "function") return null;
  const k = a.getAttribute("data-k");
  if (k == null) return null;
  const f = { k };
  if (typeof a.selectionStart === "number") { f.start = a.selectionStart; f.end = a.selectionEnd; }
  return f;
}

function scrollers(el) {
  const list = Array.prototype.slice.call(el.querySelectorAll("[data-keep-scroll]"));
  if (typeof el.hasAttribute === "function" && el.hasAttribute("data-keep-scroll")) list.unshift(el);
  return list;
}

function captureScroll(el) {
  return scrollers(el).map((s, i) => ({ id: s.getAttribute("data-keep-scroll") || String(i), top: s.scrollTop, left: s.scrollLeft }));
}

function restoreScroll(el, saved) {
  if (!saved.length) return;
  const now = scrollers(el);
  for (const s of saved) {
    const hit = now.find((n, i) => (n.getAttribute("data-keep-scroll") || String(i)) === s.id);
    if (hit) { hit.scrollTop = s.top; hit.scrollLeft = s.left; }
  }
}

function restoreFocus(el, f) {
  if (!f) return;
  const t = el.querySelector('[data-k="' + quote(f.k) + '"]');
  if (!t || typeof t.focus !== "function") return;
  t.focus({ preventScroll: true });
  if (f.start != null && typeof t.setSelectionRange === "function") {
    try { t.setSelectionRange(f.start, f.end); } catch (e) { /* inputs without a selection */ }
  }
}

/**
 * Replace the contents of `el` with `safe`. Focus returns to the element with the same data-k
 * and the scroll position of every [data-keep-scroll] element is kept. Both default on.
 * Throws on anything that is not SafeHtml.
 */
export function renderRegion(el, safe, opts) {
  if (!isSafe(safe)) throw new TypeError("renderRegion needs SafeHtml from the html template, not " + typeof safe);
  const o = opts || {};
  const focus = o.keepFocus === false ? null : captureFocus(el);
  const scroll = o.keepScroll === false ? [] : captureScroll(el);
  el.innerHTML = String(safe);
  restoreScroll(el, scroll);
  restoreFocus(el, focus);
}

/** Event delegation: fn(event, matchedElement) for events whose target is inside `selector`. */
export function delegate(root, type, selector, fn) {
  const handler = (ev) => {
    const t = ev.target;
    const m = t && typeof t.closest === "function" ? t.closest(selector) : null;
    if (m && root.contains(m)) fn(ev, m);
  };
  root.addEventListener(type, handler);
  return () => root.removeEventListener(type, handler);
}

export const qs = (root, sel) => root.querySelector(sel);
export const qsa = (root, sel) => Array.prototype.slice.call(root.querySelectorAll(sel));
