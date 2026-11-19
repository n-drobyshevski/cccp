// Extracted from the author's production Apps Script apps; adapted.
// Where a tip lands and when it opens. Pure: rectangles and numbers in, rectangles and
// numbers out, so the decisions are testable without a DOM. tipPlacement never reads the
// window; the caller passes the viewport in.

/** The gap between the trigger and the card, and the card's keep-out from the window edge. */
export const TIP_GAP = 8;
export const TIP_MARGIN = 8;
/** Caret width, and the corner radius it must not sit on. */
export const TIP_ARROW = 10;
export const TIP_RADIUS = 10;
/** Cold open delay: long enough that a pointer crossing the page does not strobe every tip. */
export const OPEN_COLD = 220;
/** After a tip closes, the next one opens instantly for this long (scanning a row of headers). */
export const WARM_WINDOW = 400;
/** Grace between leaving the trigger and the card closing, so the card is hoverable. */
export const CLOSE_GRACE = 120;

/**
 * @typedef {{ left: number, right: number, top: number, bottom: number, width?: number }} Anchor
 * @typedef {{ width: number, height: number, left?: number }} Viewport
 */

/**
 * Place a card of `size` against `anchor` inside `viewport`.
 *
 * Below by default. Flips above only when the card does not fit below AND there is more room
 * above (flipping toward the smaller gap would only trade one clipped edge for another).
 * Horizontally it centres on the anchor and clamps to the margins, which is why the caret is
 * computed: a card clamped against the right edge would otherwise point at nothing.
 * `viewport.left` is the left edge of the content area (default 0), the floor of the clamp.
 * Returns viewport coordinates for position: fixed, the side chosen, and the caret offset from
 * the card's own left edge.
 * @param {Anchor} anchor
 * @param {{ width: number, height: number }} size
 * @param {Viewport} viewport
 * @param {{ gap?: number, margin?: number }} [opts]
 * @returns {{ left: number, top: number, side: "above" | "below", arrow: number }}
 */
export function tipPlacement(anchor, size, viewport, opts) {
  const { gap = TIP_GAP, margin = TIP_MARGIN } = opts || {};
  const w = size.width;
  const h = size.height;
  const vw = viewport.width;
  const vh = viewport.height;
  const contentLeft = viewport.left || 0;
  const aWidth = anchor.width === undefined ? anchor.right - anchor.left : anchor.width;

  const roomBelow = vh - margin - (anchor.bottom + gap);
  const roomAbove = anchor.top - gap - margin;
  const side = h > roomBelow && roomAbove > roomBelow ? "above" : "below";

  let top = side === "above" ? anchor.top - gap - h : anchor.bottom + gap;
  // A card taller than either gap overlaps the trigger rather than running off the window.
  top = Math.max(margin, Math.min(top, vh - h - margin));
  if (vh - margin * 2 < h) top = margin;

  const centre = anchor.left + aWidth / 2;
  let left = centre - w / 2;
  left = Math.max(contentLeft + margin, Math.min(left, vw - w - margin));
  if (vw - contentLeft - margin * 2 < w) left = contentLeft + margin;

  // The caret stays off both corners so it never overlaps the border radius.
  const inset = TIP_RADIUS + TIP_ARROW / 2;
  let arrow = centre - left;
  if (w < inset * 2) arrow = w / 2;
  else arrow = Math.max(inset, Math.min(arrow, w - inset));

  return { left, top, side, arrow };
}

/**
 * How long to wait before showing a tip. Focus is instant (a keyboard user spent a Tab to get
 * here); a pointer gets the cold delay unless another tip closed inside the warm window.
 * @param {{ viaFocus?: boolean, sinceLastClose?: number }} [state]
 * @returns {number}
 */
export function tipDelay(state) {
  const { viaFocus = false, sinceLastClose = Infinity } = state || {};
  if (viaFocus) return 0;
  if (sinceLastClose <= WARM_WINDOW) return 0;
  return OPEN_COLD;
}

/**
 * The lead of a longer text, cut on a sentence where one is close enough and on a word with an
 * ellipsis otherwise. A cut that ends in a sentence mark gets no ellipsis.
 * @param {unknown} text
 * @param {number} [max] default 150
 * @returns {string}
 */
export function tipLead(text, max) {
  const cap = max === undefined ? 150 : max;
  const s = String(text === null || text === undefined ? "" : text).trim();
  if (s.length <= cap) return s;
  const cut = s.slice(0, cap);
  const stop = cut.lastIndexOf(". ");
  if (stop > cap * 0.5) return cut.slice(0, stop + 1);
  const space = cut.lastIndexOf(" ");
  const head = (space > 0 ? cut.slice(0, space) : cut).replace(/[,;:\s]+$/, "");
  return /[.!?]$/.test(head) ? head : head + "…";
}
