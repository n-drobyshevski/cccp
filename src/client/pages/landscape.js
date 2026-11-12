// The Landscape lens of the Inventory (identity G): the filtered register as domains in columns under
// a 2px ink rule with their count, each split into subdomain groups of named tiles. A tile is a button
// carrying the application's name with a small status square in front of it; an unknown value is a
// dashed square and a Gap tile has a red-tinted border, so colour is never the only signal. The
// 'Colour by' choice (worst, each pillar in its colour, tier, completeness) lives in the store, and so
// in the address and in saved views; the legend sits at its right. Tiles open the fact sheet. The
// Inventory page owns the count line, the pillar tabs and the clicks.
import { html } from "../lib/html.js";
import { num } from "../lib/format.js";
import { emptyView } from "../components/table.js";
import { LANDSCAPE_METRICS, landscapeModel, legendFor, metricOf } from "../../domain/landscape";

const SHORT = { worst: "Worst" };
const PILLAR_OF = { c0: "cyber", c1: "compliance", c2: "continuity", c3: "platform" };

const tile = (t) => html`<button type="button" class="tl ls-${t.tone}" data-act="open" data-id="${t.id}" data-k="tile-${t.id}" data-tip="${t.tip}" aria-label="${t.tip}"><i class="sq" aria-hidden="true"></i><span>${t.name}</span></button>`;

const groupView = (g) => html`<div class="sdg"><span>${g.name}</span><div class="tiles2">${g.tiles.map(tile)}</div></div>`;

const boxView = (d) => html`<section class="dbox" data-domain="${d.name}"><header><b>${d.name}</b><small class="mono">${num(d.apps)}</small></header>${d.groups.map(groupView)}</section>`;

/** The 'Colour by' switch; the pillar choices carry their pillar's colour. */
export function metricSwitch(metric) {
  return html`<div class="metric"><span class="lbl">Colour by</span><span class="segs" role="group" aria-label="Colour by">${LANDSCAPE_METRICS.map((m) => html`<button type="button"${PILLAR_OF[m.key] ? html` class="pc-${PILLAR_OF[m.key]}"` : ""} data-act="metric" data-v="${m.key}" data-k="metric-${m.key}" aria-pressed="${m.key === metric ? "true" : "false"}">${SHORT[m.key] || m.label}</button>`)}</span></div>`;
}

/** The legend for a metric; the unknown entry is dashed, so it never relies on colour. */
export function legendView(metric) {
  return html`<div class="lgd" role="group" aria-label="${"Legend: " + metricOf(metric).label}" data-legend="${metric}">${legendFor(metric).map((i) => html`<span><i class="sq ls-${i.tone}"></i>${i.label}</span>`)}</div>`;
}

/** The lens content for a model: the colour-by row with the legend, then the domains. Pure. */
export function landscapeView(m, all) {
  return html`<div class="lens-land" data-lens-body="landscape"><div class="lctl">${metricSwitch(m.metric)}${legendView(m.metric)}</div>${m.total ? html`<div class="land" data-page-body="landscape">${m.domains.map(boxView)}</div>` : emptyView(all)}</div>`;
}

/** The Landscape lens for the filtered rows and a metric. */
export function landscapeLens(rows, metric, all) {
  return landscapeView(landscapeModel(rows, metric), all);
}
