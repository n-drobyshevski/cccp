// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
import { html } from "@gas-kit/client/html.js";

/**
 * @component progress
 * @title Progress
 * @category Feedback
 * @summary A horizontal progress bar, determinate or indeterminate.
 * @param {{value?: number, max?: number, label?: string, indeterminate?: boolean, k?: string}} p
 * `value` runs from 0 to `max` (default 100) and is clamped; the bar width comes from the CSS custom property --gk-pct (0 to 100) on the fill. `indeterminate: true` ignores `value` and shows a sliding segment. `label` is the accessible name (default "Progress").
 * @emits none
 * @states default, complete, indeterminate
 * @a11y role="progressbar" with aria-valuemin, aria-valuemax, aria-valuenow and aria-valuetext in percent; an indeterminate bar omits aria-valuenow, which is how the role says "unknown". The fill length, not colour, carries the value. Motion: the fill eases over --dur-3; the indeterminate slide stops under reduced motion and leaves a static segment.
 * @example default: progress({ value: 42, label: "Import" })
 * @example complete: progress({ value: 100, label: "Upload" })
 * @example indeterminate: progress({ indeterminate: true, label: "Syncing" })
 */
export function progress(p) {
  const q = p || {};
  const max = typeof q.max === "number" && q.max > 0 ? q.max : 100;
  const v = typeof q.value === "number" && isFinite(q.value) ? Math.min(max, Math.max(0, q.value)) : 0;
  const pct = Math.round((v / max) * 1000) / 10;
  const ind = q.indeterminate === true;
  const name = q.label != null && q.label !== "" ? q.label : "Progress";
  return html`<div class="gk-progress${ind ? " is-indeterminate" : ""}${!ind && pct >= 100 ? " is-complete" : ""}" role="progressbar" aria-label="${name}" aria-valuemin="0" aria-valuemax="${max}"${ind ? "" : html` aria-valuenow="${v}" aria-valuetext="${pct}%"`}${q.k != null && q.k !== "" ? html` data-k="${q.k}"` : ""}><div class="gk-progress__fill" style="--gk-pct:${ind ? 40 : pct}"></div></div>`;
}
