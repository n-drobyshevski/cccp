// A small line diff (no external tool): longest common subsequence on the lines between the
// shared prefix and suffix, printed as unified hunks.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { KIT_DIR, hashFiles, vendorFiles, walkFiles } from "./hash.mjs";
import { resolveSource } from "./source.mjs";

const MAX_CELLS = 16_000_000;

/**
 * Edit script between two line arrays: [" ", line] same, ["-", line] only in a, ["+", line] only in b.
 * Returns null when the files are too different and too large to diff cheaply.
 * @param {string[]} a @param {string[]} b
 * @returns {[string, string][] | null}
 */
export function diffLines(a, b) {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const x = a.slice(pre, a.length - suf);
  const y = b.slice(pre, b.length - suf);
  if (x.length * y.length > MAX_CELLS) return null;
  const w = y.length + 1;
  const t = new Uint32Array((x.length + 1) * w);
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      t[i * w + j] = x[i] === y[j] ? /** @type {number} */ (t[(i + 1) * w + j + 1]) + 1 : Math.max(/** @type {number} */ (t[(i + 1) * w + j]), /** @type {number} */ (t[i * w + j + 1]));
    }
  }
  /** @type {[string, string][]} */
  const ops = a.slice(0, pre).map((l) => [" ", l]);
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      ops.push([" ", /** @type {string} */ (x[i])]);
      i++;
      j++;
    } else if (i < x.length && (j === y.length || /** @type {number} */ (t[(i + 1) * w + j]) >= /** @type {number} */ (t[i * w + j + 1]))) {
      ops.push(["-", /** @type {string} */ (x[i])]);
      i++;
    } else {
      ops.push(["+", /** @type {string} */ (y[j])]);
      j++;
    }
  }
  for (const l of a.slice(a.length - suf)) ops.push([" ", l]);
  return ops;
}

/**
 * Unified-style hunks for two texts; empty when they are equal.
 * @param {string} before @param {string} after @param {number} [context]
 * @returns {string[]}
 */
export function unifiedHunks(before, after, context = 3) {
  if (before === after) return [];
  const ops = diffLines(before.split("\n"), after.split("\n"));
  if (!ops) return ["@@ file too large to diff line by line @@"];
  const changed = ops.map((o, i) => (o[0] === " " ? -1 : i)).filter((i) => i >= 0);
  /** @type {string[]} */
  const out = [];
  let k = 0;
  while (k < changed.length) {
    const start = Math.max(0, /** @type {number} */ (changed[k]) - context);
    let end = Math.min(ops.length, /** @type {number} */ (changed[k]) + context + 1);
    while (k + 1 < changed.length && /** @type {number} */ (changed[k + 1]) - context <= end) {
      k++;
      end = Math.min(ops.length, /** @type {number} */ (changed[k]) + context + 1);
    }
    k++;
    let aLine = 1;
    let bLine = 1;
    for (let i = 0; i < start; i++) {
      if (/** @type {[string, string]} */ (ops[i])[0] !== "+") aLine++;
      if (/** @type {[string, string]} */ (ops[i])[0] !== "-") bLine++;
    }
    const slice = ops.slice(start, end);
    const aLen = slice.filter((o) => o[0] !== "+").length;
    const bLen = slice.filter((o) => o[0] !== "-").length;
    out.push("@@ -" + aLine + "," + aLen + " +" + bLine + "," + bLen + " @@");
    for (const [m, l] of slice) out.push(m + l);
  }
  return out;
}

/**
 * Diff the vendored files against a kit source. Returns the lines to print and the changed paths.
 * @param {string} root app root
 * @param {string} from kit checkout or git URL with #ref
 * @param {{ label?: string }} [opts] label names where a directory source came from in an error ("--from" by default)
 * @returns {{ lines: string[], changed: string[], commit: string | null }} commit is the commit a git URL resolved to
 *   (null for a directory)
 */
export function diffAgainst(root, from, opts = {}) {
  const src = resolveSource(from, { commit: false, label: opts.label });
  try {
    const kitRoot = resolve(root, KIT_DIR);
    const want = vendorFiles(src.dir);
    const have = new Set(walkFiles(kitRoot, { links: [] }));
    const wantHash = hashFiles(want);
    /** @type {string[]} */
    const lines = [];
    /** @type {string[]} */
    const changed = [];
    for (const rel of [...new Set([...Object.keys(want), ...have])].sort()) {
      const mine = join(kitRoot, rel);
      const theirs = want[rel];
      if (!theirs) {
        lines.push("Only in vendored: " + KIT_DIR + "/" + rel);
        changed.push(rel);
      } else if (!have.has(rel)) {
        lines.push("Only in source: " + rel);
        changed.push(rel);
      } else if (hashFiles({ [rel]: mine })[rel] !== wantHash[rel]) {
        changed.push(rel);
        lines.push("--- " + KIT_DIR + "/" + rel, "+++ source/" + rel);
        lines.push(...unifiedHunks(readFileSync(mine, "utf8"), readFileSync(theirs, "utf8")));
      }
    }
    return { lines, changed, commit: src.commit };
  } finally {
    src.cleanup();
  }
}

