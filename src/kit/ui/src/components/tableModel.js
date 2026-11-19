// Extracted from the author's production Apps Script apps; adapted.
// DOM-free table model: stable sort with null-last, facet and text filtering, show-more paging
// and column visibility stored as signed deviations from the defaults. Everything is computed
// in the browser over the whole list; the view (dataTable) only renders the result.
//
// Rows are immutable data: a row object, and a rows array, must not be changed in place once it
// has been passed here. Three caches rely on that: the folded search text of each row (per text
// hook), the last queryTable call, and the facet counts per rows array and value hook. To change
// a row, replace it (and the array) with a new object. Results are shared: treat them as
// read-only.

/** Rows added by one Show more click. */
export const PAGE_STEP = 50;

/**
 * Lower-case and strip accents, for find-as-you-type.
 * @param {unknown} s
 * @returns {string}
 * @internal
 */
export function fold(s) {
  return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * True for the values that sort last in both directions: null, undefined, "" and NaN.
 * @param {unknown} v
 * @internal
 */
export function isBlank(v) {
  return v == null || v === "" || (typeof v === "number" && v !== v);
}

const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/**
 * Compare two non-blank values. It is a total order, so a sort never depends on input order:
 * numeric values first (numbers, and strings that read as plain decimal numbers such as "9",
 * "10" or "-2.5", compared numerically, so numbers a sheet delivers as text sort right), then
 * everything else as case-insensitive text (no locale; booleans read as "false" and "true", so
 * false sorts first). A column that mixes numeric and other text therefore lists the numbers
 * first, in numeric order, then the rest by text.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {number}
 * @internal
 */
export function compareValues(a, b) {
  const na = asNumber(a);
  const nb = asNumber(b);
  if (na !== null && nb !== null) return na < nb ? -1 : na > nb ? 1 : 0;
  if (na !== null) return -1;
  if (nb !== null) return 1;
  const x = String(a).toLowerCase();
  const y = String(b).toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * The numeric reading of a value, or null when it is not numeric.
 * @param {unknown} v
 * @returns {number|null}
 */
function asNumber(v) {
  if (typeof v === "number") return v === v ? v : null;
  if (typeof v === "string") {
    const t = v.trim();
    return NUMERIC.test(t) ? Number(t) : null;
  }
  return null;
}

/**
 * A stable sort. Blank values go last in BOTH directions (outside the descending flip) and ties
 * keep the original order, or use `tiebreak`, which is never flipped.
 * @template T
 * @param {T[]} rows
 * @param {{ value: (row: T) => unknown, descending?: boolean, tiebreak?: (a: T, b: T) => number }} o
 * @returns {T[]} a new array
 * @internal
 */
export function sortRows(rows, o) {
  const dir = o.descending ? -1 : 1;
  const tagged = rows.map((row, i) => ({ row, i, v: o.value(row) }));
  tagged.sort((a, b) => {
    const ab = isBlank(a.v);
    const bb = isBlank(b.v);
    if (ab || bb) {
      if (ab && bb) return o.tiebreak ? o.tiebreak(a.row, b.row) || a.i - b.i : a.i - b.i;
      return ab ? 1 : -1;
    }
    const c = compareValues(a.v, b.v) * dir;
    if (c) return c;
    return (o.tiebreak ? o.tiebreak(a.row, b.row) : 0) || a.i - b.i;
  });
  return tagged.map((t) => t.row);
}

/**
 * The next sort after a header click: the same key reverses, a new key starts at `descFirst`.
 * @param {{ key: string|null, desc: boolean }|null|undefined} sort
 * @param {string} key
 * @param {boolean} [descFirst]
 * @returns {{ key: string, desc: boolean }}
 * @internal
 */
export function nextSort(sort, key, descFirst) {
  if (sort && sort.key === key) return { key, desc: !sort.desc };
  return { key, desc: !!descFirst };
}

/** The cache key standing for the default text hook (every value of the row). */
const DEFAULT_TEXT = {};

/**
 * Folded search text: text hook (or DEFAULT_TEXT) -> row object -> fold(text(row)). Keyed by
 * the hook because the hook decides which columns are searched, so two calls that search
 * different columns never share an entry. Both levels are weak, so a dropped row or hook frees
 * its text. Pass a stable `text` function (not a new arrow per call) to benefit.
 * @type {WeakMap<object, WeakMap<object, string>>}
 */
const foldCache = new WeakMap();

/**
 * fold(text(row)), computed once per row object and text hook. Primitive rows are not cached.
 * @template T
 * @param {T} r
 * @param {(row: T) => string} text
 * @param {object} hook the cache key for `text`
 * @returns {string}
 */
function foldedText(r, text, hook) {
  if (r === null || (typeof r !== "object" && typeof r !== "function")) return fold(text(r));
  const row = /** @type {object} */ (/** @type {unknown} */ (r));
  let byRow = foldCache.get(hook);
  if (!byRow) {
    byRow = new WeakMap();
    foldCache.set(hook, byRow);
  }
  let hay = byRow.get(row);
  if (hay === undefined) {
    hay = fold(text(r));
    byRow.set(row, hay);
  }
  return hay;
}

/**
 * Filter rows. `facets` maps a facet name to the selected values: values within a facet are OR,
 * facets are AND, an empty selection does not filter. `q` is split into words that must ALL
 * appear (accent- and case-insensitive) in `text(row)`. The folded text of each row is cached
 * per row object and `text` hook (rows are immutable, see the top of the module).
 * @template T
 * @param {T[]} rows
 * @param {{ facets?: Record<string, string[]>, q?: string, facetValue?: (row: T, facet: string) => unknown, text?: (row: T) => string }} o
 * @returns {T[]}
 * @internal
 */
export function filterRows(rows, o) {
  const facets = o.facets || {};
  const names = Object.keys(facets).filter((k) => facets[k] && facets[k].length);
  const words = fold(o.q || "").split(/\s+/).filter(Boolean);
  if (!names.length && !words.length) return rows.slice();
  const fv = o.facetValue || ((r, f) => /** @type {any} */ (r)[f]);
  const hook = o.text || DEFAULT_TEXT;
  const text = o.text || ((r) => Object.keys(/** @type {any} */ (r)).map((k) => /** @type {any} */ (r)[k]).join(" "));
  return rows.filter((r) => {
    for (const n of names) {
      const v = fv(r, n);
      const vals = Array.isArray(v) ? v.map(String) : [v == null ? "" : String(v)];
      if (!facets[n].some((s) => vals.indexOf(String(s)) >= 0)) return false;
    }
    if (!words.length) return true;
    const hay = foldedText(r, text, hook);
    return words.every((w) => hay.indexOf(w) >= 0);
  });
}

/**
 * Facet counts: rows array -> value hook -> counts. Weak at both levels, so the counts live as
 * long as the array they describe.
 * @type {WeakMap<object, WeakMap<Function, Map<string, number>>>}
 */
const countCache = new WeakMap();

/**
 * Counts per value of a facet over rows (used for the option counts). Memoised per rows array
 * and `value` function: the same array with the same (stable) hook returns the same Map, so a
 * re-render does not recount. The Map is shared: treat it as read-only.
 * @template T
 * @param {T[]} rows
 * @param {(row: T) => unknown} value
 * @returns {Map<string, number>}
 * @internal
 */
export function countBy(rows, value) {
  let byHook = countCache.get(rows);
  const hit = byHook && byHook.get(value);
  if (hit) return hit;
  /** @type {Map<string, number>} */
  const m = new Map();
  for (const r of rows) {
    const v = value(r);
    for (const x of Array.isArray(v) ? v : [v]) {
      if (isBlank(x)) continue;
      const k = String(x);
      m.set(k, (m.get(k) || 0) + 1);
    }
  }
  if (!byHook) {
    byHook = new WeakMap();
    countCache.set(rows, byHook);
  }
  byHook.set(value, m);
  return m;
}

/**
 * How many rows to show after a Show more click, clamped to the total.
 * @param {number} shown
 * @param {number} total
 * @param {number} [step]
 * @internal
 */
export function showMore(shown, total, step) {
  return Math.min(Math.max(0, total), Math.max(0, shown) + Math.max(1, step || PAGE_STEP));
}

/**
 * The next Show more step for the button label: min(step, rows left).
 * @param {number} shown
 * @param {number} total
 * @param {number} [step]
 * @internal
 */
export function moreStep(shown, total, step) {
  return Math.max(0, Math.min(step || PAGE_STEP, total - shown));
}

/**
 * Parse stored signed deviations: "-key" hides a default-visible column, "+key" shows a
 * default-hidden one. Unknown keys and malformed items are dropped.
 * @param {unknown} stored an array of strings (anything else gives no deviations)
 * @param {Array<{ key?: string }>} columns
 * @returns {string[]}
 * @internal
 */
export function parseDeviations(stored, columns) {
  const known = new Set(columns.map((c) => c.key).filter(Boolean));
  if (!Array.isArray(stored)) return [];
  return stored.filter((s) => typeof s === "string" && /^[+-]/.test(s) && known.has(s.slice(1)));
}

/**
 * A column can be hidden when it has a key, is not pinned and has a label (an empty label is the
 * button column).
 * @param {{ key?: string, pinned?: boolean, label?: string }} c
 * @internal
 */
export function isHideable(c) {
  return !!(c && c.key && !c.pinned && c.label);
}

/**
 * Resolve the visible columns. Defaults come from `hidden: true` on a column; the deviations
 * flip them, so a column added later gets its default for everyone. A column that cannot be
 * hidden is always visible.
 * @template {{ key?: string, pinned?: boolean, label?: string, hidden?: boolean }} C
 * @param {C[]} columns
 * @param {string[]} [deviations]
 * @returns {C[]}
 * @internal
 */
export function visibleColumns(columns, deviations) {
  const dev = new Set(deviations || []);
  return columns.filter((c) => {
    if (!isHideable(c)) return true;
    if (dev.has("-" + c.key)) return false;
    if (dev.has("+" + c.key)) return true;
    return !c.hidden;
  });
}

/**
 * Toggle one column's visibility and return the new deviation list (a deviation that equals the
 * default is removed, so the list stays minimal).
 * @param {Array<{ key?: string, pinned?: boolean, label?: string, hidden?: boolean }>} columns
 * @param {string[]} deviations
 * @param {string} key
 * @returns {string[]}
 * @internal
 */
export function toggleColumn(columns, deviations, key) {
  const c = columns.find((x) => x.key === key);
  if (!c || !isHideable(c)) return deviations.slice();
  const visible = visibleColumns(columns, deviations).some((x) => x.key === key);
  const rest = deviations.filter((d) => d.slice(1) !== key);
  const wantVisible = !visible;
  const defaultVisible = !c.hidden;
  return wantVisible === defaultVisible ? rest : rest.concat([(wantVisible ? "+" : "-") + key]);
}

/**
 * The last queryTable call: its inputs by reference, its query by JSON, and its result.
 * @type {{ rows: unknown, columns: unknown, facetValue: unknown, text: unknown, tiebreak: unknown, sig: string, result: any }|null}
 */
let lastQuery = null;

/**
 * The whole pipeline: filter, sort, then take the first `shown` rows.
 *
 * Memoised on its last call: called again with the same `rows` array, the same `columns`,
 * `facetValue`, `text` and `tiebreak` references and a query (`sort`, `facets`, `q`, `shown`)
 * whose JSON is equal, it returns the previous result object itself. One entry only, so a
 * second table in the page simply recomputes. The result is shared: treat it as read-only.
 * @template T
 * @param {{ rows: T[], columns?: Array<{ key?: string, sortValue?: (row: T) => unknown }>, sort?: { key: string|null, desc: boolean }|null, facets?: Record<string, string[]>, q?: string, facetValue?: (row: T, facet: string) => unknown, text?: (row: T) => string, tiebreak?: (a: T, b: T) => number, shown?: number }} o
 * @returns {{ rows: T[], total: number, matched: number, shown: number, left: number, filtered: boolean }}
 * @internal
 */
export function queryTable(o) {
  const sig = JSON.stringify([o.sort || null, o.facets || null, o.q || "", o.shown == null ? null : o.shown]);
  const last = lastQuery;
  if (last && last.rows === o.rows && last.columns === o.columns && last.facetValue === o.facetValue && last.text === o.text && last.tiebreak === o.tiebreak && last.sig === sig) {
    return last.result;
  }
  const result = runQuery(o);
  lastQuery = { rows: o.rows, columns: o.columns, facetValue: o.facetValue, text: o.text, tiebreak: o.tiebreak, sig, result };
  return result;
}

/**
 * queryTable without the memo.
 * @template T
 * @param {Parameters<typeof queryTable<T>>[0]} o
 * @returns {ReturnType<typeof queryTable<T>>}
 */
function runQuery(o) {
  const all = o.rows || [];
  const f = filterRows(all, o);
  let sorted = f;
  const sort = o.sort;
  if (sort && sort.key) {
    const col = (o.columns || []).find((c) => c.key === sort.key);
    const key = /** @type {string} */ (sort.key);
    const value = col && col.sortValue ? col.sortValue : (/** @type {any} */ r) => r[key];
    sorted = sortRows(f, { value, descending: sort.desc, tiebreak: o.tiebreak });
  }
  const shown = Math.min(sorted.length, Math.max(0, o.shown == null ? PAGE_STEP : o.shown));
  const hasFacet = Object.keys(o.facets || {}).some((k) => (o.facets || {})[k] && (o.facets || {})[k].length);
  return {
    rows: sorted.slice(0, shown),
    total: all.length,
    matched: sorted.length,
    shown,
    left: sorted.length - shown,
    filtered: hasFacet || fold(o.q || "").trim() !== "",
  };
}

/**
 * The rows as a matrix for CSV or Excel: the first row holds the column labels, then one row per
 * input row. A cell is `exportValue(row)` when the column has one, else `sortValue(row)`, else
 * `row[key]`. null and undefined become "", numbers stay numbers (so a spreadsheet keeps them
 * numeric), booleans become "true" or "false", an array is joined with ", " and anything else
 * is String(v). A column with no exportValue and either no key or an empty label (a button
 * column) is skipped.
 * @template T
 * @param {ReadonlyArray<T>} rows
 * @param {ReadonlyArray<{ key?: string, label?: string, exportValue?: (row: T) => unknown, sortValue?: (row: T) => unknown }>} columns
 * @returns {Array<Array<string|number>>}
 * @internal
 */
export function exportMatrix(rows, columns) {
  const cols = (columns || []).filter((c) => c && (typeof c.exportValue === "function" || (c.key && c.label)));
  /** @param {unknown} v @returns {string|number} */
  const cell = (v) => {
    if (v == null) return "";
    if (typeof v === "number") return v;
    if (Array.isArray(v)) return v.filter((x) => x != null).map(String).join(", ");
    return String(v);
  };
  /** @type {Array<Array<string|number>>} */
  const out = [cols.map((c) => (c.label == null ? "" : String(c.label)))];
  for (const r of rows || []) {
    out.push(cols.map((c) => {
      if (typeof c.exportValue === "function") return cell(c.exportValue(r));
      if (typeof c.sortValue === "function") return cell(c.sortValue(r));
      return cell(/** @type {any} */ (r)[/** @type {string} */ (c.key)]);
    }));
  }
  return out;
}
