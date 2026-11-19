// Extracted from the author's production Apps Script apps; adapted.
// A 2x2 quadrant matrix as a real table: column headers along the top, row headers down the
// side, a count in each cell. Cells can be links or buttons (data-act) when they carry an href
// or an act flag.
import { html, attrs, isSafeUrl, linkAttrs } from "@gas-kit/client/html.js";
import { fmtCount } from "@gas-kit/client/format.js";

/** The four cells, top row first: [key, row index (0 = high), column index (0 = low)]. */
/** @type {Array<[string, number, number]>} */
export const CORNERS = [["tl", 0, 0], ["tr", 0, 1], ["bl", 1, 0], ["br", 1, 1]];
/** The tones a cell can carry; each one also prints a word. */
export const TONES = new Set(["ok", "warn", "bad", "none"]);
const TONE_WORDS = { ok: "OK", warn: "Warning", bad: "Problem", none: "No data" };

/**
 * @typedef {{count?: number, label?: string, tone?: "ok"|"warn"|"bad"|"none", href?: string, act?: boolean}} QuadCell
 * @typedef {{id?: string, xLabel?: string, yLabel?: string, xLow?: string, xHigh?: string, yLow?: string, yHigh?: string, cells?: {tl?: QuadCell, tr?: QuadCell, bl?: QuadCell, br?: QuadCell}, unit?: string, label?: string}} QuadProps
 */

/**
 * Whole-number shares by largest remainder, so they add up to 100 (all 0 for a zero total).
 * @param {number[]} counts
 * @param {number} total
 * @returns {number[]}
 */
function shares(counts, total) {
  if (!total) return counts.map(() => 0);
  const exact = counts.map((n) => (n / total) * 100);
  const out = exact.map((e) => Math.floor(e));
  let left = 100 - out.reduce((a, n) => a + n, 0);
  exact.map((e, i) => ({ i, f: e - Math.floor(e) })).sort((a, b) => b.f - a.f || a.i - b.i).forEach((x) => { if (left > 0) { out[x.i] += 1; left -= 1; } });
  return out;
}

/**
 * DOM-free model: each cell with its row and column words, count, share (largest remainder, so shares add up to 100) and sentence.
 * @param {QuadProps} [p]
 * @returns {{cells: Array<{key: string, row: string, col: string, count: number, pct: number, tone: string|null, label: string, href: string|null, act: boolean, name: string, text: string}>, total: number, aria: string}}
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
  const pcts = shares(nums, total);
  const out = CORNERS.map(([key, r, c], i) => ({
    key,
    row: rows[r],
    col: cols[c],
    count: nums[i],
    pct: pcts[i],
    tone: raw[i].tone && TONES.has(raw[i].tone) ? /** @type {string} */ (raw[i].tone) : null,
    label: raw[i].label || "",
    // An unsafe href is dropped (plain cell, or the act button), never thrown on.
    href: isSafeUrl(raw[i].href) ? String(raw[i].href) : null,
    act: !!raw[i].act && !isSafeUrl(raw[i].href),
    name: (raw[i].label ? raw[i].label + ", " : "") + (raw[i].tone && TONES.has(raw[i].tone) ? TONE_WORDS[/** @type {keyof typeof TONE_WORDS} */ (raw[i].tone)] + ", " : "") + rows[r] + " " + (q.yLabel || "rows") + " and " + cols[c] + " " + (q.xLabel || "columns") + ": " + fmtCount(nums[i]) + " " + unit + (total ? ", " + pcts[i] + "%" : ""),
    text: rows[r] + " " + (q.yLabel || "rows") + " and " + cols[c] + " " + (q.xLabel || "columns") + ": " + fmtCount(nums[i]) + " " + unit,
  }));
  const aria = (q.label || "Quadrant matrix") + ": " + out.map((c) => c.name).join("; ") + ". " + fmtCount(total) + " " + unit + " in total.";
  return { cells: out, total, aria };
}

/**
 * @param {ReturnType<typeof quadModel>["cells"][number]} c
 * @param {string} id
 */
function cellBody(c, id) {
  const inner = html`<span class="gk-quad__count num">${fmtCount(c.count)}</span>${c.label ? html`<span class="gk-quad__label">${c.label}</span>` : ""}<span class="gk-quad__pct num">${c.pct}%</span>${c.tone ? html`<span class="gk-quad__tone">${TONE_WORDS[/** @type {keyof typeof TONE_WORDS} */ (c.tone)]}</span>` : ""}`;
  if (c.href) return html`<a class="gk-quad__body gk-quad__link" ${attrs({ ...linkAttrs(c.href), "aria-label": c.name, "data-k": "quad-" + id + "-" + c.key })}>${inner}</a>`;
  if (c.act) return html`<button type="button" class="gk-quad__body gk-quad__link" data-act="quad:open" data-id="${id}" data-cell="${c.key}" data-k="quad-${id}-${c.key}" aria-label="${c.name}">${inner}</button>`;
  return html`<span class="gk-quad__body">${inner}</span>`;
}

/**
 * @component quad
 * @title Quad
 * @category Domain
 * @summary A 2x2 quadrant matrix with axis labels, a count in each cell and optional cell links.
 * @param {QuadProps} p
 * `xLow`/`xHigh` name the columns, `yLow`/`yHigh` the rows (top row is the high one); `xLabel`/`yLabel` name the axes; `cells` has `tl`, `tr`, `bl`, `br` (top-left is high y, low x), each `{count, label?, tone?, href?, act?}`. A cell with a safe `href` (http, https, mailto or relative; anything else is dropped, never thrown on) is a link; with `act: true` and no safe `href` it is a button emitting `quad:open` with `data-id` (the matrix `id`, default "quad") and `data-cell`. `unit` names the counted things.
 * @emits quad:open (data-id, data-cell; a cell button was activated)
 * @states default, links, acts, empty
 * @a11y A real table with scope=col and scope=row headers and an aria-label that reads every cell and the total. Axis names are visible text. A tone is shown by its cell border (width and style) and by its word, never by colour. Link and button cells have an aria-label that starts with the visible label and tone word, then the position, count and share (Label in Name), and a data-k; the table label reads the same for every cell.
 * @example default: quad({ xLabel: "Likelihood", yLabel: "Impact", xLow: "Rare", xHigh: "Likely", yLow: "Minor", yHigh: "Severe", unit: "risks", cells: { tl: { count: 4, tone: "warn" }, tr: { count: 9, tone: "bad" }, bl: { count: 31, tone: "ok" }, br: { count: 12, tone: "warn" } } })
 * @example links: quad({ id: "risks", unit: "risks", cells: { tl: { count: 2, href: "#/risks?q=tl" }, tr: { count: 5, href: "#/risks?q=tr" }, bl: { count: 8, href: "#/risks?q=bl" }, br: { count: 3, href: "#/risks?q=br" } } })
 * @example acts: quad({ id: "risks", unit: "risks", cells: { tl: { count: 2, act: true }, tr: { count: 5, act: true }, bl: { count: 8, act: true }, br: { count: 3, act: true } } })
 * @example empty: quad({ cells: {} })
 */
export function quad(p) {
  const q = p || {};
  const m = quadModel(q);
  const id = q.id || "quad";
  const [tl, tr, bl, br] = m.cells;
  /** @param {typeof tl} c */
  const td = (c) => html`<td class="gk-quad__cell${c.tone ? " is-" + c.tone : ""}${c.count ? "" : " is-zero"}">${cellBody(c, id)}</td>`;
  return html`<div class="gk-quad${m.total ? "" : " is-empty"}">
<span class="gk-quad__y">${q.yLabel || ""}</span>
<table class="gk-quad__table" aria-label="${m.aria}"><thead><tr><td></td><th scope="col">${tl.col}</th><th scope="col">${tr.col}</th></tr></thead><tbody><tr><th scope="row">${tl.row}</th>${td(tl)}${td(tr)}</tr><tr><th scope="row">${bl.row}</th>${td(bl)}${td(br)}</tr></tbody></table>
<span class="gk-quad__x">${q.xLabel || ""}</span>
</div>`;
}
