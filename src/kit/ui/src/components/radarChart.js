// Anatomy and styling ported from shadcn/ui new-york v4 charts (MIT; see THIRD_PARTY_NOTICES.md).
// A native SVG radar chart: no dependency, no listeners; tooltips come from data-tip (tip.js).
import { cssValue, html } from "@gas-kit/client/html.js";
import { niceTicks, num, polar, polygonPath, radarPoints, r2 } from "./chartModel.js";
import { emptyView, frameView, idPrefix, legendView, markStyle, nameOf, patternDefs, rowsOf, seriesOf, tableView, valueFmt, wantLegend } from "./chartParts.js";

/**
 * @component radarChart
 * @title Radar Chart
 * @category Charts
 * @summary An SVG radar chart: one axis per row, one polygon per series, on a polygon or circle grid.
 * @param {{title?: string, data: Array<Record<string, unknown>>, xKey: string, series: Array<{key: string, label?: string, color?: string, pattern?: "none"|"stripes"|"dots"}>, dots?: boolean, linesOnly?: boolean, gridType?: "polygon"|"circle", gridFilled?: boolean, legend?: boolean, height?: number, k?: string, enter?: boolean, emptyText?: string, valueFormat?: (v: number) => string}} p
 * The drawing is a square of `height` (default 250). Each row is an axis, named by `xKey`; `series[].key` is the value field. `dots` marks each vertex with a 4px dot. `linesOnly` draws outlines without fill or spokes. `gridType` is polygon (default) or circle; `gridFilled` fills the grid at 20 percent. Fills are .6 opaque. `enter` fades the polygons in. Wrap it in a card: `card({ title, content: radarChart(...) })`.
 * @emits none
 * @states default, dots, lines-only, circle-grid, filled-grid, multiple, empty
 * @a11y The svg is an image named by `title`; every axis is one focusable group (tab stop) at the axis label whose tip and label read all series ("Speed: Alpha 86, Beta 70"). A sr-only table after the svg lists the same data. With more than one series the legend is always shown and `pattern` textures the polygons.
 * @example default: radarChart({ title: "Skills", data: [{ s: "Speed", a: 86 }, { s: "Power", a: 105 }, { s: "Range", a: 37 }, { s: "Armor", a: 73 }, { s: "Magic", a: 90 }], xKey: "s", series: [{ key: "a", label: "Alpha" }], k: "radar-a", enter: true })
 * @example dots: radarChart({ title: "Skills", dots: true, data: [{ s: "Speed", a: 86 }, { s: "Power", a: 105 }, { s: "Range", a: 37 }, { s: "Armor", a: 73 }], xKey: "s", series: [{ key: "a", label: "Alpha" }], k: "radar-b" })
 * @example lines-only: radarChart({ title: "Skills", linesOnly: true, data: [{ s: "Speed", a: 86 }, { s: "Power", a: 105 }, { s: "Range", a: 37 }, { s: "Armor", a: 73 }], xKey: "s", series: [{ key: "a", label: "Alpha" }], k: "radar-c" })
 * @example circle-grid: radarChart({ title: "Skills", gridType: "circle", data: [{ s: "Speed", a: 86 }, { s: "Power", a: 105 }, { s: "Range", a: 37 }, { s: "Armor", a: 73 }], xKey: "s", series: [{ key: "a", label: "Alpha" }], k: "radar-d" })
 * @example filled-grid: radarChart({ title: "Skills", gridFilled: true, data: [{ s: "Speed", a: 86 }, { s: "Power", a: 105 }, { s: "Range", a: 37 }, { s: "Armor", a: 73 }], xKey: "s", series: [{ key: "a", label: "Alpha" }], k: "radar-e" })
 * @example multiple: radarChart({ title: "Skills", dots: true, data: [{ s: "Speed", a: 86, b: 40 }, { s: "Power", a: 105, b: 90 }, { s: "Range", a: 37, b: 70 }, { s: "Armor", a: 73, b: 60 }], xKey: "s", series: [{ key: "a", label: "Alpha", color: "chart-1" }, { key: "b", label: "Beta", color: "chart-2", pattern: "stripes" }], k: "radar-f" })
 * @example empty: radarChart({ title: "Skills", data: [], xKey: "s", series: [{ key: "a", label: "Alpha" }] })
 */
export function radarChart(p) {
  const q = p || /** @type {any} */ ({});
  const rows = rowsOf(q);
  const series = seriesOf(q);
  const name = nameOf(q, "Radar chart");
  if (!rows.length || !series.length) return emptyView("radar", name, q.emptyText);
  const k = q.k || "chart";
  const pre = idPrefix(q.k);
  const fmt = valueFmt(q);
  const S = num(q.height, 250) > 100 ? num(q.height, 250) : 250;
  const c = S / 2;
  const R = c - 38;
  const n = rows.length;
  const vals = series.map((s) => rows.map((r) => Math.max(0, num(r[s.key]))));
  const peak = Math.max(...vals.map((v) => Math.max(...v)));
  const nt = niceTicks(0, peak, 4);
  const rings = nt.ticks.filter((t) => t > 0);
  const cats = rows.map((r) => (r[q.xKey] == null ? "" : String(r[q.xKey])));
  const ringShape = (/** @type {number} */ t) => (q.gridType === "circle"
    ? html`<circle class="gk-chart__ring0" cx="${c}" cy="${c}" r="${r2((t / nt.max) * R)}"></circle>`
    : html`<path class="gk-chart__ring0" d="${polygonPath(radarPoints(rows.map(() => t), nt.max, c, c, R))}"></path>`);
  const outer = q.gridType === "circle"
    ? html`<circle class="gk-chart__gridfill" cx="${c}" cy="${c}" r="${R}"></circle>`
    : html`<path class="gk-chart__gridfill" d="${polygonPath(radarPoints(rows.map(() => nt.max), nt.max, c, c, R))}"></path>`;
  const spokes = q.linesOnly ? "" : rows.map((r, i) => {
    const e = polar(c, c, R, (360 * i) / n);
    return html`<line class="gk-chart__spoke" x1="${c}" y1="${c}" x2="${r2(e[0])}" y2="${r2(e[1])}"></line>`;
  });
  const grid = html`<g class="gk-chart__grid${q.gridFilled ? " is-filled" : ""}" aria-hidden="true">${q.gridFilled ? outer : ""}${rings.map(ringShape)}${spokes}</g>`;
  const shapes = series.map((s) => {
    const pts = radarPoints(vals[s.index], nt.max, c, c, R);
    const cls = "gk-chart__radarArea" + (q.linesOnly ? " is-lines" : s.pattern !== "none" ? " is-solid" : "");
    return html`<path class="${cls}" style="${markStyle(s, pre)}" d="${polygonPath(pts)}"></path>${q.dots ? pts.map((pt, i) => html`<circle class="gk-chart__dot is-shown" cx="${r2(pt[0])}" cy="${r2(pt[1])}" r="4" style="--c:${cssValue(s.color)}" data-tip="${cats[i] + ": " + s.label + " " + fmt(vals[s.index][i])}"></circle>`) : ""}`;
  });
  const axes = rows.map((r, i) => {
    const deg = (360 * i) / n;
    const lp = polar(c, c, R + 16, deg);
    const tip = cats[i] + ": " + series.map((s) => s.label + " " + fmt(vals[s.index][i])).join(", ");
    const anchor = lp[0] > c + 4 ? "start" : lp[0] < c - 4 ? "end" : "middle";
    const e = polar(c, c, R, deg);
    return html`<g class="gk-chart__cat" tabindex="0" role="img" data-k="${k}-cat-${i}" data-tip="${tip}" aria-label="${tip}"><circle class="gk-chart__hit" cx="${r2(lp[0])}" cy="${r2(lp[1])}" r="20"></circle><line class="gk-chart__cursor" x1="${c}" y1="${c}" x2="${r2(e[0])}" y2="${r2(e[1])}"></line><text class="gk-chart__tick" x="${r2(lp[0])}" y="${r2(lp[1])}" dy="0.32em" text-anchor="${anchor}">${cats[i]}</text></g>`;
  });
  const table = tableView(name, [String(q.xKey || ""), ...series.map((s) => s.label)], rows.map((r, i) => [cats[i], ...series.map((s) => fmt(vals[s.index][i]))]));
  return frameView({ q, kind: "radar", vw: S, vh: S, defs: patternDefs(pre, series), body: html`${grid}${shapes}${axes}`, legend: wantLegend(q, series.length) ? legendView(series) : "", table, name });
}
