// Anatomy and styling ported from shadcn/ui new-york v4 charts (MIT; see THIRD_PARTY_NOTICES.md).
// A native SVG area chart: no dependency, no listeners; tooltips come from data-tip (tip.js).
import { cssValue, html } from "@gas-kit/client/html.js";
import { areaPath, curvePath, pointScale, r2, num, stackSeries } from "./chartModel.js";
import { categoryTarget, catText, emptyView, frameView, gridView, idPrefix, legendView, markStyle, nameOf, patternDefs, plotBox, rowsOf, seriesOf, tableView, valueFmt, wantLegend, xTicks, yScaleFor } from "./chartParts.js";

const CURVES = ["natural", "linear", "step", "monotone"];

/**
 * @component areaChart
 * @title Area Chart
 * @category Charts
 * @summary An SVG area chart over a row per category: one or more series, stacked or 100 percent stacked, with optional gradient and pattern fills.
 * @param {{title?: string, data: Array<Record<string, unknown>>, xKey: string, series: Array<{key: string, label?: string, color?: string, pattern?: "none"|"stripes"|"dots", legend?: boolean}>, curve?: "natural"|"linear"|"step"|"monotone", stacked?: boolean, expand?: boolean, gradient?: boolean, yStep?: number, legend?: boolean, grid?: boolean, axes?: boolean|{x?: boolean, y?: boolean}, height?: number, width?: number, k?: string, enter?: boolean, emptyText?: string, valueFormat?: ((v: number) => string)|"number"|"percent"|"compact"|"signed", xFormat?: ((v: unknown) => string)|"number"|"percent"|"compact"|"signed"}} p
 * `series[].color` is `chart-1` to `chart-6` or another token name (default: the next chart colour). `stacked` stacks the series, `expand` stacks them to 100 percent. `gradient` fades each fill from .8 to .1 opacity. `axes` shows the x labels by default and the y labels when `{y: true}`. `k` namespaces the ids and keys when several charts share a page. `enter` adds `data-enter` so the lines draw and the areas fade in (set it only when the data is new). Wrap it in a card: `card({ title, description, content: areaChart(...), footer })`; the chart is `height` px tall (default 250) and `width` units wide (default 600), full width of its container; a narrow `width` is drawn as given down to 80 units (never replaced by 600), so a chart in a narrow card or phone column keeps its 12px text. Mount `chartFitIsland` for a full-width chart: it redraws at the measured width so the text stays 12px. A function `valueFormat` or `xFormat` cannot travel as data, so such a chart keeps the static width; use the names "number", "percent" or "compact" to keep it fit.
 * `yStep` puts the y ticks on multiples of a step (as lineChart), `series[].legend: false` leaves a series out of the legend, and `valueFormat: "signed"` writes +12, −5 and 0.
 * @emits none
 * @states default, linear, step, stacked, expand, gradient, legend, pattern, empty
 * @a11y Apps mount chartFitIsland for a full-width chart; without it the chart still works at its fixed height. The svg is an image named by `title`; every category is one focusable group (tab stop) whose tip and label read all series ("Jan: Desktop 186, Mobile 80"). A sr-only table after the svg lists the same data; it sits in a 1px clipping box, so long names never widen the page at phone width. With more than one series the legend is always shown and `pattern` gives each series a texture, so colour is never the only signal.
 * @example default: areaChart({ title: "Visitors", data: [{ m: "Jan", d: 186 }, { m: "Feb", d: 305 }, { m: "Mar", d: 237 }, { m: "Apr", d: 73 }, { m: "May", d: 209 }, { m: "Jun", d: 214 }], xKey: "m", series: [{ key: "d", label: "Desktop", color: "chart-1" }], k: "area-a" })
 * @example linear: areaChart({ title: "Visitors", curve: "linear", data: [{ m: "Jan", d: 186 }, { m: "Feb", d: 305 }, { m: "Mar", d: 237 }], xKey: "m", series: [{ key: "d", label: "Desktop" }], k: "area-b" })
 * @example step: areaChart({ title: "Visitors", curve: "step", data: [{ m: "Jan", d: 186 }, { m: "Feb", d: 305 }, { m: "Mar", d: 237 }, { m: "Apr", d: 73 }], xKey: "m", series: [{ key: "d", label: "Desktop" }], k: "area-c" })
 * @example stacked: areaChart({ title: "Visitors by device", stacked: true, data: [{ m: "Jan", d: 186, mo: 80 }, { m: "Feb", d: 305, mo: 200 }, { m: "Mar", d: 237, mo: 120 }, { m: "Apr", d: 73, mo: 190 }], xKey: "m", series: [{ key: "d", label: "Desktop", color: "chart-1" }, { key: "mo", label: "Mobile", color: "chart-2" }], k: "area-d", enter: true })
 * @example expand: areaChart({ title: "Share of visitors", expand: true, axes: { x: true, y: true }, data: [{ m: "Jan", d: 186, mo: 80, t: 20 }, { m: "Feb", d: 305, mo: 200, t: 40 }, { m: "Mar", d: 237, mo: 120, t: 60 }], xKey: "m", series: [{ key: "d", label: "Desktop", color: "chart-1" }, { key: "mo", label: "Mobile", color: "chart-2" }, { key: "t", label: "Tablet", color: "chart-3" }], k: "area-e" })
 * @example gradient: areaChart({ title: "Visitors", gradient: true, data: [{ m: "Jan", d: 186, mo: 80 }, { m: "Feb", d: 305, mo: 200 }, { m: "Mar", d: 237, mo: 120 }], xKey: "m", series: [{ key: "d", label: "Desktop", color: "chart-1" }, { key: "mo", label: "Mobile", color: "chart-2" }], k: "area-f" })
 * @example legend: areaChart({ title: "Visitors", legend: true, data: [{ m: "Jan", d: 186 }, { m: "Feb", d: 305 }, { m: "Mar", d: 237 }], xKey: "m", series: [{ key: "d", label: "Desktop" }], k: "area-g" })
 * @example pattern: areaChart({ title: "Visitors by device", data: [{ m: "Jan", d: 186, mo: 80 }, { m: "Feb", d: 305, mo: 200 }, { m: "Mar", d: 237, mo: 120 }], xKey: "m", series: [{ key: "d", label: "Desktop", pattern: "stripes" }, { key: "mo", label: "Mobile", pattern: "dots" }], k: "area-h" })
 * @example empty: areaChart({ title: "Visitors", data: [], xKey: "m", series: [{ key: "d", label: "Desktop" }] })
 */
export function areaChart(p) {
  const q = p || /** @type {any} */ ({});
  const rows = rowsOf(q);
  const series = seriesOf(q);
  const name = nameOf(q, "Area chart");
  if (!rows.length || !series.length) return emptyView("area", name, q.emptyText);
  const k = q.k || "chart";
  const pre = idPrefix(q.k);
  const fmt = valueFmt(q);
  const expand = !!q.expand;
  const stacked = expand || !!q.stacked;
  const curve = CURVES.indexOf(String(q.curve)) >= 0 ? q.curve : "natural";
  const keys = series.map((s) => s.key);
  const box = plotBox(q, { top: 12 });
  const n = rows.length;
  const x = pointScale(n, box.l, box.w - box.r);
  /** @type {Array<Array<{y0: number, y1: number, v: number}>>} */
  let layers;
  let lo = 0;
  let hi = 0;
  if (stacked) {
    const st = stackSeries(rows, keys, expand ? "expand" : "none");
    layers = st.layers.map((l) => l.points);
    lo = st.min;
    hi = st.max;
  } else {
    layers = keys.map((key) => {
      const st = stackSeries(rows, [key]);
      lo = Math.min(lo, st.min);
      hi = Math.max(hi, st.max);
      return st.layers[0].points;
    });
  }
  const sc = yScaleFor(lo, hi, box.t, box.h - box.b, expand, q.yStep);
  const tickFmt = expand ? (/** @type {number} */ v) => Math.round(v * 100) + "%" : fmt;
  const cats = rows.map((r) => catText(q, r[q.xKey]));
  const grad = series.map((s) => (q.gradient && s.pattern === "none"
    ? html`<linearGradient id="${pre}-g${s.index}" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" style="stop-color:${cssValue(s.color)};stop-opacity:.8"></stop><stop offset="95%" style="stop-color:${cssValue(s.color)};stop-opacity:.1"></stop></linearGradient>`
    : ""));
  const areas = series.map((s) => {
    const pts = layers[s.index];
    const top = pts.map((pt, i) => /** @type {[number, number]} */ ([x(i), sc.y(pt.y1)]));
    const base = pts.map((pt, i) => /** @type {[number, number]} */ ([x(i), sc.y(pt.y0)]));
    const paint = q.gradient && s.pattern === "none" ? html`--c:${cssValue(s.color)};fill:url(#${cssValue(pre)}-g${s.index})` : markStyle(s, pre);
    const cls = "gk-chart__area" + (q.gradient || s.pattern !== "none" ? " is-solid" : "");
    return html`<path class="${cls}" style="${paint}" d="${areaPath(top, base, curve)}"></path><path class="gk-chart__line" style="--c:${cssValue(s.color)}" pathLength="1" d="${curvePath(top, curve)}"></path>`;
  });
  const targets = rows.map((r, i) => {
    const xl = i === 0 ? box.l : (x(i - 1) + x(i)) / 2;
    const xr = i === n - 1 ? box.w - box.r : (x(i) + x(i + 1)) / 2;
    const tip = cats[i] + ": " + series.map((s) => s.label + " " + (fmt(layers[s.index][i].v))).join(", ");
    const inner = html`<line class="gk-chart__cursor" x1="${r2(x(i))}" x2="${r2(x(i))}" y1="${box.t}" y2="${box.h - box.b}"></line>${series.map((s) => html`<circle class="gk-chart__dot" cx="${r2(x(i))}" cy="${r2(sc.y(layers[s.index][i].y1))}" r="4" style="--c:${cssValue(s.color)}" data-tip="${cats[i] + ": " + s.label + " " + fmt(layers[s.index][i].v)}"></circle>`)}`;
    return categoryTarget({ k, i, tip, x: xl, y: box.t, w: xr - xl, h: box.h - box.t, inner });
  });
  const body = html`${gridView(box, sc.ticks, sc.y, { grid: q.grid !== false, fmt: tickFmt })}${areas}${xTicks(box, cats.map((c, i) => ({ x: x(i), text: c })))}${targets}`;
  const table = tableView(name, [String(q.xKey || ""), ...series.map((s) => s.label)], rows.map((r, i) => [cats[i], ...series.map((s) => fmt(num(layers[s.index][i].v)))]));
  return frameView({ q, kind: "area", view: areaChart, vw: box.w, vh: box.h, fit: true, defs: html`${patternDefs(pre, series)}${grad}`, body, legend: wantLegend(q, series.length) ? legendView(series) : "", table, name });
}
