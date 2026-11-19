// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
import { html } from "@gas-kit/client/html.js";

/**
 * @component spinner
 * @title Spinner
 * @category Feedback
 * @summary A small spinning arc for work in progress, with a spoken label.
 * @param {{label?: string, size?: "sm"|"default"|"lg"}} p
 * `label` is the sr-only text (default "Loading"). Sizes are 12, 16 and 24px.
 * @emits none
 * @states default, sm, lg
 * @a11y role="status" with an sr-only label, so the start of loading is announced politely; the arc itself is aria-hidden. Motion: one turn takes two --dur-5 steps with the standard easing; under reduced motion (the system setting or data-motion="reduce") nothing spins and the arc stays as a static icon, which still reads as a loader next to its label.
 * @example default: spinner({})
 * @example sm: spinner({ label: "Saving", size: "sm" })
 * @example lg: spinner({ size: "lg" })
 */
export function spinner(p) {
  const q = p || {};
  const size = q.size === "sm" || q.size === "lg" ? q.size : "default";
  return html`<span class="gk-spinner is-${size}" role="status"><svg class="gk-spinner__icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 9 9"></path></svg><span class="sr-only">${q.label != null && q.label !== "" ? q.label : "Loading"}</span></span>`;
}
