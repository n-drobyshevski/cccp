// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
// A sheet: the dialog anchored to a screen edge. It uses dialogIsland (data-mount="dialog").
import { overlayMarkup } from "./dialog.js";

const SIDES = ["right", "left", "top", "bottom"];

/**
 * @component sheet
 * @title Sheet
 * @category Overlays
 * @summary A modal panel that slides in from the right, left, top or bottom edge, on the native dialog element.
 * @param {{id: string, side?: "right"|"left"|"top"|"bottom", open?: boolean, title?: string, description?: string, content?: unknown, footer?: unknown, label?: string, closeLabel?: string, closeAct?: string, showClose?: boolean, returnK?: string}} p
 * Same props as dialog plus `side` (default "right"; an unknown side falls back to right). `closeAct` defaults to "sheet:close". Mount dialogIsland on it (data-mount="dialog") after every render; it opens the sheet modally and returns focus to `returnK`.
 * @emits sheet:close (the close button, Escape and a backdrop click; or the closeAct you pass)
 * @states right, left, top, bottom, closed
 * @a11y A native dialog opened with showModal(): focus moves inside, the page behind is inert, Escape closes it, a backdrop click closes it, focus returns to the opener by data-k. The close button has an aria-label and a drawn cross. Motion: slides in over --dur-3 with the distance multiplied by --motion-scale, so reduced motion is a fade only.
 * @example right: sheet({ id: "sh-right", open: true, title: "Filters", description: "Narrow the register.", content: "Filter controls.", footer: "Apply and reset.", returnK: "btn-filters" })
 * @example left: sheet({ id: "sh-left", open: true, side: "left", title: "Menu", content: "Links go here." })
 * @example top: sheet({ id: "sh-top", open: true, side: "top", title: "Notice", content: "Maintenance tonight." })
 * @example bottom: sheet({ id: "sh-bottom", open: true, side: "bottom", title: "Share", content: "Copy the link." })
 * @example closed: sheet({ id: "sh-closed", title: "Filters", content: "Filter controls." })
 */
export function sheet(p) {
  const q = p || { id: "sheet" };
  const side = SIDES.indexOf(String(q.side)) >= 0 ? String(q.side) : "right";
  return overlayMarkup("sheet", q, { "data-side": side });
}
