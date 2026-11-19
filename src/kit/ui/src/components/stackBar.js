// Extracted from the author's production Apps Script apps; adapted.
// A stacked bar of status counts. Colour is never the only signal: every status has its own pattern (solid, diagonal stripes, cross-hatch, dots, vertical stripes),
// and the same counts are in a text summary for screen readers.
import { html } from "@gas-kit/client/html.js";
import { fmtCount } from "@gas-kit/client/format.js";
import { STATUS_WORDS, STATUSES } from "./statusDot.js";

/**
 * @param {{status: string, count: number, label?: string}} s
 * @returns {string}
 */
function segText(s) {
  const word = s.label != null && s.label !== "" ? s.label : STATUS_WORDS[/** @type {keyof typeof STATUS_WORDS} */ (s.status)];
  return fmtCount(s.count) + " " + word;
}

/**
 * @component stackBar
 * @title Stack Bar
 * @category Charts
 * @summary A horizontal bar split into status segments sized by count, with a text summary.
 * @param {{segments: Array<{status: "ok"|"warn"|"bad"|"info"|"none", count: number, label?: string}>, label?: string, emptyText?: string}} p
 * `label` names the group (default "Status counts"); `label` on a segment is the noun after its count ("gaps"). Segments with a zero, negative or non-numeric count are not drawn, and a zero total shows `emptyText` (default "No data").
 * @emits none
 * @states default, single, empty
 * @a11y A labelled group whose sr-only text reads every segment and the total ("12 Problem, 3 Warning. 15 in total"); the drawn track is aria-hidden. The group is focusable and shows the same summary as a tip on hover and focus, so the words are reachable by keyboard.
 * @example default: stackBar({ segments: [{ status: "bad", count: 12, label: "gaps" }, { status: "warn", count: 3, label: "need attention" }, { status: "ok", count: 40 }, { status: "none", count: 7 }] })
 * @example single: stackBar({ segments: [{ status: "ok", count: 5 }] })
 * @example empty: stackBar({ segments: [] })
 */
export function stackBar(p) {
  const q = p || { segments: [] };
  const segs = (Array.isArray(q.segments) ? q.segments : [])
    .filter((s) => s && STATUSES.indexOf(s.status) >= 0)
    .map((s) => ({ status: s.status, count: Math.round(Number(s.count)), label: s.label }))
    .filter((s) => Number.isFinite(s.count) && s.count > 0);
  const name = q.label || "Status counts";
  if (!segs.length) {
    return html`<span class="gk-stackBar is-empty" role="group" aria-label="${name}"><span class="gk-stackBar__track" aria-hidden="true"></span><span class="gk-stackBar__empty">${q.emptyText || "No data"}</span></span>`;
  }
  const total = segs.reduce((a, s) => a + s.count, 0);
  const summary = segs.map(segText).join(", ") + ". " + fmtCount(total) + " in total";
  return html`<span class="gk-stackBar" role="group" aria-label="${name}" tabindex="0" data-tip="${summary}"><span class="gk-stackBar__track" aria-hidden="true">${segs.map((s) => html`<i class="gk-stackBar__seg is-${s.status}" style="--gk-n:${s.count}" data-tip="${segText(s)}"></i>`)}</span><span class="sr-only">${summary}</span></span>`;
}
