// Extracted from the author's production Apps Script apps; adapted.
// Script Properties access: the JSON helpers every store writes through.
//
// Only the SCRIPT store is used. UserProperties under USER_DEPLOYING is the deployer's store,
// shared by every viewer, so it is never touched.

import { ApiError } from "./envelope";
import { utf8ByteLength } from "./errorLog";
import { executionGeneration } from "./execution";

export { utf8ByteLength };

/** One property value may not exceed this many UTF-8 bytes. */
export const PROP_MAX_BYTES = 8000;

// Per-execution snapshot. Every PropertiesService call costs tens of milliseconds, so the first
// read takes the whole store with ONE getProperties() and later reads answer from memory. Writes
// go through to the store and update the snapshot. The snapshot is tied to the PropertiesService
// global it came from and to the execution (beginExecution, which run() calls): a new global (a
// fresh set of test fakes) or a new execution is a new snapshot, so nothing leaks between tests
// or RPCs. withScriptLock calls resetPropsMemo() once the lock is held, so a
// read-modify-write under the lock sees what other executions saved. A writer that bypasses
// these helpers must call resetPropsMemo() after it writes.

let memo: Record<string, string> | null = null;
let memoOwner: unknown = null;
let memoGen = -1;
// Bumped by every resetPropsMemo(), so a memo derived from property values (the access
// decision) can tell that the snapshot it was built from has been dropped.
let propsGen = 0;

function service(): unknown {
  return (globalThis as { PropertiesService?: unknown }).PropertiesService;
}

function snapshot(): Record<string, string> {
  const owner = service();
  const gen = executionGeneration();
  if (memo === null || memoOwner !== owner || memoGen !== gen) {
    const all = PropertiesService.getScriptProperties().getProperties();
    const copy: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const k of Object.keys(all)) copy[k] = String(all[k]);
    memo = copy;
    memoOwner = owner;
    memoGen = gen;
  }
  return memo;
}

/** The current snapshot, or null when none was taken from the installed PropertiesService. */
function liveMemo(): Record<string, string> | null {
  return memo !== null && memoOwner === service() && memoGen === executionGeneration() ? memo : null;
}

/** Forget the snapshot: the next read takes a fresh one from the store. */
export function resetPropsMemo(): void {
  propsGen++;
  memo = null;
  memoOwner = null;
  memoGen = -1;
}

/**
 * A counter bumped by every resetPropsMemo() (withScriptLock calls it once the lock is held).
 * A memo built from property values keys itself on this, so it never outlives a re-read.
 */
export function propsGeneration(): number {
  return propsGen;
}

export function getProp(key: string): string | null {
  const snap = snapshot();
  const k = String(key);
  return Object.prototype.hasOwnProperty.call(snap, k) ? snap[k]! : null;
}

export function setProp(key: string, value: string): void {
  PropertiesService.getScriptProperties().setProperty(key, value);
  const snap = liveMemo();
  if (snap) snap[String(key)] = String(value);
}

export function deleteProp(key: string): void {
  PropertiesService.getScriptProperties().deleteProperty(key);
  const snap = liveMemo();
  if (snap) delete snap[String(key)];
}

/** The parsed JSON value of a property, or fallback when it is unset, empty or malformed. */
export function getJsonProp<T>(key: string, fallback: T): T {
  const raw = getProp(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Store a value as JSON. Refuses above PROP_MAX_BYTES (UTF-8 bytes, the unit the quota counts)
 * BEFORE anything is written, with a sentence the caller can act on.
 */
export function putJsonProp(key: string, value: unknown): void {
  const json = JSON.stringify(value);
  if (json === undefined) throw new ApiError("error", "Nothing to store for " + key + ".");
  const bytes = utf8ByteLength(json);
  if (bytes > PROP_MAX_BYTES) {
    throw new ApiError(
      "error",
      "That is too large to store (" + bytes + " of " + PROP_MAX_BYTES + " bytes in " + key + ").",
    );
  }
  setProp(key, json);
}
