// Shared pieces of the native SVG charts: series and ids, grid and ticks, legend, the sr-only
// data table, patterns and the figure frame. Every export is an @internal helper.
// Anatomy and chrome follow shadcn/ui new-york v4 charts (MIT; see THIRD_PARTY_NOTICES.md).
import { cssValue, html } from "@gas-kit/client/html.js";
import { colorVar, fmtNum, linearScale, num, niceTicks, r2, stepTicks } from "./chartModel.js";

/** Default width of the drawing space. Mount chartFitIsland and the viewBox follows the container width, so 12px text stays 12px. */
export const VW = 600;

/** The narrowest drawing a cartesian chart takes: a `width` below it (a narrow card, a phone column) draws at this width, never back at VW. */
export const MIN_VW = 80;

/** The narrowest plot area left between the margins, so a narrow chart with wide labels keeps a drawable plot. */
export const MIN_PLOT = 40;

/** Named formats a chart accepts instead of a function; they survive the JSON props of chartFitIsland. */
export const NAMED_FORMATS = ["number", "percent", "compact", "signed"];

/**
 * @typedef {{key: string, label: string, color: string, pattern: string, index: number, legend?: boolean, fill?: boolean}} ChartSeries
 * @typedef {{title?: string, data?: Array<Record<string, unknown>>, series?: Array<{key: string, label?: string, color?: string, pattern?: string, legend?: boolean, fill?: boolean}>, height?: number, legend?: boolean, grid?: boolean, axes?: boolean|{x?: boolean, y?: boolean}, k?: string, enter?: boolean, emptyText?: string, valueFormat?: ((v: number) => string)|"number"|"percent"|"compact"|"signed", xFormat?: ((v: unknown) => string)|"number"|"percent"|"compact"|"signed", width?: number, inner?: boolean}} ChartProps
 */

/**
 * Normalised rows of a props object.
 * @internal
 * @param {ChartProps|undefined|null} q
 * @returns {Array<Record<string, unknown>>}
 */
export function rowsOf(q) {
  return q && Array.isArray(q.data) ? q.data.filter((r) => r && typeof r === "object") : [];
}

/**
 * Series with a resolved colour variable, label and pattern; `legend` false leaves one out of the
 * legend (never the tips or the table), `fill` asks lineChart for the area under it.
 * @internal
 * @param {ChartProps|undefined|null} q
 * @returns {ChartSeries[]}
 */
export function seriesOf(q) {
  const list = q && Array.isArray(q.series) ? q.series : [];
  return list.filter((s) => s && typeof s.key === "string" && s.key !== "").map((s, i) => ({
    key: s.key,
    label: s.label != null && s.label !== "" ? String(s.label) : s.key,
    color: colorVar(s.color, i),
    pattern: s.pattern === "stripes" || s.pattern === "dots" ? s.pattern : "none",
    index: i,
    legend: s.legend !== false,
    fill: s.fill === true,
  }));
}

/**
 * A DOM id prefix unique per chart: the `k` prop, reduced to id-safe characters.
 * @internal
 * @param {string|undefined} k
 * @returns {string}
 */
export function idPrefix(k) {
  return "gk-" + (typeof k === "string" && k ? k.replace(/[^A-Za-z0-9_-]/g, "-") : "chart");
}

/**
 * Plot box in the drawing space: `width` wide (default 600), `height` tall (default 250). A
 * positive `width` below MIN_VW draws at MIN_VW, and the width never leaves less than MIN_PLOT
 * between the margins; a missing, zero or non-numeric width is the default.
 * @internal
 * @param {ChartProps} q
 * @param {{left?: number, right?: number, top?: number, bottom?: number}} [m]
 * @returns {{w: number, h: number, l: number, r: number, t: number, b: number, iw: number, ih: number, axes: {x: boolean, y: boolean}}}
 */
export function plotBox(q, m = {}) {
  const h = num(q && q.height, 250) > 60 ? num(q.height, 250) : 250;
  const ax = q && q.axes;
  const axes = ax && typeof ax === "object" ? { x: ax.x !== false, y: ax.y === true } : { x: ax !== false, y: false };
  const l = (m.left == null ? 12 : m.left) + (axes.y ? 40 : 0);
  const r = m.right == null ? 12 : m.right;
  const t = m.top == null ? 12 : m.top;
  const b = (m.bottom == null ? 8 : m.bottom) + (axes.x ? 22 : 0);
  const asked = num(q && q.width, VW);
  const w = asked > 0 ? Math.max(MIN_VW, l + r + MIN_PLOT, Math.round(asked)) : VW;
  return { w, h, l, r, t, b, iw: w - l - r, ih: h - t - b, axes };
}

/**
 * SVG patterns for series that ask for one.
 * @internal
 * @param {string} pre id prefix
 * @param {ChartSeries[]} series
 */
export function patternDefs(pre, series) {
  const list = series.filter((s) => s.pattern !== "none");
  if (!list.length) return "";
  return html`${list.map((s) => (s.pattern === "stripes"
    ? html`<pattern id="${pre}-p${s.index}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)" style="--c:${cssValue(s.color)}"><rect width="6" height="6" class="gk-chart__pbg"></rect><rect width="3" height="6" class="gk-chart__pfg"></rect></pattern>`
    : html`<pattern id="${pre}-p${s.index}" width="6" height="6" patternUnits="userSpaceOnUse" style="--c:${cssValue(s.color)}"><rect width="6" height="6" class="gk-chart__pbg"></rect><circle cx="3" cy="3" r="1.5" class="gk-chart__pfg"></circle></pattern>`))}`;
}

/**
 * Inline style for a mark: the series colour as `--c` and the paint (colour or pattern).
 * @internal
 * @param {ChartSeries} s
 * @param {string} pre
 * @param {"fill"|"stroke"} [prop]
 * @returns {ReturnType<typeof html>}
 */
export function markStyle(s, pre, prop = "fill") {
  // cssValue refuses a colour that could end the declaration; the prefix is an idPrefix id.
  // A style value takes no plain string, so the paint and the property name are literal text.
  const paint = s.pattern !== "none" ? html`url(#${cssValue(pre)}-p${s.index})` : html`var(--c)`;
  return prop === "stroke" ? html`--c:${cssValue(s.color)};stroke:${paint}` : html`--c:${cssValue(s.color)};fill:${paint}`;
}

/**
 * Horizontal grid lines and the optional y tick labels.
 * @internal
 * @param {ReturnType<typeof plotBox>} box
 * @param {number[]} ticks
 * @param {(v: number) => number} y
 * @param {{grid: boolean, fmt: (v: number) => string}} o
 */
export function gridView(box, ticks, y, o) {
  return html`<g class="gk-chart__grid" aria-hidden="true">${o.grid ? ticks.map((t) => html`<line class="gk-chart__gridline" x1="${box.l}" x2="${box.w - box.r}" y1="${r2(y(t))}" y2="${r2(y(t))}"></line>`) : ""}${box.axes.y ? ticks.map((t) => html`<text class="gk-chart__tick" x="${box.l - 8}" y="${r2(y(t))}" dy="0.32em" text-anchor="end">${o.fmt(t)}</text>`) : ""}</g>`;
}

/**
 * X tick labels for n categories at the given x positions; labels are thinned so they do not
 * collide. Labels already fitted with an `anchor` (fitLinearTicks, timeTicks) are all drawn.
 * @internal
 * @param {ReturnType<typeof plotBox>} box
 * @param {Array<{x: number, text: string, anchor?: string}>} items
 */
export function xTicks(box, items) {
  if (!box.axes.x || !items.length) return "";
  const maxLabels = Math.max(1, Math.floor(box.iw / 56));
  const every = items[0].anchor ? 1 : Math.ceil(items.length / maxLabels);
  const y = box.h - box.b + 8 + 10;
  return html`<g class="gk-chart__xaxis" aria-hidden="true">${items.map((it, i) => (i % every ? "" : html`<text class="gk-chart__tick" x="${r2(it.x)}" y="${y}" text-anchor="${it.anchor || "middle"}">${it.text}</text>`))}</g>`;
}

/**
 * Value ticks for a domain: nice ticks from min(0, lo) to hi. `fixed` true is the 0 to 1 of a
 * percent stack; a `[min, max]` pair (a `yDomain`) is kept exactly, with the nice ticks inside it.
 * A positive `step` (a `yStep`) puts the ticks on its multiples, the ends rounded out to them
 * unless fixed; a step whose labels would sit closer than 16 units is widened by 2, 5, 10 and
 * so on until they do not.
 * @internal
 * @param {number} lo
 * @param {number} hi
 * @param {number} top range top (pixels)
 * @param {number} bottom range bottom (pixels)
 * @param {boolean|[number, number]|null} [fixed]
 * @param {unknown} [step]
 * @returns {{ticks: number[], y: (v: number) => number, min: number, max: number}}
 */
export function yScaleFor(lo, hi, top, bottom, fixed = false, step = 0) {
  const d = Array.isArray(fixed) ? fixed : null;
  let t = fixed === true ? { ticks: [0, 0.25, 0.5, 0.75, 1], min: 0, max: 1 }
    : d ? { ticks: niceTicks(d[0], d[1], 4).ticks.filter((v) => v >= d[0] && v <= d[1]), min: d[0], max: d[1] }
      : niceTicks(Math.min(0, lo), Math.max(0, hi), 4);
  let st = num(step);
  const a = d ? d[0] : Math.floor(Math.min(0, lo) / st + 1e-9) * st;
  const b = d ? d[1] : Math.ceil(Math.max(0, hi) / st - 1e-9) * st;
  if (st > 0 && fixed !== true && b > a) {
    for (let i = 0; Math.abs(bottom - top) * st / (b - a) < 16 && i < 40; i++) st *= i % 3 === 1 ? 2.5 : 2;
    t = { ticks: stepTicks(a, b, st), min: a, max: b };
  }
  return { ticks: t.ticks, min: t.min, max: t.max, y: linearScale(t.min, t.max, bottom, top) };
}

/**
 * A fixed value domain [min, max]: both ends parsed (numbers by default) and min below max, else null.
 * @internal
 * @param {unknown} v
 * @param {(x: unknown) => number|null} [parse]
 * @returns {[number, number]|null}
 */
export function domainPair(v, parse) {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const f = parse || ((/** @type {unknown} */ x) => (typeof x === "number" && Number.isFinite(x) ? x : null));
  const a = f(v[0]);
  const b = f(v[1]);
  return a != null && b != null && a < b ? [a, b] : null;
}

/**
 * The legend row: centred swatches with the labels always visible. A marker's swatch takes its
 * shape (`is-circle`, `is-triangle`, `is-square`, `is-diamond`) from chartParts.css, drawn as an
 * outline with `hollow`. An item with `legend: false` is left out.
 * @internal
 * @param {Array<{label: string, color: string, pattern: string, hollow?: boolean, legend?: boolean}>} items
 */
export function legendView(items) {
  const list = items.filter((it) => it.legend !== false);
  if (!list.length && items.length) return "";
  return html`<ul class="gk-chart__legend">${list.map((it) => html`<li class="gk-chart__legendItem"><i class="gk-chart__swatch is-${it.pattern}${it.hollow ? " is-hollow" : ""}" style="--c:${cssValue(it.color)}"></i><span>${it.label}</span></li>`)}</ul>`;
}

/**
 * Dashed reference lines across the plot, each labelled beside it (lineChart, scatterChart): `at`
 * is the pixel position on x (`vx`) or y. A label past the middle of x is written on the left.
 * @internal
 * @param {ReturnType<typeof plotBox>} box
 * @param {Array<{vx: boolean, at: number, label: string}>} refs
 */
export function refLinesView(box, refs) {
  if (!refs.length) return "";
  return html`<g class="gk-chart__refs" aria-hidden="true">${refs.map((m) => {
    const at = r2(m.at);
    const end = !m.vx || at > (box.l + box.w - box.r) / 2;
    return html`<line class="gk-chart__ref" x1="${m.vx ? at : box.l}" x2="${m.vx ? at : box.w - box.r}" y1="${m.vx ? box.t : at}" y2="${m.vx ? box.h - box.b : at}"></line><text class="gk-chart__refLabel" x="${m.vx ? r2(at + (end ? -6 : 6)) : box.w - box.r}" y="${m.vx ? box.t + 10 : r2(at - 6)}" text-anchor="${end ? "end" : "start"}">${m.label}</text>`;
  })}</g>`;
}

/**
 * Whether to show the legend: always for more than one series, otherwise when asked.
 * @internal
 * @param {ChartProps|undefined|null} q
 * @param {number} count
 * @returns {boolean}
 */
export function wantLegend(q, count) {
  return count > 1 || !!(q && q.legend);
}

/**
 * The sr-only data table that mirrors the drawing. It sits in an sr-only box rather than being one:
 * a table is never narrower than its content, so an sr-only table with long names still widens
 * the page at phone width, while the 1px box clips it.
 * @internal
 * @param {string} caption
 * @param {string[]} head column headings (the first one is the row heading)
 * @param {Array<Array<string|number>>} rows
 */
export function tableView(caption, head, rows) {
  return html`<div class="gk-chart__table sr-only"><table><caption>${caption}</caption><thead><tr>${head.map((h) => html`<th scope="col">${h}</th>`)}</tr></thead><tbody>${rows.map((r) => html`<tr>${r.map((c, i) => (i ? html`<td>${c}</td>` : html`<th scope="row">${c}</th>`))}</tr>`)}</tbody></table></div>`;
}

/**
 * The inside of a figure: the svg (role img, named), the legend and the table.
 * @internal
 * @param {{vh: number, vw?: number, fit?: boolean, defs?: unknown, body: unknown, legend?: unknown, table: unknown, name: string}} o
 */
export function frameInner(o) {
  const vw = o.vw || VW;
  const size = o.fit ? html` style="height:${o.vh}px;width:100%"` : "";
  return html`<svg class="gk-chart__svg" viewBox="0 0 ${vw} ${o.vh}"${size} role="img" aria-label="${o.name}" focusable="false"><defs>${o.defs || ""}</defs>${o.body}</svg>${o.legend || ""}${o.table}`;
}

/**
 * Whether a props object can travel as JSON: no function formatters.
 * @internal
 * @param {ChartProps} q
 * @returns {boolean}
 */
export function fitsJson(q) {
  return typeof q.valueFormat !== "function" && typeof q.xFormat !== "function" && typeof (/** @type {any} */ (q).categoryLabels) !== "function";
}

/** Views chartFitIsland can redraw, by kind. A cartesian view registers itself when it draws, so the island names no chart and an app bundles only the charts it calls. */
const FIT_VIEWS = /** @type {Record<string, (p: any) => unknown>} */ (Object.create(null));

/**
 * Registers the view chartFitIsland redraws a figure of this kind with. frameView calls it for
 * every cartesian chart it draws; a kind never drawn on the page stays unknown.
 * @internal
 * @param {string} kind
 * @param {(p: any) => unknown} view
 */
export function registerChartFit(kind, view) {
  if (typeof kind === "string" && kind && typeof view === "function") FIT_VIEWS[kind] = view;
}

/**
 * The registered view for a kind, by own key only, or null.
 * @internal
 * @param {unknown} kind
 * @returns {((p: any) => unknown)|null}
 */
export function fitView(kind) {
  return typeof kind === "string" && Object.prototype.hasOwnProperty.call(FIT_VIEWS, kind) ? FIT_VIEWS[kind] : null;
}

/**
 * The figure frame around every chart: the svg (role img, named), the legend and the table.
 * A cartesian chart (`fit`) has a fixed pixel height and the full width, and carries
 * data-mount="chartFit" with its kind and props, so chartFitIsland can redraw it at the measured
 * width; with a function formatter it keeps the static width. `inner: true` returns only the
 * inside of the figure (what the island renders into the figure it keeps). `view`, the chart's
 * own function, is registered for its kind so the island can redraw it.
 * @internal
 * @param {{q: ChartProps, kind: string, view?: (p: any) => unknown, vh: number, vw?: number, fit?: boolean, defs?: unknown, body: unknown, legend?: unknown, table: unknown, name: string}} o
 */
export function frameView(o) {
  if (o.fit && o.view) registerChartFit(o.kind, o.view);
  const inner = frameInner(o);
  if (o.q.inner) return inner;
  const mount = o.fit && fitsJson(o.q)
    ? html` data-mount="chartFit" data-props="${JSON.stringify({ kind: o.kind, props: { ...o.q, inner: undefined, width: undefined } })}"`
    : "";
  return html`<figure class="gk-chart gk-chart--${o.kind}"${o.q.enter ? html` data-enter="1"` : ""}${mount}>${inner}</figure>`;
}

/**
 * The empty state: a figure with a visible message.
 * @internal
 * @param {string} kind
 * @param {string|undefined} name
 * @param {string|undefined} text
 */
export function emptyView(kind, name, text) {
  return html`<figure class="gk-chart gk-chart--${kind} is-empty" role="group" aria-label="${name || "Chart"}"><p class="gk-chart__empty">${text || "No data"}</p></figure>`;
}

/**
 * The accessible name of a chart.
 * @internal
 * @param {ChartProps|undefined|null} q
 * @param {string} fallback
 * @returns {string}
 */
export function nameOf(q, fallback) {
  return q && typeof q.title === "string" && q.title ? q.title : fallback;
}

/**
 * Number formatter from props.
 * @internal
 * @param {ChartProps|undefined|null} q
 * @returns {(v: number) => string}
 */
export function valueFmt(q) {
  const f = q && q.valueFormat;
  if (typeof f === "function") return f;
  if (f === "percent") return (v) => (fmtNum(v) ? fmtNum(v) + "%" : "");
  if (f === "signed") return (v) => { const n = Number(v); const t = fmtNum(v) && fmtNum(Math.abs(n)); return t && t !== "0" ? (n > 0 ? "+" : "\u2212") + t : t; };
  if (f === "compact") return (v) => (Number.isFinite(Number(v)) && v != null && /** @type {unknown} */ (v) !== "" ? Number(v).toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 }) : "");
  return fmtNum;
}

/**
 * Text of a category cell.
 * @internal
 * @param {ChartProps|undefined|null} q
 * @param {unknown} v
 * @returns {string}
 */
export function catText(q, v) {
  if (q && typeof q.xFormat === "function") return String(q.xFormat(v));
  if (q && NAMED_FORMATS.indexOf(/** @type {string} */ (q.xFormat)) >= 0) return valueFmt({ valueFormat: q.xFormat })(Number(v));
  return v == null ? "" : String(v);
}

/**
 * The shared focus target for a category: a group with the hit area, named by the tip text.
 * @internal
 * @param {{k: string, i: number, tip: string, x: number, y: number, w: number, h: number, inner: unknown}} o
 */
export function categoryTarget(o) {
  return html`<g class="gk-chart__cat" tabindex="0" role="img" data-k="${o.k}-cat-${o.i}" data-tip="${o.tip}" aria-label="${o.tip}"><rect class="gk-chart__hit" x="${r2(o.x)}" y="${r2(o.y)}" width="${r2(Math.max(0, o.w))}" height="${r2(Math.max(0, o.h))}"></rect>${o.inner}</g>`;
}
