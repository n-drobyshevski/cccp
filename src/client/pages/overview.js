// The Overview page (lx3 KPI variant): four headline figures, a status bar per pillar and the
// domains with the most gaps, over the whole visible register with no toolbar. Every figure
// opens the List with the filters that reproduce it.
import { delegate, renderRegion } from "../lib/dom.js";
import { html } from "../lib/html.js";
import { count, num, stamp } from "../lib/format.js";
import { dot } from "../components/dots.js";
import { kpiTile } from "../components/kpiTile.js";
import { legend } from "../components/legend.js";
import { stackBar, segmentText } from "../components/stackBar.js";
import { pctStep } from "../components/table.js";
import { registerPage } from "../shell/router.js";
import * as register from "../state/register.js";
import { navigate } from "../state/url.js";
import { OVERVIEW_TITLES, overviewModel } from "../../domain/overview";

const go = (t) => JSON.stringify(t);

function pillarBar(p) {
  const c = p.counts;
  const text = segmentText("bad", c.bad) + ", " + segmentText("warn", c.warn) + ", " + segmentText("none", c.none) + ", " + segmentText("ok", c.ok);
  return html`<button type="button" class="pbar" data-act="go" data-pillar="${p.pillar}" data-go="${go(p.target)}" data-k="pillar-${p.pillar}" data-tip="${text}"><span>${dot(c.bad ? "bad" : "ok")}${p.label}</span>${stackBar(c)}<small><b>${num(c.bad)}</b> gaps · ${num(c.warn)} attention</small></button>`;
}

function domainRow(d) {
  const step = pctStep(d.completeness);
  return html`<tr data-domain="${d.name}"><td><button type="button" class="lk" data-act="go" data-go="${go(d.target)}" data-k="dom-${d.name}"><b>${d.name}</b></button></td><td class="num">${num(d.apps)}</td><td class="num"><button type="button" class="lk gapn" data-act="go" data-go="${go(d.gapTarget)}" data-k="domgap-${d.name}" aria-label="${count(d.gaps, "application") + " with a gap in " + d.name}">${num(d.gaps)}</button></td><td><span class="qcell"><span class="qbar" aria-hidden="true"><i class="${step}" style="width:${d.completeness}%"></i></span><small>${d.completeness}%</small></span></td></tr>`;
}

/** The whole page for a model. Pure. */
export function overviewView(m, hidden, loadedAt) {
  return html`<div class="ov" data-page="overview">
    <div class="ovh"><div><h1>Overview</h1><p>${count(m.total, "application")}${loadedAt ? html` · data loaded ${loadedAt}` : ""}${hidden ? html` · ${count(hidden, "application")} hidden by the display settings` : ""}</p></div></div>
    <div class="kpis">${m.kpis.map(kpiTile)}</div>
    <div class="two">
      <section class="panel card2" aria-label="${OVERVIEW_TITLES.pillars}"><h2>${OVERVIEW_TITLES.pillars}</h2><div class="pbars">${m.pillars.map(pillarBar)}</div>${legend()}</section>
      <section class="panel card2" aria-label="${OVERVIEW_TITLES.domains}"><h2>${OVERVIEW_TITLES.domains}</h2><div class="tw"><table class="dt" data-table="domains"><thead><tr><th>Domain</th><th>Apps</th><th>With a gap</th><th>Completeness</th></tr></thead><tbody>${m.domains.map(domainRow)}</tbody></table></div></section>
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
