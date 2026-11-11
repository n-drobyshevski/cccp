// The script lock around every read-modify-write of Script Properties. A held lock is not a
// fault: it becomes the `busy` kind, which the client shows as "try again".

import { ApiError } from "./errors";

const WAIT_MS = 10_000;

export function withScriptLock<T>(fn: () => T, waitMs: number = WAIT_MS): T {
  const lock = LockService.getScriptLock();
  let got = false;
  try {
    got = lock.tryLock(waitMs);
  } catch (_e) {
    got = false;
  }
  if (!got) throw new ApiError("busy", "Another change is being saved. Try again in a moment.");
  try {
    return fn();
  } finally {
    try {
      lock.releaseLock();
    } catch (_e) {
      // releasing is best-effort
    }
  }
}
