// Anatomy and styling ported from shadcn/ui new-york v4 charts (MIT; see THIRD_PARTY_NOTICES.md).
// A native SVG bar chart: no dependency, no listeners; tooltips come from data-tip (tip.js).
import { html } from "@gas-kit/client/html.js";
import { bandScale, colorVar, linearScale, num, r2, roundRectPath, stackSeries } from "./chartModel.js";
import { categoryTarget, catText, emptyView, frameView, gridView, idPrefix, legendView, markStyle, nameOf, patternDefs, plotBox, rowsOf, seriesOf, tableView, valueFmt, wantLegend, xTicks, yScaleFor } from "./chartParts.js";

/**
 * @component barChart
 * @title Bar Chart
 * @category Charts
 * @summary An SVG bar chart: vertical or horizontal, one series or several (grouped or stacked), with value labels, negative values, an active bar and per-row colours.
 * @param {{title?: string, data: Array<Record<string, unknown>>, xKey: string, series: Array<{key: string, label?: string, color?: string, pattern?: "none"|"stripes"|"dots"}>, orientation?: "vertical"|"horizontal", stacked?: boolean, labels?: boolean, negative?: boolean, activeIndex?: number, colorKey?: string, radius?: number, legend?: boolean, grid?: boolean, axes?: boolean|{x?: boolean, y?: boolean}, height?: number, width?: number, k?: string, enter?: boolean, emptyText?: string, valueFormat?: ((v: number) => string)|"number"|"percent"|"compact", xFormat?: ((v: unknown) => string)|"number"|"percent"|"compact"}} p
 * Several series are grouped side by side; `stacked` stacks them. `labels` writes the value at the end of each bar (not on stacks). `negative` colours values below zero with `chart-2` (a single series). `activeIndex` draws that row's bar at .8 opacity with a dashed outline. `colorKey` names a row field holding `chart-1` to `chart-6` (or a token name) for a colour per row (a single series). `radius` overrides the corner radius (default 8 single, 5 horizontal, 4 grouped or stacked). `k` namespaces ids and keys; `enter` makes the bars grow in. Wrap it in a card: `card({ title, description, content: barChart(...), footer })`. The chart is `height` px tall (default 250) and `width` units wide (default 600), full width of its container. Mount `chartFitIsland` for a full-width chart: it redraws at the measured width so the text stays 12px. A function `valueFormat` or `xFormat` cannot travel as data, so such a chart keeps the static width; use the names "number", "percent" or "compact" to keep it fit.
 * @emits none
 * @states default, horizontal, multiple, stacked, labels, negative, active, per-row, empty
 * @a11y Apps mount chartFitIsland for a full-width chart; without it the chart still works at its fixed height. The svg is an image named by `title`; every category is one focusable group (tab stop) whose tip and label read all series ("Jan: Desktop 186, Mobile 80"). A sr-only table after the svg lists the same data. With more than one series the legend is always shown and `pattern` textures the bars, so colour is never the only signal; negative bars sit below the baseline.
 * @example default: barChart({ title: "Visitors", data: [{ m: "Jan", d: 186 }, { m: "Feb", d: 305 }, { m: "Mar", d: 237 }, { m: "Apr", d: 73 }, { m: "May", d: 209 }, { m: "Jun", d: 214 }], xKey: "m", series: [{ key: "d", label: "Desktop" }], k: "bar-a", enter: true })
 * @example horizontal: barChart({ title: "Visitors", orientation: "horizontal", data: [{ m: "Jan", d: 186 }, { m: "Feb", d: 305 }, { m: "Mar", d: 237 }], xKey: "m", series: [{ key: "d", label: "Desktop" }], k: "bar-b" })
 * @example multiple: barChart({ title: "Visitors by device", data: [{ m: "Jan", d: 186, mo: 80 }, { m: "Feb", d: 305, mo: 200 }, { m: "Mar", d: 237, mo: 120 }], xKey: "m", series: [{ key: "d", label: "Desktop", color: "chart-1" }, { key: "mo", label: "Mobile", color: "chart-2", pattern: "stripes" }], k: "bar-c" })
 * @example stacked: barChart({ title: "Visitors by device", stacked: true, data: [{ m: "Jan", d: 186, mo: 80 }, { m: "Feb", d: 305, mo: 200 }, { m: "Mar", d: 237, mo: 120 }], xKey: "m", series: [{ key: "d", label: "Desktop", color: "chart-1" }, { key: "mo", label: "Mobile", color: "chart-2", pattern: "dots" }], k: "bar-d" })
 * @example labels: barChart({ title: "Visitors", labels: true, data: [{ m: "Jan", d: 186 }, { m: "Feb", d: 305 }, { m: "Mar", d: 237 }], xKey: "m", series: [{ key: "d", label: "Desktop" }], k: "bar-e" })
 * @example negative: barChart({ title: "Net change", negative: true, data: [{ m: "Jan", v: 186 }, { m: "Feb", v: -205 }, { m: "Mar", v: -207 }, { m: "Apr", v: 173 }], xKey: "m", series: [{ key: "v", label: "Change" }], k: "bar-f" })
 * @example active: barChart({ title: "Visitors", activeIndex: 2, data: [{ m: "Jan", d: 186 }, { m: "Feb", d: 305 }, { m: "Mar", d: 237 }], xKey: "m", series: [{ key: "d", label: "Desktop" }], k: "bar-g" })
 * @example per-row: barChart({ title: "Browsers", colorKey: "fill", data: [{ b: "Chrome", n: 275, fill: "chart-1" }, { b: "Safari", n: 200, fill: "chart-2" }, { b: "Firefox", n: 187, fill: "chart-3" }], xKey: "b", series: [{ key: "n", label: "Visitors" }], k: "bar-h" })
 * @example empty: barChart({ title: "Visitors", data: [], xKey: "m", series: [{ key: "d", label: "Desktop" }] })
 */
export function barChart(p) {
  const q = p || /** @type {any} */ ({});
  const rows = rowsOf(q);
  const series = seriesOf(q);
  const name = nameOf(q, "Bar chart");
  if (!rows.length || !series.length) return emptyView("bar", name, q.emptyText);
  const k = q.k || "chart";
  const pre = idPrefix(q.k);
  const fmt = valueFmt(q);
  const horiz = q.orientation === "horizontal";
  const stacked = !!q.stacked && series.length > 1;
  const multi = series.length > 1;
  const rad = Number.isFinite(q.radius) ? q.radius : horiz ? 5 : multi || stacked ? 4 : 8;
  const n = rows.length;
  const cats = rows.map((r) => catText(q, r[q.xKey]));
  const keys = series.map((s) => s.key);
  const st = stacked ? stackSeries(rows, keys) : null;
  /** @type {Array<Array<{y0: number, y1: number, v: number}>>} */
  const layers = st ? st.layers.map((l) => l.points) : keys.map((key) => stackSeries(rows, [key]).layers[0].points);
  let lo = 0;
  let hi = 0;
  layers.forEach((l) => l.forEach((pt) => { lo = Math.min(lo, pt.y0, pt.y1); hi = Math.max(hi, pt.y0, pt.y1); }));
  const labelW = horiz && q.axes !== false && !(q.axes && /** @type {any} */ (q.axes).x === false) ? Math.min(110, Math.max(...cats.map((c) => c.length)) * 6.5 + 10) : 0;
  const box = horiz
    ? plotBox({ ...q, axes: { x: false, y: false } }, { left: 12 + labelW, right: q.labels ? 48 : 12, top: 12, bottom: 8 })
    : plotBox(q, { top: q.labels ? 28 : 12 });
  const sc = yScaleFor(lo, hi, horiz ? box.l : box.t, horiz ? box.w - box.r : box.h - box.b);
  const val = horiz ? linearScale(sc.min, sc.max, box.l, box.w - box.r) : sc.y;
  const band = horiz ? bandScale(n, box.t, box.h - box.b, 0.25) : bandScale(n, box.l, box.w - box.r, 0.2);
  const gap = 4;
  const m = stacked ? 1 : series.length;
  const bw = (band.bandwidth - gap * (m - 1)) / m;
  const zero = val(0);
  /**
   * @param {number} i row
   * @param {import("./chartParts.js").ChartSeries} s
   * @param {{y0: number, y1: number, v: number}} pt
   */
  const barView = (i, s, pt) => {
    const a = val(pt.y0);
    const b = val(pt.y1);
    const len = Math.abs(b - a);
    if (!(len > 0)) return "";
    let paintSeries = s;
    if (q.negative && !multi && pt.v < 0) paintSeries = { ...s, color: colorVar("chart-2", 1), pattern: "none" };
    else if (q.colorKey && !multi && typeof rows[i][q.colorKey] === "string") paintSeries = { ...s, color: colorVar(rows[i][q.colorKey], i) };
    const off = (stacked ? 0 : s.index * (bw + gap));
    const pos = band.start(i) + off;
    const neg = pt.y1 < pt.y0 || (pt.y1 === pt.y0 && pt.v < 0);
    const farIsEnd = !neg;
    let d;
    if (horiz) {
      const x0 = Math.min(a, b);
      /** @type {{tl?: number, tr?: number, bl?: number, br?: number}} */
      const r = {};
      if (farIsEnd) { r.tr = rad; r.br = rad; } else { r.tl = rad; r.bl = rad; }
      if (stacked) { r.tl = r.tr; r.bl = r.br; }
      d = roundRectPath(x0, pos, len, bw, r);
    } else {
      const y0 = Math.min(a, b);
      /** @type {{tl?: number, tr?: number, bl?: number, br?: number}} */
      const r = {};
      if (farIsEnd) { r.tl = rad; r.tr = rad; } else { r.bl = rad; r.br = rad; }
      if (stacked) { r.bl = r.tl; r.br = r.tr; }
      d = roundRectPath(pos, y0, bw, len, r);
    }
    const tip = cats[i] + ": " + s.label + " " + fmt(pt.v);
    const cls = "gk-chart__bar" + (horiz ? " is-h" : "") + (neg ? " is-neg" : "") + (q.activeIndex === i ? " is-active" : "");
    const label = q.labels && !stacked
      ? (horiz
        ? html`<text class="gk-chart__value" x="${r2(Math.max(a, b) + (neg ? -6 : 6))}" y="${r2(pos + bw / 2)}" dy="0.32em" text-anchor="${neg ? "end" : "start"}" aria-hidden="true">${fmt(pt.v)}</text>`
        : html`<text class="gk-chart__value" x="${r2(pos + bw / 2)}" y="${r2(neg ? Math.max(a, b) + 16 : Math.min(a, b) - 6)}" text-anchor="middle" aria-hidden="true">${fmt(pt.v)}</text>`)
      : "";
    return html`<path class="${cls}" style="${markStyle(paintSeries, pre)}" d="${d}" data-tip="${tip}"></path>${label}`;
  };
  const targets = rows.map((r, i) => {
    const tip = cats[i] + ": " + series.map((s) => s.label + " " + fmt(layers[s.index][i].v)).join(", ");
    const c = band.center(i);
    const cur = horiz
      ? html`<rect class="gk-chart__cursorBand" x="${box.l}" y="${r2(c - band.step / 2)}" width="${box.iw}" height="${r2(band.step)}"></rect>`
      : html`<rect class="gk-chart__cursorBand" x="${r2(c - band.step / 2)}" y="${box.t}" width="${r2(band.step)}" height="${box.ih}"></rect>`;
    const inner = html`${cur}${series.map((s) => barView(i, s, layers[s.index][i]))}`;
    return horiz
      ? categoryTarget({ k, i, tip, x: box.l, y: c - band.step / 2, w: box.iw, h: band.step, inner })
      : categoryTarget({ k, i, tip, x: c - band.step / 2, y: box.t, w: band.step, h: box.ih, inner });
  });
  const yLabels = horiz && labelW
    ? html`<g class="gk-chart__xaxis" aria-hidden="true">${cats.map((c, i) => html`<text class="gk-chart__tick" x="${box.l - 10}" y="${r2(band.center(i))}" dy="0.32em" text-anchor="end">${c}</text>`)}</g>`
    : "";
  const base = horiz
    ? ""
    : html`${gridView(box, sc.ticks, sc.y, { grid: q.grid !== false, fmt })}${xTicks(box, cats.map((c, i) => ({ x: band.center(i), text: c })))}`;
  const zeroLine = lo < 0 && !horiz ? html`<line class="gk-chart__zero" x1="${box.l}" x2="${box.w - box.r}" y1="${r2(zero)}" y2="${r2(zero)}" aria-hidden="true"></line>` : "";
  const body = html`${base}${zeroLine}${yLabels}${targets}`;
  const table = tableView(name, [String(q.xKey || ""), ...series.map((s) => s.label)], rows.map((r, i) => [cats[i], ...series.map((s) => fmt(num(layers[s.index][i].v)))]));
  return frameView({ q, kind: "bar", vw: box.w, vh: box.h, fit: true, defs: patternDefs(pre, series), body, legend: wantLegend(q, series.length) ? legendView(series) : "", table, name });
}
