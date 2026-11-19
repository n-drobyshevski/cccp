// The small labels of the fact sheet header: the tier, the lifecycle mark and the tag group. Pure views. A tag always carries its words, so
// colour is never the only signal.
import { html } from "@gas-kit/client/html.js";
import { tags } from "@gas-kit/ui/components/tags.js";
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

/**
 * The kit tag tone each flag is drawn with. The kit's tone is the only hook on a tag, and the three
 * flags have three looks (solid red, solid amber, soft amber with a ring), so "No SSO" takes the
 * third tone name and the look is set in factsheet.css; the words carry the meaning, not the tone.
 */
const FLAG_TONE = { ex: "bad", pd: "warn", sso: "info" };

/** The coloured tags (internet exposed, personal data, no SSO), on the kit tags list; typology and hosting are in the meta line. */
export function tagsView(list) {
  const items = list.filter((t) => t.key !== "ty" && t.key !== "h").map((t) => ({ id: t.key, text: t.label, tone: FLAG_TONE[t.key] || "none" }));
  return items.length ? tags({ items, label: "Flags" }) : "";
}
