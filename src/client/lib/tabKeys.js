// Arrow-key navigation for a row of role=tab buttons (the Settings tabs behave the same way): Left and
// Right move to the neighbouring tab and activate it, Home and End jump to the ends. The tabs carry
// roving tabindex, so only the selected one is in the Tab order. `root` is any ancestor of the
// tablist; the tab that was reached is focused again once the page has redrawn.
import { delegate } from "./dom.js";

export function tabKeys(root) {
  return delegate(root, "keydown", '[role="tab"]', (ev, t) => {
    const list = t.closest('[role="tablist"]');
    if (!list || ev.altKey || ev.ctrlKey || ev.metaKey) return;
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
    const again = () => {
      const b = k ? root.querySelector('[data-k="' + k + '"]') : null;
      if (b && document.activeElement !== b) b.focus();
    };
    again();
    setTimeout(again, 0);
  });
}
