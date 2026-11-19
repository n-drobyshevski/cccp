// Extracted from the author's production Apps Script apps; adapted.
// Arrow-key navigation for a row of role=tab buttons: Left and Right move to the neighbouring
// tab (wrapping) and activate it, Home and End jump to the ends. The tabs carry roving
// tabindex, so only the selected one is in the Tab order. `root` is any ancestor of the
// tablist; the tab that was reached is focused again once the page has redrawn.
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
