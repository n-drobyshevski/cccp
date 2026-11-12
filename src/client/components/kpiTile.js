// A headline figure (identity G): the value in mono, its label, the share it is of its denominator
// and "Open in inventory ›". The whole tile is a button that opens the Inventory with the filters
// that reproduce the number.
import { html } from "../lib/html.js";
import { num } from "../lib/format.js";

export function kpiTile(k) {
  const note = k.id === "eol"
    ? "still listed as running"
    : k.id === "t1gap" ? "of " + num(k.denominator) + " " + k.of
    : k.id === "gap" ? k.pct + "% of " + num(k.denominator)
    : k.id === "noso" ? k.pct + "% of " + k.of
    : k.pct + "% of " + num(k.denominator) + " " + k.of;
  return html`<button type="button" class="kpi ${k.tone}" data-act="go" data-kpi="${k.id}" data-go="${JSON.stringify(k.target)}" data-k="kpi-${k.id}"><b class="num mono" data-value>${num(k.value)}</b><span class="kl">${k.label}</span><small>${note}</small><span class="kgo">Open in inventory ›</span></button>`;
}
