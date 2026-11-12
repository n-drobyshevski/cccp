// A headline figure tile (lx3): label, big value, and the share it is of its denominator. The
// whole tile is a button that opens the List with the filters that reproduce the number.
import { html } from "../lib/html.js";
import { num } from "../lib/format.js";

export function kpiTile(k) {
  const note = k.id === "eol"
    ? "still listed as running"
    : k.id === "t1gap" ? "of " + num(k.denominator) + " " + k.of : k.pct + "% of " + num(k.denominator) + " " + k.of;
  return html`<button type="button" class="kpi ${k.tone}" data-act="go" data-kpi="${k.id}" data-go="${JSON.stringify(k.target)}" data-k="kpi-${k.id}"><span>${k.label}</span><b class="num" data-value>${num(k.value)}</b><small>${note}</small></button>`;
}
