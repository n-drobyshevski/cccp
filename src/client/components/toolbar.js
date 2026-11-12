// The filter toolbar over the register: search (debounced 120 ms), the pills Tier / Domain /
// Lifecycle / Security officer / Gap in with their checklist popovers, Clear all and the
// Filter panel icon button (with the count of selected values). While the panel is open, chips replace the pills. The state is the
// shared filter state in the store (q and f), written through url.replace, so the address, the
// pills, the panel and the page all read one source. Saved views (viewTabs.js) render into
// [data-slot=views] at the top of the toolbar.
import { delegate, qs, renderRegion } from "../lib/dom.js";
import { html } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { closePopovers, openPopover } from "../lib/popover.js";
import * as register from "../state/register.js";
import { store } from "../state/store.js";
import { replace } from "../state/url.js";
import { FACET_BY_KEY } from "../../domain/facets";
import { activeFilterCount, facetOptions } from "../../domain/query";
import { facetPopover } from "./facetList.js";
import { panelView, readSide, writeSide } from "./filterPanel.js";
import { mountViewTabs } from "./viewTabs.js";

/** The facets that have a panel section and, with the panel closed, a pill after Tier. */
export const PILL_FACETS = ["dom", "lc", "so", "gap"];
/** Every pill in the row, in order. Tier stays a pill while the panel is open. */
export const ROW_PILLS = ["tier", ...PILL_FACETS];
export const SEARCH_DEBOUNCE_MS = 120;
export const SEARCH_PLACEHOLDER = "Search name, team, owner, officer";

/** The pill's visible value text: tier shows 'T1' as '1'; other values show as they are. */
const shown = (key, v) => (key === "tier" ? v.replace(/^T(\d)$/, "$1") : v);

/** 'Domain', or 'Domain: X' or 'Domain: X +2'. Tier lists its values: 'Tier: 1, 2'. An active
 *  Security officer pill says 'Officer' to leave room for the name; its tip says it in full. */
export function pillLabel(key, selected) {
  const s = selected || [];
  const label = key === "so" && s.length ? "Officer" : FACET_BY_KEY[key].label;
  if (!s.length) return label;
  if (key === "tier") return label + ": " + s.map((v) => shown(key, v)).join(", ");
  return label + ": " + s[0] + (s.length > 1 ? " +" + (s.length - 1) : "");
}

/** The full text of an active pill: the facet name and every selected value. '' when none. */
export function pillTip(key, selected) {
  const s = selected || [];
  return s.length ? FACET_BY_KEY[key].label + ": " + s.join(", ") : "";
}

/** The facet map with one value switched on or off. Empty lists are dropped. */
export function toggled(f, key, value, on) {
  const cur = f[key] || [];
  const next = on ? (cur.indexOf(value) >= 0 ? cur : cur.concat([value])) : cur.filter((v) => v !== value);
  return withFacet(f, key, next);
}

export function withFacet(f, key, values) {
  const out = { ...f };
  if (values.length) out[key] = values;
  else delete out[key];
  return out;
}

/** Facet keys with a selection, other than tier (which keeps its pill): what the chips show. */
export function chipKeys(f) {
  return Object.keys(f).filter((k) => k !== "tier" && FACET_BY_KEY[k] && f[k] && f[k].length);
}

/** The part of the toolbar row that follows the search box. */
export function rowView(s, popKey) {
  const n = activeFilterCount(s.f);
  const pillKeys = s.side ? ["tier"] : ROW_PILLS;
  const pills = pillKeys.map((k) => {
    const sel = s.f[k] || [];
    const tip = pillTip(k, sel);
    const name = tip ? html` aria-label="${tip}" data-tip="${tip}"` : "";
    return html`<span class="pw"><button type="button" class="pill${sel.length ? " on" : ""}" data-act="open" data-facet="${k}" data-k="pill-${k}" aria-haspopup="dialog" aria-expanded="${popKey === k ? "true" : "false"}"${name}><span>${pillLabel(k, sel)}</span>${icon("chevron")}</button></span>`;
  });
  const chips = chipKeys(s.f).flatMap((k) => s.f[k].map((v) => html`<span class="chip"><span>${FACET_BY_KEY[k].label}: ${v}</span><button type="button" data-act="rm" data-facet="${k}" data-v="${v}" data-k="chip-${k}-${v}" aria-label="Remove ${FACET_BY_KEY[k].label}: ${v}">×</button></span>`));
  const panelName = "Filter panel" + (n ? ", " + n + (n === 1 ? " filter" : " filters") : "");
  return html`${pills}${s.side ? chips : ""}${n || s.q ? html`<button type="button" class="linkbtn clr" data-act="clear-all" data-k="clear-all">Clear all</button>` : ""}<button type="button" class="pill sbtn" data-act="side" data-k="side" aria-pressed="${s.side ? "true" : "false"}" aria-label="${panelName}" data-tip="${panelName}">${icon("filter", 14)}${n ? html`<span class="badge">${n}</span>` : ""}</button>`;
}

/** The toolbar's static frame: the views slot, the search box, and the region that is redrawn. */
export function frameView(q) {
  return html`<section class="panel toolbar" aria-label="Filters">
    <div class="views-slot" data-slot="views"></div>
    <div class="row"><label class="search">${icon("search")}<input type="search" data-k="q" placeholder="${SEARCH_PLACEHOLDER}" value="${q}" aria-label="Search applications" autocomplete="off"></label><div class="tbdyn" data-region="tbdyn"></div></div>
  </section>`;
}

/** What a page puts in its markup: the toolbar host, then the content next to the panel. */
export function filtersShell(content) {
  return html`<div data-region="toolbar"></div><div class="body" data-region="body"><div class="main-col" data-region="content">${content}</div><aside class="side-host" data-region="panel"></aside></div>`;
}

/** The rows the filters work over: the register minus display-hidden apps. */
const scopeRows = () => register.visibleRows();

/**
 * Wire the toolbar, the pill popovers and the panel into `root` (the element holding
 * filtersShell markup). Returns a teardown.
 */
export function mountFilters(root) {
  const tbHost = qs(root, '[data-region="toolbar"]');
  const bodyEl = qs(root, '[data-region="body"]');
  const panelEl = qs(root, '[data-region="panel"]');
  if (!tbHost || !bodyEl || !panelEl) return () => {};

  const saved = readSide();
  if (saved !== null && saved !== store.get().side) store.set({ side: saved });

  const finds = { pop: "", side: {} };
  let popKey = null;
  let pop = null;
  let timer = 0;
  let typed = null;

  renderRegion(tbHost, frameView(store.get().q), { keepFocus: false, keepScroll: false });
  const input = qs(tbHost, "input[data-k=q]");
  const dyn = qs(tbHost, '[data-region="tbdyn"]');
  const offViews = mountViewTabs(qs(tbHost, "[data-slot=views]"));

  const apply = (patch) => replace({ ...patch, limit: 50 });
  const setF = (f) => apply({ f });

  const popView = () => {
    const s = store.get();
    const def = FACET_BY_KEY[popKey];
    return facetPopover({ key: popKey, label: def.label, big: def.big, find: finds.pop, options: facetOptions(scopeRows(), { q: s.q, f: s.f }, popKey) });
  };

  function drawPop() {
    if (!pop || !popKey) return;
    pop.update(popView());
    const a = qs(dyn, '[data-k="pill-' + popKey + '"]');
    if (a) pop.setAnchor(a);
  }

  function draw() {
    const s = store.get();
    renderRegion(dyn, rowView(s, popKey));
    renderRegion(panelEl, panelView(s, scopeRows(), PILL_FACETS, finds.side));
    bodyEl.classList.toggle("side-on", !!s.side);
    if (typed === null && document.activeElement !== input && input.value !== s.q) input.value = s.q;
    if (s.side && pop) closePopovers(false);
    drawPop();
  }

  function openFacet(key, anchor) {
    if (popKey === key) { closePopovers(true); return; }
    finds.pop = "";
    popKey = key;
    const h = openPopover(anchor, popView(), {
      label: FACET_BY_KEY[key].label + " filter",
      onClose: () => { if (pop === h) { pop = null; popKey = null; finds.pop = ""; } },
    });
    pop = h;
    delegate(h.el, "change", "[data-act=pick]", (ev, el) => setF(toggled(store.get().f, el.getAttribute("data-facet"), el.getAttribute("data-v"), el.checked)));
    delegate(h.el, "input", "[data-find]", (ev, el) => { finds.pop = el.value; drawPop(); });
    delegate(h.el, "click", "[data-act=clear-facet]", (ev, el) => { setF(withFacet(store.get().f, el.getAttribute("data-facet"), [])); closePopovers(true); });
    renderRegion(dyn, rowView(store.get(), popKey));
    const a = qs(dyn, '[data-k="pill-' + key + '"]');
    if (a) h.setAnchor(a);
  }

  const setSide = (open) => {
    writeSide(open);
    if (open) closePopovers(false);
    store.set({ side: open });
  };

  const clearAll = () => {
    clearTimeout(timer);
    typed = null;
    finds.pop = "";
    finds.side = {};
    input.value = "";
    closePopovers(false);
    apply({ q: "", f: {} });
  };

  const offs = [];
  offs.push(delegate(tbHost, "click", "[data-act]", (ev, b) => {
    const act = b.getAttribute("data-act");
    const s = store.get();
    if (act === "open") openFacet(b.getAttribute("data-facet"), b);
    else if (act === "rm") setF(toggled(s.f, b.getAttribute("data-facet"), b.getAttribute("data-v"), false));
    else if (act === "clear-all") clearAll();
    else if (act === "side") setSide(!s.side);
  }));
  offs.push(delegate(tbHost, "input", "input[data-k=q]", (ev, el) => {
    typed = el.value;
    clearTimeout(timer);
    timer = setTimeout(() => { const v = typed; typed = null; apply({ q: v }); }, SEARCH_DEBOUNCE_MS);
  }));
  offs.push(delegate(panelEl, "click", "[data-act]", (ev, b) => {
    const act = b.getAttribute("data-act");
    if (act === "side") setSide(false);
  }));
  offs.push(delegate(panelEl, "change", "[data-act=pick]", (ev, el) => setF(toggled(store.get().f, el.getAttribute("data-facet"), el.getAttribute("data-v"), el.checked))));
  offs.push(delegate(panelEl, "input", "[data-find]", (ev, el) => {
    finds.side = { ...finds.side, [el.getAttribute("data-find")]: el.value };
    draw();
  }));

  const offStore = store.subscribe((s, prev) => {
    if (s.q !== prev.q || s.f !== prev.f || s.side !== prev.side) draw();
  });
  const offReg = register.subscribe(draw);
  draw();

  return () => {
    clearTimeout(timer);
    offViews();
    offStore();
    offReg();
    offs.forEach((f) => f());
    closePopovers(false);
  };
}
