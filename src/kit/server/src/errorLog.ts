// Extracted from the author's production Apps Script apps; adapted.
// A bounded ring buffer of recent server-side errors, persisted in one Script Property so a
// failure outlives the request that produced it and can be shown in the app instead of only in
// the Apps Script execution log.
//
// Property access is injected: this module never imports an app's props. Recording is
// best-effort and never throws (it must not mask the error it logs). One property holds the
// whole JSON array, so the entry count, the message length and the blob size are all capped.
//
// A thrown value is recorded once per execution: a failure that is rethrown through several
// layers would otherwise be listed once per layer. markRecorded lets a caller whose failure
// already has a durable record elsewhere say so without adding an entry.
//
// A ref (the short reference run() hands back with a generic error) is stored in the entry, so
// an admin can match what a user reports to the detail. An optional redact() is applied to the
// stored message (to strip ids or tokens the app knows about); a throwing redact stores a fixed
// placeholder, never the unredacted text.

const KEY = "RECENT_ERRORS";
export const MAX_ENTRIES = 25;
export const MAX_MESSAGE_LEN = 500;
// A property value is capped near 9 KB, measured in UTF-8 bytes (not string length: Cyrillic
// is two bytes a character). The blob is trimmed oldest-first to stay under this ceiling.
export const MAX_BLOB_BYTES = 8500;
const MAX_LABEL_LEN = 80;

/** The Script Properties accessors an app binds in. */
export interface ErrorLogProps {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
}

export interface ErrorEntry {
  /** Whole-second ISO-Z of when it was recorded. */
  ts: string;
  /** Operation label, e.g. "refresh" or "api". */
  op: string;
  /** "error", or "warning" for a condition that is not a fault. */
  kind: string;
  /** The message, redacted and truncated. */
  message: string;
  /** The reference the caller was given, when there was one. */
  ref?: string;
}

export interface ErrorLogOptions {
  /** Applied to every message before it is stored. */
  redact?: (text: string) => string;
}

export interface RecordErrorOptions {
  /** "error" (default), or "warning" for a condition that is not a fault. */
  kind?: string;
  /** The clock, in epoch ms. Default Date.now(). */
  now?: number;
}

export const REDACT_FAILED_MESSAGE = "[message withheld: redaction failed]";
const MAX_REF_LEN = 40;

export interface ErrorLog {
  /** The recorded errors, newest first. Tolerates a missing or malformed blob (returns []). */
  recentErrors(): ErrorEntry[];
  /**
   * Record one thrown value, with the reference the caller was given. Never throws; skips a value
   * already recorded in this execution. opts may also be the clock alone (epoch ms).
   */
  recordError(op: string, err: unknown, ref?: string | null, opts?: RecordErrorOptions | number): void;
  /** Say that err already has a durable record elsewhere, so it is not added here. */
  markRecorded(err: unknown): void;
  /** Drop the whole log. */
  clearErrors(): void;
}

/**
 * The UTF-8 encoded length of s, without encoding it. A surrogate pair is one four-byte code
 * point; a lone surrogate counts as the three-byte replacement character it is written as.
 */
export function utf8ByteLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

function truncate(s: string): string {
  return s.length > MAX_MESSAGE_LEN ? s.slice(0, MAX_MESSAGE_LEN) + "…" : s;
}

function isoSeconds(now?: number): string {
  const ms = now ?? Date.now();
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");
}

/** The error log over one app's Script Properties. */
export function createErrorLog(props: ErrorLogProps, options: ErrorLogOptions = {}): ErrorLog {
  // Per execution only: module state does not outlive an Apps Script execution. A primitive
  // cannot be held in a WeakSet, so it is never deduplicated.
  const alreadyRecorded = new WeakSet<object>();

  function recentErrors(): ErrorEntry[] {
    const raw = props.get(KEY);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (e): e is Record<string, unknown> =>
            Boolean(e) && typeof e === "object" && !Array.isArray(e),
        )
        .map((e) => {
          const entry: ErrorEntry = {
            ts: String(e["ts"] ?? ""),
            op: String(e["op"] ?? "api"),
            kind: String(e["kind"] ?? "error"),
            message: String(e["message"] ?? ""),
          };
          if (typeof e["ref"] === "string" && e["ref"] !== "") entry.ref = e["ref"];
          return entry;
        });
    } catch {
      return [];
    }
  }

  function markRecorded(err: unknown): void {
    try {
      if (err !== null && typeof err === "object") alreadyRecorded.add(err);
    } catch {
      // best-effort
    }
  }

  function redacted(message: string): string {
    if (!options.redact) return message;
    try {
      return String(options.redact(message));
    } catch {
      return REDACT_FAILED_MESSAGE;
    }
  }

  function recordError(op: string, err: unknown, ref?: string | null, opts?: RecordErrorOptions | number): void {
    try {
      const o: RecordErrorOptions = typeof opts === "number" ? { now: opts } : opts ?? {};
      const kind = o.kind ?? "error";
      const now = o.now;
      if (err !== null && typeof err === "object") {
        if (alreadyRecorded.has(err)) return;
        alreadyRecorded.add(err);
      }
      const message =
        err instanceof Error ? err.message : typeof err === "string" ? err : String(err);
      const entry: ErrorEntry = {
        ts: isoSeconds(now),
        op: String(op).slice(0, MAX_LABEL_LEN),
        kind: String(kind).slice(0, MAX_LABEL_LEN),
        message: truncate(redacted(message)),
      };
      const r = ref == null ? "" : String(ref).replace(/[^\w.:-]+/g, "").slice(0, MAX_REF_LEN);
      if (r) entry.ref = r;
      const next = [entry, ...recentErrors()].slice(0, MAX_ENTRIES);
      // Trim oldest-first until the blob fits (always keep the entry just added).
      let blob = JSON.stringify(next);
      while (next.length > 1 && utf8ByteLength(blob) > MAX_BLOB_BYTES) {
        next.pop();
        blob = JSON.stringify(next);
      }
      // The newest entry alone always fits: message <= 501 chars and op and kind <= 80 chars, at
      // most 6 bytes per char once JSON-escaped, is about 4 kB against MAX_BLOB_BYTES. The check
      // below is a backstop should those caps change.
      if (utf8ByteLength(blob) > MAX_BLOB_BYTES) return;
      props.set(KEY, blob);
    } catch {
      // Diagnostics are best-effort: logging an error must never raise one.
    }
  }

  function clearErrors(): void {
    props.delete(KEY);
  }

  return { recentErrors, recordError, markRecorded, clearErrors };
}
