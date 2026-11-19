// Extracted from the author's production Apps Script apps; adapted.
// A 2x2 quadrant matrix. Default is a mosaic (column widths follow the column totals, tile
// heights follow the counts); layout "grid" is a real table. Each cell shows its label, a tone
// badge (icon and word), the count and the share. Colour is optional (status, heat or none).
// Cells can be links or buttons (data-act) when they carry an href or an act flag.
import { html, attrs, isSafeUrl, linkAttrs } from "@gas-kit/client/html.js";
import { fmtCount } from "@gas-kit/client/format.js";

/** The four cells, top row first: [key, row index (0 = high), column index (0 = low)]. */
/** @type {Array<[string, number, number]>} */
export const CORNERS = [["tl", 0, 0], ["tr", 0, 1], ["bl", 1, 0], ["br", 1, 1]];
/** The tones a cell can carry; each one also prints a word. */
export const TONES = new Set(["ok", "warn", "bad", "none"]);
const TONE_WORDS = { ok: "OK", warn: "Warning", bad: "Problem", none: "No data" };
/** A mosaic label longer than this is clamped to two lines and carries its full text as a tip. */
const LONG_LABEL = 20;
/** The colour modes; anything else is "status". */
export const COLOURS = new Set(["status", "heat", "none"]);
/** The layouts; anything else is "mosaic". */
export const LAYOUTS = new Set(["mosaic", "grid"]);
/**
 * The tone icon: ok a check in a circle, warn a triangle with a bang, bad an octagon with a cross, none a dashed circle.
 * @param {string} tone
 */
function icon(tone) {
  const svg = (/** @type {ReturnType<typeof html>} */ body) => html`<svg class="gk-quad__icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5">${body}</svg>`;
  if (tone === "ok") return svg(html`<circle cx="8" cy="8" r="6.5"></circle><path d="M5 8.2l2 2L11 6"></path>`);
  if (tone === "warn") return svg(html`<path d="M8 2L14.5 13.5H1.5Z" stroke-linejoin="round"></path><path d="M8 6.5v3"></path><circle cx="8" cy="11.5" r="0.9" fill="currentColor"></circle>`);
  if (tone === "bad") return svg(html`<path d="M5.2 1.8h5.6l3.4 3.4v5.6l-3.4 3.4H5.2L1.8 10.8V5.2Z" stroke-linejoin="round"></path><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4"></path>`);
  return svg(html`<circle cx="8" cy="8" r="6.5" stroke-dasharray="2.5 2"></circle>`);
}


/**
 * @typedef {{count?: number, label?: string, tone?: "ok"|"warn"|"bad"|"none", href?: string, act?: boolean}} QuadCell
 * @typedef {{label?: string, count?: number, href?: string, act?: boolean, actionLabel?: string, split?: {xLow?: number, xHigh?: number}}} QuadExtra
 * @typedef {{id?: string, xLabel?: string, yLabel?: string, xLow?: string, xHigh?: string, yLow?: string, yHigh?: string, cells?: {tl?: QuadCell, tr?: QuadCell, bl?: QuadCell, br?: QuadCell}, unit?: string, label?: string, title?: string, layout?: "mosaic"|"grid", colour?: "status"|"heat"|"none", shareDecimals?: 0|1, extra?: QuadExtra}} QuadProps
 */

/**
 * Shares by largest remainder at whole percents (scale 1) or tenths (scale 10), in units of
 * 1/scale percent, so they add up to 100 * scale (all 0 for a zero total).
 * @param {number[]} counts
 * @param {number} total
 * @param {number} [scale]
 * @returns {number[]}
 */
function shares(counts, total, scale = 1) {
  if (!total) return counts.map(() => 0);
  const exact = counts.map((n) => (n / total) * 100 * scale);
  const out = exact.map((e) => Math.floor(e));
  let left = 100 * scale - out.reduce((a, n) => a + n, 0);
  exact.map((e, i) => ({ i, f: e - Math.floor(e) })).sort((a, b) => b.f - a.f || a.i - b.i).forEach((x) => { if (left > 0) { out[x.i] += 1; left -= 1; } });
  return out;
}

/**
 * DOM-free model: each cell with its row and column words, count, share (largest remainder at whole percents, or tenths with `shareDecimals: 1`, so shares add up to 100) and its printed form, and sentence.
 * @param {QuadProps} [p]
 * @returns {{cells: Array<{key: string, row: string, col: string, count: number, pct: number, share: string, heat: number, colShare: number, tone: string|null, label: string, href: string|null, act: boolean, name: string, text: string}>, total: number, all: number, colTotals: [number, number], rowWeights: [number, number], extra: {label: string, count: number, href: string|null, act: boolean, actionLabel: string, split: string, name: string}|null, layout: "mosaic"|"grid", colour: "status"|"heat"|"none", aria: string}}
 * @internal
 */
export function quadModel(p) {
  const q = p || {};
  const cells = q.cells || {};
  const rows = [q.yHigh || "High", q.yLow || "Low"];
  const cols = [q.xLow || "Low", q.xHigh || "High"];
  const unit = q.unit || "items";
  const raw = CORNERS.map(([key]) => /** @type {QuadCell} */ (/** @type {any} */ (cells)[key] || {}));
  const nums = raw.map((c) => (Number(c.count) > 0 ? Math.round(Number(c.count)) : 0));
  const total = nums.reduce((a, n) => a + n, 0);
  // shareDecimals 1 splits at tenths and prints one decimal ("22.1"); anything else is whole percents.
  const dec = q.shareDecimals === 1 ? 1 : 0;
  const units = shares(nums, total, dec ? 10 : 1);
  const pcts = dec ? units.map((u) => u / 10) : units;
  const fmtShare = (/** @type {number} */ v) => (dec ? v.toFixed(1) : String(v));
  const max = Math.max(0, ...nums);
  const colTotals = /** @type {[number, number]} */ ([nums[0] + nums[2], nums[1] + nums[3]]);
  const out = CORNERS.map(([key, r, c], i) => ({
    key,
    row: rows[r],
    col: cols[c],
    count: nums[i],
    pct: pcts[i],
    share: fmtShare(pcts[i]),
    // Heat share: this count over the largest count, 0..1.
    heat: max ? Math.round((nums[i] / max) * 1000) / 1000 : 0,
    // Share of its own column, 0..1.
    colShare: colTotals[CORNERS[i][2]] ? nums[i] / colTotals[CORNERS[i][2]] : 0,
    tone: raw[i].tone && TONES.has(raw[i].tone) ? /** @type {string} */ (raw[i].tone) : null,
    label: raw[i].label || "",
    // An unsafe href is dropped (plain cell, or the act button), never thrown on.
    href: isSafeUrl(raw[i].href) ? String(raw[i].href) : null,
    act: !!raw[i].act && !isSafeUrl(raw[i].href),
    name: (raw[i].label ? raw[i].label + ", " : "") + (raw[i].tone && TONES.has(raw[i].tone) ? TONE_WORDS[/** @type {keyof typeof TONE_WORDS} */ (raw[i].tone)] + ", " : "") + rows[r] + " " + (q.yLabel || "rows") + " and " + cols[c] + " " + (q.xLabel || "columns") + ": " + fmtCount(nums[i]) + " " + unit + (total ? ", " + fmtShare(pcts[i]) + "%" : ""),
    text: rows[r] + " " + (q.yLabel || "rows") + " and " + cols[c] + " " + (q.xLabel || "columns") + ": " + fmtCount(nums[i]) + " " + unit,
  }));
  const ex = q.extra && typeof q.extra === "object" ? q.extra : null;
  const exCount = ex && Number(ex.count) > 0 ? Math.round(Number(ex.count)) : 0;
  const exLabel = (ex && ex.label) || "Unclassified";
  const n0 = (/** @type {unknown} */ v) => (Number(v) > 0 ? Math.round(Number(v)) : 0);
  const sp = ex && ex.split && typeof ex.split === "object" ? ex.split : {};
  const sLow = n0(sp.xLow);
  const sHigh = n0(sp.xHigh);
  const split = sLow || sHigh ? fmtCount(sLow) + " " + cols[0].toLowerCase() + " \u00b7 " + fmtCount(sHigh) + " " + cols[1].toLowerCase() : "";
  const extra = ex ? {
    label: exLabel,
    count: exCount,
    href: isSafeUrl(ex.href) ? String(ex.href) : null,
    act: !!ex.act && !isSafeUrl(ex.href),
    actionLabel: ex.actionLabel ? String(ex.actionLabel) : "View",
    split,
    name: exLabel + ": " + fmtCount(exCount) + " " + unit + " not in the grid" + (split ? ", " + split : ""),
  } : null;
  const aria = (q.label || "Quadrant matrix") + ": " + out.map((c) => c.name).join("; ") + ". " + fmtCount(total) + " " + unit + " in total." + (extra ? " " + extra.name + "." : "");
  return {
    cells: out,
    total,
    all: total + exCount,
    colTotals,
    rowWeights: [nums[0], nums[2]],
    extra,
    layout: q.layout && LAYOUTS.has(q.layout) ? q.layout : "mosaic",
    colour: q.colour && COLOURS.has(q.colour) ? q.colour : "status",
    aria,
  };
}

/**
 * @param {ReturnType<typeof quadModel>["cells"][number]} c
 * @param {boolean} clamp  a long mosaic label, clamped to two lines
 */
function content(c, clamp) {
  const label = c.label ? html`<span class="gk-quad__label${clamp ? " is-clamp" : ""}">${c.label}</span>` : "";
  const badge = c.tone ? html`<span class="gk-quad__tone">${icon(c.tone)}${TONE_WORDS[/** @type {keyof typeof TONE_WORDS} */ (c.tone)]}</span>` : "";
  return html`<span class="gk-quad__top">${label}${badge}</span><span class="gk-quad__num"><span class="gk-quad__count num">${fmtCount(c.count)}</span><span class="gk-quad__pct num">${c.share}%</span></span><i class="gk-quad__bar" aria-hidden="true" style="--gk-p:${c.pct}"></i>`;
}

/**
 * One cell as a link, a button or a plain element; `cls` and `style` go on that element.
 * @param {ReturnType<typeof quadModel>["cells"][number]} c
 * @param {string} id
 * @param {string} cls
 * @param {ReturnType<typeof html>} inner
 * @param {string} tip  a hover tip, or ""
 * @param {ReturnType<typeof html>|string} pos  visually hidden position text
 */
function body(c, id, cls, inner, tip, pos) {
  const extra = tip ? { "data-tip": tip } : {};
  if (c.href) return html`<a class="${cls} gk-quad__link" style="--gk-w:${c.count};--gk-s:${c.heat}" ${attrs({ ...linkAttrs(c.href), ...extra, "aria-label": c.name, "data-k": "quad-" + id + "-" + c.key })}>${inner}</a>`;
  if (c.act) return html`<button type="button" class="${cls} gk-quad__link" style="--gk-w:${c.count};--gk-s:${c.heat}" ${attrs(extra)} data-act="quad:open" data-id="${id}" data-cell="${c.key}" data-k="quad-${id}-${c.key}" aria-label="${c.name}">${inner}</button>`;
  return html`<div class="${cls}" style="--gk-w:${c.count};--gk-s:${c.heat}" ${attrs(extra)}>${pos}${inner}</div>`;
}

/**
 * @component quad
 * @title Quad
 * @category Domain
 * @summary A 2x2 quadrant mosaic (or table) with axis labels, a tone badge, count and share in each cell, optional colour and cell links.
 * @param {QuadProps} p
 * `xLow`/`xHigh` name the columns, `yLow`/`yHigh` the rows (top row is the high one); `xLabel`/`yLabel` name the axes; `cells` has `tl`, `tr`, `bl`, `br` (top-left is high y, low x), each `{count, label?, tone?, href?, act?}`. A cell with a safe `href` (http, https, mailto or relative; anything else is dropped, never thrown on) is a link; with `act: true` and no safe `href` it is a button emitting `quad:open` with `data-id` (the matrix `id`, default "quad") and `data-cell`. `unit` names the counted things. `layout` is "mosaic" (default: column widths follow the column totals, tile heights the counts above a minimum that fits the label, the tone badge and the count, so every tile, a zero one too, shows its label; a label over 20 characters is clamped to two lines with the full text as a tip; under a container width of about 420px it becomes one list, worst tone first) or "grid" (a table). `colour` is "status" (default: fill and border by tone), "heat" (fill by count over the largest count, no good or bad meaning) or "none"; an unknown value falls back to the default. `extra` is `{label?, count, split?, href?, act?, actionLabel?}`: items outside the grid, shown as a footer under the tiles and added to the header total but not to the shares; `split` is `{xLow, xHigh}` counts printed with the lowercased column names; a safe `href` or `act: true` draws an underlined action (`actionLabel`, default View); its act emits `quad:open` with `data-cell="extra"`. `title` is an optional heading with the total beside it. `shareDecimals` is 0 (default: whole percents) or 1 (tenths, printed with one decimal such as 22.1%, still adding up to 100.0 by largest remainder) and applies to the tile, the accessible names, the sentence, the table and the narrow list; a zero total prints 0.0%. For the old look use `layout: "grid", colour: "none"`.
 * @emits quad:open (data-id, data-cell; a cell button, or the extra button with data-cell "extra", was activated)
 * @states default, grid, heat, none, extra, links, acts, long-labels, zero, decimals, empty
 * @a11y The grid layout is a real table with scope=col and scope=row headers and an aria-label that reads every cell and the total. The mosaic is a group with the same aria-label, and each tile carries its row and column as visually hidden text so position, count and share are read in order. Axis names are visible text. Colour is optional: every tone is also shown by an icon shape and a word, and a bad cell by a 2px strong border, in every colour mode. Link and button cells have an aria-label that starts with the visible label and tone word, then the position, count and share (Label in Name), and a data-k. Every mosaic tile shows its label; a long label clamped to two lines keeps its full text in the DOM, in the name of a link or button cell, and in a data-tip. Focus is a 2px accent ring; transitions stop under reduced motion.
 * @example default: quad({ title: "Remediation vs risk", xLabel: "Outcome", yLabel: "Risk", xLow: "Open", xHigh: "Closed", yLow: "Not high", yHigh: "High", unit: "items", cells: { tl: { count: 40, label: "Overdue", tone: "bad" }, tr: { count: 150, label: "Handled", tone: "ok" }, bl: { count: 90, label: "Watching", tone: "warn" }, br: { count: 150, label: "Closed", tone: "ok" } } })
 * @example grid: quad({ layout: "grid", xLabel: "Likelihood", yLabel: "Impact", xLow: "Rare", xHigh: "Likely", yLow: "Minor", yHigh: "Severe", unit: "risks", cells: { tl: { count: 4, tone: "warn" }, tr: { count: 9, tone: "bad" }, bl: { count: 31, tone: "ok" }, br: { count: 12 } } })
 * @example heat: quad({ colour: "heat", unit: "risks", cells: { tl: { count: 4, tone: "warn" }, tr: { count: 9, tone: "bad" }, bl: { count: 31, tone: "ok" }, br: { count: 12, tone: "none" } } })
 * @example none: quad({ colour: "none", unit: "risks", cells: { tl: { count: 4, tone: "warn" }, tr: { count: 9, tone: "bad" }, bl: { count: 31 }, br: { count: 12 } } })
 * @example extra: quad({ title: "Acme backlog", unit: "items", extra: { label: "Unclassified", count: 10, split: { xLow: 3, xHigh: 7 }, href: "#/backlog?q=unclassified", actionLabel: "Classify them" }, cells: { tl: { count: 40, tone: "bad" }, tr: { count: 150, tone: "ok" }, bl: { count: 90, tone: "warn" }, br: { count: 150, tone: "ok" } } })
 * @example links: quad({ id: "risks", unit: "risks", cells: { tl: { count: 2, href: "#/risks?q=tl" }, tr: { count: 5, href: "#/risks?q=tr" }, bl: { count: 8, href: "#/risks?q=bl" }, br: { count: 3, href: "#/risks?q=br" } } })
 * @example acts: quad({ id: "risks", unit: "risks", cells: { tl: { count: 2, act: true }, tr: { count: 5, act: true }, bl: { count: 8, act: true }, br: { count: 3, act: true } } })
 * @example long-labels: quad({ title: "Triage vs outcome", xLabel: "Outcome", yLabel: "Triage", xLow: "Not needed", xHigh: "Needed", yLow: "Deprioritised", yHigh: "Prioritised", unit: "items", cells: { tl: { count: 95, label: "Prioritised, turned out not to matter", tone: "warn" }, tr: { count: 220, label: "Prioritised and needed", tone: "ok" }, bl: { count: 35, label: "Effort that could have gone to other work", tone: "warn" }, br: { count: 80, label: "Correctly deprioritised", tone: "ok" } } })
 * @example zero: quad({ title: "Acme secrets", unit: "secrets", xLabel: "Rotation", yLabel: "State", xLow: "Rotated", xHigh: "Not rotated", yLow: "Removed", yHigh: "Live", cells: { tl: { count: 0, label: "Live, rotated", tone: "ok" }, tr: { count: 8, label: "Live, not rotated", tone: "bad" }, bl: { count: 4, label: "Removed and rotated", tone: "ok" }, br: { count: 102, label: "Removed, not rotated", tone: "warn" } } })
 * @example decimals: quad({ title: "Triage vs outcome", shareDecimals: 1, xLabel: "Outcome", yLabel: "Triage", xLow: "Not needed", xHigh: "Needed", yLow: "Deprioritised", yHigh: "Prioritised", unit: "items", cells: { tl: { count: 95, label: "Work that mattered", tone: "ok" }, tr: { count: 220, label: "Prioritised and needed", tone: "ok" }, bl: { count: 35, label: "Missed", tone: "warn" }, br: { count: 80, label: "Correctly deprioritised", tone: "ok" } } })
 * @example empty: quad({ cells: {} })
 */
export function quad(p) {
  const q = p || {};
  const m = quadModel(q);
  const id = q.id || "quad";
  const [tl, tr, bl, br] = m.cells;
  const unit = q.unit || "items";
  const cls = "gk-quad is-" + m.layout + " is-colour-" + m.colour + (m.total ? "" : " is-empty");
  const head = q.title || m.extra ? html`<div class="gk-quad__head"><span class="gk-quad__title">${q.title || ""}</span><span class="gk-quad__sum num">${fmtCount(m.all)} ${unit}${m.extra ? html` · ${fmtCount(m.extra.count)} ${m.extra.label}` : ""}</span></div>` : "";
  const xl = q.xLabel || "";
  const yl = q.yLabel || "";
  /** @param {typeof tl} c */
  const toneCls = (c) => (c.tone ? " is-" + c.tone : "") + (c.count ? "" : " is-zero");
  /** @param {typeof tl} c */
  const td = (c) => html`<td class="gk-quad__cell${toneCls(c)}" style="--gk-s:${c.heat}">${body(c, id, "gk-quad__body", content(c, false), "", "")}</td>`;
  /** @param {typeof tl} c */
  const tile = (c) => {
    // Every tile shows its label; a long one is clamped to two lines, with the full text as a tip.
    const long = c.label.length > LONG_LABEL;
    const pos = html`<span class="sr-only">${c.row} ${yl}, ${c.col} ${xl}. </span>`;
    return body(c, id, "gk-quad__cell gk-quad__tile" + toneCls(c), content(c, long), long ? c.label : "", pos);
  };
  const ex = m.extra;
  const action = !ex ? ""
    : ex.href ? html`<a class="gk-quad__action gk-quad__link" ${attrs({ ...linkAttrs(ex.href), "aria-label": ex.actionLabel + ": " + ex.label, "data-k": "quad-" + id + "-extra" })}>${ex.actionLabel}</a>`
    : ex.act ? html`<button type="button" class="gk-quad__action gk-quad__link" data-act="quad:open" data-id="${id}" data-cell="extra" data-k="quad-${id}-extra" aria-label="${ex.actionLabel + ": " + ex.label}">${ex.actionLabel}</button>`
    : "";
  const foot = !ex ? "" : html`<div class="gk-quad__extra" role="group" aria-label="${ex.name}"><i class="gk-quad__swatch" aria-hidden="true"></i><span class="gk-quad__exn"><b class="num">${fmtCount(ex.count)} ${ex.label.toLowerCase()}</b> not in the grid</span>${ex.split ? html`<span class="gk-quad__split num">${ex.split}</span>` : ""}${action}<i class="gk-quad__exbar" aria-hidden="true"></i></div>`;
  const plot = m.layout === "grid"
    ? html`<div class="gk-quad__plot">
<span class="gk-quad__y">${yl}</span>
<table class="gk-quad__table" aria-label="${m.aria}"><thead><tr><td></td><th scope="col">${tl.col}</th><th scope="col">${tr.col}</th></tr></thead><tbody><tr><th scope="row">${tl.row}</th>${td(tl)}${td(tr)}</tr><tr><th scope="row">${bl.row}</th>${td(bl)}${td(br)}</tr></tbody></table>
<span class="gk-quad__x">${xl}</span>
${foot}</div>`
    : html`<div class="gk-quad__plot">
<span class="gk-quad__y">${yl}</span>
<div class="gk-quad__colh" aria-hidden="true" style="--gk-a:${m.colTotals[0]};--gk-b:${m.colTotals[1]}"><span class="gk-quad__colhc is-a">${tl.col} · <b class="num">${fmtCount(m.colTotals[0])}</b></span><span class="gk-quad__colhc is-b">${tr.col} · <b class="num">${fmtCount(m.colTotals[1])}</b></span></div>
<div class="gk-quad__rowh" aria-hidden="true"><span style="--gk-w:${m.rowWeights[0]}">${tl.row}</span><span style="--gk-w:${m.rowWeights[1]}">${bl.row}</span></div>
<div class="gk-quad__cols" role="group" aria-label="${m.aria}" style="--gk-a:${m.colTotals[0]};--gk-b:${m.colTotals[1]}"><div class="gk-quad__col is-a">${tile(tl)}${tile(bl)}</div><div class="gk-quad__col is-b">${tile(tr)}${tile(br)}</div></div>
<span class="gk-quad__x">${xl}</span>
${foot}</div>`;
  return html`<div class="${cls}">${head}${plot}</div>`;
}
