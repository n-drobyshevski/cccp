// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
import { html } from "@gas-kit/client/html.js";

/**
 * @component separator
 * @title Separator
 * @category Layout
 * @summary A thin horizontal or vertical divider, decorative or semantic.
 * @param {{orientation?: "horizontal"|"vertical", decorative?: boolean}} p
 * `decorative` defaults to true. A vertical separator takes the height of its flex or grid parent (give the parent a height or let it stretch).
 * @emits none
 * @states horizontal, vertical, semantic
 * @a11y A decorative separator has role="none" and is skipped by assistive tech. A semantic one (`decorative: false`) has role="separator" and aria-orientation, so it announces a change of section.
 * @example horizontal: separator({})
 * @example vertical: separator({ orientation: "vertical" })
 * @example semantic: separator({ decorative: false })
 */
export function separator(p) {
  const q = p || {};
  const vertical = q.orientation === "vertical";
  const o = vertical ? "vertical" : "horizontal";
  return q.decorative === false
    ? html`<div class="gk-separator" data-orientation="${o}" role="separator" aria-orientation="${o}"></div>`
    : html`<div class="gk-separator" data-orientation="${o}" role="none"></div>`;
}
