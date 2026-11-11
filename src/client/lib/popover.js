// A small anchored panel: checklist popovers, menus, the column chooser. One is open at a
// time. Positioning uses the local place() below rather than the vendored tipPlacement: it
// aligns to either edge of the anchor and flips above when there is no room below. Escape and a press outside close it; Escape returns focus to the trigger.
import { renderRegion } from "./dom.js";
import { closeTips } from "./tip.js";

let open = null;

function place(pop, anchor, align) {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const a = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  let left = align === "end" ? a.right - w : a.left;
  left = Math.max(8, Math.min(left, vw - w - 8));
  let top = a.bottom + 6;
  if (top + h > vh - 8 && a.top - 6 - h >= 8) top = a.top - 6 - h;
  top = Math.max(8, Math.min(top, Math.max(8, vh - h - 8)));
  pop.style.left = Math.round(left) + "px";
  pop.style.top = Math.round(top) + "px";
}

/** Close whatever is open. `restore` returns focus to the trigger. */
export function closePopovers(restore) {
  const cur = open;
  if (!cur) return;
  open = null;
  document.removeEventListener("pointerdown", cur.onDown, true);
  document.removeEventListener("keydown", cur.onKey, true);
  window.removeEventListener("resize", cur.onResize);
  cur.pop.remove();
  if (cur.anchor.setAttribute) cur.anchor.setAttribute("aria-expanded", "false");
  if (restore && cur.anchor.focus) cur.anchor.focus();
  if (cur.onClose) cur.onClose();
}

/**
 * Open `safe` (SafeHtml) under `anchor`. Returns {el, close, update(safe)}; update re-renders
 * in place and keeps focus and scroll. opts: label (aria-label), align ('start'|'end'), onClose.
 */
export function openPopover(anchor, safe, opts) {
  const o = opts || {};
  closePopovers(false);
  closeTips();
  const pop = document.createElement("div");
  pop.className = "pop";
  pop.setAttribute("role", "dialog");
  if (o.label) pop.setAttribute("aria-label", o.label);
  pop.tabIndex = -1;
  document.body.appendChild(pop);
  renderRegion(pop, safe, { keepFocus: false, keepScroll: false });
  place(pop, anchor, o.align);
  anchor.setAttribute("aria-expanded", "true");
  const cur = {
    pop, anchor, onClose: o.onClose,
    onDown: (ev) => { if (!pop.contains(ev.target) && !anchor.contains(ev.target)) closePopovers(false); },
    onKey: (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); closePopovers(true); } },
    onResize: () => place(pop, anchor, o.align),
  };
  open = cur;
  document.addEventListener("pointerdown", cur.onDown, true);
  document.addEventListener("keydown", cur.onKey, true);
  window.addEventListener("resize", cur.onResize);
  const first = pop.querySelector("input,button,[tabindex]");
  (first || pop).focus({ preventScroll: true });
  return {
    el: pop,
    close: () => { if (open === cur) closePopovers(true); },
    update: (next) => { renderRegion(pop, next); place(pop, anchor, o.align); },
  };
}

export function popoverOpen() {
  return open !== null;
}
