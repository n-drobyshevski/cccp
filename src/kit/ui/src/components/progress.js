// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
import { html } from "@gas-kit/client/html.js";
import { badge } from "./badge.js";

/** The default word of each state; `stateText` overrides it. @type {Record<string, string>} */
const STATE_WORDS = { ok: "OK", warn: "Warning", bad: "Problem" };

/**
 * @component progress
 * @title Progress
 * @category Feedback
 * @summary A horizontal progress bar, determinate or indeterminate, optionally a meter with a caption and an ok, warn or bad state.
 * @param {{value?: number, max?: number, label?: string, indeterminate?: boolean, state?: "ok"|"warn"|"bad"|null, stateText?: string, caption?: string, note?: string, k?: string}} p
 * `value` runs from 0 to `max` (default 100) and is clamped; the bar width comes from the CSS custom property --gk-pct (0 to 100) on the fill. `indeterminate: true` ignores `value` and shows a sliding segment. `label` is the accessible name (default "Progress").
 * A meter: with `caption` (the value in words, for example "1,200 of 5,000 (24%)") or `state`, the bar gets a head row showing `label`, the caption and, for a state, a status badge (its shape and word: OK, Warning or Problem, or `stateText`), and the fill takes the state's colour. `note` is a sentence under the bar. The caller decides the state (the thresholds belong to what is measured). Without `caption`, `state` and `note` the markup is the plain bar.
 * @emits none
 * @states default, complete, indeterminate, meter, warn, bad
 * @a11y role="progressbar" with aria-valuemin, aria-valuemax, aria-valuenow and aria-valuetext in percent; an indeterminate bar omits aria-valuenow, which is how the role says "unknown". The fill length, not colour, carries the value. A meter's head row is aria-hidden and its words go into aria-valuetext instead ("1,200 of 5,000 (24%), Warning"), so they are read once, with the bar; the state is a word and a shape, never the fill colour alone. The note is plain text. Motion: the fill eases over --dur-3; the indeterminate slide stops under reduced motion and leaves a static segment.
 * @example default: progress({ value: 42, label: "Import" })
 * @example complete: progress({ value: 100, label: "Upload" })
 * @example indeterminate: progress({ indeterminate: true, label: "Syncing" })
 * @example meter: progress({ value: 1200, max: 5000, label: "Storage", caption: "1,200 of 5,000 (24%)", state: "ok" })
 * @example warn: progress({ value: 4300, max: 5000, label: "Storage", caption: "4,300 of 5,000 (86%)", state: "warn", stateText: "Near the limit", note: "Archive old rows to free space." })
 * @example bad: progress({ value: 5000, max: 5000, label: "Storage", caption: "5,000 of 5,000 (100%)", state: "bad", stateText: "At the limit" })
 */
export function progress(p) {
  const q = p || {};
  const max = typeof q.max === "number" && q.max > 0 ? q.max : 100;
  const v = typeof q.value === "number" && isFinite(q.value) ? Math.min(max, Math.max(0, q.value)) : 0;
  const pct = Math.round((v / max) * 1000) / 10;
  const ind = q.indeterminate === true;
  const hasLabel = q.label != null && q.label !== "";
  const name = hasLabel ? q.label : "Progress";
  const state = q.state === "ok" || q.state === "warn" || q.state === "bad" ? q.state : "";
  const caption = q.caption != null && q.caption !== "" ? String(q.caption) : "";
  const note = q.note != null && q.note !== "" ? String(q.note) : "";
  const word = state ? (q.stateText != null && q.stateText !== "" ? String(q.stateText) : STATE_WORDS[state]) : "";
  const meter = !!(state || caption || note);
  const said = [caption || (ind ? "" : pct + "%"), word].filter(Boolean).join(", ");
  const valueText = meter ? said : ind ? "" : pct + "%";
  const bar = html`<div class="gk-progress${ind ? " is-indeterminate" : ""}${!ind && pct >= 100 ? " is-complete" : ""}${state ? " is-" + state : ""}" role="progressbar" aria-label="${name}" aria-valuemin="0" aria-valuemax="${max}"${ind ? "" : html` aria-valuenow="${v}"`}${valueText ? html` aria-valuetext="${valueText}"` : ""}${q.k != null && q.k !== "" ? html` data-k="${q.k}"` : ""}><div class="gk-progress__fill" style="--gk-pct:${ind ? 40 : pct}"></div></div>`;
  if (!meter) return bar;
  const showHead = hasLabel || caption || word;
  return html`<div class="gk-progress__meter${state ? " is-" + state : ""}">${showHead ? html`<div class="gk-progress__head" aria-hidden="true">${hasLabel ? html`<span class="gk-progress__label">${name}</span>` : ""}${caption ? html`<span class="gk-progress__caption">${caption}</span>` : ""}${word ? badge({ text: word, variant: /** @type {"ok"|"warn"|"bad"} */ (state) }) : ""}</div>` : ""}${bar}${note ? html`<p class="gk-progress__note">${note}</p>` : ""}</div>`;
}
