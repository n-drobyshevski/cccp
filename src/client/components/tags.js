// The small labels of the fact sheet header: the tier, the lifecycle mark and the tag group. Pure views. A tag always carries its words, so
// colour is never the only signal.
import { html } from "../lib/html.js";
import { lifecycleClass } from "./table.js";

/** The tier in words: 'Tier 2', or a dashed 'No tier' (the same unset meaning as the dash in the table). */
export function tierBadge(tier) {
  return tier
    ? html`<span class="tier tw t${tier}">Tier ${tier}</span>`
    : html`<span class="tier tw t0" tabindex="0" data-tip="No tiering set">No tier</span>`;
}

/** The lifecycle with its dot; an unknown lifecycle is a muted dash. */
export function lifecycleMark(lc) {
  return lc
    ? html`<span class="lc ${lifecycleClass(lc.key)}">${lc.label}</span>`
    : html`<span class="mut" aria-hidden="true">—</span><span class="sr-only">Not set</span>`;
}

/** The coloured tags (internet exposed, personal data, no SSO); typology and hosting are in the meta line. */
export function tagsView(tags) {
  const list = tags.filter((t) => t.key !== "ty" && t.key !== "h");
  return list.length ? html`<div class="tags lxc">${list.map((t) => html`<span class="tag t-${t.key}">${t.label}</span>`)}</div>` : "";
}
