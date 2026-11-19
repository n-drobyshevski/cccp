// Anatomy and styling ported from shadcn/ui new-york v4 charts (MIT; see THIRD_PARTY_NOTICES.md).
// A native SVG pie or donut chart: no dependency, no listeners; tooltips come from data-tip (tip.js).
import { html } from "@gas-kit/client/html.js";
import { arcPath, colorVar, num, polar, r2, sliceAngles } from "./chartModel.js";
import { emptyView, frameView, idPrefix, legendView, markStyle, nameOf, patternDefs, rowsOf, seriesOf, tableView, valueFmt } from "./chartParts.js";

const TEXTURES = ["none", "stripes", "dots"];

/**
 * @component pieChart
 * @title Pie Chart
 * @category Charts
 * @summary An SVG pie or donut chart: a slice per row, sized by one value, with an optional centre text, labels, legend and active slice.
 * @param {{title?: string, data: Array<Record<string, unknown>>, nameKey: string, series: Array<{key: string, label?: string}>, colorKey?: string, donut?: boolean|number, innerText?: boolean|{value?: string|number, label?: string}, labels?: boolean|"value"|"name", legend?: boolean, activeIndex?: number, patterns?: boolean, height?: number, k?: string, enter?: boolean, emptyText?: string, valueFormat?: (v: number) => string}} p
 * `series[0].key` is the field holding each slice value and its label names the measure ("Visitors"). Slice colours come from `colorKey` (a row field holding `chart-1` to `chart-6` or a token name) or cycle through the palette. `donut` is true (inner radius .6 of the outer) or an inner radius in drawing units (the drawing is a square of `height`, default 250). `innerText` writes the total (or `value`) at 30px bold with `label` below, in a donut. `labels` writes each value (true or `value`) or each name (`name`) outside its slice. The legend is shown unless `legend` is false, in every labelling mode. Without it the names are in each slice's tip and label and in the sr-only table; with `labels: "name"` they are also written beside the slices. A page that drops the legend with value labels or none should name the slices nearby (a table or its own legend), so a sighted reader is never left with colour alone. `patterns` textures the slices (solid, stripes, dots in turn). `activeIndex` pushes one slice out by 10 units. `enter` fades the slices in. Wrap it in a card: `card({ title, content: pieChart(...) })`.
 * @emits none
 * @states default, donut, donut-text, labels, label-list, legend, no-legend, active, patterns, empty
 * @a11y The svg is an image named by `title`; every slice is one focusable mark (tab stop) whose tip and label read "Chrome: Visitors 275". A sr-only table after the svg lists name and value. Names are legend text unless `legend: false` (then they are the slice tips and labels, the sr-only table and, with `labels: "name"`, text beside each slice), and `patterns` keeps slices apart without colour.
 * @example default: pieChart({ title: "Visitors by browser", data: [{ b: "Chrome", n: 275, fill: "chart-1" }, { b: "Safari", n: 200, fill: "chart-2" }, { b: "Firefox", n: 187, fill: "chart-3" }, { b: "Edge", n: 173, fill: "chart-4" }, { b: "Other", n: 90, fill: "chart-5" }], nameKey: "b", colorKey: "fill", series: [{ key: "n", label: "Visitors" }], k: "pie-a", enter: true })
 * @example donut: pieChart({ title: "Visitors by browser", donut: true, data: [{ b: "Chrome", n: 275 }, { b: "Safari", n: 200 }, { b: "Firefox", n: 187 }], nameKey: "b", series: [{ key: "n", label: "Visitors" }], k: "pie-b" })
 * @example donut-text: pieChart({ title: "Visitors by browser", donut: true, innerText: true, data: [{ b: "Chrome", n: 275 }, { b: "Safari", n: 200 }, { b: "Firefox", n: 187 }], nameKey: "b", series: [{ key: "n", label: "Visitors" }], k: "pie-c" })
 * @example labels: pieChart({ title: "Visitors by browser", labels: true, data: [{ b: "Chrome", n: 275 }, { b: "Safari", n: 200 }, { b: "Firefox", n: 187 }], nameKey: "b", series: [{ key: "n", label: "Visitors" }], k: "pie-d" })
 * @example label-list: pieChart({ title: "Visitors by browser", labels: "name", legend: false, data: [{ b: "Chrome", n: 275 }, { b: "Safari", n: 200 }, { b: "Firefox", n: 187 }], nameKey: "b", series: [{ key: "n", label: "Visitors" }], k: "pie-e" })
 * @example legend: pieChart({ title: "Visitors by browser", legend: true, data: [{ b: "Chrome", n: 275 }, { b: "Safari", n: 200 }], nameKey: "b", series: [{ key: "n", label: "Visitors" }], k: "pie-f" })
 * @example no-legend: pieChart({ title: "Visitors by browser", legend: false, labels: "value", data: [{ b: "Chrome", n: 275 }, { b: "Safari", n: 200 }, { b: "Firefox", n: 187 }], nameKey: "b", series: [{ key: "n", label: "Visitors" }], k: "pie-i" })
 * @example active: pieChart({ title: "Visitors by browser", donut: true, activeIndex: 0, data: [{ b: "Chrome", n: 275 }, { b: "Safari", n: 200 }, { b: "Firefox", n: 187 }], nameKey: "b", series: [{ key: "n", label: "Visitors" }], k: "pie-g" })
 * @example patterns: pieChart({ title: "Visitors by browser", patterns: true, data: [{ b: "Chrome", n: 275 }, { b: "Safari", n: 200 }, { b: "Firefox", n: 187 }], nameKey: "b", series: [{ key: "n", label: "Visitors" }], k: "pie-h" })
 * @example empty: pieChart({ title: "Visitors by browser", data: [], nameKey: "b", series: [{ key: "n", label: "Visitors" }] })
 */
export function pieChart(p) {
  const q = p || /** @type {any} */ ({});
  const rows = rowsOf(q);
  const series = seriesOf(q);
  const name = nameOf(q, "Pie chart");
  const vkey = series.length ? series[0].key : "";
  const values = rows.map((r) => Math.max(0, num(r[vkey])));
  if (!rows.length || !series.length || !values.some((v) => v > 0)) return emptyView("pie", name, q.emptyText);
  const k = q.k || "chart";
  const pre = idPrefix(q.k);
  const fmt = valueFmt(q);
  const S = num(q.height, 250) > 100 ? num(q.height, 250) : 250;
  const c = S / 2;
  const showLabels = q.labels === true || q.labels === "value" || q.labels === "name";
  const lift = Number.isInteger(q.activeIndex) ? 10 : 0;
  const R = c - (showLabels ? 46 : 12) - lift;
  const inner = q.donut === true ? R * 0.6 : typeof q.donut === "number" && q.donut > 0 ? Math.min(q.donut, R - 4) : 0;
  const names = rows.map((r) => (r[q.nameKey] == null ? "" : String(r[q.nameKey])));
  const slices = rows.map((r, i) => ({
    key: String(i),
    label: names[i],
    color: colorVar(q.colorKey ? r[q.colorKey] : null, i),
    pattern: q.patterns ? TEXTURES[i % 3] : "none",
    index: i,
  }));
  const ang = sliceAngles(values);
  const total = values.reduce((a, v) => a + v, 0);
  const measure = series[0].label;
  const marks = slices.map((s, i) => {
    const a = ang[i];
    const out = R + (q.activeIndex === i ? lift : 0);
    const tip = s.label + ": " + measure + " " + fmt(values[i]);
    const d = arcPath(c, c, inner, out, a.a0, a.a1);
    const path = d ? html`<path class="gk-chart__slice${q.activeIndex === i ? " is-active" : ""}" tabindex="0" role="img" data-k="${k}-slice-${i}" data-tip="${tip}" aria-label="${tip}" style="${markStyle(s, pre)};--i:${i}" d="${d}"></path>` : "";
    /** @type {unknown} */
    let label = "";
    if (showLabels && d) {
      const mid = (a.a0 + a.a1) / 2;
      const pt = polar(c, c, out + 14, mid);
      const anchor = pt[0] > c + 4 ? "start" : pt[0] < c - 4 ? "end" : "middle";
      label = html`<text class="gk-chart__value" x="${r2(pt[0])}" y="${r2(pt[1])}" dy="0.32em" text-anchor="${anchor}" aria-hidden="true">${q.labels === "name" ? s.label : fmt(values[i])}</text>`;
    }
    return html`${path}${label}`;
  });
  /** @type {unknown} */
  let centre = "";
  if (inner > 0 && q.innerText) {
    const it = typeof q.innerText === "object" ? q.innerText : {};
    const big = it.value != null && it.value !== "" ? String(it.value) : fmt(total);
    const small = it.label != null ? String(it.label) : measure;
    centre = html`<text class="gk-chart__centerValue" x="${c}" y="${c - 6}" text-anchor="middle" dy="0.35em">${big}</text><text class="gk-chart__centerLabel" x="${c}" y="${c + 20}" text-anchor="middle">${small}</text>`;
  }
  const table = tableView(name, [String(q.nameKey || ""), measure], rows.map((r, i) => [names[i], fmt(values[i])]));
  const legend = q.legend === false ? "" : legendView(slices);
  return frameView({ q, kind: "pie", vw: S, vh: S, defs: patternDefs(pre, slices), body: html`${marks}${centre}`, legend, table, name });
}
