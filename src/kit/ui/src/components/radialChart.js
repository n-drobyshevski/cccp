// Anatomy and styling ported from shadcn/ui new-york v4 charts (MIT; see THIRD_PARTY_NOTICES.md).
// A native SVG radial bar chart: no dependency, no listeners; tooltips come from data-tip (tip.js).
import { html } from "@gas-kit/client/html.js";
import { colorVar, num, r2, ringPath } from "./chartModel.js";
import { emptyView, frameView, idPrefix, legendView, markStyle, nameOf, patternDefs, rowsOf, seriesOf, tableView, valueFmt } from "./chartParts.js";

const TEXTURES = ["none", "stripes", "dots"];

/**
 * @component radialChart
 * @title Radial Chart
 * @category Charts
 * @summary An SVG radial bar chart: a ring per row sized by one value, or one ring split by several series, with an optional track and centre text.
 * @param {{title?: string, data: Array<Record<string, unknown>>, nameKey: string, series: Array<{key: string, label?: string, color?: string, pattern?: "none"|"stripes"|"dots"}>, angles?: [number, number], track?: boolean, stacked?: boolean, centerText?: boolean|{value?: string|number, label?: string}, max?: number, colorKey?: string, patterns?: boolean, legend?: boolean, height?: number, k?: string, enter?: boolean, emptyText?: string, valueFormat?: (v: number) => string}} p
 * By default every row is one ring (the first one outermost) filled to its `series[0].key` value out of `max` (default: the largest value). `stacked` instead draws one ring from the first row, split by the series in proportion to their values. `angles` is the start and end in degrees clockwise from the top (default 0 and 360; use 0 and 180 for a half ring). `track` draws the full ring behind in the surface colour. `centerText` writes the total (or `value`) at 30px bold with `label` below. Ring colours come from `colorKey` (a row field holding `chart-1` to `chart-6` or a token name) or cycle through the palette. `patterns` textures the rings. The drawing is a square of `height` (default 250). `enter` draws the rings in. Wrap it in a card: `card({ title, content: radialChart(...) })`.
 * @emits none
 * @states default, track, angles, stacked, center-text, empty
 * @a11y The svg is an image named by `title`; every ring or segment is one focusable mark (tab stop) whose tip and label read "Chrome: Visitors 275". A sr-only table after the svg lists the same data. Names are always shown in the legend, and `patterns` keeps rings apart without colour.
 * @example default: radialChart({ title: "Visitors by browser", data: [{ b: "Chrome", n: 275 }, { b: "Safari", n: 200 }, { b: "Firefox", n: 187 }, { b: "Edge", n: 173 }], nameKey: "b", series: [{ key: "n", label: "Visitors" }], k: "radial-a", enter: true })
 * @example track: radialChart({ title: "Visitors by browser", track: true, data: [{ b: "Chrome", n: 275 }, { b: "Safari", n: 200 }, { b: "Firefox", n: 187 }], nameKey: "b", series: [{ key: "n", label: "Visitors" }], k: "radial-b" })
 * @example angles: radialChart({ title: "Visitors", angles: [0, 250], track: true, max: 2000, data: [{ b: "Chrome", n: 1260 }], nameKey: "b", series: [{ key: "n", label: "Visitors" }], k: "radial-c" })
 * @example stacked: radialChart({ title: "Visitors by device", stacked: true, angles: [-90, 90], data: [{ b: "Total", d: 1260, mo: 570 }], nameKey: "b", series: [{ key: "d", label: "Desktop", color: "chart-1" }, { key: "mo", label: "Mobile", color: "chart-2", pattern: "stripes" }], k: "radial-d" })
 * @example center-text: radialChart({ title: "Visitors", angles: [0, 250], track: true, centerText: true, max: 2000, data: [{ b: "Chrome", n: 1260 }], nameKey: "b", series: [{ key: "n", label: "Visitors" }], k: "radial-e" })
 * @example empty: radialChart({ title: "Visitors", data: [], nameKey: "b", series: [{ key: "n", label: "Visitors" }] })
 */
export function radialChart(p) {
  const q = p || /** @type {any} */ ({});
  const rows = rowsOf(q);
  const series = seriesOf(q);
  const name = nameOf(q, "Radial chart");
  if (!rows.length || !series.length) return emptyView("radial", name, q.emptyText);
  const k = q.k || "chart";
  const pre = idPrefix(q.k);
  const fmt = valueFmt(q);
  const S = num(q.height, 250) > 100 ? num(q.height, 250) : 250;
  const c = S / 2;
  const [a0, a1] = Array.isArray(q.angles) && q.angles.length === 2 && num(q.angles[1]) > num(q.angles[0]) ? [num(q.angles[0]), num(q.angles[1])] : [0, 360];
  const span = a1 - a0;
  const stacked = !!q.stacked;
  const names = rows.map((r) => (r[q.nameKey] == null ? "" : String(r[q.nameKey])));
  const measure = series[0].label;
  /** @type {Array<import("./chartParts.js").ChartSeries & {value: number, from: number, to: number, radius: number, thick: number, tip: string}>} */
  let items;
  if (stacked) {
    const row = rows[0];
    const vs = series.map((s) => Math.max(0, num(row[s.key])));
    const tot = vs.reduce((x, v) => x + v, 0);
    let at = a0;
    items = series.map((s, i) => {
      const from = at;
      at += tot ? (vs[i] / tot) * span : 0;
      return { ...s, value: vs[i], from: from + (i ? 0.6 : 0), to: at - (i < series.length - 1 ? 0.6 : 0), radius: c - 36, thick: 24, tip: names[0] + ": " + s.label + " " + fmt(vs[i]) };
    });
  } else {
    const vs = rows.map((r) => Math.max(0, num(r[series[0].key])));
    const mx = num(q.max) > 0 ? num(q.max) : Math.max(...vs);
    const n = rows.length;
    const step = n === 1 ? 0 : (c - 15 - 30) / n;
    const thick = n === 1 ? 16 : Math.min(18, step * 0.7);
    items = rows.map((r, i) => ({
      key: String(i),
      label: names[i],
      color: colorVar(q.colorKey ? r[q.colorKey] : null, i),
      pattern: q.patterns ? TEXTURES[i % 3] : series[0].pattern,
      index: i,
      value: vs[i],
      from: a0,
      to: a0 + (mx ? Math.min(1, vs[i] / mx) : 0) * span,
      radius: n === 1 ? c - 40 : c - 15 - step * (i + 0.5),
      thick,
      tip: names[i] + ": " + measure + " " + fmt(vs[i]),
    }));
    if (n === 1 && !q.colorKey) items[0].color = series[0].color;
  }
  const totalVal = items.reduce((x, it) => x + it.value, 0);
  const marks = items.map((it, i) => {
    const d = ringPath(c, c, it.radius, it.from, it.to);
    const track = q.track && (!stacked || i === 0) ? html`<path class="gk-chart__track" d="${ringPath(c, c, it.radius, a0, a1)}" stroke-width="${r2(it.thick)}"></path>` : "";
    const ring = d ? html`<path class="gk-chart__ring${stacked ? "" : " is-round"}" tabindex="0" role="img" data-k="${k}-ring-${i}" data-tip="${it.tip}" aria-label="${it.tip}" style="${markStyle(it, pre, "stroke")};--i:${i}" stroke-width="${r2(it.thick)}" pathLength="1" d="${d}"></path>` : "";
    return html`${track}${ring}`;
  });
  /** @type {unknown} */
  let centre = "";
  if (q.centerText) {
    const it = typeof q.centerText === "object" ? q.centerText : {};
    const big = it.value != null && it.value !== "" ? String(it.value) : fmt(totalVal);
    const small = it.label != null ? String(it.label) : stacked ? "Total" : measure;
    centre = html`<text class="gk-chart__centerValue" x="${c}" y="${c - 6}" text-anchor="middle" dy="0.35em">${big}</text><text class="gk-chart__centerLabel" x="${c}" y="${c + 20}" text-anchor="middle">${small}</text>`;
  }
  const head = [String(q.nameKey || ""), measure];
  const table = stacked
    ? tableView(name, [String(q.nameKey || ""), ...series.map((s) => s.label)], [[names[0], ...items.map((it) => fmt(it.value))]])
    : tableView(name, head, items.map((it) => [it.label, fmt(it.value)]));
  const legend = items.length > 1 ? legendView(items) : "";
  return frameView({ q, kind: "radial", vw: S, vh: S, defs: patternDefs(pre, items), body: html`${marks}${centre}`, legend, table, name });
}
