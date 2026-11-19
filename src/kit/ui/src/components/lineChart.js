// Anatomy and styling ported from shadcn/ui new-york v4 charts (MIT; see THIRD_PARTY_NOTICES.md).
// A native SVG line chart: no dependency, no listeners; tooltips come from data-tip (tip.js).
import { cssValue, html } from "@gas-kit/client/html.js";
import { curvePath, num, pointScale, r2 } from "./chartModel.js";
import { categoryTarget, catText, emptyView, frameView, gridView, legendView, nameOf, plotBox, rowsOf, seriesOf, tableView, valueFmt, wantLegend, xTicks, yScaleFor } from "./chartParts.js";

const CURVES = ["natural", "linear", "step", "monotone"];

/**
 * @component lineChart
 * @title Line Chart
 * @category Charts
 * @summary An SVG line chart over a row per category: one or more lines with optional dots and value labels.
 * @param {{title?: string, data: Array<Record<string, unknown>>, xKey: string, series: Array<{key: string, label?: string, color?: string, pattern?: "none"|"stripes"|"dots"}>, curve?: "natural"|"linear"|"step"|"monotone", dots?: boolean, labels?: boolean, legend?: boolean, grid?: boolean, axes?: boolean|{x?: boolean, y?: boolean}, height?: number, width?: number, k?: string, enter?: boolean, emptyText?: string, valueFormat?: ((v: number) => string)|"number"|"percent"|"compact", xFormat?: ((v: unknown) => string)|"number"|"percent"|"compact"}} p
 * `series[].color` is `chart-1` to `chart-6` or another token name. `dots` draws a 4px dot per point; `labels` writes each value above its point. The stroke is 2px. With several series, `pattern` also gives each line a dash style (stripes: dashed, dots: dotted) so colour is never the only signal. `k` namespaces ids and keys; `enter` makes the lines draw in. Wrap it in a card: `card({ title, description, content: lineChart(...) })`. The chart is `height` px tall (default 250) and `width` units wide (default 600), full width of its container. Mount `chartFitIsland` for a full-width chart: it redraws at the measured width so the text stays 12px. A function `valueFormat` or `xFormat` cannot travel as data, so such a chart keeps the static width; use the names "number", "percent" or "compact" to keep it fit.
 * @emits none
 * @states default, linear, step, multiple, dots, labels, empty
 * @a11y Apps mount chartFitIsland for a full-width chart; without it the chart still works at its fixed height. The svg is an image named by `title`; every category is one focusable group (tab stop) whose tip and label read all series. A sr-only table after the svg lists the same data. More than one series always shows the legend, and dashed or dotted strokes tell lines apart without colour.
 * @example default: lineChart({ title: "Visitors", data: [{ m: "Jan", d: 186 }, { m: "Feb", d: 305 }, { m: "Mar", d: 237 }, { m: "Apr", d: 73 }, { m: "May", d: 209 }, { m: "Jun", d: 214 }], xKey: "m", series: [{ key: "d", label: "Desktop" }], k: "line-a" })
 * @example linear: lineChart({ title: "Visitors", curve: "linear", data: [{ m: "Jan", d: 186 }, { m: "Feb", d: 305 }, { m: "Mar", d: 237 }], xKey: "m", series: [{ key: "d", label: "Desktop" }], k: "line-b" })
 * @example step: lineChart({ title: "Visitors", curve: "step", data: [{ m: "Jan", d: 186 }, { m: "Feb", d: 305 }, { m: "Mar", d: 237 }], xKey: "m", series: [{ key: "d", label: "Desktop" }], k: "line-c" })
 * @example multiple: lineChart({ title: "Visitors by device", curve: "monotone", data: [{ m: "Jan", d: 186, mo: 80 }, { m: "Feb", d: 305, mo: 200 }, { m: "Mar", d: 237, mo: 120 }, { m: "Apr", d: 73, mo: 190 }], xKey: "m", series: [{ key: "d", label: "Desktop", color: "chart-1" }, { key: "mo", label: "Mobile", color: "chart-2", pattern: "dots" }], k: "line-d", enter: true })
 * @example dots: lineChart({ title: "Visitors", dots: true, curve: "linear", data: [{ m: "Jan", d: 186 }, { m: "Feb", d: 305 }, { m: "Mar", d: 237 }], xKey: "m", series: [{ key: "d", label: "Desktop" }], k: "line-e" })
 * @example labels: lineChart({ title: "Visitors", dots: true, labels: true, data: [{ m: "Jan", d: 186 }, { m: "Feb", d: 305 }, { m: "Mar", d: 237 }], xKey: "m", series: [{ key: "d", label: "Desktop" }], k: "line-f" })
 * @example empty: lineChart({ title: "Visitors", data: [], xKey: "m", series: [{ key: "d", label: "Desktop" }] })
 */
export function lineChart(p) {
  const q = p || /** @type {any} */ ({});
  const rows = rowsOf(q);
  const series = seriesOf(q);
  const name = nameOf(q, "Line chart");
  if (!rows.length || !series.length) return emptyView("line", name, q.emptyText);
  const k = q.k || "chart";
  const fmt = valueFmt(q);
  const curve = CURVES.indexOf(String(q.curve)) >= 0 ? q.curve : "natural";
  const box = plotBox(q, { top: q.labels ? 28 : 12 });
  const n = rows.length;
  const x = pointScale(n, box.l, box.w - box.r);
  const vals = series.map((s) => rows.map((r) => num(r[s.key])));
  const all = vals.reduce((a, v) => a.concat(v), /** @type {number[]} */ ([]));
  const sc = yScaleFor(Math.min(...all), Math.max(...all), box.t, box.h - box.b);
  const cats = rows.map((r) => catText(q, r[q.xKey]));
  const lines = series.map((s) => {
    const pts = vals[s.index].map((v, i) => /** @type {[number, number]} */ ([x(i), sc.y(v)]));
    const dash = s.pattern === "stripes" ? " is-dashed" : s.pattern === "dots" ? " is-dotted" : "";
    return html`<path class="gk-chart__line${dash}" style="--c:${cssValue(s.color)}" pathLength="1" d="${curvePath(pts, curve)}"></path>${q.dots ? pts.map((pt, i) => html`<circle class="gk-chart__dot is-shown" cx="${r2(pt[0])}" cy="${r2(pt[1])}" r="4" style="--c:${cssValue(s.color)}" data-tip="${cats[i] + ": " + s.label + " " + fmt(vals[s.index][i])}"></circle>`) : ""}${q.labels ? pts.map((pt, i) => html`<text class="gk-chart__value" x="${r2(pt[0])}" y="${r2(pt[1] - 12)}" text-anchor="middle" aria-hidden="true">${fmt(vals[s.index][i])}</text>`) : ""}`;
  });
  const targets = rows.map((r, i) => {
    const xl = i === 0 ? box.l : (x(i - 1) + x(i)) / 2;
    const xr = i === n - 1 ? box.w - box.r : (x(i) + x(i + 1)) / 2;
    const tip = cats[i] + ": " + series.map((s) => s.label + " " + fmt(vals[s.index][i])).join(", ");
    const inner = html`<line class="gk-chart__cursor" x1="${r2(x(i))}" x2="${r2(x(i))}" y1="${box.t}" y2="${box.h - box.b}"></line>${q.dots ? "" : series.map((s) => html`<circle class="gk-chart__dot" cx="${r2(x(i))}" cy="${r2(sc.y(vals[s.index][i]))}" r="4" style="--c:${cssValue(s.color)}" data-tip="${cats[i] + ": " + s.label + " " + fmt(vals[s.index][i])}"></circle>`)}`;
    return categoryTarget({ k, i, tip, x: xl, y: box.t, w: xr - xl, h: box.h - box.t, inner });
  });
  const body = html`${gridView(box, sc.ticks, sc.y, { grid: q.grid !== false, fmt })}${lines}${xTicks(box, cats.map((c, i) => ({ x: x(i), text: c })))}${targets}`;
  const table = tableView(name, [String(q.xKey || ""), ...series.map((s) => s.label)], rows.map((r, i) => [cats[i], ...series.map((s) => fmt(vals[s.index][i]))]));
  return frameView({ q, kind: "line", vw: box.w, vh: box.h, fit: true, defs: "", body, legend: wantLegend(q, series.length) ? legendView(series) : "", table, name });
}
