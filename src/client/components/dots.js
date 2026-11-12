// Status dots, the small round marker the Overview, Heatmap, Landscape and the checklists use, and
// the text a pillar's status says. The list and the fact sheet use glyph.js instead. The 'none'
// dot is dashed, so colour is never the only signal.
import { html } from "../lib/html.js";
import { PILLAR_LABEL, STATUS_WORD } from "../../domain/facets";

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
