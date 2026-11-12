// A stacked status bar: one segment per status, worst first, as in the lx3 pillar bars. Colour
// is never the only signal: each segment has a tip, and the counts are also in sr-only text.
import { html } from "../lib/html.js";
import { STATUS_STACK } from "../../domain/overview";
import { STATUS_WORD } from "../../domain/facets";
import { num } from "../lib/format.js";

/** The words for one segment: '12 gaps', '3 need attention', '40 ok', '7 no data'. */
export function segmentText(status, n) {
  const w = { bad: n === 1 ? "gap" : "gaps", warn: n === 1 ? "needs attention" : "need attention", ok: "OK", none: "no data" }[status] || STATUS_WORD[status];
  return num(n) + " " + w;
}

/** counts: {bad, warn, none, ok}. Zero segments are not drawn. */
export function stackBar(counts) {
  const segs = STATUS_STACK.filter((s) => counts[s] > 0);
  return html`<span class="stk" role="group" aria-label="Status counts">${segs.map((s) => html`<i class="${s}" style="flex:${counts[s]}" data-tip="${segmentText(s, counts[s])}"></i>`)}<span class="sr-only">${segs.map((s) => html`<span>${segmentText(s, counts[s])}. </span>`)}</span></span>`;
}
