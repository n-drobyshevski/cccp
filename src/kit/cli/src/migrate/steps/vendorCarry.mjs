// The vendor-carry step of the kit-shaped profile: the source's vendored tree (src/vendor/**) is
// carried byte for byte to src/vendor/** of the target, and its lock (tools/vendor.lock.json) is kept
// as .migrate/vendor.lock.json for the record. Before anything is carried, every file the lock pins is
// read from the source and hashed: one whose sha256 is not the pinned one refuses the whole step (a
// vendored file someone edited is not carried as if it were the pinned one), as does a lock that
// names a file the source does not have. src/vendor is outside every tsconfig include and the
// client lint, so verbatim third-party code is not retyped; it is still scanned by the server
// contracts (noMutators, noDangerousServerApis), so a file that would trip them stays pending with
// an agent step. A vendored file the lock does not pin is carried with a note.
import { sha256 } from "../../hash.mjs";
import { pendingPath } from "./_common.mjs";
import { agentStep, listOf, serverRuleBreaks, spawnId, stem } from "./copyDomain.mjs";

/** @typedef {import("../apply.mjs").StepContext} StepContext */
/** @typedef {import("../apply.mjs").StepResult} StepResult */

const LOCK = "tools/vendor.lock.json";
const VENDOR = "src/vendor/";
const RECORD = ".migrate/vendor.lock.json";
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * The pinned files of a lock text: { key: sha256 }. Throws on a lock the step cannot read.
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function pinnedFiles(text) {
  let lock;
  try {
    lock = JSON.parse(text);
  } catch (e) {
    throw new Error("vendor-carry: " + LOCK + " is not JSON: " + /** @type {Error} */ (e).message);
  }
  const files = lock && typeof lock === "object" ? lock.files : null;
  if (!files || typeof files !== "object" || Array.isArray(files)) throw new Error("vendor-carry: " + LOCK + " has no files object of path to sha256");
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of Object.entries(files)) {
    if (typeof v !== "string" || !HEX64.test(v.toLowerCase())) throw new Error("vendor-carry: " + LOCK + " pins " + JSON.stringify(k.slice(0, 80)) + " with something that is not a sha256");
    out[k] = v.toLowerCase();
  }
  return out;
}

/** @param {StepContext} ctx @returns {StepResult} */
export function run(ctx) {
  const vendored = ctx.inv.files.filter((f) => f.key.startsWith(VENDOR)).map((f) => f.key).sort();
  const hasLock = ctx.tree.files.has(LOCK);
  if (!vendored.length && !hasLock) return { notes: ["no vendored tree in the source"] };
  const pins = hasLock ? pinnedFiles(ctx.tree.read(LOCK)) : {};
  /** @type {Map<string, Buffer>} */
  const bytes = new Map();
  // Every pin is checked before anything is written: a mismatch refuses the whole step.
  for (const [key, want] of Object.entries(pins)) {
    if (!ctx.tree.files.has(key) && !ctx.tree.assets.has(key)) throw new Error("vendor-carry refused: " + LOCK + " pins " + key + ", which the source does not have (or the migration could not read)");
    const b = ctx.tree.readBytes(key);
    const got = sha256(b);
    if (got !== want) throw new Error("vendor-carry refused: " + key + " does not match the sha256 " + LOCK + " pins (" + want.slice(0, 12) + "..., the file is " + got.slice(0, 12) + "...): it was edited after it was vendored. Restore it, or re-vendor it and update the lock, then run migrate:inventory and migrate:plan");
    bytes.set(key, b);
  }
  /** @type {string[]} */
  const notes = [];
  /** @type {import("./copyDomain.mjs").SpawnStep[]} */
  const spawn = [];
  let carried = 0;
  for (const key of vendored) {
    const b = bytes.get(key) ?? ctx.tree.readBytes(key);
    const breaks = /\.(?:m?js|ts)$/.test(key) ? serverRuleBreaks(b.toString("utf8")) : [];
    if (breaks.length) {
      notes.push(key + " stays in .migrate/pending: the server contracts scan src/vendor and it " + listOf(breaks));
      spawn.push(agentStep({ id: spawnId(ctx, "vendor", stem(key)), title: "Carry the vendored " + key + " by hand", why: key + " would fail the server contracts in src/vendor: " + listOf(breaks), reads: [key], writes: [key] }));
      continue;
    }
    ctx.out.write(key, b);
    ctx.out.remove(pendingPath(key));
    carried++;
    if (!(key in pins)) notes.push(key + " is not pinned by " + (hasLock ? LOCK : "a lock") + ": carried as it is");
  }
  if (hasLock) {
    ctx.out.write(RECORD, ctx.tree.readBytes(LOCK));
    ctx.out.remove(pendingPath(LOCK));
  }
  notes.unshift(carried + " vendored file" + (carried === 1 ? "" : "s") + " carried to " + VENDOR + (hasLock ? ", " + Object.keys(pins).length + " pin" + (Object.keys(pins).length === 1 ? "" : "s") + " verified; the lock is kept as " + RECORD : ""));
  return { notes, ...(spawn.length ? { spawn } : {}) };
}
