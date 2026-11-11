// Status dots. One dot per pillar in the fixed order Cyber, Compliance, Continuity, Platform
// (C C C P). Colour is never the only signal: each dot carries a tip and an accessible name with
// the pillar, the status word and the reason, and the 'none' dot is dashed.
import { html } from "../lib/html.js";
import { PILLARS } from "../../domain/types";
import { PILLAR_LABEL, STATUS_WORD } from "../../domain/facets";

export const PILLAR_LETTER = { cyber: "C", compliance: "C", continuity: "C", platform: "P" };

/** One dot for a status ('ok' | 'warn' | 'bad' | 'none'). Decorative on its own. */
export function dot(status) {
  return html`<span class="dot ${status}" aria-hidden="true"></span>`;
}

/** The text a pillar dot says: 'Cyber: Gap. Front exposed on internet'. */
export function pillarText(pillar, result) {
  const r = result || { status: "none", why: "" };
  const word = STATUS_WORD[r.status] || r.status;
  return PILLAR_LABEL[pillar] + ": " + word + (r.why ? ". " + r.why : "");
}

/** The four dots of a status object (a Row's `status`). */
export function dots(status) {
  return html`<span class="dots" role="group" aria-label="Status by pillar">${PILLARS.map((p) => {
    const text = pillarText(p, status && status[p]);
    const s = status && status[p] ? status[p].status : "none";
    return html`<span class="dotw" tabindex="0" role="img" aria-label="${text}" data-tip="${text}">${dot(s)}</span>`;
  })}</span>`;
}

/** The C C C P column head that goes with the dots. */
export function dotsHead() {
  return html`<span class="dhead" aria-hidden="true">${PILLARS.map((p) => html`<span data-tip="${PILLAR_LABEL[p]}">${PILLAR_LETTER[p]}</span>`)}</span>`;
}
