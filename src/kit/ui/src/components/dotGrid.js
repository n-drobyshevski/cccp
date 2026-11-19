// Extracted from the author's production Apps Script apps; adapted.
// A share drawn as filled cells out of a fixed grid (100 by default, 20 to a row): "26% of the
// backlog" is 26 filled cells. A positive share below half a cell still fills one, so 0.7% never
// draws as nothing. The figure itself is the reading; the grid is its picture, labelled in words.
import { html, cssValue } from "@gas-kit/client/html.js";

/** A colour token name such as "--accent" (the value is a token, never a literal). */
const TOKEN = /^--[a-z][a-z0-9-]*$/;

/**
 * The share in percent (0..100) from a share or a value of a total, or null when it cannot be read.
 * @param {{ share?: unknown, value?: unknown, total?: unknown }} p
 * @returns {number | null}
 * @internal
 */
export function dotGridShare(p) {
  const num = (/** @type {unknown} */ v) => (v === null || v === undefined || v === "" ? null : Number(v));
  const s = num(p.share);
  if (s !== null) return Number.isFinite(s) ? Math.min(Math.max(s, 0), 100) : null;
  const v = num(p.value);
  const t = num(p.total);
  if (v === null || t === null || !Number.isFinite(v) || !Number.isFinite(t) || t <= 0) return null;
  return Math.min(Math.max((v / t) * 100, 0), 100);
}

/**
 * How many of `cells` a share fills: rounded, but a positive share fills at least one.
 * @param {number} sharePct @param {number} cells
 * @internal
 */
export function dotGridFilled(sharePct, cells) {
  if (!(sharePct > 0)) return 0;
  return Math.min(cells, Math.max(1, Math.round((sharePct / 100) * cells)));
}

/**
 * @component dotGrid
 * @title Dot Grid
 * @category Charts
 * @summary A share drawn as filled cells out of a fixed grid of 100, 20 to a row.
 * @param {{share?: number, value?: number, total?: number, label: string, cells?: number, columns?: number, color?: string, emptyText?: string}} p
 * `share` is a percentage (0 to 100); or give `value` and `total` and the share is worked out. `label` says the share in words ("0.7% of open findings are in cold repositories"); it is what assistive technology reads. `cells` (default 100) and `columns` (default 20) shape the grid. `color` names the colour token of the filled cells (default `"--accent"`). A positive share below half a cell still fills one cell, so a small share is never drawn as none. A share that cannot be read shows `emptyText` (default "No data").
 * @emits none
 * @states default, small, value, empty
 * @a11y One image labelled by `label`; the cells are aria-hidden. Nothing is said by colour alone: the grid only pictures a figure that the page prints next to it, and the label carries it in words.
 * @example default: dotGrid({ share: 26, label: "26% of open findings are in cold repositories" })
 * @example small: dotGrid({ share: 0.7, label: "0.7% of open findings are in cold repositories" })
 * @example value: dotGrid({ value: 3, total: 10, cells: 10, columns: 10, color: "--chart-2", label: "3 of 10 repositories are idle" })
 * @example empty: dotGrid({ label: "Share of cold findings" })
 */
export function dotGrid(p) {
  const q = p || { label: "" };
  const label = q.label || "Share";
  const cells = Number.isInteger(q.cells) && Number(q.cells) > 0 && Number(q.cells) <= 400 ? Number(q.cells) : 100;
  const columns = Number.isInteger(q.columns) && Number(q.columns) > 0 && Number(q.columns) <= cells ? Number(q.columns) : Math.min(20, cells);
  const share = dotGridShare(q);
  if (share === null) {
    return html`<span class="gk-dotGrid is-empty" role="img" aria-label="${label}"><span class="gk-dotGrid__empty" aria-hidden="true">${q.emptyText || "No data"}</span></span>`;
  }
  const filled = dotGridFilled(share, cells);
  const fill = typeof q.color === "string" && TOKEN.test(q.color) ? "var(" + q.color + ")" : "var(--accent)";
  /** @type {unknown[]} */
  const marks = [];
  for (let i = 0; i < cells; i += 1) marks.push(i < filled ? html`<i class="gk-dotGrid__cell is-on"></i>` : html`<i class="gk-dotGrid__cell"></i>`);
  return html`<span class="gk-dotGrid" role="img" aria-label="${label}" style="--gk-cols:${columns};--gk-fill:${cssValue(fill)}"><span class="gk-dotGrid__cells" aria-hidden="true">${marks}</span></span>`;
}
