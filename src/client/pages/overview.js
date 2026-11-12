// The Overview page (identity G): the title line with the count and the read time, four headline
// figures in mono, a status bar per pillar and the domains with the most gaps (with the number of
// applications with a gap in each pillar), over the whole visible register. Every figure, bar and domain opens the
// Inventory with the filters that reproduce it.
import { delegate, renderRegion } from "../lib/dom.js";
import { html } from "../lib/html.js";
import { count, num, stamp } from "../lib/format.js";
import { PILLAR_CODE } from "../components/glyph.js";
import { kpiTile } from "../components/kpiTile.js";
import { legend } from "../components/legend.js";
import { stackBar, segmentText } from "../components/stackBar.js";
import { registerPage } from "../shell/router.js";
import * as register from "../state/register.js";
import { navigate } from "../state/url.js";
import { PILLAR_LABEL } from "../../domain/facets";
import { PILLARS } from "../../domain/types";
import { OVERVIEW_TITLES, overviewModel } from "../../domain/overview";

const go = (t) => JSON.stringify(t);

function pillarBar(p) {
  const c = p.counts;
  const text = segmentText("bad", c.bad) + ", " + segmentText("warn", c.warn) + ", " + segmentText("none", c.none) + ", " + segmentText("ok", c.ok);
  return html`<button type="button" class="pbar pc-${p.pillar}" data-act="go" data-pillar="${p.pillar}" data-go="${go(p.target)}" data-k="pillar-${p.pillar}" data-tip="${text}"><span class="pn">${p.label}</span>${stackBar(c)}<small><b class="mono">${num(c.bad)}</b> ${c.bad === 1 ? "gap" : "gaps"}<span class="sr-only"> and ${num(c.warn)} needing attention. Open in inventory.</span></small></button>`;
}

function domainRow(d) {
  return html`<tr data-domain="${d.name}"><td><button type="button" class="lk" data-act="go" data-go="${go(d.target)}" data-k="dom-${d.name}"><b>${d.name}</b></button></td><td class="num mono">${num(d.apps)}</td><td class="num mono"><button type="button" class="lk gapn" data-act="go" data-go="${go(d.gapTarget)}" data-k="domgap-${d.name}" aria-label="${count(d.gaps, "application") + " with a gap in " + d.name}">${num(d.gaps)}</button></td>${PILLARS.map((p) => {
    const g = d.pillarGaps[p];
    return html`<td class="p num mono" data-pillar="${p}">${g.n > 0
      ? html`<button type="button" class="lk pgap" data-act="go" data-go="${go(g.target)}" data-k="dompg-${d.name}-${p}" aria-label="${count(g.n, "application") + " with a " + PILLAR_LABEL[p] + " gap in " + d.name}" data-tip="${count(g.n, "application") + " with a " + PILLAR_LABEL[p] + " gap"}">${num(g.n)}</button>`
      : html`<span class="mut" aria-label="${"No " + PILLAR_LABEL[p] + " gap in " + d.name}">–</span>`}</td>`;
  })}</tr>`;
}

/** The whole page for a model. Pure. */
export function overviewView(m, hidden, loadedAt) {
  return html`<div class="ov" data-page="overview">
    <div class="ovh"><h1>Overview</h1><p class="mut">${count(m.total, "application")}${loadedAt ? html` · read ${loadedAt}` : ""}${hidden ? html` · ${count(hidden, "application")} hidden by the display settings` : ""}</p></div>
    <div class="kpis">${m.kpis.map(kpiTile)}</div>
    <div class="two">
      <section class="ovs" aria-label="${OVERVIEW_TITLES.pillars}"><h2 class="lbl">${OVERVIEW_TITLES.pillars}</h2><div class="pbars">${m.pillars.map(pillarBar)}</div>${legend()}</section>
      <section class="ovs" aria-label="${OVERVIEW_TITLES.domains}"><h2 class="lbl">${OVERVIEW_TITLES.domains}</h2><div class="tw"><table class="dt" data-table="domains"><thead><tr><th>Domain</th><th class="n">Apps</th><th class="n">With a gap</th>${PILLARS.map((p) => html`<th class="p pc-${p}" data-tip="${PILLAR_LABEL[p]}"><span aria-hidden="true">${PILLAR_CODE[p]}</span><span class="sr-only">${PILLAR_LABEL[p]}</span></th>`)}</tr></thead><tbody>${m.domains.map(domainRow)}</tbody></table></div><p class="mut note">Each pillar column counts the domain's applications with a gap there.</p></section>
    </div>
  </div>`;
}

/** The list route patch for a set of facet filters. */
export function listPatch(f) {
  return { route: "list", app: null, tab: null, view: null, currentViewId: null, q: "", f, limit: 50 };
}

export const overviewPage = {
  mount(el) {
    const draw = () => {
      const m = overviewModel(register.visibleRows());
      renderRegion(el, overviewView(m, register.hiddenCount(), stamp(register.loadedMeta().loadedAt)));
    };
    draw();
    const offReg = register.subscribe(draw);
    const off = delegate(el, "click", "[data-act=go]", (ev, b) => {
      let f = {};
      try { f = JSON.parse(b.getAttribute("data-go") || "{}"); } catch (e) { return; }
      navigate(listPatch(f), "push");
    });
    // The whole domain row opens the List, as the name button does; the buttons keep their own click.
    const offRow = delegate(el, "click", "tr[data-domain]", (ev, row) => {
      if (ev.target.closest && ev.target.closest("button")) return;
      const b = row.querySelector("[data-act=go]");
      if (!b) return;
      let f = {};
      try { f = JSON.parse(b.getAttribute("data-go") || "{}"); } catch (e) { return; }
      navigate(listPatch(f), "push");
    });
    return () => { offReg(); off(); offRow(); };
  },
};

registerPage("overview", overviewPage);
