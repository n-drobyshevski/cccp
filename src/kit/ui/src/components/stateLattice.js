// Extracted from the author's production Apps Script apps; adapted.
// One cell per item, grouped by named state, every state its own cell SHAPE (solid, ring, dots,
// half, hatch, dashed) as well as its colour, with a key naming each state in words with its
// count and share. unitChart merges items into the five statuses; this one takes the app's own
// states, more than five of them, and two states never differ by colour alone.
import { html, cssValue } from "@gas-kit/client/html.js";
import { fmtCount } from "@gas-kit/client/format.js";

/** A colour token name such as "--chart-2" (the value is a token, never a literal). */
const TOKEN = /^--[a-z][a-z0-9-]*$/;
/** How many chart palette tokens the kit defines (--chart-1 .. --chart-6). */
const PALETTE = 6;
/** The status tones a state may take, each a status token. */
const TONES = /** @type {Record<string, string>} */ ({ ok: "--ok-fg", warn: "--warn-fg", bad: "--bad-fg", info: "--info-fg", none: "--none-fg" });

/**
 * The cell fills a state may take, each a different shape; states without one take them in order.
 * @internal
 */
export const LATTICE_FILLS = ["solid", "ring", "dots", "half", "hatch", "dashed"];
/**
 * The most cells a lattice draws by default; a bigger total makes one cell stand for several items.
 * @internal
 */
export const LATTICE_MAX = 1000;

/**
 * @typedef {{ label: string, count: number, cells?: number, fill?: string, tone?: string, color?: string, share?: string }} LatticeState
 * @typedef {{ label: string, count: number, cells: number, fill: string, color: string, share: string }} LatticeRow
 * @internal
 */

/** @param {unknown} v */
const whole = (v) => {
  const n = typeof v === "number" || (typeof v === "string" && v.trim() !== "") ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/**
 * Whole percentages of the counts that add up to 100 (largest remainder); all zero for no total.
 * @param {number[]} counts
 * @returns {number[]}
 * @internal
 */
export function latticeShares(counts) {
  const total = counts.reduce((a, n) => a + n, 0);
  if (!total) return counts.map(() => 0);
  const exact = counts.map((n) => (n / total) * 100);
  const out = exact.map(Math.floor);
  let left = 100 - out.reduce((a, n) => a + n, 0);
  exact.map((e, i) => ({ i, f: e - Math.floor(e) })).sort((a, b) => b.f - a.f || a.i - b.i).forEach((x) => {
    if (left > 0) { out[x.i] += 1; left -= 1; }
  });
  return out;
}

/**
 * DOM-free model: each state with its count, cells, fill, colour and share; the totals; and the
 * unit, about how many items one cell stands for (1 when the cells are the items). A state with
 * no label is dropped; a count that is not a positive number is zero. A state's `cells` overrides
 * its count's (the caller's own scaling); a total above `max` cells makes one cell stand for
 * several items, so the grid stays at most about `max` cells, a positive state keeping one.
 * @param {{ states?: LatticeState[], max?: number }} p
 * @returns {{ rows: LatticeRow[], total: number, cells: number, unit: number }}
 * @internal
 */
export function stateLatticeModel(p) {
  const q = p || {};
  const max = Number.isInteger(q.max) && Number(q.max) > 0 && Number(q.max) <= 5000 ? Number(q.max) : LATTICE_MAX;
  const states = (Array.isArray(q.states) ? q.states : []).filter((s) => s && typeof s.label === "string" && s.label !== "");
  const raw = states.map((s) => (s.cells == null ? whole(s.count) : whole(s.cells)));
  const sum = raw.reduce((a, n) => a + n, 0);
  const scale = sum > max ? Math.ceil(sum / max) : 1;
  const total = states.reduce((a, s) => a + whole(s.count), 0);
  const counts = states.map((s) => whole(s.count));
  const pcts = latticeShares(counts);
  /** @param {number} i */
  const share = (i) => {
    if (!total) return "";
    const exact = (counts[i] / total) * 100;
    return (exact > 0 && exact < 1 ? "<1" : String(pcts[i])) + "%";
  };
  const rows = states.map((s, i) => ({
    label: s.label,
    count: whole(s.count),
    cells: raw[i] > 0 ? Math.max(1, Math.round(raw[i] / scale)) : 0,
    fill: typeof s.fill === "string" && LATTICE_FILLS.indexOf(s.fill) >= 0 ? s.fill : LATTICE_FILLS[i % LATTICE_FILLS.length],
    color: typeof s.color === "string" && TOKEN.test(s.color)
      ? "var(" + s.color + ")"
      : typeof s.tone === "string" && Object.prototype.hasOwnProperty.call(TONES, s.tone) ? "var(" + TONES[s.tone] + ")" : "var(--chart-" + ((i % PALETTE) + 1) + ")",
    share: typeof s.share === "string" && s.share !== "" ? s.share : share(i),
  }));
  const cells = rows.reduce((a, r) => a + r.cells, 0);
  const per = cells ? Math.round(total / cells) : 1;
  return { rows, total, cells, unit: cells !== total && per >= 2 ? per : 1 };
}

/**
 * @component stateLattice
 * @title State Lattice
 * @category Charts
 * @summary One cell per item, grouped by named state, each state its own cell shape and colour, with a key of words, counts and shares.
 * @param {{states: Array<{label: string, count: number, cells?: number, fill?: "solid"|"ring"|"dots"|"half"|"hatch"|"dashed", tone?: "ok"|"warn"|"bad"|"info"|"none", color?: string, share?: string}>, label?: string, keyZeros?: boolean, columns?: number, max?: number, noun?: string, emptyText?: string}} p
 * `label` names the grid for assistive technology (default "By state"); it may say every count in words ("Of 40 hosts: 24 up, 6 down..."). Each state draws one cell per item in its `fill` (a shape: solid, ring, dots, half, hatch or dashed; states without one take them in order, so two states never share a shape by default) and its colour: `tone` for a status token, `color` for a colour token (`"--chart-4"`), else the chart palette in order. `cells` replaces the cell count of a state the caller has scaled. Above `max` cells (default 1000) one cell stands for several items, rounded, and a line under the key says how many (`noun`, default "items"). `share` is the key's printed share (default the state's whole percentage of all counts, adding up to 100, "<1%" for a sliver). `keyZeros: false` leaves states with a zero count out of the key (default: kept, with 0). `columns` fixes the cells to a row (default: they wrap). No cells shows `emptyText` (default "No data").
 * @emits none
 * @states default, tones, zeros, scaled, empty
 * @a11y The grid is one image named by `label`; its cells and the key's swatches are aria-hidden. The key is a list that names every state in words with its count and share, and each swatch has the shape of its state's cells, so the states never rest on colour alone.
 * @example default: stateLattice({ label: "Of 40 repositories: 12 active, 8 idle, 6 cold, 5 not measured, 5 archived, 4 out of sight", states: [{ label: "Active", count: 12 }, { label: "Idle", count: 8 }, { label: "Cold", count: 6 }, { label: "Not measured", count: 5 }, { label: "Archived", count: 5 }, { label: "Out of sight", count: 4 }] })
 * @example tones: stateLattice({ label: "Of 20 hosts: 14 up, 3 degraded, 2 down, 1 unknown", states: [{ label: "Up", count: 14, fill: "solid", tone: "ok" }, { label: "Degraded", count: 3, fill: "half", tone: "warn" }, { label: "Down", count: 2, fill: "hatch", tone: "bad" }, { label: "Unknown", count: 1, fill: "dashed", tone: "none" }] })
 * @example zeros: stateLattice({ label: "Of 9 jobs: 7 done, 2 failed", keyZeros: false, states: [{ label: "Done", count: 7, fill: "solid", tone: "ok" }, { label: "Running", count: 0, fill: "ring", tone: "info" }, { label: "Failed", count: 2, fill: "hatch", tone: "bad" }] })
 * @example scaled: stateLattice({ label: "Of 1,125 applications: 900 current, 180 due, 45 overdue", max: 100, noun: "applications", states: [{ label: "Current", count: 900, fill: "solid", tone: "ok" }, { label: "Due", count: 180, fill: "dots", tone: "warn" }, { label: "Overdue", count: 45, fill: "hatch", tone: "bad" }] })
 * @example empty: stateLattice({ label: "Hosts by state", states: [] })
 */
export function stateLattice(p) {
  const q = p || { states: [] };
  const name = typeof q.label === "string" && q.label !== "" ? q.label : "By state";
  const m = stateLatticeModel(q);
  if (!m.cells) {
    return html`<div class="gk-stateLattice is-empty" role="img" aria-label="${name}"><span class="gk-stateLattice__empty" aria-hidden="true">${q.emptyText || "No data"}</span></div>`;
  }
  const columns = Number.isInteger(q.columns) && Number(q.columns) > 0 && Number(q.columns) <= 200 ? Number(q.columns) : 0;
  const groups = m.rows.filter((r) => r.cells > 0).map((r) => {
    /** @type {unknown[]} */
    const cells = [];
    for (let i = 0; i < r.cells; i += 1) cells.push(html`<i class="gk-stateLattice__cell"></i>`);
    return html`<span class="${"gk-stateLattice__group is-" + r.fill}" style="--gk-c:${cssValue(r.color)}">${cells}</span>`;
  });
  const keyRows = m.rows.filter((r) => q.keyZeros !== false || r.count > 0);
  const noun = typeof q.noun === "string" && q.noun !== "" ? q.noun : "items";
  return html`<div class="gk-stateLattice"><div class="${columns ? "gk-stateLattice__grid is-columns" : "gk-stateLattice__grid"}" role="img" aria-label="${name}" style="--gk-cols:${columns}">${groups}</div><ul class="gk-stateLattice__key">${keyRows.map(
    (r) => html`<li class="gk-stateLattice__item"><span class="${"gk-stateLattice__swatch is-" + r.fill}" style="--gk-c:${cssValue(r.color)}" aria-hidden="true"></span><span class="gk-stateLattice__name">${r.label}</span><span class="sr-only">,</span> <span class="gk-stateLattice__count">${fmtCount(r.count)}</span>${r.share ? html`<span class="sr-only">,</span> <span class="gk-stateLattice__share">${r.share}</span>` : ""}</li>`,
  )}</ul>${m.unit > 1 ? html`<p class="gk-stateLattice__unit">One cell is about ${fmtCount(m.unit)} ${noun}.</p>` : ""}</div>`;
}
