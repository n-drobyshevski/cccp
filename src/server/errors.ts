// The recent-errors log bound to CCCP's Script Properties, and the error vocabulary of the
// RPC envelope.
//
// The log itself is the vendored gas_shared implementation; this module only binds its
// property accessors, lazily through arrows so a test that fakes ./props needs no ordering.

import { createErrorLog, utf8ByteLength, type ErrorEntry } from "../vendor/gas_shared/server/errorLog";
import { deleteProp, getProp, setProp } from "./props";

const log = createErrorLog({
  get: (key) => getProp(key),
  set: (key, value) => setProp(key, value),
  delete: (key) => deleteProp(key),
});

export const recentErrors = log.recentErrors;
export const recordError = log.recordError;
export const markRecorded = log.markRecorded;
export const clearErrors = log.clearErrors;
export { utf8ByteLength, type ErrorEntry };

/** What run() puts in `errorKind`. `forbidden` is also minted by access.denyResult. */
export type ErrorKind = "error" | "busy" | "conflict" | "forbidden";

/**
 * An expected refusal with its own kind: `busy` when the script lock is held, `conflict` when
 * a stale baseGen is saved. These are not faults, so run() does not put them in the error log.
 */
export class ApiError extends Error {
  readonly kind: ErrorKind;
  constructor(kind: ErrorKind, message: string) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
  }
}
