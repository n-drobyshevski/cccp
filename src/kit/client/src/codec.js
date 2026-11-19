// Extracted from the author's production Apps Script apps; adapted.
// The browser half of the columnar row codec: decodeRows turns the server's encodeRows output
// (server/src/codec.ts) back into the exact row objects. A cell listed in absent has no key at
// all, null stays null, and a dictionary column's index is looked up in the shared strings table.

/**
 * @typedef {object} PackedRows
 * @property {1} v
 * @property {string[]} cols
 * @property {unknown[][]} rows
 * @property {string[]} [strings]
 * @property {number[]} [dict]
 * @property {Array<[number, number]>} [absent]
 */

/** The packed format version this module reads. */
export const CODEC_VERSION = 1;

/**
 * Decode a packed row set. Throws on anything that is not version 1.
 * @param {PackedRows} packed
 * @returns {Array<Record<string, unknown>>}
 */
export function decodeRows(packed) {
  if (!packed || packed.v !== CODEC_VERSION || !Array.isArray(packed.cols) || !Array.isArray(packed.rows)) {
    throw new Error("Not a packed row set (version " + String(packed && packed.v) + ").");
  }
  const cols = packed.cols;
  const width = cols.length;
  const strings = packed.strings || [];
  /** @type {boolean[]} */
  const isDict = [];
  for (let c = 0; c < width; c++) isDict.push(false);
  for (const c of packed.dict || []) isDict[c] = true;
  /** @type {Set<number>} */
  const gone = new Set();
  for (const pair of packed.absent || []) gone.add(pair[0] * width + pair[1]);
  return packed.rows.map((line, i) => {
    /** @type {Record<string, unknown>} */
    const obj = {};
    for (let c = 0; c < width; c++) {
      if (gone.has(i * width + c)) continue;
      const raw = line[c];
      const v = isDict[c] && raw !== null ? strings[/** @type {number} */ (raw)] : raw;
      // defineProperty, so a column named __proto__ is an own key, never the prototype.
      Object.defineProperty(obj, cols[c], { value: v, enumerable: true, writable: true, configurable: true });
    }
    return obj;
  });
}
