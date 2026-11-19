// Page-level block composed from shadcn/ui new-york v4 anatomy (MIT; see THIRD_PARTY_NOTICES.md),
// the dashboard body: summary cards, a range-switched area chart and a tabbed table.
import { html } from "@gas-kit/client/html.js";
import { areaChart } from "../components/areaChart.js";
import { badge } from "../components/badge.js";
import { card } from "../components/card.js";
import { dataTable } from "../components/dataTable.js";
import { tabs } from "../components/tabs.js";
import { toggleGroup } from "../components/toggleGroup.js";

/** @param {unknown} v */
const has = (v) => v != null && v !== false && v !== "";

/** @param {string[]} paths */
const icon = (paths) => html`<svg class="gk-sectionCards__icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths.map((d) => html`<path d="${d}"></path>`)}</svg>`;
const TREND = {
  up: { word: "Up", sign: "+", shape: icon(["M16 7h6v6", "m22 7-8.5 8.5-5-5L2 17"]) },
  down: { word: "Down", sign: "-", shape: icon(["M16 17h6v-6", "m22 17-8.5-8.5-5 5L2 7"]) },
  flat: { word: "Unchanged", sign: "", shape: icon(["M5 12h14"]) },
};

/**
 * The direction of a trend from its sign, the badge text and the shape. Null for a missing or non-finite value.
 * @param {any} t
 */
function trendOf(t) {
  if (!t || typeof t !== "object" || typeof t.value !== "number" || !isFinite(t.value)) return null;
  const rounded = Math.round(Math.abs(t.value) * 10) / 10;
  const dir = rounded === 0 ? "flat" : t.value > 0 ? "up" : "down";
  return { dir, rounded, ...TREND[dir] };
}

/** @param {unknown} v */
const valueText = (v) => (typeof v === "number" && isFinite(v) ? v.toLocaleString("en-US") : v);

/**
 * @component sectionCards
 * @title Section Cards
 * @category Dashboard
 * @summary A responsive grid of summary cards: label, big value, an outline trend badge and two footer lines.
 * @param {{cards: Array<{label: string, value: number|string, trend?: {value: number}, note?: string, sub?: string}>, k?: string}} p
 * `cards` are laid out in 1, 2 or 4 columns by the width of the grid itself (container queries at 36rem and 64rem). `value` is text, or a number shown with thousands separators. `trend.value` is a percent; its direction comes from its sign (positive up, negative down, zero unchanged) and the badge shows a trend shape, the signed number and a screen-reader word (Up, Down, Unchanged), so the direction is never colour alone. `note` is the bold footer line (it repeats the trend shape) and `sub` the muted one. `k` prefixes each card's data-k (default "cards").
 * @emits none
 * @states default, no-trend, empty
 * @a11y Each card title is a heading holding the label and the value as one text run. The trend badge reads, for example, "Up 12.5%". The grid is a plain list container with no role.
 * @example default: sectionCards({ k: "sc-a", cards: [{ label: "Total revenue", value: "$1,250.00", trend: { value: 12.5 }, note: "Trending up this month", sub: "Visitors for the last 6 months" }, { label: "New customers", value: 1234, trend: { value: -20 }, note: "Down 20% this period", sub: "Acquisition needs attention" }, { label: "Active accounts", value: 45678, trend: { value: 0 }, note: "Steady retention", sub: "Engagement exceeds targets" }, { label: "Growth rate", value: "4.5%", trend: { value: 4.5 }, note: "Steady performance increase", sub: "Meets growth projections" }] })
 * @example no-trend: sectionCards({ k: "sc-b", cards: [{ label: "Open items", value: 42 }, { label: "Closed this week", value: 17, sub: "Since Monday" }] })
 * @example empty: sectionCards({ k: "sc-c", cards: [] })
 */
export function sectionCards(p) {
  const q = p || /** @type {any} */ ({});
  const list = Array.isArray(q.cards) ? q.cards.filter((/** @type {any} */ c) => c && typeof c === "object") : [];
  const k = has(q.k) ? String(q.k) : "cards";
  return html`<div class="gk-sectionCards"><div class="gk-sectionCards__grid">${list.map((/** @type {any} */ c, /** @type {number} */ i) => {
    const t = trendOf(c.trend);
    const footer = has(c.note) || has(c.sub)
      ? html`${has(c.note) ? html`<div class="gk-sectionCards__note">${c.note}${t ? t.shape : ""}</div>` : ""}${has(c.sub) ? html`<div class="gk-sectionCards__sub">${c.sub}</div>` : ""}`
      : null;
    return card({
      k: k + "-" + i,
      title: html`<span class="gk-sectionCards__label">${c.label}</span><span class="sr-only">: </span><span class="gk-sectionCards__value">${valueText(c.value)}</span>`,
      action: t ? badge({ variant: "outline", text: /** @type {any} */ (html`${t.shape}<span class="sr-only">${t.word} </span>${t.sign}${t.rounded}%`) }) : null,
      footer,
    });
  })}</div></div>`;
}

/**
 * @component chartCard
 * @title Chart Card
 * @category Dashboard
 * @summary A card holding an area chart, with an optional time-range toggle group in the card action.
 * @param {{title: string, description?: string, data: Array<Record<string, unknown>>, xKey: string, series: Array<{key: string, label?: string, color?: string, pattern?: "none"|"stripes"|"dots"}>, ranges?: Array<{value: string, label: string}>, range?: string, act?: string, curve?: "natural"|"linear"|"step"|"monotone", stacked?: boolean, legend?: boolean, enter?: boolean, height?: number, valueFormat?: ((v: number) => string)|"number"|"percent"|"compact", xFormat?: ((v: unknown) => string)|"number"|"percent"|"compact", k?: string}} p
 * The chart takes `data`, `xKey` and `series` as `areaChart` does (gradient fill, 250px tall, `curve`, `stacked`, `legend`, `enter`, `height` and the formatters pass through). `ranges` adds an outline single-choice toggle group (for example 90d, 30d, 7d) whose selected item is `range`; the app filters `data` to the range and re-renders on the act (default "chartCard:range", with the choice in data-v). `k` namespaces the ids and keys (default "chart-card"). Mount toggleGroupIsland after every render when `ranges` is set. Needs chartParts.css.
 * @emits chartCard:range (data-v, data-k; or the act you pass)
 * @states default, ranges, empty
 * @a11y The card title is a heading and the chart is an image named by the title, with a focusable target per category and a screen-reader table. The range control is a radio group named "Time range" with arrow-key roving, and the selected item differs by fill and weight, not colour alone.
 * @example default: chartCard({ k: "cc-a", title: "Total visitors", description: "Total for the last 6 months", data: [{ m: "Jan", d: 186, mo: 80 }, { m: "Feb", d: 305, mo: 200 }, { m: "Mar", d: 237, mo: 120 }, { m: "Apr", d: 73, mo: 190 }, { m: "May", d: 209, mo: 130 }, { m: "Jun", d: 214, mo: 140 }], xKey: "m", series: [{ key: "d", label: "Desktop", color: "chart-1" }, { key: "mo", label: "Mobile", color: "chart-2" }], stacked: true })
 * @example ranges: chartCard({ k: "cc-b", title: "Total visitors", description: "Total for the last 3 months", ranges: [{ value: "90d", label: "Last 3 months" }, { value: "30d", label: "Last 30 days" }, { value: "7d", label: "Last 7 days" }], range: "90d", data: [{ m: "Jan", d: 186 }, { m: "Feb", d: 305 }, { m: "Mar", d: 237 }, { m: "Apr", d: 73 }], xKey: "m", series: [{ key: "d", label: "Visitors" }] })
 * @example empty: chartCard({ k: "cc-c", title: "Total visitors", data: [], xKey: "m", series: [{ key: "d", label: "Visitors" }] })
 */
export function chartCard(p) {
  const q = p || /** @type {any} */ ({});
  const k = has(q.k) ? String(q.k) : "chart-card";
  const ranges = Array.isArray(q.ranges) ? q.ranges.filter((/** @type {any} */ r) => r && has(r.value)) : [];
  const chart = areaChart({
    title: has(q.title) ? String(q.title) : undefined, data: q.data, xKey: q.xKey, series: q.series, curve: q.curve, stacked: q.stacked, legend: q.legend,
    enter: q.enter, height: q.height != null ? q.height : 250, valueFormat: q.valueFormat, xFormat: q.xFormat, gradient: true, k: k + "-chart",
  });
  const action = ranges.length
    ? toggleGroup({ label: "Time range", variant: "outline", size: "sm", k: k + "-range", act: has(q.act) ? String(q.act) : "chartCard:range", value: q.range, items: ranges.map((/** @type {any} */ r) => ({ value: String(r.value), text: has(r.label) ? String(r.label) : String(r.value) })) })
    : null;
  return card({ title: q.title, description: q.description, action, content: chart, k });
}

/**
 * @component dataTableCard
 * @title Data Table Card
 * @category Dashboard
 * @summary A tabbed table: a row of tabs over a kit dataTable (the tabs are optional).
 * @param {{table?: object, tabs?: {label: string, tabs: Array<{value: string, text?: string, disabled?: boolean, tip?: string}>, value?: string|null, variant?: "default"|"line", act?: string, k?: string}, k?: string}} p
 * `table` takes the props of the `dataTable` view (caption, columns, rows, sort and so on) and is the panel of the selected tab. `tabs` takes the props of the `tabs` view without `content`; the app picks the rows for the selected tab and re-renders on the act (default "tabs:select"). Without `tabs` only the table is drawn. `k` prefixes the tabs' keys (default "table-tabs"). Mount tabsIsland after every render when `tabs` is set.
 * @emits tabs:select (data-v), plus dataTable:sort, dataTable:more, dataTable:clear and dataTable:retry from the table
 * @states default, no-tabs, empty
 * @a11y The tabs are a labelled tablist with arrow-key roving and a focusable tabpanel; the table keeps its caption, sortable column buttons and row semantics.
 * @example default: dataTableCard({ k: "dtc-a", tabs: { label: "Views", value: "outline", tabs: [{ value: "outline", text: "Outline" }, { value: "past", text: "Past performance" }, { value: "people", text: "Key personnel" }] }, table: { caption: "Sections", columns: [{ key: "name", label: "Section", sortable: true }, { key: "status", label: "Status" }, { key: "owner", label: "Reviewer" }], rows: [{ name: "Cover page", status: "Done", owner: "Dana Reyes" }, { name: "Table of contents", status: "In progress", owner: "Sam Okafor" }] } })
 * @example no-tabs: dataTableCard({ k: "dtc-b", table: { caption: "Sections", columns: [{ key: "name", label: "Section" }], rows: [{ name: "Cover page" }] } })
 * @example empty: dataTableCard({ k: "dtc-c", tabs: { label: "Views", value: "outline", tabs: [{ value: "outline", text: "Outline" }] }, table: { caption: "Sections", columns: [{ key: "name", label: "Section" }], rows: [] } })
 */
export function dataTableCard(p) {
  const q = p || /** @type {any} */ ({});
  const k = has(q.k) ? String(q.k) : "table-tabs";
  const panel = q.table && typeof q.table === "object" ? dataTable(/** @type {any} */ (q.table)) : "";
  const t = q.tabs && typeof q.tabs === "object" ? q.tabs : null;
  return html`<div class="gk-dataTableCard">${t ? tabs({ ...t, k: has(t.k) ? t.k : k, content: panel }) : panel}</div>`;
}

/**
 * @component dashboard
 * @title Dashboard
 * @category Dashboard
 * @summary A dashboard page body: summary cards, a range-switched area chart and a tabbed table, stacked with even spacing.
 * @param {{cards?: Array<{label: string, value: number|string, trend?: {value: number}, note?: string, sub?: string}>, chart?: object, table?: object, tabs?: object, k?: string}} p
 * Each part is optional and drawn only when given. `cards` go to `sectionCards`, `chart` (title, description, data, xKey, series, ranges, range, act and the other chartCard props) to `chartCard`, and `table` with `tabs` to `dataTableCard`. `k` prefixes the keys of the parts ("<k>-cards", "<k>-chart", "<k>-table"; default "dash"). Put it in the `content` of `appShell`, which supplies the padding. Mount toggleGroupIsland (when `chart.ranges` is set) and tabsIsland (when `tabs` is set) after every render. Needs card.css, badge.css, toggleGroup.css, tabs.css, dataTable.css, areaChart.css and chartParts.css; the manifest lists them as cssDeps.
 * @emits chartCard:range (data-v; or the chart's act), tabs:select (data-v; or the tabs' act), plus the dataTable acts
 * @states default, cards-only, empty
 * @a11y The parts keep their own semantics: headed cards, a chart with a screen-reader table, a labelled tablist and a captioned table. Trend direction is a shape and a word, never colour alone.
 * @example default: dashboard({ k: "dash-a", cards: [{ label: "Total revenue", value: "$1,250.00", trend: { value: 12.5 }, note: "Trending up this month", sub: "Visitors for the last 6 months" }, { label: "New customers", value: 1234, trend: { value: -20 }, note: "Down 20% this period", sub: "Acquisition needs attention" }, { label: "Active accounts", value: 45678, trend: { value: 12.5 }, note: "Strong user retention", sub: "Engagement exceeds targets" }, { label: "Growth rate", value: "4.5%", trend: { value: 4.5 }, note: "Steady performance increase", sub: "Meets growth projections" }], chart: { title: "Total visitors", description: "Total for the last 3 months", ranges: [{ value: "90d", label: "Last 3 months" }, { value: "30d", label: "Last 30 days" }, { value: "7d", label: "Last 7 days" }], range: "90d", data: [{ m: "Jan", d: 186, mo: 80 }, { m: "Feb", d: 305, mo: 200 }, { m: "Mar", d: 237, mo: 120 }, { m: "Apr", d: 73, mo: 190 }, { m: "May", d: 209, mo: 130 }, { m: "Jun", d: 214, mo: 140 }], xKey: "m", series: [{ key: "d", label: "Desktop", color: "chart-1" }, { key: "mo", label: "Mobile", color: "chart-2" }], stacked: true }, tabs: { label: "Views", value: "outline", tabs: [{ value: "outline", text: "Outline" }, { value: "past", text: "Past performance" }, { value: "people", text: "Key personnel" }] }, table: { caption: "Sections", columns: [{ key: "name", label: "Section", sortable: true }, { key: "status", label: "Status" }, { key: "owner", label: "Reviewer" }], rows: [{ name: "Cover page", status: "Done", owner: "Dana Reyes" }, { name: "Table of contents", status: "In progress", owner: "Sam Okafor" }, { name: "Executive summary", status: "Done", owner: "Dana Reyes" }] } })
 * @example cards-only: dashboard({ k: "dash-b", cards: [{ label: "Open items", value: 42, trend: { value: -3 }, note: "Down 3% this week" }, { label: "Closed items", value: 17 }] })
 * @example empty: dashboard({ k: "dash-c" })
 */
export function dashboard(p) {
  const q = p || /** @type {any} */ ({});
  const k = has(q.k) ? String(q.k) : "dash";
  const cards = Array.isArray(q.cards) && q.cards.length ? q.cards : null;
  const chart = q.chart && typeof q.chart === "object" ? q.chart : null;
  const table = q.table && typeof q.table === "object" ? q.table : null;
  const t = q.tabs && typeof q.tabs === "object" ? q.tabs : null;
  return html`<div class="gk-dashboard">${cards ? sectionCards({ cards, k: k + "-cards" }) : ""}${chart ? chartCard(/** @type {any} */ ({ ...chart, k: k + "-chart" })) : ""}${table || t ? dataTableCard(/** @type {any} */ ({ table: table || undefined, tabs: t || undefined, k: k + "-table" })) : ""}</div>`;
}
