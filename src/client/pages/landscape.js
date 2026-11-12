// The Landscape page (lx3.ext.html named tiles): the filtered register as one box per domain,
// largest first, each split into subdomain groups of named tiles. A tile is a button carrying the
// application's name, coloured by the chosen metric; an unknown value is hatched, never a colour.
// The 'Colour by' choice lives in the store (and so in the address and in saved views), and the
// legend below it follows the metric. Opening a tile remembers the scroll so Back lands here.
import { delegate, qs, renderRegion } from "../lib/dom.js";
import { html } from "../lib/html.js";
import { count, num } from "../lib/format.js";
import { filtersShell, mountFilters } from "../components/toolbar.js";
import { emptyView } from "../components/table.js";
import { registerPage } from "../shell/router.js";
import * as register from "../state/register.js";
import { store } from "../state/store.js";
import { navigate, queryFor, replace } from "../state/url.js";
import { runQuery } from "../../domain/query";
import { LANDSCAPE_METRICS, landscapeModel, legendFor, metricOf } from "../../domain/landscape";

let memo = null;

const tile = (t) => html`<button type="button" class="tl ls-${t.tone}" data-act="open" data-id="${t.id}" data-k="tile-${t.id}" data-tip="${t.tip}" aria-label="${t.tip}">${t.name}</button>`;

const groupView = (g) => html`<div class="sdg"><span>${g.name}</span><div class="tiles2">${g.tiles.map(tile)}</div></div>`;

const boxView = (d) => html`<section class="dbox" data-domain="${d.name}"><header><b>${d.name}</b><small>${num(d.apps)}</small></header>${d.groups.map(groupView)}</section>`;

/** The 'Colour by' switch. */
export function metricSwitch(metric) {
  return html`<div class="metric"><span class="lbl">Colour by</span><span class="segs" role="group" aria-label="Colour by">${LANDSCAPE_METRICS.map((m) => html`<button type="button" data-act="metric" data-v="${m.key}" data-k="metric-${m.key}" aria-pressed="${m.key === metric ? "true" : "false"}">${m.label}</button>`)}</span></div>`;
}

/** The legend for a metric; the unknown entry is hatched, so it never relies on colour. */
export function legendView(metric) {
  return html`<div class="lgd" role="group" aria-label="${"Legend: " + metricOf(metric).label}" data-legend="${metric}">${legendFor(metric).map((i) => html`<span><i class="ls-${i.tone}"></i>${i.label}</span>`)}</div>`;
}

/** The results panel for a model. Pure. */
export function landscapeView(m, all, hidden) {
  return html`<section class="panel results" aria-label="Applications by domain and subdomain"><div class="rhead"><span class="rcount"><span data-count="visible"><b class="num">${num(m.total)}</b></span> <span class="mut" data-count="of">of ${count(all, "application")}</span>${hidden ? html` <span class="mut" data-count="hidden"> and ${count(hidden, "application")} hidden by the display settings</span>` : ""}</span>${metricSwitch(m.metric)}</div><div class="rhead rleg">${legendView(m.metric)}</div>${m.total ? html`<div class="land" data-page-body="landscape">${m.domains.map(boxView)}</div>` : emptyView(all)}</section>`;
}

export const landscapePage = {
  mount(el, ctx) {
    renderRegion(el, filtersShell(html``), { keepFocus: false, keepScroll: false });
    const content = qs(el, '[data-region="content"]');
    const offFilters = mountFilters(el);

    const draw = () => {
      const s = store.get();
      const m = landscapeModel(runQuery(register.visibleRows(), s), s.metric);
      renderRegion(content, html`<div data-page="landscape">${landscapeView(m, register.allRows().length, register.hiddenCount())}</div>`);
    };
    draw();

    if (memo && memo.key === queryFor(store.get())) {
      const y = memo.y;
      requestAnimationFrame(() => { if (ctx.current()) window.scrollTo(0, y); });
    }
    memo = null;

    const offs = [];
    offs.push(delegate(content, "click", "[data-act=metric]", (ev, b) => { replace({ metric: b.getAttribute("data-v") }); }));
    offs.push(delegate(content, "click", "[data-act=open]", (ev, b) => {
      memo = { y: window.scrollY, key: queryFor(store.get()) };
      navigate({ route: "app", app: b.getAttribute("data-id"), tab: null, view: null }, "push");
    }));
    const offStore = store.subscribe((s, p) => { if (s.q !== p.q || s.f !== p.f || s.metric !== p.metric) draw(); });
    const offReg = register.subscribe(draw);
    return () => { offReg(); offStore(); offs.forEach((f) => f()); offFilters(); };
  },
};

registerPage("landscape", landscapePage);

/** Test seam. */
export function __resetLandscapeForTest() { memo = null; }
