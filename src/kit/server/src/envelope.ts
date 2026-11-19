// Extracted from the author's production Apps Script apps; adapted.
// The RPC envelope: every endpoint returns an ApiResult, and run() is the one wrapper that
// builds it. The role check runs before the body, an expected refusal (ApiError) keeps its
// kind and message and is not logged, and any other throw is recorded and becomes kind "error".
// The client never sees an unexpected throw's text: it gets UNEXPECTED_ERROR_MESSAGE and a short
// `ref`, and the text goes to recordError under the same ref. Service errors can carry ids (a
// spreadsheet id, a property or cache key), and every role can read an envelope.

/** What run() puts in errorKind. "forbidden" is minted by the role gate, "cold" by a cache miss. */
export type ErrorKind = "error" | "busy" | "conflict" | "forbidden" | "cold";

import { endExecution, ensureExecution } from "./execution";

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  errorKind?: ErrorKind;
  /** A short reference for an unexpected fault, the same one recordError received. */
  ref?: string;
  /** The fault's own (redacted) text, present only when RunDeps.detailFor() said yes. */
  detail?: string;
}

/** The sentence every unexpected (non-ApiError) fault answers with. */
export const UNEXPECTED_ERROR_MESSAGE =
  "Something went wrong. Try again, and if it keeps happening, quote the reference to whoever runs this app.";

/**
 * An expected refusal with its own kind: "busy" when the script lock is held, "conflict" when
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

export interface RunDeps {
  /** Returns a refusal envelope to hand back as-is, or null when the caller may proceed. */
  requireRole(name: string): ApiResult<never> | null;
  /**
   * Record an unexpected fault. `ref` is the reference the envelope carries, so a viewer's
   * report can be matched with the record. With `redact`, err is a new Error holding the
   * redacted text (same name), not the original throw.
   */
  recordError(op: string, err: unknown, ref: string): void;
  /**
   * True when this caller may see a fault's own text (an admin, say): the envelope then carries
   * it as `detail`, redacted. Default: nobody. A throw reads as false.
   */
  detailFor?: () => boolean;
  /**
   * A fresh reference. Default: 8 hex characters from Utilities.getUuid(), or from Math.random
   * when Utilities is absent. A throw or a value that is not 1 to 32 letters, digits or hyphens
   * falls back to the default.
   */
  newRef?: () => string;
  /**
   * Applied to every message run() hands out (ApiError messages, detail) and to the text that
   * reaches recordError. A throw replaces the text with the fixed sentence.
   */
  redact?: (text: string) => string;
}

export type Run = <T>(name: string, fn: () => T) => ApiResult<T>;

const REF_SHAPE = /^[A-Za-z0-9-]{1,32}$/;

/** Eight hex characters: the tail of a UUID (random in a v4 uuid), else Math.random. */
export function defaultErrorRef(): string {
  try {
    const u = (globalThis as { Utilities?: { getUuid?: () => string } }).Utilities;
    if (u && typeof u.getUuid === "function") {
      const hex = String(u.getUuid()).toLowerCase().replace(/[^0-9a-f]/g, "");
      if (hex.length >= 8) return hex.slice(-8);
    }
  } catch {
    // fall through to the local generator
  }
  let out = "";
  for (let i = 0; i < 8; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

function textOf(e: unknown): string {
  try {
    return e instanceof Error ? e.message : String(e);
  } catch {
    return "";
  }
}

export function createRun(deps: RunDeps): Run {
  function newRef(): string {
    if (deps.newRef) {
      try {
        const r = deps.newRef();
        if (typeof r === "string" && REF_SHAPE.test(r)) return r;
      } catch {
        // fall back to the default reference
      }
    }
    return defaultErrorRef();
  }
  /** The redacted text, or null when redact threw or returned something other than a string. */
  function redacted(text: string): string | null {
    if (!deps.redact) return text;
    try {
      const r = deps.redact(text);
      return typeof r === "string" ? r : null;
    } catch {
      return null;
    }
  }
  function showDetail(): boolean {
    if (!deps.detailFor) return false;
    try {
      return deps.detailFor() === true;
    } catch {
      return false;
    }
  }
  // A recorder that throws must not turn an envelope into a raw exception.
  function safeRecord(op: string, err: unknown, ref: string): void {
    try {
      let rec = err;
      if (deps.redact) {
        const t = redacted(textOf(err));
        const e = new Error(t === null ? "The error text could not be redacted." : t);
        if (err instanceof Error && typeof err.name === "string") e.name = err.name;
        rec = e;
      }
      deps.recordError(op, rec, ref);
    } catch {
      // best-effort
    }
  }
  function fault(name: string, e: unknown): ApiResult<never> {
    const ref = newRef();
    safeRecord(name, e, ref);
    const env: ApiResult<never> = { ok: false, error: UNEXPECTED_ERROR_MESSAGE, errorKind: "error", ref };
    if (showDetail()) {
      const d = redacted(textOf(e));
      if (d !== null) env.detail = d;
    }
    return env;
  }
  return function run<T>(name: string, fn: () => T): ApiResult<T> {
    // One RPC is one execution: no per-execution memo from an earlier call is trusted. The entry
    // point usually began it already; run() closes it on the way out (see the finally below).
    ensureExecution();
    try {
      return runBody(name, fn);
    } finally {
      endExecution();
    }
  };
  function runBody<T>(name: string, fn: () => T): ApiResult<T> {
    let refusal: ApiResult<never> | null;
    try {
      refusal = deps.requireRole(name);
    } catch (e) {
      // A throwing gate fails closed: the body never runs.
      const ref = newRef();
      safeRecord(name, e, ref);
      return { ok: false, error: "Not permitted", errorKind: "forbidden", ref };
    }
    if (refusal) return refusal;
    try {
      return { ok: true, data: fn() };
    } catch (e) {
      if (e instanceof ApiError) {
        // An expected refusal keeps its sentence, through redact when one is given.
        const m = redacted(e.message);
        return { ok: false, error: m === null ? UNEXPECTED_ERROR_MESSAGE : m, errorKind: e.kind };
      }
      return fault(name, e);
    }
  }
}
