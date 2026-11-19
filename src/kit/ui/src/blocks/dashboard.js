// Page-level block composed from shadcn/ui new-york v4 anatomy (MIT; see THIRD_PARTY_NOTICES.md),
// the dashboard body: summary cards, a range-switched area chart and a tabbed table.
import { html, attrs } from "@gas-kit/client/html.js";
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
 * @param {{title: string, description?: string, data: Array<Record<string, unknown>>, xKey: string, series: Array<{key: string, label?: string, color?: string, pattern?: "none"|"stripes"|"dots"}>, ranges?: Array<{value: string, label: string, description?: string}>, range?: string, datasets?: Record<string, Array<Record<string, unknown>>>, act?: string, curve?: "natural"|"linear"|"step"|"monotone", stacked?: boolean, legend?: boolean, enter?: boolean, height?: number, valueFormat?: ((v: number) => string)|"number"|"percent"|"compact", xFormat?: ((v: unknown) => string)|"number"|"percent"|"compact", k?: string}} p
 * The chart takes `data`, `xKey` and `series` as `areaChart` does (gradient fill, 250px tall, `curve`, `stacked`, `legend`, `enter`, `height` and the formatters pass through). `ranges` adds an outline single-choice toggle group (for example 90d, 30d, 7d) whose selected item is `range`; the app filters `data` to the range and re-renders on the act (default "chartCard:range", with the choice in data-v). `k` namespaces the ids and keys (default "chart-card"). `datasets` (a map of range value to the rows for that range; a range with no entry uses `data`) switches to an uncontrolled mode like `tabs` `panels`: one chart is drawn per range, `hidden` on all but the selected one, and toggleGroupIsland switches them on click with no app code; the act is still sent, so an app can listen. A range may carry a `description`, shown in place of the card description while it is selected (the card `description` is used when none is given). Mount chartFitIsland as well as toggleGroupIsland: a chart drawn hidden is refitted by its resize observer when it is shown. Mount toggleGroupIsland after every render when `ranges` is set. Needs chartParts.css.
 * @emits chartCard:range (data-v, data-k; or the act you pass)
 * @states default, ranges, datasets, empty
 * @a11y The card title is a heading and the chart is an image named by the title, with a focusable target per category and a screen-reader table. The range control is a radio group named "Time range" with arrow-key roving, and the selected item differs by fill and weight, not colour alone.
 * @example default: chartCard({ k: "cc-a", title: "Total visitors", description: "Total for the last 3 months", ranges: [{ value: "90d", label: "Last 3 months", description: "Total for the last 3 months" }, { value: "30d", label: "Last 30 days", description: "Total for the last 30 days" }, { value: "7d", label: "Last 7 days", description: "Total for the last 7 days" }], range: "90d", datasets: { "90d": [{ m: "Jul 6", d: 1341, mo: 850 }, { m: "Jul 13", d: 1205, mo: 945 }, { m: "Jul 20", d: 1590, mo: 698 }, { m: "Jul 27", d: 1192, mo: 608 }, { m: "Aug 3", d: 1120, mo: 951 }, { m: "Aug 10", d: 1662, mo: 836 }, { m: "Aug 17", d: 1160, mo: 767 }, { m: "Aug 24", d: 1632, mo: 1089 }, { m: "Aug 31", d: 1468, mo: 823 }, { m: "Sep 7", d: 1276, mo: 648 }, { m: "Sep 14", d: 1368, mo: 759 }, { m: "Sep 21", d: 1126, mo: 806 }, { m: "Sep 28", d: 1378, mo: 738 }], "30d": [{ m: "Sep 1", d: 372, mo: 241 }, { m: "Sep 4", d: 404, mo: 322 }, { m: "Sep 7", d: 425, mo: 184 }, { m: "Sep 10", d: 485, mo: 248 }, { m: "Sep 13", d: 501, mo: 261 }, { m: "Sep 16", d: 459, mo: 225 }, { m: "Sep 19", d: 375, mo: 225 }, { m: "Sep 22", d: 451, mo: 233 }, { m: "Sep 25", d: 352, mo: 302 }, { m: "Sep 28", d: 406, mo: 163 }], "7d": [{ m: "Mon", d: 147, mo: 123 }, { m: "Tue", d: 149, mo: 115 }, { m: "Wed", d: 134, mo: 102 }, { m: "Thu", d: 164, mo: 126 }, { m: "Fri", d: 146, mo: 105 }, { m: "Sat", d: 167, mo: 70 }, { m: "Sun", d: 139, mo: 89 }] }, data: [], xKey: "m", series: [{ key: "d", label: "Desktop", color: "chart-1" }, { key: "mo", label: "Mobile", color: "chart-2" }], stacked: true })
 * @example ranges: chartCard({ k: "cc-b", title: "Total visitors", description: "Total for the last 3 months", ranges: [{ value: "90d", label: "Last 3 months" }, { value: "30d", label: "Last 30 days" }, { value: "7d", label: "Last 7 days" }], range: "90d", data: [{ m: "Jan", d: 186 }, { m: "Feb", d: 305 }, { m: "Mar", d: 237 }, { m: "Apr", d: 73 }], xKey: "m", series: [{ key: "d", label: "Visitors" }] })
 * @example datasets: chartCard({ k: "cc-d", title: "Sign-ups", ranges: [{ value: "90d", label: "Last 3 months", description: "Total for the last 3 months" }, { value: "30d", label: "Last 30 days", description: "Total for the last 30 days" }, { value: "7d", label: "Last 7 days", description: "Total for the last 7 days" }], range: "30d", datasets: { "90d": [{ m: "Aug 24", d: 832, mo: 362 }, { m: "Aug 31", d: 741, mo: 363 }, { m: "Sep 7", d: 936, mo: 660 }, { m: "Sep 14", d: 843, mo: 605 }, { m: "Sep 21", d: 973, mo: 671 }, { m: "Sep 28", d: 941, mo: 698 }], "30d": [{ m: "Sep 16", d: 283, mo: 138 }, { m: "Sep 19", d: 326, mo: 145 }, { m: "Sep 22", d: 248, mo: 172 }, { m: "Sep 25", d: 356, mo: 145 }, { m: "Sep 28", d: 321, mo: 200 }], "7d": [{ m: "Mon", d: 108, mo: 53 }, { m: "Tue", d: 91, mo: 58 }, { m: "Wed", d: 107, mo: 83 }, { m: "Thu", d: 117, mo: 56 }, { m: "Fri", d: 120, mo: 71 }] }, data: [], xKey: "m", series: [{ key: "d", label: "Web" }] })
 * @example empty: chartCard({ k: "cc-c", title: "Total visitors", data: [], xKey: "m", series: [{ key: "d", label: "Visitors" }] })
 */
export function chartCard(p) {
  const q = p || /** @type {any} */ ({});
  const k = has(q.k) ? String(q.k) : "chart-card";
  const ranges = Array.isArray(q.ranges) ? q.ranges.filter((/** @type {any} */ r) => r && has(r.value)) : [];
  const draw = (/** @type {any} */ data, /** @type {string} */ kk) => areaChart({
    title: has(q.title) ? String(q.title) : undefined, data, xKey: q.xKey, series: q.series, curve: q.curve, stacked: q.stacked, legend: q.legend,
    enter: q.enter, height: q.height != null ? q.height : 250, valueFormat: q.valueFormat, xFormat: q.xFormat, gradient: true, k: kk,
  });
  const ds = q.datasets && typeof q.datasets === "object" && ranges.length ? q.datasets : null;
  const want = q.range == null ? null : String(q.range);
  const sel = ds ? (ranges.some((/** @type {any} */ r) => String(r.value) === want) ? want : String(ranges[0].value)) : null;
  const chart = ds
    ? html`${ranges.map((/** @type {any} */ r) => html`<div ${attrs({ "data-set": k + "-range", "data-v": String(r.value), hidden: String(r.value) !== sel })}>${draw(Array.isArray(ds[r.value]) ? ds[r.value] : q.data, k + "-chart-" + r.value)}</div>`)}`
    : draw(q.data, k + "-chart");
  const descs = ds && ranges.some((/** @type {any} */ r) => has(r.description))
    ? html`${ranges.map((/** @type {any} */ r) => html`<span ${attrs({ "data-set": k + "-range", "data-v": String(r.value), hidden: String(r.value) !== sel })}>${has(r.description) ? r.description : q.description}</span>`)}`
    : q.description;
  const action = ranges.length
    ? toggleGroup({ label: "Time range", variant: "outline", size: "sm", k: k + "-range", act: has(q.act) ? String(q.act) : "chartCard:range", value: ds ? sel : q.range, controls: ds ? k + "-range" : undefined, items: ranges.map((/** @type {any} */ r) => ({ value: String(r.value), text: has(r.label) ? String(r.label) : String(r.value) })) })
    : null;
  return card({ title: q.title, description: descs, action, content: chart, k });
}

/**
 * @component dataTableCard
 * @title Data Table Card
 * @category Dashboard
 * @summary A tabbed table: a row of tabs over a kit dataTable (the tabs are optional).
 * @param {{table?: object, tabs?: {label: string, tabs: Array<{value: string, text?: string, disabled?: boolean, tip?: string}>, value?: string|null, variant?: "default"|"line", act?: string, k?: string}, tables?: Record<string, object>, k?: string}} p
 * `table` takes the props of the `dataTable` view (caption, columns, rows, sort and so on) and is the panel of the selected tab. `tabs` takes the props of the `tabs` view without `content`; the app picks the rows for the selected tab and re-renders on the act (default "tabs:select"). `tables` maps a tab value to the props of that tab's `dataTable` and makes the tabs switch on their own (the uncontrolled mode of `tabs`); a tab with no entry shows `table`. Without `tabs` only the table is drawn. `k` prefixes the tabs' keys (default "table-tabs"). Mount tabsIsland after every render when `tabs` is set.
 * @emits tabs:select (data-v), plus dataTable:sort, dataTable:more, dataTable:clear and dataTable:retry from the table
 * @states default, no-tabs, empty
 * @a11y The tabs are a labelled tablist with arrow-key roving and a focusable tabpanel; the table keeps its caption, sortable column buttons and row semantics.
 * @example default: dataTableCard({ k: "dtc-a", tabs: { label: "Views", value: "outline", tabs: [{ value: "outline", text: "Outline" }, { value: "past", text: "Past performance" }, { value: "people", text: "Key personnel" }] }, tables: { past: { caption: "Past performance", columns: [{ key: "name", label: "Project", sortable: true }, { key: "year", label: "Year", kind: "num" }, { key: "result", label: "Result" }, { key: "team", label: "Team" }], rows: [{ name: "Acme Portal", year: "2025", result: "Delivered on time", team: "Platform" }, { name: "Acme Archive", year: "2024", result: "Delivered early", team: "Records" }, { name: "Acme Billing", year: "2024", result: "Delivered on time", team: "Finance" }, { name: "Acme Identity", year: "2023", result: "Delivered late", team: "Security" }, { name: "Acme Reports", year: "2023", result: "Delivered early", team: "Analytics" }, { name: "Acme Mobile", year: "2022", result: "Delivered on time", team: "Platform" }] }, people: { caption: "Key personnel", columns: [{ key: "name", label: "Name", sortable: true }, { key: "role", label: "Role" }, { key: "team", label: "Team" }], rows: [{ name: "Dana Reyes", role: "Programme lead", team: "Platform" }, { name: "Sam Okafor", role: "Security reviewer", team: "Security" }, { name: "Alex Lee", role: "Technical writer", team: "Records" }, { name: "Priya Nair", role: "Delivery manager", team: "Platform" }, { name: "Jordan Kim", role: "Data analyst", team: "Analytics" }, { name: "Taylor Brooks", role: "Finance partner", team: "Finance" }] } }, table: { caption: "Proposal sections", columns: [{ key: "name", label: "Section", sortable: true }, { key: "type", label: "Type" }, { key: "status", label: "Status", kind: "status" }, { key: "pages", label: "Pages", kind: "num" }, { key: "owner", label: "Reviewer" }], rows: [{ name: "Cover page", type: "Cover page", status: badge({ text: "Done", variant: "ok" }), pages: 1, owner: "Dana Reyes" }, { name: "Table of contents", type: "Table of contents", status: badge({ text: "Done", variant: "ok" }), pages: 2, owner: "Sam Okafor" }, { name: "Executive summary", type: "Narrative", status: badge({ text: "In progress", variant: "info" }), pages: 12, owner: "Dana Reyes" }, { name: "Technical approach", type: "Narrative", status: badge({ text: "Needs review", variant: "warn" }), pages: 24, owner: "Alex Lee" }, { name: "Design approach", type: "Narrative", status: badge({ text: "In progress", variant: "info" }), pages: 8, owner: "Sam Okafor" }, { name: "Capabilities", type: "Narrative", status: badge({ text: "Done", variant: "ok" }), pages: 6, owner: "Alex Lee" }, { name: "Integration with existing systems", type: "Narrative", status: badge({ text: "Blocked", variant: "bad" }), pages: 14, owner: "Dana Reyes" }, { name: "Innovation and Advantages", type: "Narrative", status: badge({ text: "Needs review", variant: "warn" }), pages: 5, owner: "Sam Okafor" }] } })
 * @example no-tabs: dataTableCard({ k: "dtc-b", table: { caption: "Sections", columns: [{ key: "name", label: "Section" }], rows: [{ name: "Cover page" }] } })
 * @example empty: dataTableCard({ k: "dtc-c", tabs: { label: "Views", value: "outline", tabs: [{ value: "outline", text: "Outline" }] }, table: { caption: "Sections", columns: [{ key: "name", label: "Section" }], rows: [] } })
 */
export function dataTableCard(p) {
  const q = p || /** @type {any} */ ({});
  const k = has(q.k) ? String(q.k) : "table-tabs";
  const panel = q.table && typeof q.table === "object" ? dataTable(/** @type {any} */ (q.table)) : "";
  const t = q.tabs && typeof q.tabs === "object" ? q.tabs : null;
  const tb = q.tables && typeof q.tables === "object" ? q.tables : null;
  const panels = t && tb ? Object.fromEntries((Array.isArray(t.tabs) ? t.tabs : []).map((/** @type {any} */ x) => [x.value, tb[x.value] && typeof tb[x.value] === "object" ? dataTable(/** @type {any} */ (tb[x.value])) : panel])) : null;
  return html`<div class="gk-dataTableCard">${t ? tabs({ ...t, k: has(t.k) ? t.k : k, content: panel, ...(panels ? { panels } : {}) }) : panel}</div>`;
}

/**
 * @component dashboard
 * @title Dashboard
 * @category Dashboard
 * @summary A dashboard page body: summary cards, a range-switched area chart and a tabbed table, stacked with even spacing.
 * @param {{cards?: Array<{label: string, value: number|string, trend?: {value: number}, note?: string, sub?: string}>, chart?: object, table?: object, tables?: Record<string, object>, tabs?: object, k?: string}} p
 * Each part is optional and drawn only when given. `cards` go to `sectionCards`, `chart` (title, description, data, xKey, series, ranges, range, act and the other chartCard props) to `chartCard`, and `table` with `tabs` (and the per-tab `tables`, which make the tabs switch on their own) to `dataTableCard`. `k` prefixes the keys of the parts ("<k>-cards", "<k>-chart", "<k>-table"; default "dash"). Put it in the `content` of `appShell`, which supplies the padding. Mount toggleGroupIsland and chartFitIsland (when `chart.ranges` is set; `chart.datasets` makes the range switch on its own) and tabsIsland (when `tabs` is set) after every render. Needs card.css, badge.css, toggleGroup.css, tabs.css, dataTable.css, areaChart.css and chartParts.css; the manifest lists them as cssDeps.
 * @emits chartCard:range (data-v; or the chart's act), tabs:select (data-v; or the tabs' act), plus the dataTable acts
 * @states default, cards-only, empty
 * @a11y The parts keep their own semantics: headed cards, a chart with a screen-reader table, a labelled tablist and a captioned table. Trend direction is a shape and a word, never colour alone.
 * @example default: dashboard({ k: "dash-a", cards: [{ label: "Total revenue", value: "$1,250.00", trend: { value: 12.5 }, note: "Trending up this month", sub: "Visitors for the last 6 months" }, { label: "New customers", value: 1234, trend: { value: -20 }, note: "Down 20% this period", sub: "Acquisition needs attention" }, { label: "Active accounts", value: 45678, trend: { value: 12.5 }, note: "Strong user retention", sub: "Engagement exceeds targets" }, { label: "Growth rate", value: "4.5%", trend: { value: 4.5 }, note: "Steady performance increase", sub: "Meets growth projections" }], chart: { title: "Total visitors", description: "Total for the last 3 months", ranges: [{ value: "90d", label: "Last 3 months", description: "Total for the last 3 months" }, { value: "30d", label: "Last 30 days", description: "Total for the last 30 days" }, { value: "7d", label: "Last 7 days", description: "Total for the last 7 days" }], range: "90d", datasets: { "90d": [{ m: "Jul 6", d: 1341, mo: 850 }, { m: "Jul 13", d: 1205, mo: 945 }, { m: "Jul 20", d: 1590, mo: 698 }, { m: "Jul 27", d: 1192, mo: 608 }, { m: "Aug 3", d: 1120, mo: 951 }, { m: "Aug 10", d: 1662, mo: 836 }, { m: "Aug 17", d: 1160, mo: 767 }, { m: "Aug 24", d: 1632, mo: 1089 }, { m: "Aug 31", d: 1468, mo: 823 }, { m: "Sep 7", d: 1276, mo: 648 }, { m: "Sep 14", d: 1368, mo: 759 }, { m: "Sep 21", d: 1126, mo: 806 }, { m: "Sep 28", d: 1378, mo: 738 }], "30d": [{ m: "Sep 1", d: 372, mo: 241 }, { m: "Sep 4", d: 404, mo: 322 }, { m: "Sep 7", d: 425, mo: 184 }, { m: "Sep 10", d: 485, mo: 248 }, { m: "Sep 13", d: 501, mo: 261 }, { m: "Sep 16", d: 459, mo: 225 }, { m: "Sep 19", d: 375, mo: 225 }, { m: "Sep 22", d: 451, mo: 233 }, { m: "Sep 25", d: 352, mo: 302 }, { m: "Sep 28", d: 406, mo: 163 }], "7d": [{ m: "Mon", d: 147, mo: 123 }, { m: "Tue", d: 149, mo: 115 }, { m: "Wed", d: 134, mo: 102 }, { m: "Thu", d: 164, mo: 126 }, { m: "Fri", d: 146, mo: 105 }, { m: "Sat", d: 167, mo: 70 }, { m: "Sun", d: 139, mo: 89 }] }, data: [], xKey: "m", series: [{ key: "d", label: "Desktop", color: "chart-1" }, { key: "mo", label: "Mobile", color: "chart-2" }], stacked: true }, tabs: { label: "Views", value: "outline", tabs: [{ value: "outline", text: "Outline" }, { value: "past", text: "Past performance" }, { value: "people", text: "Key personnel" }] }, tables: { past: { caption: "Past performance", columns: [{ key: "name", label: "Project" }, { key: "year", label: "Year" }, { key: "result", label: "Result" }], rows: [{ name: "Acme Portal", year: "2025", result: "Delivered on time" }, { name: "Acme Archive", year: "2024", result: "Delivered early" }] }, people: { caption: "Key personnel", columns: [{ key: "name", label: "Name" }, { key: "role", label: "Role" }], rows: [{ name: "Dana Reyes", role: "Programme lead" }, { name: "Sam Okafor", role: "Security reviewer" }] } }, table: { caption: "Sections", columns: [{ key: "name", label: "Section", sortable: true }, { key: "status", label: "Status" }, { key: "owner", label: "Reviewer" }], rows: [{ name: "Cover page", status: "Done", owner: "Dana Reyes" }, { name: "Table of contents", status: "In progress", owner: "Sam Okafor" }, { name: "Executive summary", status: "Done", owner: "Dana Reyes" }] } })
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
  return html`<div class="gk-dashboard">${cards ? sectionCards({ cards, k: k + "-cards" }) : ""}${chart ? chartCard(/** @type {any} */ ({ ...chart, k: k + "-chart" })) : ""}${table || t ? dataTableCard(/** @type {any} */ ({ table: table || undefined, tabs: t || undefined, tables: q.tables, k: k + "-table" })) : ""}</div>`;
}
