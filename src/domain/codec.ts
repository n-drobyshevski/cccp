// The register's columnar row codec: columns and a string dictionary instead of one object per row,
// so the keys and the repeated strings are written once. Provenance: formerly vendored from the
// upstream shared library (commit 77bcf22, domain/snapshotCodec.ts), now app-owned; only the row
// codec is kept (the upstream's two-table snapshot wrapper was unused here). The wire format is
// unchanged, so a register cached by an earlier build still decodes. See KIT.md.
//
// WHY. Almost all of the register's text is repetition: every row spells out the same key names and
// the long strings repeat across rows. Parsing is paid per character, so the fix is to stop writing
// the same characters twice.
//
// THE ENCODING, per table ({ cols, rows }):
//   - `cols` names each column once; a row is an array in that order.
//   - A column is DICTIONARY-ENCODED when its non-null values are all strings and mostly repeat.
//     Its cells then hold an index into the snapshot-wide `strings` table. A non-string that
//     turns up in such a column is stored wrapped as `[value]`, so a cell is always one of
//     index | null | [raw] and the decode is unambiguous.
//   - Any other column holds its values as they are.
//   - A key absent from a row (as opposed to present and null) is listed in `absent` as
//     [row, col], so the decode reproduces the object exactly rather than inventing a null. A
//     key whose value is `undefined` counts as absent — which is what the v1 snapshot did too,
//     since JSON.stringify drops such keys.
//
// EXACTNESS IS THE CONTRACT: `decodeRows(encodeRows(x))` deep-equals what a JSON round trip of
// `x` gives — same keys, same values. Key ORDER follows the columns (first appearance across
// rows), which for uniform rows is each row's own order. test/domain/codec.test.ts holds that on
// adversarial rows.
//

type Row = Record<string, unknown>;

export interface EncodedTable {
  cols: string[];
  /** Indices of the dictionary-encoded columns. */
  dict: number[];
  rows: unknown[][];
  /** [rowIndex, colIndex] of each key absent from its row. */
  absent: [number, number][];
}

/** A column is worth a dictionary when at most this share of its strings are distinct. */
const DICT_MAX_DISTINCT_SHARE = 0.5;

/** Encode rows against a shared, growing string table (`strings` / `index` are appended to). */
export function encodeRows(
  rows: Row[],
  strings: string[],
  index: Map<string, number>,
): EncodedTable {
  // Column order: first appearance across rows, so a table of uniform rows keeps its key order.
  const cols: string[] = [];
  const colOf = new Map<string, number>();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!colOf.has(k)) {
        colOf.set(k, cols.length);
        cols.push(k);
      }
    }
  }

  // Decide per column: all non-null values strings, and mostly repeated.
  const dict: number[] = [];
  for (let c = 0; c < cols.length; c++) {
    const name = cols[c]!;
    const seen = new Set<string>();
    let strs = 0;
    let onlyStrings = true;
    for (const r of rows) {
      const v = r[name];
      if (v === null || v === undefined) continue;
      if (typeof v !== "string") {
        onlyStrings = false;
        break;
      }
      strs += 1;
      seen.add(v);
    }
    if (onlyStrings && strs > 0 && seen.size <= strs * DICT_MAX_DISTINCT_SHARE) dict.push(c);
  }
  const isDict = new Array<boolean>(cols.length).fill(false);
  for (const c of dict) isDict[c] = true;

  const out: unknown[][] = [];
  const absent: [number, number][] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const cells = new Array<unknown>(cols.length);
    for (let c = 0; c < cols.length; c++) {
      const name = cols[c]!;
      const v = r[name];
      if (v === undefined || !Object.prototype.hasOwnProperty.call(r, name)) {
        absent.push([i, c]);
        cells[c] = null;
        continue;
      }
      if (!isDict[c] || v === null) {
        cells[c] = v;
        continue;
      }
      if (typeof v === "string") {
        let at = index.get(v);
        if (at === undefined) {
          at = strings.length;
          strings.push(v);
          index.set(v, at);
        }
        cells[c] = at;
      } else {
        cells[c] = [v];
      }
    }
    out.push(cells);
  }
  return { cols, dict, rows: out, absent };
}

/** The exact inverse of `encodeRows`. */
export function decodeRows(t: EncodedTable, strings: string[]): Row[] {
  const n = t.cols.length;
  const isDict = new Array<boolean>(n).fill(false);
  for (const c of t.dict) isDict[c] = true;
  // Absent cells, looked up per row; almost always empty.
  const absentByRow = new Map<number, Set<number>>();
  for (const [i, c] of t.absent) {
    let s = absentByRow.get(i);
    if (!s) absentByRow.set(i, (s = new Set()));
    s.add(c);
  }
  const out: Row[] = new Array(t.rows.length);
  for (let i = 0; i < t.rows.length; i++) {
    const cells = t.rows[i]!;
    const skip = absentByRow.get(i);
    const r: Row = {};
    for (let c = 0; c < n; c++) {
      if (skip && skip.has(c)) continue;
      const v = cells[c];
      if (isDict[c] && v !== null) {
        r[t.cols[c]!] = typeof v === "number" ? strings[v] : (v as unknown[])[0];
      } else {
        r[t.cols[c]!] = v;
      }
    }
    out[i] = r;
  }
  return out;
}
