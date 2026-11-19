// Extracted from the author's production Apps Script apps; adapted.
// Columnar row codec. An array of row objects becomes one column list plus an array of arrays, so
// the keys are sent once instead of once per row. A string column whose distinct values are at
// most half of its non-null values is dictionary-encoded: its cells become indexes into one
// strings table shared by every such column. The client's decodeRows (client/src/codec.js) gives
// back the exact objects.
//
// Exactness: a key absent from a row object stays absent (listed in `absent`), null stays null.
// A key whose value is undefined counts as absent, as it would after JSON. Column order is the
// first-seen key order over all rows; key order inside a decoded object follows it. Cell values
// that are not dictionary strings are passed through untouched (send JSON-safe values only).

export const CODEC_VERSION = 1;

export interface PackedRows {
  v: 1;
  /** Column names, in first-seen key order. */
  cols: string[];
  /** One array per row, cols.length wide. An absent cell holds null and is listed in absent. */
  rows: unknown[][];
  /** The shared dictionary for every dictionary-encoded column. */
  strings?: string[];
  /** Indexes into cols of the dictionary-encoded columns. */
  dict?: number[];
  /** [rowIndex, colIndex] of every key a row object did not have. */
  absent?: [number, number][];
}

const has = Object.prototype.hasOwnProperty;

/** Encode row objects column-wise. The input is not modified. */
export function encodeRows(rows: ReadonlyArray<Record<string, unknown>>): PackedRows {
  const cols: string[] = [];
  const colIndex = new Map<string, number>();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (r[k] === undefined || colIndex.has(k)) continue;
      colIndex.set(k, cols.length);
      cols.push(k);
    }
  }
  // Which columns qualify for the dictionary: every non-null value a string, and few distinct.
  const dictCols: number[] = [];
  for (let c = 0; c < cols.length; c++) {
    const name = cols[c]!;
    const seen = new Set<string>();
    let n = 0;
    let allStrings = true;
    for (const r of rows) {
      if (!has.call(r, name)) continue;
      const v = r[name];
      if (v === undefined || v === null) continue;
      if (typeof v !== "string") { allStrings = false; break; }
      n++;
      seen.add(v);
    }
    if (allStrings && n > 0 && seen.size * 2 <= n) dictCols.push(c);
  }
  const isDict = new Array<boolean>(cols.length).fill(false);
  for (const c of dictCols) isDict[c] = true;

  const strings: string[] = [];
  const stringIndex = new Map<string, number>();
  const absent: [number, number][] = [];
  const out: unknown[][] = new Array<unknown[]>(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const line = new Array<unknown>(cols.length);
    for (let c = 0; c < cols.length; c++) {
      const name = cols[c]!;
      const v = has.call(r, name) ? r[name] : undefined;
      if (v === undefined) {
        line[c] = null;
        absent.push([i, c]);
      } else if (isDict[c] && v !== null) {
        const s = v as string;
        let idx = stringIndex.get(s);
        if (idx === undefined) {
          idx = strings.length;
          strings.push(s);
          stringIndex.set(s, idx);
        }
        line[c] = idx;
      } else {
        line[c] = v;
      }
    }
    out[i] = line;
  }
  const packed: PackedRows = { v: 1, cols, rows: out };
  if (dictCols.length) {
    packed.strings = strings;
    packed.dict = dictCols;
  }
  if (absent.length) packed.absent = absent;
  return packed;
}

/** The inverse of encodeRows, for servers and tests (the browser uses client/src/codec.js). */
export function decodeRows(packed: PackedRows): Record<string, unknown>[] {
  if (!packed || packed.v !== CODEC_VERSION || !Array.isArray(packed.cols) || !Array.isArray(packed.rows)) {
    throw new Error("Not a packed row set (version " + String(packed && packed.v) + ").");
  }
  const cols = packed.cols;
  const strings = packed.strings ?? [];
  const isDict = new Array<boolean>(cols.length).fill(false);
  for (const c of packed.dict ?? []) isDict[c] = true;
  const gone = new Set<number>();
  for (const [r, c] of packed.absent ?? []) gone.add(r * cols.length + c);
  return packed.rows.map((line, i) => {
    const obj: Record<string, unknown> = {};
    for (let c = 0; c < cols.length; c++) {
      if (gone.has(i * cols.length + c)) continue;
      const raw = line[c];
      const v = isDict[c] && raw !== null ? strings[raw as number] : raw;
      // defineProperty, so a column named __proto__ is an own key, never the prototype.
      Object.defineProperty(obj, cols[c]!, { value: v, enumerable: true, writable: true, configurable: true });
    }
    return obj;
  });
}
