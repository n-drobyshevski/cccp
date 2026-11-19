// Extracted from the author's production Apps Script apps; adapted.
// Loading placeholders: generic lines, rows and tiles. The blocks are decorative (aria-hidden);
// one sr-only "Loading" text carries the meaning. aria-busy is deliberately not set here (some screen readers then suppress the announcement): put aria-busy="true" on the container the app owns while it loads. A role=status node inserted already filled is often not announced: keep a persistent status region in the page if the announcement matters. The shimmer
// stops under prefers-reduced-motion. `slow` adds a calm line for a load that takes long
// (the app flips it after a delay of its choosing).
import { html } from "@gas-kit/client/html.js";

/** Widths cycle so lines do not look like a stamp. */
const WIDTHS = [92, 78, 86, 64];

/**
 * @param {unknown} n
 * @param {number} def
 */
function count(n, def) {
  const v = typeof n === "number" && isFinite(n) ? Math.floor(n) : def;
  return Math.max(1, Math.min(v, 50));
}

/**
 * @component skeleton
 * @title Skeleton
 * @category Feedback
 * @summary Placeholder lines, table-like rows or tiles while data loads.
 * @param {{variant?: "lines"|"rows"|"tiles", count?: number, label?: string, slow?: boolean, slowText?: string}} p
 * @emits none
 * @states lines, rows, tiles, slow
 * @a11y Motion: the shimmer is a slow loop on the motion tokens and stops under reduced motion, leaving the static placeholder. The container is role=status with an sr-only "Loading" text; the shapes are aria-hidden. The component never sets aria-busy (it can suppress the announcement of a live region): the app's container owns aria-busy and should set it to true while loading. The shimmer is off under prefers-reduced-motion. The slow line is visible text, not colour.
 * @example lines: skeleton({ variant: "lines", count: 3 })
 * @example rows: skeleton({ variant: "rows", count: 4 })
 * @example tiles: skeleton({ variant: "tiles", count: 3 })
 * @example slow: skeleton({ variant: "lines", count: 2, slow: true })
 */
export function skeleton(p) {
  const q = p || {};
  const v = q.variant === "rows" || q.variant === "tiles" ? q.variant : "lines";
  const n = count(q.count, v === "tiles" ? 3 : v === "rows" ? 5 : 3);
  const items = [];
  for (let i = 0; i < n; i++) {
    const w = WIDTHS[i % WIDTHS.length];
    if (v === "lines") items.push(html`<span class="gk-skeleton__line" style="--w:${w}%"></span>`);
    else if (v === "rows") items.push(html`<span class="gk-skeleton__row"><span class="gk-skeleton__cell is-narrow"></span><span class="gk-skeleton__cell" style="--w:${w}%"></span><span class="gk-skeleton__cell is-narrow"></span></span>`);
    else items.push(html`<span class="gk-skeleton__tile"><span class="gk-skeleton__line" style="--w:48%"></span><span class="gk-skeleton__line is-big" style="--w:${w}%"></span></span>`);
  }
  return html`<div class="gk-skeleton is-${v}" role="status"><span class="sr-only">${q.label || "Loading"}</span><span class="gk-skeleton__items" aria-hidden="true">${items}</span>${
    q.slow ? html`<span class="gk-skeleton__slow">${q.slowText || "Still loading. This is taking longer than usual."}</span>` : null
  }</div>`;
}
