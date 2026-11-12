// The Inventory page (identity G, route id 'list'): the facet panel on the left, then saved views
// as tabs, a header line with the count, the active-filter tags, Columns and Export, the pillar
// tabs and the sortable table. Search is the shell's (shell/appbar.js). Sort, columns and filters
// live in the store and the URL; the limit does not. Everything is computed here in
// the browser over the whole register. Opening an application remembers the scroll position so
// Back lands where the viewer was.
import { delegate, qs, renderRegion } from "../lib/dom.js";
import { html } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { count, num } from "../lib/format.js";
import { closePopovers, openPopover } from "../lib/popover.js";
import { toggled, withFacet } from "../components/toolbar.js";
import { facetPanelView } from "../components/facetPanel.js";
import { mountViewTabs } from "../components/viewTabs.js";
import { tabKeys } from "../lib/tabKeys.js";
import { chooserView, readCols, writeCols } from "../components/columnChooser.js";
import { exportMenuView, runExport } from "../components/exportMenu.js";
import { PAGE_STEP, emptyView, moreView, sortAfter, tableView } from "../components/table.js";
import { registerPage } from "../shell/router.js";
import * as register from "../state/register.js";
import { store } from "../state/store.js";
import { navigate, queryFor, replace } from "../state/url.js";
import { ALL_ID } from "../state/views.js";
import { FACETS, PILLAR_LABEL } from "../../domain/facets";
import { PILLARS } from "../../domain/types";
import { activeFilterCount, pillarCounts, pillarTabOf, runQuery, withPillarTab } from "../../domain/query";
import { toggleColumnKey, visibleColumnDefs } from "../../domain/columns";

let restoredCols = false;
let memo = null;

const PILLAR_TABS = ["all", ...PILLARS];
const tabName = (t) => (t === "all" ? "All" : PILLAR_LABEL[t]);

/** The tags of the active filters: the search text and one per facet with a selection. Pure. */
export function activeTags(s) {
  const tags = [];
  if (s.q && s.q.trim()) tags.push({ act: "rm-q", key: "q", label: "Search: \u201c" + s.q.trim() + "\u201d" });
  for (const d of FACETS) {
    const v = s.f[d.key];
    if (v && v.length) tags.push({ act: "clear-facet", key: d.key, label: d.label + ": " + v.join(", ") });
  }
  return tags;
}

/** The header line: 'N of M applications', the active-filter tags, Columns and Export. */
export function headView(s, shown, total, hidden) {
  const tags = activeTags(s);
  const n = activeFilterCount(s.f);
  return html`<div class="rhead"><span class="rcount"><span data-count="visible"><b class="num mono">${num(shown)}</b></span> <span class="mut" data-count="of">of ${count(total, "application")}</span>${hidden ? html` <span class="mut" data-count="hidden"> and ${count(hidden, "application")} hidden by the display settings</span>` : ""}</span><span class="ftags">${tags.map((t) => html`<span class="ftag" data-tag="${t.key}"><span data-tip="${t.label}">${t.label}</span><button type="button" data-act="${t.act}" data-facet="${t.key}" data-k="tag-${t.key}" aria-label="Remove ${t.label}">${icon("close", 10)}</button></span>`)}${tags.length ? html`<button type="button" class="tlink" data-act="clear-all" data-k="clear-all">Clear all</button>` : ""}</span><div class="rtools"><button type="button" class="tlink fbtn" data-act="fopen" data-k="fopen" aria-haspopup="dialog" aria-expanded="false">Filters${n ? " (" + n + ")" : ""}</button><button type="button" class="tlink" data-act="cols" data-k="cols" aria-haspopup="dialog" aria-expanded="false">Columns</button><button type="button" class="tlink" data-act="export" data-k="export" aria-haspopup="dialog" aria-expanded="false">Export</button></div></div>`;
}

/** The pillar tabs: All and one per pillar, each with its count over the filtered set. Pure. */
export function pillarTabsView(s, visible) {
  const c = pillarCounts(visible, { q: s.q, f: s.f });
  const on = pillarTabOf(s.f);
  return html`<div class="ptabs" role="tablist" aria-label="Pillar">${PILLAR_TABS.map((t) => {
    const sel = on === t;
    const n = t === "all" ? c.all : c.gaps[t];
    const word = t === "all" ? "shown" : n === 1 ? "gap" : "gaps";
    return html`<button type="button" role="tab" class="pt pc-${t}" tabindex="${sel || (on === null && t === "all") ? "0" : "-1"}" aria-selected="${sel ? "true" : "false"}" aria-controls="inv-panel" data-act="ptab" data-tab="${t}" data-k="pt-${t}"><span class="k">${tabName(t)}</span><span class="v"><b class="num mono">${num(n)}</b> ${word}</span></button>`;
  })}</div>`;
}

/** The whole results area for a store state. Pure. */
export function resultsView(s, all, visible, hidden, limit) {
  const rows = runQuery(visible, s);
  const cols = visibleColumnDefs(s.cols, s.sort);
  const drawn = rows.slice(0, limit);
  return html`${headView(s, rows.length, all, hidden)}${pillarTabsView(s, visible)}<section class="tbl" id="inv-panel" role="tabpanel" aria-label="Applications">${rows.length ? html`${tableView({ cols, rows: drawn, sort: s.sort, desc: s.desc })}${moreView(drawn.length, rows.length)}` : emptyView(visible.length)}</section>`;
}

export const listPage = {
  mount(el, ctx) {
    renderRegion(el, html`<div class="wb"><aside class="facets" data-region="facets" aria-label="Filters"></aside><button type="button" class="fscrim" data-act="fclose" data-k="fscrim" aria-label="Close filters" tabindex="-1"></button><div class="wmain"><div class="views-slot" data-slot="views"></div><div data-region="content" data-page="list"></div></div></div>`, { keepFocus: false, keepScroll: false });
    const aside = qs(el, '[data-region="facets"]');
    const content = qs(el, '[data-region="content"]');
    const wb = qs(el, ".wb");
    const offViews = mountViewTabs(qs(el, "[data-slot=views]"));

    const first = store.get();
    if (!restoredCols) {
      restoredCols = true;
      const saved = readCols();
      if (!first.cols.length && saved.length && (!first.currentViewId || first.currentViewId === ALL_ID)) replace({ cols: saved });
    }

    let chooser = null;
    let exporter = null;
    let drawer = false;
    const panel = { open: new Set(), finds: {} };

    const drawFacets = () => {
      const s = store.get();
      renderRegion(aside, html`<div class="fhead"><b>Filters</b><button type="button" class="tlink" data-act="fclose" data-k="fdone">Done</button></div>${facetPanelView(s, register.visibleRows(), panel)}`);
    };
    const drawDrawer = () => {
      wb.classList.toggle("fopen", drawer);
      if (drawer) { aside.setAttribute("role", "dialog"); aside.setAttribute("aria-modal", "true"); }
      else { aside.removeAttribute("role"); aside.removeAttribute("aria-modal"); }
      const b = qs(content, '[data-act="fopen"]');
      if (b) b.setAttribute("aria-expanded", drawer ? "true" : "false");
    };
    const draw = () => {
      const s = store.get();
      const visible = register.visibleRows();
      renderRegion(content, resultsView(s, register.allRows().length, visible, register.hiddenCount(), s.limit));
      drawDrawer();
      if (chooser) {
        chooser.update(chooserView(s.cols, s.sort));
        chooser.setAnchor(qs(content, '[data-act="cols"]'));
      }
      if (exporter) {
        exporter.update(exportMenuView(runQuery(visible, s).length));
        exporter.setAnchor(qs(content, '[data-act="export"]'));
      }
    };
    drawFacets();
    draw();

    if (memo && memo.key === queryFor(store.get())) {
      const y = memo.y;
      requestAnimationFrame(() => { if (ctx.current()) window.scrollTo(0, y); });
    }
    memo = null;

    const open = (id) => {
      memo = { y: window.scrollY, key: queryFor(store.get()) };
      navigate({ route: "app", app: id, tab: null, view: null }, "push");
    };

    const setF = (f) => replace({ f, limit: PAGE_STEP });
    const setDrawer = (on) => {
      if (drawer === on) return;
      drawer = on;
      drawDrawer();
      const t = on ? qs(aside, '[data-k="fdone"]') : qs(content, '[data-act="fopen"]');
      if (t && typeof t.focus === "function") t.focus({ preventScroll: true });
    };

    const openChooser = (btn) => {
      if (chooser) { chooser.close(); return; }
      const h = openPopover(btn, chooserView(store.get().cols, store.get().sort), {
        label: "Columns", align: "end",
        onClose: () => { if (chooser === h) chooser = null; },
      });
      chooser = h;
      h.el.classList.add("pop-cols");
      h.setAnchor(btn);
      delegate(h.el, "change", "[data-act=col]", (ev, input) => {
        const s = store.get();
        const next = toggleColumnKey(s.cols, input.getAttribute("data-col"), s.sort);
        writeCols(next);
        replace({ cols: next });
      });
      delegate(h.el, "click", "[data-act=cols-reset]", () => {
        writeCols([]);
        replace({ cols: [] });
      });
    };

    const exportCtx = () => {
      const s = store.get();
      return { rows: runQuery(register.visibleRows(), s), cols: visibleColumnDefs(s.cols, s.sort), route: "list", today: (s.live && s.live.today) || "", title: "Inventory" };
    };
    const openExport = (btn) => {
      if (exporter) { exporter.close(); return; }
      const h = openPopover(btn, exportMenuView(exportCtx().rows.length), {
        label: "Export", align: "end",
        onClose: () => { if (exporter === h) exporter = null; },
      });
      exporter = h;
      h.el.classList.add("pop-menu");
      h.setAnchor(btn);
      delegate(h.el, "click", "[data-act^=export-]", (ev, b) => {
        const kind = b.getAttribute("data-act").slice("export-".length);
        const ctx = exportCtx();
        h.close();
        runExport(kind, ctx);
      });
    };

    const clearAll = () => {
      panel.finds = {};
      replace({ q: "", f: {}, limit: PAGE_STEP });
    };

    const offs = [];
    offs.push(tabKeys(content));
    offs.push(delegate(content, "click", "[data-act]", (ev, b) => {
      const act = b.getAttribute("data-act");
      const s = store.get();
      if (act === "sort") {
        const col = visibleColumnDefs(s.cols, s.sort).find((c) => c.key === b.getAttribute("data-col"));
        if (col) replace({ ...sortAfter(s.sort, s.desc, col), limit: PAGE_STEP });
      } else if (act === "more") store.set({ limit: s.limit + PAGE_STEP });
      else if (act === "clear-all") clearAll();
      else if (act === "ptab") setF(withPillarTab(s.f, b.getAttribute("data-tab")));
      else if (act === "rm-q") replace({ q: "", limit: PAGE_STEP });
      else if (act === "clear-facet") setF(withFacet(s.f, b.getAttribute("data-facet"), []));
      else if (act === "fopen") setDrawer(!drawer);
      else if (act === "cols") openChooser(b);
      else if (act === "export") openExport(b);
    }));
    offs.push(delegate(content, "click", "tr[data-id]", (ev, tr) => open(tr.getAttribute("data-id"))));
    offs.push(delegate(aside, "click", "[data-act]", (ev, b) => {
      const act = b.getAttribute("data-act");
      const key = b.getAttribute("data-facet");
      if (act === "clear-facet") setF(withFacet(store.get().f, key, []));
      else if (act === "more-facet") {
        if (panel.open.has(key)) { panel.open.delete(key); delete panel.finds[key]; } else panel.open.add(key);
        drawFacets();
      } else if (act === "fclose") setDrawer(false);
    }));
    offs.push(delegate(aside, "change", "[data-act=pick]", (ev, input) => setF(toggled(store.get().f, input.getAttribute("data-facet"), input.getAttribute("data-v"), input.checked))));
    offs.push(delegate(aside, "input", "[data-find]", (ev, input) => {
      panel.finds = { ...panel.finds, [input.getAttribute("data-find")]: input.value };
      drawFacets();
    }));
    offs.push(delegate(el, "click", ".fscrim", () => setDrawer(false)));
    const onKey = (ev) => { if (ev.key === "Escape" && drawer && !document.querySelector(".pop")) setDrawer(false); };
    document.addEventListener("keydown", onKey);

    const offStore = store.subscribe((s, p) => {
      if (s.q !== p.q || s.f !== p.f) drawFacets();
      if (s.q !== p.q || s.f !== p.f || s.sort !== p.sort || s.desc !== p.desc || s.cols !== p.cols || s.limit !== p.limit) draw();
    });
    const offReg = register.subscribe(() => { drawFacets(); draw(); });
    return () => { document.removeEventListener("keydown", onKey); offViews(); offReg(); offStore(); offs.forEach((f) => f()); closePopovers(false); };
  },
};

registerPage("list", listPage);

/** Test seam. */
export function __resetListForTest() {
  restoredCols = false;
  memo = null;
}
