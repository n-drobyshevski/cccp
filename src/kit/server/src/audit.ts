// The audit trail: one entry per security event (an access, mode or settings change, an export,
// a read of a confidential register), naming who did it and when.
//
//   const audit = createAudit({
//     actor: () => access.decide().email,
//     role: () => access.role(),
//     sinks: [consoleAuditSink(), createSheetAuditSink({ sheetId: () => getProp("AUDIT_SHEET_ID"), forbidIds: () => [sourceId()] })],
//   });
//   audit.record("access.users", { added: ["a@example.org"], removed: [] });
//   audit.record("export.sheet", { rows: 120 }, { required: true }); // throws when not recorded
//   audit.recordList("access.users", { added, removed }, {}, { required: true }); // every address, in parts
//
// WHAT AN ENTRY HOLDS. The event name, the time, the actor and role, and a small flat detail
// (counts, ids of rows, column keys, added and removed addresses, old and new mode). Row data and
// setting values are never part of an entry: pass counts and keys, not contents. The detail is
// sanitised whatever the caller passes: flat values only (string, finite number, boolean, array
// of strings), control characters removed, every string cut to 200 characters, at most 12 keys,
// and the reserved names (audit, at, event, actor, role, truncated, part, parts) dropped so a
// detail cannot forge them.
//
// NOTHING IS CUT SILENTLY. A key whose string was cut, whose array lost items, or that was dropped
// for the 12-key limit is named in the entry's detail.truncated. A list of names that must all be
// in the trail (the addresses an access change adds or removes) goes through recordList, which
// writes as many entries as needed (part, parts) so that every item appears whole in one of them:
// at most AUDIT_LIST_MAX items per list per entry, each entry's detail JSON within one sheet cell
// (AUDIT_CELL_MAX). An item that cannot fit a cell on its own is refused, never cut.
//
// FAILURE. record() never throws, so a broken sink cannot take an endpoint down. The exception is
// opts.required: when any sink failed (or there is no sink), it throws ApiError("error",
// AUDIT_REQUIRED_MESSAGE) so the caller can refuse an action it must not do unrecorded (an
// export of confidential rows). Call it BEFORE the action. recordList with required throws the
// same on the first failed write or a refused item, and returns only once every part is written.
//
// IDENTITY. identity "hash" writes a short SHA-256 of the lowercased address instead of the
// address. recordOnce keeps its "already written" marker in the script cache under a hash of the
// actor, the event and the key, never the address itself.
//
// The sheet sink only ever appends (Sheets!.Spreadsheets!.Values!.append, RAW): it never
// updates, clears or deletes a row, and it refuses the app's source sheet. The audit spreadsheet
// is owned by the deploying account and shared with nobody by code: who can read it is decided in
// Drive, by its owner.

import { assertNamespace } from "./cache";
import { ApiError } from "./envelope";
import { cleanTabName, cleanTitle } from "./sheetExport";

export const AUDIT_REQUIRED_MESSAGE = "The action was not done because it could not be recorded in the audit trail.";
export const AUDIT_TAB = "Audit";
export const AUDIT_HEADER = ["at", "event", "actor", "role", "detail"];
/** Versioned script-cache namespace of the recordOnce markers. */
export const AUDIT_ONCE_NS = "auditOnce1";
export const AUDIT_DETAIL_MAX_KEYS = 12;
export const AUDIT_STRING_MAX = 200;
/** Most items kept from an array value. */
export const AUDIT_ARRAY_MAX = 50;
/** Most items of one list in one recordList entry. */
export const AUDIT_LIST_MAX = 50;
/** Most characters in one sheet cell (the Sheets limit); an entry's detail JSON must fit one. */
export const AUDIT_CELL_MAX = 50_000;
/** The sheet sink's error for an entry whose detail JSON does not fit one cell. */
export const AUDIT_CELL_TOO_LARGE_MESSAGE = "The audit entry is too large for one sheet cell.";
const EVENT_MAX = 64;
const ONCE_MAX_SEC = 21_600;
const RESERVED = new Set(["audit", "at", "event", "actor", "role"]);
/** Names a caller's detail may not set: the line's own fields and the ones this module writes. */
const INPUT_RESERVED = new Set([...RESERVED, "truncated", "part", "parts"]);
/** The most key names one truncated marker lists. */
const TRUNCATED_MAX = 50;
const KEY_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,39}$/;

export type AuditValue = string | number | boolean | string[];

export interface AuditEntry {
  /** ISO-8601 time of the event. */
  at: string;
  event: string;
  /** The caller's address, its short hash (identity "hash"), or "anonymous". */
  actor: string;
  role?: string;
  detail?: Record<string, AuditValue>;
}

export interface AuditSink {
  /** Write one entry. Throw when it could not be written. */
  write(entry: AuditEntry): void;
}

export interface AuditOptions {
  /** The caller's address ("" for an anonymous caller). */
  actor: () => string;
  /** The caller's role, or null when denied. */
  role?: () => string | null;
  sinks: AuditSink[];
  /** "email" (default) writes the address, "hash" a short SHA-256 of the lowercased address. */
  identity?: "email" | "hash";
  /** The clock. Default new Date(). */
  now?: () => Date;
}

export interface RecordOptions {
  /** Throw ApiError("error", AUDIT_REQUIRED_MESSAGE) when any sink failed. Default false. */
  required?: boolean;
}

export interface RecordOnceOptions {
  /** The window in seconds (1 to 21600): at most one entry per actor and key per window. */
  everySec: number;
  /** Tells events of the same name apart (such as the dataset read). Default "". */
  key?: string;
}

export interface Audit {
  /** Write one entry to every sink. Never throws, except under opts.required (see above). */
  record(event: string, detail?: Record<string, unknown>, opts?: RecordOptions): void;
  /** Write the entry at most once per actor and key per window. Never throws. */
  recordOnce(event: string, detail: Record<string, unknown> | undefined, opts: RecordOnceOptions): void;
  /**
   * Write as many entries as needed so that every item of every list appears whole in one of
   * them: at most AUDIT_LIST_MAX items per list per entry, each detail within AUDIT_CELL_MAX
   * characters. Each entry's detail holds the (sanitised) detail, part (1-based), parts, the
   * list's slice under its name and the list's full length under name + "Count". With
   * opts.required it throws ApiError("error", AUDIT_REQUIRED_MESSAGE) on the first failed write
   * or when an item is refused (one too long for a cell, or not a string, number or boolean),
   * and it returns only after every part is written: call it before the change. Lists that are
   * not arrays, and list names that are not detail keys or collide, throw a TypeError.
   */
  recordList(event: string, lists: Record<string, string[]>, detail?: Record<string, unknown>, opts?: RecordOptions): void;
}

const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g;

function cleanString(v: unknown, max = AUDIT_STRING_MAX): string {
  return String(v == null ? "" : v).replace(CONTROL_RE, "").slice(0, max);
}

/** cleanString, and whether the cut removed characters (control characters do not count). */
function clip(v: unknown, max = AUDIT_STRING_MAX): { s: string; cut: boolean } {
  const all = String(v == null ? "" : v).replace(CONTROL_RE, "");
  return all.length > max ? { s: all.slice(0, max), cut: true } : { s: all, cut: false };
}

/** A list item kept whole: control, bidi and zero-width characters shown as \uXXXX, not removed. */
function visible(v: string): string {
  return v.replace(CONTROL_RE, (c) => "\\u" + ("000" + c.charCodeAt(0).toString(16)).slice(-4));
}

function hex(bytes: number[]): string {
  let out = "";
  for (const b of bytes) out += ((b & 0xff) < 16 ? "0" : "") + (b & 0xff).toString(16);
  return out;
}

function sha256Hex(s: string): string {
  return hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8));
}

/** A short SHA-256 (16 hex characters) of the trimmed, lowercased address. */
export function hashIdentity(email: string): string {
  return sha256Hex(String(email == null ? "" : email).trim().toLowerCase()).slice(0, 16);
}

/**
 * The detail as an entry may hold it: flat values only, control characters removed, strings cut
 * to 200 characters, arrays to 50 strings, at most 12 keys, reserved names dropped. Nothing is
 * cut silently: the keys that lost characters or items, or were dropped for the key limit, are
 * listed (at most 50) in `truncated`. Pure.
 */
export function sanitizeDetail(detail: unknown): Record<string, AuditValue> | undefined {
  if (detail === null || typeof detail !== "object" || Array.isArray(detail)) return undefined;
  const out: Record<string, AuditValue> = {};
  const truncated: string[] = [];
  let n = 0;
  for (const k of Object.keys(detail)) {
    if (!KEY_RE.test(k) || INPUT_RESERVED.has(k)) continue;
    const v = (detail as Record<string, unknown>)[k];
    let clean: AuditValue | undefined;
    let cut = false;
    if (typeof v === "string") {
      const c = clip(v);
      clean = c.s;
      cut = c.cut;
    } else if (typeof v === "number") clean = Number.isFinite(v) ? v : undefined;
    else if (typeof v === "boolean") clean = v;
    else if (Array.isArray(v)) {
      const flat = v.filter((x) => typeof x === "string" || typeof x === "number" || typeof x === "boolean");
      cut = flat.length !== v.length || flat.length > AUDIT_ARRAY_MAX;
      clean = flat.slice(0, AUDIT_ARRAY_MAX).map((x) => {
        const c = clip(x);
        if (c.cut) cut = true;
        return c.s;
      });
    }
    if (clean === undefined) continue;
    if (n >= AUDIT_DETAIL_MAX_KEYS) {
      if (truncated.length < TRUNCATED_MAX) truncated.push(k);
      continue;
    }
    out[k] = clean;
    n++;
    if (cut && truncated.length < TRUNCATED_MAX) truncated.push(k);
  }
  if (truncated.length) out.truncated = truncated;
  return n || truncated.length ? out : undefined;
}

/** A recordList item that cannot be written whole. */
class ListRefused extends Error {}

/**
 * The details recordList writes, part by part. Pure apart from the sanitising. Throws TypeError
 * for a malformed call and ListRefused for an item that cannot be written whole.
 */
function listDetails(lists: unknown, detail: unknown): Record<string, AuditValue>[] {
  if (lists === null || typeof lists !== "object" || Array.isArray(lists)) {
    throw new TypeError("recordList: lists must be an object of arrays, such as { added: [...], removed: [...] }.");
  }
  const names = Object.keys(lists);
  const taken = new Set<string>();
  const items: string[][] = [];
  for (const name of names) {
    const list = (lists as Record<string, unknown>)[name];
    if (!KEY_RE.test(name) || INPUT_RESERVED.has(name) || taken.has(name) || taken.has(name + "Count")) {
      throw new TypeError("recordList: a list name must be a detail key that no other list name or count uses.");
    }
    taken.add(name);
    taken.add(name + "Count");
    if (!Array.isArray(list)) throw new TypeError("recordList: every list must be an array.");
    items.push(
      list.map((x: unknown) => {
        if (typeof x !== "string" && typeof x !== "number" && typeof x !== "boolean") throw new ListRefused("an item is not a string");
        return visible(String(x));
      }),
    );
  }
  const base: Record<string, AuditValue> = {};
  const clean = sanitizeDetail(detail) ?? {};
  for (const k of Object.keys(clean)) if (!taken.has(k)) base[k] = clean[k]!;
  const frame: Record<string, AuditValue> = { ...base, part: 99999, parts: 99999 };
  names.forEach((name, i) => {
    frame[name] = [];
    frame[name + "Count"] = items[i]!.length;
  });
  const frameLen = JSON.stringify(frame).length;
  if (frameLen > AUDIT_CELL_MAX) throw new ListRefused("the detail does not fit one cell");

  const cursor = names.map(() => 0);
  const parts: string[][][] = [];
  // Each pass takes at least one item or throws, so the loop ends.
  for (;;) {
    let size = frameLen;
    let took = 0;
    const slice = names.map((_, i) => {
      const out: string[] = [];
      const all = items[i]!;
      while (cursor[i]! < all.length && out.length < AUDIT_LIST_MAX) {
        const add = JSON.stringify(all[cursor[i]!]).length + (out.length ? 1 : 0);
        if (size + add > AUDIT_CELL_MAX) break;
        out.push(all[cursor[i]!]!);
        size += add;
        cursor[i]!++;
        took++;
      }
      return out;
    });
    const left = cursor.some((c, i) => c < items[i]!.length);
    // Nothing fitted an empty entry: the next item alone is longer than a cell.
    if (took === 0 && left) throw new ListRefused("an item is too long for one cell");
    parts.push(slice);
    if (!left) break;
  }
  return parts.map((slice, p) => {
    const d: Record<string, AuditValue> = { ...base, part: p + 1, parts: parts.length };
    names.forEach((name, i) => {
      d[name] = slice[i]!;
      d[name + "Count"] = items[i]!.length;
    });
    return d;
  });
}

function cleanEvent(event: unknown): string {
  return cleanString(event, EVENT_MAX).trim() || "unnamed";
}

export function createAudit(o: AuditOptions): Audit {
  const sinks = Array.isArray(o.sinks) ? o.sinks.slice() : [];
  const now = o.now ?? (() => new Date());
  const hashed = o.identity === "hash";

  function rawActor(): string {
    try {
      return String(o.actor() ?? "").trim();
    } catch {
      return "";
    }
  }

  function entryFor(event: string, detail: unknown, actorRaw: string, clean?: Record<string, AuditValue>): AuditEntry {
    let at: string;
    try {
      at = now().toISOString();
    } catch {
      at = new Date().toISOString();
    }
    const actor = actorRaw === "" ? "anonymous" : hashed ? hashIdentity(actorRaw) : cleanString(actorRaw);
    const entry: AuditEntry = { at, event: cleanEvent(event), actor };
    if (o.role) {
      try {
        const r = o.role();
        entry.role = r == null ? "none" : cleanString(r, 20);
      } catch {
        entry.role = "unknown";
      }
    }
    const d = clean ?? sanitizeDetail(detail);
    if (d) entry.detail = d;
    return entry;
  }

  function write(entry: AuditEntry): boolean {
    let ok = sinks.length > 0;
    for (const s of sinks) {
      try {
        s.write(entry);
      } catch (e) {
        ok = false;
        try {
          console.error(JSON.stringify({ audit: "sink-failed", event: entry.event, error: cleanString(e instanceof Error ? e.message : e) }));
        } catch {
          // best-effort
        }
      }
    }
    return ok;
  }

  function record(event: string, detail?: Record<string, unknown>, opts: RecordOptions = {}): void {
    let ok = false;
    try {
      ok = write(entryFor(event, detail, rawActor()));
    } catch {
      ok = false;
    }
    if (!ok && opts && opts.required) throw new ApiError("error", AUDIT_REQUIRED_MESSAGE);
  }

  function recordOnce(event: string, detail: Record<string, unknown> | undefined, opts: RecordOnceOptions): void {
    try {
      const actorRaw = rawActor();
      const sec = Math.min(ONCE_MAX_SEC, Math.max(1, Math.round(Number(opts && opts.everySec) || 0)));
      assertNamespace(AUDIT_ONCE_NS);
      const marker = AUDIT_ONCE_NS + ":" + sha256Hex(actorRaw.toLowerCase() + "\n" + cleanEvent(event) + "\n" + String((opts && opts.key) ?? ""));
      let cache: GoogleAppsScript.Cache.Cache | null = null;
      try {
        cache = CacheService.getScriptCache();
        if (cache.get(marker)) return;
      } catch {
        cache = null; // a cache failure records once more rather than not at all
      }
      if (write(entryFor(event, detail, actorRaw)) && cache) {
        try {
          cache.put(marker, "1", sec);
        } catch {
          // best-effort
        }
      }
    } catch {
      // never throws
    }
  }

  function recordList(event: string, lists: Record<string, string[]>, detail?: Record<string, unknown>, opts: RecordOptions = {}): void {
    const required = !!(opts && opts.required);
    let details: Record<string, AuditValue>[];
    try {
      details = listDetails(lists, detail);
    } catch (e) {
      if (!(e instanceof ListRefused)) throw e;
      try {
        console.error(JSON.stringify({ audit: "list-refused", event: cleanEvent(event), error: cleanString(e.message) }));
      } catch {
        // best-effort
      }
      if (required) throw new ApiError("error", AUDIT_REQUIRED_MESSAGE);
      return;
    }
    const actorRaw = rawActor();
    for (const d of details) {
      let ok = false;
      try {
        ok = write(entryFor(event, undefined, actorRaw, d));
      } catch {
        ok = false;
      }
      if (!ok && required) throw new ApiError("error", AUDIT_REQUIRED_MESSAGE);
    }
  }

  return { record, recordOnce, recordList };
}

/** One JSON console line per entry: { audit: event, at, actor, role, ...detail }. */
export function consoleAuditSink(): AuditSink {
  return {
    write(e: AuditEntry): void {
      const line: Record<string, unknown> = { audit: e.event, at: e.at, actor: e.actor };
      if (e.role !== undefined) line.role = e.role;
      if (e.detail) for (const k of Object.keys(e.detail)) if (!RESERVED.has(k)) line[k] = e.detail[k];
      console.log(JSON.stringify(line));
    },
  };
}

export interface SheetAuditSinkOptions {
  /** The audit spreadsheet id (a Script Property set by setup), or null when not created. */
  sheetId: () => string | null;
  /** Ids the sink must never write, such as the app's source sheet. */
  forbidIds?: () => string[];
  /** The tab rows are appended to. Default "Audit". */
  tab?: string;
}

export const AUDIT_SHEET_UNSET_MESSAGE = "The audit sheet is not configured.";
export const AUDIT_SHEET_REFUSED_MESSAGE = "The audit sheet id is one the app must never write.";
export const AUDIT_SERVICE_MESSAGE =
  "The Sheets advanced service is not enabled. Add Sheets (API v4) to dependencies.enabledAdvancedServices in appsscript.json.";

function requireSheets(): void {
  if (typeof Sheets === "undefined" || !Sheets || !Sheets.Spreadsheets || !Sheets.Spreadsheets.Values) {
    throw new Error(AUDIT_SERVICE_MESSAGE);
  }
}

function forbidden(get: (() => string[]) | undefined): string[] {
  if (!get) return [];
  const list = get();
  return (Array.isArray(list) ? list : []).map((x) => String(x == null ? "" : x).trim()).filter(Boolean);
}

const rangeOf = (tab: string): string => "'" + tab.replace(/'/g, "''") + "'!A1";

/**
 * Appends one row [at, event, actor, role, JSON of detail] per entry, written RAW (a leading "="
 * stays text). Throws, so record() can fail closed, when the id is blank or forbidden, the
 * detail JSON is over AUDIT_CELL_MAX characters, the service is missing or the append fails.
 * Never updates, clears or deletes rows.
 */
export function createSheetAuditSink(o: SheetAuditSinkOptions): AuditSink {
  const tab = cleanTabName(o.tab ?? AUDIT_TAB);
  return {
    write(e: AuditEntry): void {
      const id = String(o.sheetId() ?? "").trim();
      if (id === "") throw new Error(AUDIT_SHEET_UNSET_MESSAGE);
      if (forbidden(o.forbidIds).includes(id)) throw new Error(AUDIT_SHEET_REFUSED_MESSAGE);
      const detail = JSON.stringify(e.detail ?? {});
      if (detail.length > AUDIT_CELL_MAX) throw new Error(AUDIT_CELL_TOO_LARGE_MESSAGE);
      requireSheets();
      const row = [e.at, e.event, e.actor, e.role ?? "", detail];
      Sheets!.Spreadsheets!.Values!.append({ values: [row] }, id, rangeOf(tab), { valueInputOption: "RAW", insertDataOption: "INSERT_ROWS" });
    },
  };
}

export interface AuditSheetOptions {
  /** The file title, cleaned like an export title. */
  title: string;
  /** Ids the new file must never have, such as the source sheet. */
  forbidIds?: string[];
  /** The tab name. Default "Audit". */
  tab?: string;
}

/**
 * Create the audit spreadsheet with its header row through the Sheets advanced service (which
 * works under the drive.file scope) and return its id. It is owned by the deploying account and
 * shared with nobody. Call it from editor-run setup and store the id in a Script Property.
 */
export function createAuditSheet(o: AuditSheetOptions): string {
  requireSheets();
  const tab = cleanTabName(o.tab ?? AUDIT_TAB);
  const created = Sheets!.Spreadsheets!.create({
    properties: { title: cleanTitle(o.title, "Audit") },
    sheets: [{ properties: { title: tab, gridProperties: { frozenRowCount: 1 } } }],
  });
  const id = String((created && created.spreadsheetId) || "").trim();
  const forbid = (o.forbidIds ?? []).map((x) => String(x == null ? "" : x).trim()).filter(Boolean);
  if (id === "" || forbid.includes(id)) throw new Error("The audit sheet was not created.");
  Sheets!.Spreadsheets!.Values!.update({ values: [AUDIT_HEADER.slice()] }, id, rangeOf(tab), { valueInputOption: "RAW" });
  return id;
}
