// The Heatmap page (proto.src.html heatmap): the filtered register grouped by domain, largest
// first. A group row carries a status bar per pillar and the gap count in red; opened, it lists
// its applications with the status dot and the reason in every pillar. Which groups are open is
// remembered across filter changes (the first sight of the page seeds it with the largest group);
// while the result has 40 applications or fewer, or one group, every group shows open and a toggle
// closes it in a separate set that a filter change clears. Opening an application remembers the scroll so Back
// lands where the viewer was.
import { delegate, qs, renderRegion } from "../lib/dom.js";
import { html } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { count, num } from "../lib/format.js";
import { dot } from "../components/dots.js";
import { filtersShell, mountFilters } from "../components/toolbar.js";
import { emptyView } from "../components/table.js";
import { registerPage } from "../shell/router.js";
import * as register from "../state/register.js";
import { store } from "../state/store.js";
import { navigate, queryFor } from "../state/url.js";
import { PILLARS } from "../../domain/types";
import { PILLAR_LABEL, STATUS_WORD } from "../../domain/facets";
import { runQuery } from "../../domain/query";
import { HEAT_STACK, OPEN_ALL_MAX, heatmapModel } from "../../domain/heatmap";

let open = null;
let closedSmall = new Set();
let memo = null;

const isSmall = (m) => m.total <= OPEN_ALL_MAX || m.groups.length === 1;

const tierMark = (a) => a.tier
  ? html`<span class="tier t${a.tier}">T${a.tier}</span>`
  : html`<span class="tier t0" data-tip="No tiering set">–<span class="sr-only">No tiering set</span></span>`;

/** The words for one bar: '3 gaps · 2 need attention · 1 no data · 10 OK'. */
export function barText(c) {
  return num(c.bad) + (c.bad === 1 ? " gap" : " gaps") + " · " + num(c.warn) + (c.warn === 1 ? " needs attention" : " need attention") + " · " + num(c.none) + " no data · " + num(c.ok) + " OK";
}

function barCell(g, p) {
  const c = g.counts[p];
  const text = PILLAR_LABEL[p] + ": " + barText(c);
  const segs = HEAT_STACK.filter((s) => c[s] > 0);
  return html`<td class="sbc"><span class="sbw" tabindex="0" data-tip="${text}"><span class="sb" role="img" aria-label="${text}">${segs.map((s) => html`<i class="${s}" style="flex:${c[s]}"></i>`)}</span><small data-bad="${p}" class="${c.bad ? "bad" : ""}">${c.bad || ""}</small></span></td>`;
}

function appRow(r) {
  const a = r.app;
  return html`<tr data-id="${a.id}" data-dom="${a.domain}"><td><button type="button" class="nm" data-k="open-${a.id}" data-tip="${a.name}">${a.name}</button></td><td>${tierMark(a)}</td>${PILLARS.map((p) => {
    const s = r.status[p];
    return html`<td class="hc ${s.status}" data-pillar="${p}"><span>${dot(s.status)}<span class="hw"><span class="sr-only">${PILLAR_LABEL[p] + ": " + STATUS_WORD[s.status] + ". "}</span>${s.sentence}</span></span></td>`;
  })}</tr>`;
}

function groupRows(g, isOpen) {
  return html`<tr class="grp" data-group="${g.name}"><td colspan="2"><button type="button" class="gb" data-act="grp" data-grp="${g.name}" data-k="grp-${g.name}" aria-expanded="${isOpen ? "true" : "false"}">${icon("chevron")}${g.name} <span>${num(g.apps)}</span></button></td>${PILLARS.map((p) => barCell(g, p))}</tr>${isOpen ? g.rows.map(appRow) : ""}`;
}

/** The table for a model and the set of open group names. Pure. */
export function heatTable(m, openSet) {
  return html`<div class="tw"><table class="heat" data-table="heatmap"><thead><tr><th>Domain / application</th><th>Tier</th>${PILLARS.map((p) => html`<th>${PILLAR_LABEL[p]}</th>`)}</tr></thead><tbody>${m.groups.map((g) => groupRows(g, openSet.has(g.name)))}</tbody></table></div>`;
}

/** The results panel: count, legend, then the table or the empty state. Pure. */
export function heatView(m, openSet, all, hidden) {
  return html`<section class="panel results" aria-label="Applications by domain"><div class="rhead"><span class="rcount"><span data-count="visible"><b class="num">${num(m.total)}</b></span> <span class="mut" data-count="of">of ${count(all, "application")}</span>${hidden ? html` <span class="mut" data-count="hidden"> and ${count(hidden, "application")} hidden by the display settings</span>` : ""}</span><span class="mut hint">Bars show the share of applications per status; the red number counts gaps.</span></div>${m.total ? heatTable(m, openSet) : emptyView(all)}</section>`;
}

export const heatmapPage = {
  mount(el, ctx) {
    renderRegion(el, filtersShell(html``), { keepFocus: false, keepScroll: false });
    const content = qs(el, '[data-region="content"]');
    const offFilters = mountFilters(el);

    const draw = () => {
      const s = store.get();
      const visible = register.visibleRows();
      const m = heatmapModel(runQuery(visible, s));
      if (open === null && m.total) open = new Set([m.groups[0].name]);
      const shown = isSmall(m) ? new Set(m.groups.map((g) => g.name).filter((n) => !closedSmall.has(n))) : (open || new Set());
      renderRegion(content, html`<div data-page="heatmap">${heatView(m, shown, register.allRows().length, register.hiddenCount())}</div>`);
    };
    draw();

    if (memo && memo.key === queryFor(store.get())) {
      const y = memo.y;
      requestAnimationFrame(() => { if (ctx.current()) window.scrollTo(0, y); });
    }
    memo = null;

    const offs = [];
    offs.push(delegate(content, "click", "[data-act=grp]", (ev, b) => {
      const name = b.getAttribute("data-grp");
      const m = heatmapModel(runQuery(register.visibleRows(), store.get()));
      if (isSmall(m)) {
        if (closedSmall.has(name)) closedSmall.delete(name); else closedSmall.add(name);
      } else {
        if (open === null) open = new Set();
        if (open.has(name)) open.delete(name); else open.add(name);
      }
      draw();
    }));
    offs.push(delegate(content, "click", "tr[data-id]", (ev, tr) => {
      memo = { y: window.scrollY, key: queryFor(store.get()) };
      navigate({ route: "app", app: tr.getAttribute("data-id"), tab: null, view: null }, "push");
    }));
    const offStore = store.subscribe((s, p) => { if (s.q !== p.q || s.f !== p.f) { closedSmall = new Set(); draw(); } });
    const offReg = register.subscribe(draw);
    return () => { offReg(); offStore(); offs.forEach((f) => f()); offFilters(); };
  },
};

registerPage("heatmap", heatmapPage);

/** Test seam. */
export function __resetHeatmapForTest() {
  open = null;
  closedSmall = new Set();
  memo = null;
}
