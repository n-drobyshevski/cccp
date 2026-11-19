// Extracted from the author's production Apps Script apps; adapted.
// Keyboard helpers. tabKeys: arrow-key navigation for a row of role=tab buttons: Left and Right
// move to the neighbouring tab (wrapping) and activate it, Home and End jump to the ends. The
// tabs carry roving tabindex, so only the selected one is in the Tab order. `root` is any
// ancestor of the tablist; the tab that was reached is focused again once the page has redrawn.
// trapTab: Tab and Shift+Tab wrap inside a modal container (a dialog, a sheet, a confirm).
import { delegate, quote } from "./dom.js";

/**
 * @param {Element} root
 * @returns {() => void} removes the listener
 */
export function tabKeys(root) {
  return delegate(root, "keydown", '[role="tab"]', (ev, t) => {
    const list = t.closest('[role="tablist"]');
    if (!list || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    /** @type {any[]} */
    const tabs = Array.prototype.slice.call(list.querySelectorAll('[role="tab"]'));
    const i = tabs.indexOf(t);
    let to = -1;
    if (ev.key === "ArrowRight") to = (i + 1) % tabs.length;
    else if (ev.key === "ArrowLeft") to = (i - 1 + tabs.length) % tabs.length;
    else if (ev.key === "Home") to = 0;
    else if (ev.key === "End") to = tabs.length - 1;
    if (to < 0 || to === i) return;
    ev.preventDefault();
    const next = tabs[to];
    const k = next.getAttribute("data-k");
    next.focus();
    next.click();
    const doc = root.ownerDocument;
    const again = () => {
      const b = k ? /** @type {any} */ (root.querySelector('[data-k="' + quote(k) + '"]')) : null;
      if (b && doc.activeElement !== b) b.focus();
    };
    again();
    setTimeout(again, 0);
  });
}

const FOCUSABLE = "a[href], area[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable]";

/**
 * The Tab stops inside `container`, in document order: focusable elements that are not
 * disabled, not tabindex -1, not a hidden input, not inside [hidden] or [inert], and, in a
 * browser, rendered (a closed popover or a display none subtree has no client rects).
 * @param {Element} container
 * @returns {any[]}
 */
export function focusables(container) {
  return Array.prototype.slice.call(container.querySelectorAll(FOCUSABLE)).filter((/** @type {any} */ e) => {
    if (e.hasAttribute("disabled") || e.getAttribute("tabindex") === "-1") return false;
    if (e.tagName === "INPUT" && String(e.getAttribute("type") || "").toLowerCase() === "hidden") return false;
    if (e.getAttribute("contenteditable") === "false") return false;
    for (let n = e; n && n !== container; n = n.parentNode) {
      if (typeof n.hasAttribute === "function" && (n.hasAttribute("hidden") || n.hasAttribute("inert"))) return false;
    }
    return typeof e.getClientRects !== "function" || e.getClientRects().length > 0;
  });
}

/**
 * Keep Tab inside `container`: from the last Tab stop it wraps to the first, from the first
 * with Shift it wraps to the last, and from anything that is not one of its Tab stops (outside,
 * or the container itself) it comes back in at an end. Between the ends the browser moves focus
 * as usual. Returns true when it handled (and
 * prevented) the event; any other key returns false.
 * @param {Element} container
 * @param {{key: string, shiftKey?: boolean, preventDefault: () => void}} ev
 * @returns {boolean}
 */
export function trapTab(container, ev) {
  if (!ev || ev.key !== "Tab") return false;
  const items = focusables(container);
  if (!items.length) {
    ev.preventDefault();
    return true;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const at = container.ownerDocument.activeElement;
  if (items.indexOf(at) < 0 || (ev.shiftKey && at === first)) {
    ev.preventDefault();
    (ev.shiftKey ? last : first).focus();
    return true;
  }
  if (!ev.shiftKey && at === last) {
    ev.preventDefault();
    first.focus();
    return true;
  }
  return false;
}
