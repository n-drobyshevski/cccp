// The List page (lx3 inventory): the toolbar and right panel from mountFilters, a results head
// with the count, the status legend, Columns and Export, then the sortable table. Sort, columns
// and filters live in the store and the URL; the limit does not. Everything is computed here in
// the browser over the whole register. Opening an application remembers the scroll position so
// Back lands where the viewer was.
import { delegate, qs, renderRegion } from "../lib/dom.js";
import { html } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { count, num } from "../lib/format.js";
import { closePopovers, openPopover } from "../lib/popover.js";
import { toast } from "../lib/toast.js";
import { filtersShell, mountFilters } from "../components/toolbar.js";
import { chooserView, readCols, writeCols } from "../components/columnChooser.js";
import { legend } from "../components/legend.js";
import { PAGE_STEP, emptyView, moreView, sortAfter, tableView } from "../components/table.js";
import { registerPage } from "../shell/router.js";
import * as register from "../state/register.js";
import { store } from "../state/store.js";
import { navigate, queryFor, replace } from "../state/url.js";
import { ALL_ID } from "../state/views.js";
import { runQuery } from "../../domain/query";
import { toggleColumnKey, visibleColumnDefs } from "../../domain/columns";

let restoredCols = false;
let memo = null;

/** The results head: 'N of M applications', the hidden note, the legend and the tools. */
export function headView(shown, total, hidden) {
  return html`<div class="rhead"><span class="rcount"><span data-count="visible"><b class="num">${num(shown)}</b></span> <span class="mut" data-count="of">of ${count(total, "application")}</span>${hidden ? html` <span class="mut" data-count="hidden"> and ${count(hidden, "application")} hidden by the display settings</span>` : ""}</span>${legend()}<div class="rtools"><span class="pw"><button type="button" class="tbtn" data-act="cols" data-k="cols" aria-haspopup="dialog" aria-expanded="false">${icon("columns")}<span>Columns</span></button></span><button type="button" class="tbtn" data-act="export" data-k="export" aria-label="Export (arrives in a later step)" data-tip="Export arrives in a later step">${icon("download")}<span>Export</span></button></div></div>`;
}

/** The whole results panel for a store state. Pure. */
export function resultsView(s, all, visible, hidden, limit) {
  const rows = runQuery(visible, s);
  const cols = visibleColumnDefs(s.cols, s.sort);
  const drawn = rows.slice(0, limit);
  return html`<section class="panel results" aria-label="Applications">${headView(rows.length, all, hidden)}${rows.length ? html`${tableView({ cols, rows: drawn, sort: s.sort, desc: s.desc })}${moreView(drawn.length, rows.length)}` : emptyView(visible.length)}</section>`;
}

export const listPage = {
  mount(el, ctx) {
    renderRegion(el, filtersShell(html``), { keepFocus: false, keepScroll: false });
    const content = qs(el, '[data-region="content"]');
    const offFilters = mountFilters(el);

    const first = store.get();
    if (!restoredCols) {
      restoredCols = true;
      const saved = readCols();
      if (!first.cols.length && saved.length && (!first.currentViewId || first.currentViewId === ALL_ID)) replace({ cols: saved });
    }

    let chooser = null;
    const draw = () => {
      const s = store.get();
      const visible = register.visibleRows();
      renderRegion(content, html`<div data-page="list">${resultsView(s, register.allRows().length, visible, register.hiddenCount(), s.limit)}</div>`);
      if (chooser) {
        chooser.update(chooserView(s.cols, s.sort));
        chooser.setAnchor(qs(content, '[data-act="cols"]'));
      }
    };
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

    const offs = [];
    offs.push(delegate(content, "click", "[data-act]", (ev, b) => {
      const act = b.getAttribute("data-act");
      const s = store.get();
      if (act === "sort") {
        const col = visibleColumnDefs(s.cols, s.sort).find((c) => c.key === b.getAttribute("data-col"));
        if (col) replace({ ...sortAfter(s.sort, s.desc, col), limit: PAGE_STEP });
      } else if (act === "more") store.set({ limit: s.limit + PAGE_STEP });
      else if (act === "clear-all") replace({ q: "", f: {}, limit: PAGE_STEP });
      else if (act === "cols") openChooser(b);
      else if (act === "export") toast("Export is not available yet.");
    }));
    offs.push(delegate(content, "click", "tr[data-id]", (ev, tr) => open(tr.getAttribute("data-id"))));

    const offStore = store.subscribe((s, p) => {
      if (s.q !== p.q || s.f !== p.f || s.sort !== p.sort || s.desc !== p.desc || s.cols !== p.cols || s.limit !== p.limit) draw();
    });
    const offReg = register.subscribe(draw);
    return () => { offReg(); offStore(); offs.forEach((f) => f()); offFilters(); closePopovers(false); };
  },
};

registerPage("list", listPage);

/** Test seam. */
export function __resetListForTest() {
  restoredCols = false;
  memo = null;
}
