// Extracted from the author's production Apps Script apps; adapted.
// An anchored panel opened by a trigger button. The view is pure: `open` comes from the app's
// state, and data-act="popover:toggle" (with data-id) flips it. The island positions the open
// panel with the client's tipPlacement math, repositions on scroll and resize, closes on
// Escape (focus returns to the trigger), on a click outside and when focus leaves the popover
// (after the target's own act runs), by clicking the trigger so the app sees one more popover:toggle. Mount with mountIslands(root, { popover: popoverIsland }).
import { attrs, html } from "@gas-kit/client/html.js";
import { tipPlacement } from "@gas-kit/client/tipPlace.js";

/**
 * @component popover
 * @title Popover
 * @category Overlays
 * @summary A trigger button and an anchored panel that opens below it, or above when there is no room. The body is a string (escaped) or SafeHtml from html.
 * @param {{id: string, label: string, open?: boolean, title?: string|null, body?: unknown, tip?: string|null}} p
 * @emits popover:toggle (data-id is the popover id)
 * @states closed, open
 * @a11y Motion: the panel fades in and scales from 0.96 to 1 over --dur-3 (from the trigger side), and fades out over --dur-2 before display flips; reduced motion keeps the fades and drops the scale. Re-rendering the popover while it is open replays the short entrance. A disclosure, not a dialog: the trigger carries aria-expanded and aria-controls (the panel id), and the panel is role=group labelled by its title (aria-labelledby) or the trigger label, hidden while closed. Focus stays on the trigger when it opens, and there is no focus trap. Escape (with focus inside the popover) closes it and returns focus to the trigger, also after the app re-renders; moving focus out of the popover, or a click outside, closes it too. A tip is also sr-only text inside the trigger (after the label, separated by a full stop). The root is a div, so keep the popover out of a p element.
 * @example open: popover({ id: "help", label: "Filters", open: true, title: "Filters", body: "Pick what to show." })
 * @example closed: popover({ id: "help", label: "Filters", open: false, title: "Filters", body: "Pick what to show." })
 */
export function popover(p) {
  const open = !!p.open;
  const id = p.id == null ? "" : String(p.id);
  const labelled = p.title ? id + "-title" : null;
  return html`<div class="gk-popover${open ? " is-open" : ""}"><button type="button" class="gk-popover__trigger gk-btn" data-variant="outline" ${attrs({
    "data-act": "popover:toggle", "data-id": id, "data-k": "popover-" + id, "aria-expanded": open ? "true" : "false",
    "aria-controls": id + "-panel", "data-tip": p.tip,
  })}>${p.label}${p.tip ? html`<span class="sr-only">. ${p.tip}</span>` : null}</button><div class="gk-popover__panel" ${attrs({
    id: id + "-panel", role: "group", "aria-labelledby": labelled, "aria-label": labelled ? null : p.label,
    "data-mount": "popover", "data-props": JSON.stringify({ id }), hidden: !open,
  })}>${
    p.title ? html`<h3 class="gk-popover__title" id="${id}-title">${p.title}</h3>` : null
  }<div class="gk-popover__body">${p.body}</div></div></div>`;
}

/**
 * Pure placement of a panel against its trigger: viewport coordinates for position: fixed.
 * Below by default, above only when there is no room below and more above.
 * @internal
 * @param {{left: number, right: number, top: number, bottom: number, width?: number}} anchor
 * @param {{width: number, height: number}} size
 * @param {{width: number, height: number}} viewport
 * @returns {{left: number, top: number, side: "above"|"below"}}
 */
export function popoverPlacement(anchor, size, viewport) {
  const r = tipPlacement(anchor, size, viewport, { gap: 6, margin: 8 });
  return { left: r.left, top: r.top, side: r.side };
}

/**
 * The popover island, mounted on the panel. It only listens while the panel is open (a closed
 * panel is hidden and has nothing to do). Run its teardown before the app re-renders.
 * @type {import("@gas-kit/client/islands.js").Island}
 */
export const popoverIsland = {
  mount(el) {
    if (el.hasAttribute("hidden")) return undefined;
    const doc = el.ownerDocument;
    const win = /** @type {any} */ (doc.defaultView);
    const root = /** @type {any} */ (el.closest(".gk-popover"));
    const trigger = root ? /** @type {any} */ (root.querySelector(".gk-popover__trigger")) : null;
    const panel = /** @type {any} */ (el);
    const place = () => {
      if (!trigger) return;
      const r = popoverPlacement(trigger.getBoundingClientRect(), { width: panel.offsetWidth, height: panel.offsetHeight },
        { width: doc.documentElement.clientWidth, height: doc.documentElement.clientHeight });
      panel.style.setProperty("left", r.left + "px");
      panel.style.setProperty("top", r.top + "px");
      panel.setAttribute("data-side", r.side);
    };
    /** @param {any} ev */
    const onKey = (ev) => {
      if (ev.key !== "Escape") return;
      // Only when focus is in this popover: Escape elsewhere on the page is not ours.
      if (!root || !root.contains(doc.activeElement)) return;
      ev.stopPropagation();
      if (trigger) {
        // Focus first: the app re-renders inside the click, and renderRegion puts focus back
        // on the element with the same data-k that held it at render time.
        trigger.focus();
        trigger.click();
      }
    };
    // Light dismiss listens on a click in the capture phase and acts one tick later, after the
    // app's delegate has handled the target's own act (and possibly re-rendered), so a press on
    // another control still reaches it. The trigger is looked up again by data-k then, and only
    // clicked while it still reports expanded. The pointerdown only records whether the press
    // began inside, for a target the app re-rendered away before this listener sees it.
    const key = trigger ? trigger.getAttribute("data-k") : null;
    /** @type {boolean|null} */
    let pressInside = null;
    /** @param {any} ev */
    const onDown = (ev) => {
      pressInside = !!(root && ev.target && root.contains(ev.target));
    };
    const closeLater = () => {
      if (!key) return;
      setTimeout(() => {
        const now = /** @type {any} */ (Array.from(doc.querySelectorAll("[data-k]")).find((e) => e.getAttribute("data-k") === key));
        if (now && now.getAttribute("aria-expanded") === "true") now.click();
      }, 0);
    };
    /** @param {any} ev */
    const onPress = (ev) => {
      const t = ev.target;
      const inside = t && t.isConnected ? !!(root && root.contains(t)) : pressInside !== false;
      pressInside = null;
      if (!inside) closeLater();
    };
    // Focus moving to a control outside the popover (Tab out, or a focus call) closes it.
    /** @param {any} ev */
    const onFocusIn = (ev) => {
      const t = ev.target;
      if (!root || !t || !t.isConnected || root.contains(t)) return;
      closeLater();
    };
    place();
    doc.addEventListener("keydown", onKey);
    doc.addEventListener("pointerdown", onDown, true);
    doc.addEventListener("click", onPress, true);
    doc.addEventListener("focusin", onFocusIn);
    if (win) {
      win.addEventListener("resize", place);
      win.addEventListener("scroll", place, true);
    }
    return () => {
      doc.removeEventListener("keydown", onKey);
      doc.removeEventListener("pointerdown", onDown, true);
      doc.removeEventListener("click", onPress, true);
      doc.removeEventListener("focusin", onFocusIn);
      if (win) {
        win.removeEventListener("resize", place);
        win.removeEventListener("scroll", place, true);
      }
    };
  },
};
