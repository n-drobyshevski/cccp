// The small labels of the fact sheet header: the 'A · Application' type badge, the tier, the
// lifecycle mark and the coloured tag group (lx2). Pure views. A tag always carries its words, so
// colour is never the only signal.
import { html } from "../lib/html.js";
import { lifecycleClass } from "./table.js";

export function typeBadge() {
  return html`<span class="tbadge"><b aria-hidden="true">A</b><span>Application</span></span>`;
}

export function tierBadge(tier) {
  return tier
    ? html`<span class="tier t${tier}">T${tier}</span>`
    : html`<span class="tier t0" data-tip="No tiering set">–<span class="sr-only">No tiering set</span></span>`;
}

/** The lifecycle with its dot; an unknown lifecycle is a muted dash. */
export function lifecycleMark(lc) {
  return lc
    ? html`<span class="lc ${lifecycleClass(lc.key)}">${lc.label}</span>`
    : html`<span class="mut" aria-hidden="true">—</span><span class="sr-only">Not set</span>`;
}

/** The tier badge and the coloured tags (typology, hosting, internet exposed, personal data, no SSO). */
export function tagsView(tier, tags) {
  return html`<div class="tags lxc">${tier ? tierBadge(tier) : ""}${tags.map((t) => html`<span class="tag t-${t.key}">${t.label}</span>`)}</div>`;
}
