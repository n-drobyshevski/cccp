// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
// A sheet: the dialog anchored to a screen edge. It uses dialogIsland (data-mount="dialog").
import { html, attrs, styleDecls } from "@gas-kit/client/html.js";
import { overlayMarkup } from "./dialog.js";

const UP = html`<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"></path></svg>`;
const DOWN = html`<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"></path></svg>`;

/**
 * One previous or next button.
 * @param {string} id
 * @param {"prev"|"next"} dir
 * @param {{act: string, label: string, disabled: boolean}} n
 * @param {string} variant
 */
function navButton(id, dir, n, variant) {
  return html`<button ${attrs({ type: "button", class: "gk-btn gk-sheet__nav", "data-variant": variant, "data-size": "icon", "aria-label": n.label, "data-tip": n.label, "data-act": n.act, "data-k": id + "-" + dir, disabled: n.disabled })}>${dir === "prev" ? UP : DOWN}</button>`;
}

const SIDES = ["right", "left", "top", "bottom"];

/**
 * @component sheet
 * @title Sheet
 * @category Overlays
 * @summary A modal panel that slides in from the right, left, top or bottom edge, on the native dialog element.
 * @param {{id: string, side?: "right"|"left"|"top"|"bottom", open?: boolean, title?: string, description?: string, content?: unknown, footer?: unknown, label?: string, closeLabel?: string, closeAct?: string, showClose?: boolean, returnK?: string, rail?: boolean, prevAct?: string, nextAct?: string, prevLabel?: string, nextLabel?: string, prevDisabled?: boolean, nextDisabled?: boolean, resizable?: boolean, width?: number, minWidth?: number, maxWidth?: number, resizeAct?: string, resizeLabel?: string}} p
 * Same props as dialog plus `side` (default "right"; an unknown side falls back to right). `closeAct` defaults to "sheet:close". Mount dialogIsland on it (data-mount="dialog") after every render; it opens the sheet modally and returns focus to `returnK`. All the options below are off by default, and without them the markup is exactly as before. `rail` (left and right sheets) lifts the close button and the previous and next buttons out of the panel into a vertical column of round buttons just outside its inner edge, top aligned with the header (to the left of a right sheet, to the right of a left one); the close button keeps its data-dialog-close, act and key, so Escape and the backdrop still close the sheet. `prevAct` and `nextAct` each draw a chevron button (up for previous, down for next) with data-act, `data-k` "<id>-prev" or "<id>-next", an aria-label and data-tip of `prevLabel` ("Previous") or `nextLabel` ("Next"), and the native disabled attribute with `prevDisabled` or `nextDisabled`; the app moves to the neighbouring item and re-renders. Without `rail` they sit in the panel's top right corner beside the close button (any side). `resizable` (left and right sheets) draws a grip on the inner edge for dragging the width: `width` is the initial width in px (default 384), `minWidth` the least (default 320), `maxWidth` an optional cap (the width never passes the viewport minus 4rem, so the rail stays on screen), `resizeAct` the act reported when the width changes (default "sheet:resize"; data-v on the grip is the width in px, so the app stores it and passes it back as `width`) and `resizeLabel` the grip's name ("Resize panel"). The island keeps the dragged width per sheet id across redraws that pass the same width or none, and takes a new `width` from the app when it differs. On top and bottom sheets `rail` and the resize props are ignored.
 * @emits sheet:close (the close button, Escape and a backdrop click; or the closeAct you pass)
 * @emits the prevAct and nextAct you pass (data-k "<id>-prev" and "<id>-next")
 * @emits sheet:resize (data-v is the new width in px, sent when a drag ends and on each key step; or the resizeAct you pass)
 * @states right, left, top, bottom, closed, rail, nav, resizable
 * @a11y A native dialog opened with showModal(): focus moves inside, the page behind is inert, Tab and Shift+Tab wrap between its first and last controls while it is open (dialogIsland), Escape closes it, a backdrop click closes it, focus returns to the opener by data-k. The close button has an aria-label and a drawn cross. The previous and next buttons are native buttons with an aria-label and a drawn chevron; a disabled one uses the disabled attribute, so it is skipped by Tab and announced as unavailable. The resize grip is a focusable role="separator" with aria-orientation="vertical", an aria-label and aria-valuenow, aria-valuemin and aria-valuemax in px: ArrowLeft and ArrowRight move it by 16px (Shift 64px; the arrow that moves the grip towards the middle of the page widens the sheet), Home goes to the minimum and End to the maximum; dragging uses pointer capture. The grip is a pill with a drawn outline and a focus ring, not colour alone. Motion: slides in over --dur-3 with the distance multiplied by --motion-scale, so reduced motion is a fade only; there is no transition while dragging.
 * @example right: sheet({ id: "sh-right", open: true, title: "Filters", description: "Narrow the register.", content: "Filter controls.", footer: "Apply and reset.", returnK: "btn-filters" })
 * @example left: sheet({ id: "sh-left", open: true, side: "left", title: "Menu", content: "Links go here." })
 * @example top: sheet({ id: "sh-top", open: true, side: "top", title: "Notice", content: "Maintenance tonight." })
 * @example bottom: sheet({ id: "sh-bottom", open: true, side: "bottom", title: "Share", content: "Copy the link." })
 * @example rail: sheet({ id: "sh-rail", open: true, rail: true, title: "Request 1042", description: "Opened by Acme Corp.", content: "Details go here.", prevAct: "sh:prev", nextAct: "sh:next", prevDisabled: true, returnK: "btn-open" })
 * @example nav: sheet({ id: "sh-nav", open: true, title: "Request 1043", content: "Details go here.", prevAct: "sh:prev", nextAct: "sh:next", prevLabel: "Previous request", nextLabel: "Next request" })
 * @example resizable: sheet({ id: "sh-resize", open: true, rail: true, resizable: true, width: 420, title: "Request 1044", content: "Drag the grip, or focus it and use the arrow keys.", prevAct: "sh:prev", nextAct: "sh:next" })
 * @example closed: sheet({ id: "sh-closed", title: "Filters", content: "Filter controls." })
 */
export function sheet(p) {
  const q = p || { id: "sheet" };
  const side = SIDES.indexOf(String(q.side)) >= 0 ? String(q.side) : "right";
  const edge = side === "left" || side === "right";
  const nav = (/** @type {any} */ act, /** @type {any} */ label, /** @type {any} */ off, /** @type {string} */ dflt) =>
    typeof act === "string" && act !== "" ? { act, label: label ? String(label) : dflt, disabled: off === true } : null;
  const prev = nav(q.prevAct, q.prevLabel, q.prevDisabled, "Previous");
  const next = nav(q.nextAct, q.nextLabel, q.nextDisabled, "Next");
  const rail = q.rail === true && edge && (q.showClose !== false || !!prev || !!next);
  /** @type {any} */
  let resize = null;
  if (q.resizable === true && edge) {
    const num = (/** @type {any} */ v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null);
    const min = num(q.minWidth) || 320;
    const max = num(q.maxWidth);
    const cap = max != null ? Math.max(max, min) : null;
    const given = num(q.width);
    let width = given != null ? given : 384;
    width = Math.min(Math.max(width, min), cap != null ? cap : width);
    resize = {
      width, min, max: cap, maxAria: cap != null ? cap : 1200, passed: given != null ? width : null,
      act: q.resizeAct ? String(q.resizeAct) : "sheet:resize", label: q.resizeLabel ? String(q.resizeLabel) : "Resize panel",
    };
  }
  const id = q.id != null && q.id !== "" ? String(q.id) : "sheet";
  if (!(rail || prev || next || resize)) return overlayMarkup("sheet", q, { "data-side": side });
  const variant = rail ? "outline" : "ghost";
  const navs = [prev ? navButton(id, "prev", prev, variant) : "", next ? navButton(id, "next", next, variant) : ""].filter((x) => x !== "");
  /** @type {Record<string, unknown>} */
  const more = {};
  if (rail) more["data-rail"] = "";
  if (resize) more["data-resizable"] = "";
  return overlayMarkup("sheet", q, { "data-side": side }, {
    rail, nav: navs, attrs: more, width: resize ? resize.passed : null,
    style: resize ? styleDecls({ "--gk-sheet-w": resize.width, "--gk-sheet-min": resize.min, "--gk-sheet-max": resize.max }) : null,
    grip: resize ? html`<div ${attrs({ class: "gk-sheet__grip", role: "separator", "aria-orientation": "vertical", "aria-label": resize.label, tabindex: "0", "aria-valuenow": resize.width, "aria-valuemin": resize.min, "aria-valuemax": resize.maxAria, "data-act": resize.act, "data-k": id + "-grip", "data-v": resize.width, "data-var": "--gk-sheet-w" })}></div>` : null,
  });
}
