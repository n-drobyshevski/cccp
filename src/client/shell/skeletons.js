// The page-shaped loading frames (style C): every fixed word of the real page is already there,
// toolbar, column heads, pillar names, section and field names, tab names, and only the data
// values are pulsing blocks. The words come from the same constants the real pages read, so a
// renamed column or pillar cannot leave a skeleton behind. Each builder is pure and returns
// SafeHtml; skeleton(route, label) wraps one in the busy region the router and Settings share.
import { html } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { SEARCH_PLACEHOLDER } from "../components/toolbar.js";
import { ALL_VIEW } from "../state/views.js";
import { DEFAULT_COLUMN_KEYS, COLUMN_BY_KEY } from "../../domain/columns";
import { DQ_TITLE, factsheetOutline } from "../../domain/factsheet";
import { FACET_BY_KEY, PILLAR_LABEL } from "../../domain/facets";
import { HEATMAP_LEAD_HEADS } from "../../domain/heatmap";
import { LANDSCAPE_METRICS } from "../../domain/landscape";
import { OVERVIEW_TITLES, overviewModel } from "../../domain/overview";
import { PILLARS } from "../../domain/types";
import { SETTINGS_TABS } from "../pages/settings/draft.js";

/** The wait after which a calm second line appears. */
export const SLOW_AFTER_MS = 8000;
export const SLOW_TEXT = "Still loading. Large sheets take a moment.";

// A fixed spread of widths, so a skeleton looks the same every time it is drawn.
const W = [62, 48, 74, 55, 68, 40, 58, 71];
const w = (i) => W[i % W.length];

const bar = (width, cls) => html`<i class="sk${cls ? " " + cls : ""}" style="--w:${width}%"></i>`;
const dots = () => html`<span class="sk-dots"><i></i><i></i><i></i><i></i></span>`;
const rows = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));

// The filter toolbar the three filtered pages share.
function toolbar() {
  const pills = ["tier", "dom", "lc", "so", "gap"].map((k) => html`<span class="pill ld-hide-s"><span>${FACET_BY_KEY[k].label}</span>${icon("chevron")}</span>`);
  return html`<section class="panel ld-bar">
    <div class="ld-tab"><span>${ALL_VIEW.name}</span></div>
    <div class="ld-bar-row">
      <span class="ld-search">${icon("search")}<span>${SEARCH_PLACEHOLDER}</span></span>
      ${pills}
      <span class="pill">${icon("filter", 14)}</span>
    </div>
  </section>`;
}

function listView() {
  const cols = DEFAULT_COLUMN_KEYS.map((k) => COLUMN_BY_KEY[k]);
  const n = cols.length;
  const style = "grid-template-columns:2fr repeat(" + (n - 1) + ", minmax(0, 1fr))";
  return html`${toolbar()}
    <section class="panel ld-res">
      <div class="ld-head">${bar(14, "h")}<span class="ld-tools"><span>Columns</span><span>Export</span></span></div>
      <div class="ld-tbl">
        <div class="ld-tr ld-th" style="${style}">${cols.map((c, i) => html`<span class="${i > 2 ? "ld-hide-s" : ""}">${c.label}</span>`)}</div>
        ${rows(8, (r) => html`<div class="ld-tr" style="${style}">${cols.map((c, i) => html`<span class="${i > 2 ? "ld-hide-s" : ""}">${c.key === "st" ? dots() : c.key === "t" ? bar(60, "sq") : bar(i === 0 ? w(r) : w(r + i) - 12)}</span>`)}</div>`)}
      </div>
    </section>`;
}

function overviewView() {
  const m = overviewModel([]);
  return html`<div class="ld-ov">
    <div class="ld-title"><h1>Overview</h1>${bar(30, "h")}</div>
    <div class="ld-kpis">${m.kpis.map((k, i) => html`<div class="ld-kpi"><span>${k.label}</span>${bar(30 + i * 4, "big")}${bar(50, "")}</div>`)}</div>
    <div class="ld-two">
      <section class="panel ld-card"><h2>${OVERVIEW_TITLES.pillars}</h2>${m.pillars.map((p, i) => html`<div class="ld-pb"><span>${p.label}</span>${bar(w(i) + 20, "stack")}</div>`)}</section>
      <section class="panel ld-card"><h2>${OVERVIEW_TITLES.domains}</h2>${rows(4, (i) => html`<div class="ld-line">${bar(w(i))}<span class="ld-sp"></span>${bar(12, "sq")}</div>`)}</section>
    </div>
  </div>`;
}

function heatmapView() {
  const cols = HEATMAP_LEAD_HEADS.concat(PILLARS.map((p) => PILLAR_LABEL[p]));
  const style = "grid-template-columns:2fr repeat(" + (cols.length - 1) + ", minmax(0, 1fr))";
  return html`${toolbar()}
    <section class="panel ld-res">
      <div class="ld-head">${bar(14, "h")}</div>
      <div class="ld-tbl">
        <div class="ld-tr ld-th" style="${style}">${cols.map((c) => html`<span>${c}</span>`)}</div>
        ${rows(7, (r) => html`<div class="ld-tr" style="${style}"><span>${bar(w(r))}</span><span>${bar(40, "sq")}</span>${PILLARS.map((p, i) => html`<span>${bar(w(r + i + 2), "cell")}</span>`)}</div>`)}
      </div>
    </section>`;
}

function landscapeView() {
  return html`${toolbar()}
    <section class="panel ld-res">
      <div class="ld-head">${bar(14, "h")}</div>
      <div class="ld-metric"><span>Colour by</span>${LANDSCAPE_METRICS.map((m, i) => html`<span class="${i > 3 ? "ld-hide-s" : ""}">${m.label}</span>`)}</div>
      <div class="ld-boxes">${rows(3, (b) => html`<div class="ld-box"><div class="ld-boxh">${bar(w(b) - 10)}${bar(10, "sq")}</div><div class="ld-tiles">${rows(8 - b * 2, (t) => bar(w(t + b), "tile"))}</div></div>`)}</div>
    </section>`;
}

function appView() {
  const outline = factsheetOutline();
  return html`<div class="ld-app">
    <div class="ld-main panel">
      <span class="ld-back">${icon("arrowleft")}Back</span>
      <div class="ld-name">${bar(45, "title")}${bar(30, "")}</div>
      ${outline.map((s, i) => html`<div class="ld-sec"><h2>${s.title}</h2>${i < 3 ? s.labels.slice(0, 4).map((l, j) => html`<div class="ld-kv"><span>${l}</span>${bar(w(i + j) - 10)}</div>`) : ""}</div>`)}
    </div>
    <aside class="ld-dq panel"><h3>${DQ_TITLE}</h3>${bar(0, "ring")}${PILLARS.map((p, i) => html`<div class="ld-dqp"><b>${PILLAR_LABEL[p]}</b>${bar(w(i) + 10)}</div>`)}</aside>
  </div>`;
}

function settingsView() {
  return html`<div class="ld-set">
    <span class="ld-back">${icon("arrowleft")}Back</span>
    <div class="ld-title"><h1>Settings</h1>${bar(50, "")}</div>
    <div class="panel ld-card">
      <div class="ld-stabs">${SETTINGS_TABS.map((t, i) => html`<span class="${i === 0 ? "on" : ""}">${t.label}</span>`)}</div>
      <div class="ld-sbody">${bar(25, "h")}${rows(5, (i) => html`<div class="ld-kv"><span class="sk-lbl">${bar(60)}</span>${bar(w(i))}</div>`)}</div>
    </div>
  </div>`;
}

const BUILDERS = { overview: overviewView, list: listView, heatmap: heatmapView, landscape: landscapeView, app: appView, settings: settingsView };
const LABELS = { overview: "Opening the overview", list: "Loading the applications", heatmap: "Loading the heatmap", landscape: "Loading the landscape", app: "Opening the application", settings: "Opening the settings" };

export const SKELETON_ROUTES = Object.keys(BUILDERS);

/** A route-shaped loading frame. An unknown route (nothing routed yet) draws the list. */
export function skeleton(route, label) {
  const r = BUILDERS[route] ? route : "list";
  return html`<div class="ld ld-r-${r}" data-skeleton="${r}" role="status" aria-busy="true" aria-live="polite">
    <span class="sr-only">${label || LABELS[r]}</span>
    <div data-slot="slow"></div>
    <div class="ld-body" aria-hidden="true">${BUILDERS[r]()}</div>
  </div>`;
}
