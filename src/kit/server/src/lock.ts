// Extracted from the author's production Apps Script apps; adapted.
// The script lock around a read-modify-write. Busy is an expected refusal, not a fault.

import { ApiError } from "./envelope";
import { resetPropsMemo } from "./props";

export const LOCK_BUSY_MESSAGE = "Another save is in progress. Try again in a moment.";

/**
 * Run fn holding the script lock; throws ApiError("busy") when it is not acquired in waitMs.
 * Once the lock is held the Script Properties snapshot is dropped, so fn reads what other
 * executions saved before it, not a value this execution memoised earlier.
 */
export function withScriptLock<T>(fn: () => T, opts: { waitMs?: number } = {}): T {
  const waitMs = opts.waitMs ?? 10000;
  const lock = LockService.getScriptLock();
  let got = false;
  try {
    got = lock.tryLock(waitMs);
  } catch {
    got = false;
  }
  if (!got) throw new ApiError("busy", LOCK_BUSY_MESSAGE);
  try {
    resetPropsMemo();
    return fn();
  } finally {
    try {
      lock.releaseLock();
    } catch {
      // releasing is best-effort
    }
  }
}
