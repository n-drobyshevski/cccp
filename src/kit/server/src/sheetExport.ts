// Extracted from the author's production Apps Script apps; adapted.
// "Open in a new Google Sheet": the one kit module that calls the Sheets and Drive advanced
// services. It creates a NEW spreadsheet, refuses when the new id is one the app must never write
// (its source sheet), writes the values RAW (a leading "=" stays text), bolds and freezes the
// header row, and shares the file with the viewer (as a writer by default, or a reader) without a
// notification email. Before any value is written the file is set so that its writers cannot share
// it onward (writersCanShare false, always), optionally so that readers cannot copy, print or
// download it (noCopy), and stamped with a description (who exported it, when, which data class).
// If any step after the create fails, the new file is moved to the trash and the caller gets one
// fixed ApiError; the service's own text goes to the console only.
//
// The caller builds the matrix on the server from its own data: never write values a client sent,
// or anyone could put text of their choosing into a file shared under the deployer's name. The
// helpers cleanIds and cleanTitle validate what a client may send (row ids and a title), and
// throttleExports caps how many files one viewer (and, with appLimit, the whole app) may create. The source sheet is never opened
// here. Every Sheets and Drive call is written out in full (Sheets!.Spreadsheets!.create, ...) so
// the noMutators and manifestScopes contracts can see it by name.

import { assertNamespace } from "./cache";
import { ApiError } from "./envelope";
import { withScriptLock } from "./lock";

export const EXPORT_LIMIT = 5;
export const EXPORT_WINDOW_SEC = 600;
export const EXPORT_MAX_ROWS = 20_000;
export const EXPORT_ID_MAX = 200;
export const EXPORT_TITLE_MAX = 80;
export const EXPORT_TAB_MAX = 100;
export const EXPORT_DEFAULT_TAB = "Export";
export const EXPORT_THROTTLE_NS = "export1";
export const NOTHING_TO_EXPORT_MESSAGE = "Nothing to export.";
export const ADVANCED_SERVICES_MESSAGE =
  "The Sheets and Drive advanced services are not enabled. Add Sheets (API v4) and Drive (API v3) " +
  "to dependencies.enabledAdvancedServices in appsscript.json.";
export const EXPORT_NOT_CREATED_MESSAGE = "The export file was not created.";
export const EXPORT_APP_BUSY_MESSAGE_START = "The app has created its limit of Google Sheets for now.";
export const EXPORT_DESCRIPTION_MAX = 500;
/** The cache TTL ceiling: a throttle window cannot be longer than CacheService keeps a value. */
const WINDOW_MAX_SEC = 21_600;

export interface SheetExportOptions {
  /** The file title. Cleaned with cleanTitle; the final name is "[prefix · ]title · yyyy-MM-dd HH:mm". */
  title: string;
  /** The tab name, cleaned like a sheet name. Default "Export". */
  tab?: string;
  /** The header row, then the data rows. null and undefined cells are written as "". */
  matrix: unknown[][];
  /** The viewer the file is shared with. Empty (anonymous) means no share. */
  viewerEmail: string;
  /** The deployer, who owns the new file already; Drive refuses a share with the owner. */
  ownerEmail: string;
  /** Ids the new file must never have, such as the app's source sheet. */
  forbidIds?: string[];
  /** Time zone of the stamp in the title. Default Etc/GMT. */
  tz?: string;
  /** Product name put before the title, such as "Acme export". */
  prefix?: string;
  /** The role the viewer is given. Default "writer". */
  shareRole?: "writer" | "reader";
  /** Set copyRequiresWriterPermission: readers cannot copy, print or download. Default false. */
  noCopy?: boolean;
  /** The Drive file description, such as "Exported by a@example.org, 2026-03-14 09:05 UTC, confidential". Cut to 500 characters. */
  description?: string;
}

export interface SheetExportResult {
  id: string;
  url: string;
  /** Data rows written (the header is not counted). */
  rows: number;
  /** True when the file was shared with the viewer. */
  shared: boolean;
}

const lower = (s: unknown): string => String(s == null ? "" : s).trim().toLowerCase();
const flatten = (v: unknown): string => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

/** Control characters become a space, whitespace collapses, the ends are trimmed and the result is cut to max. */
export function cleanTitle(raw: unknown, fallback = "Export", max = EXPORT_TITLE_MAX): string {
  return flatten(raw).slice(0, max).trim() || fallback;
}

/** A tab name as Sheets accepts it: no [ ] : * ? / \ and at most 100 characters. Default "Export". */
export function cleanTabName(raw: unknown): string {
  return flatten(String(raw == null ? "" : raw).replace(/[[\]:*?/\\]/g, " ")).slice(0, EXPORT_TAB_MAX).trim() || EXPORT_DEFAULT_TAB;
}

/**
 * Row ids a client sent: non-empty strings of at most 200 characters, in the order given, without
 * repeats. Anything else is dropped. Throws ApiError("error") when none is left or above max.
 */
export function cleanIds(raw: unknown, max = EXPORT_MAX_ROWS): string[] {
  if (!Array.isArray(raw)) throw new ApiError("error", NOTHING_TO_EXPORT_MESSAGE);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string" || v === "" || v.length > EXPORT_ID_MAX || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  if (out.length === 0) throw new ApiError("error", NOTHING_TO_EXPORT_MESSAGE);
  if (out.length > max) throw new ApiError("error", "Too many rows to export at once (the limit is " + max + ").");
  return out;
}

function sha1Hex(s: string): string {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, s, Utilities.Charset.UTF_8);
  let out = "";
  for (const b of bytes) out += ((b & 0xff) < 16 ? "0" : "") + (b & 0xff).toString(16);
  return out;
}

/** The script-cache key of one viewer's throttle: the namespace and a SHA-1 of the address, never the address. */
export function throttleKey(email: string, ns = EXPORT_THROTTLE_NS): string {
  assertNamespace(ns);
  return ns + ":" + sha1Hex(lower(email));
}

const plural = (n: number, one: string, many: string): string => n + " " + (n === 1 ? one : many);

function windowText(sec: number): string {
  if (sec % 60 !== 0) return sec === 1 ? "second" : plural(sec, "second", "seconds");
  const min = sec / 60;
  return min === 1 ? "minute" : plural(min, "minute", "minutes");
}

export interface ThrottleOptions {
  /** Exports allowed per window. Default 5. */
  limit?: number;
  /** The window in seconds, 1 to 21600. Default 600. */
  windowSec?: number;
  /** Versioned cache namespace of the key. Default "export1". */
  ns?: string;
  /** Exports allowed per window across every viewer. Default none (no app-wide cap). */
  appLimit?: number;
}

/** The script-cache key of the app-wide throttle. */
export function appThrottleKey(ns = EXPORT_THROTTLE_NS): string {
  assertNamespace(ns);
  return ns + ":app";
}

/**
 * Count one export for this viewer, or refuse it. The timestamps live in the script cache under
 * the script lock, keyed by a hash of the address. Throws ApiError("busy") with a wait in minutes
 * when the viewer has used the window up. The lock is not re-entrant: do not call this from
 * inside withScriptLock.
 */
export function throttleExports(email: string, o: ThrottleOptions = {}): void {
  const limit = o.limit ?? EXPORT_LIMIT;
  const windowSec = o.windowSec ?? EXPORT_WINDOW_SEC;
  const appLimit = o.appLimit;
  if (!Number.isInteger(limit) || limit < 1) throw new Error("throttleExports: limit must be a whole number of 1 or more.");
  if (appLimit !== undefined && (!Number.isInteger(appLimit) || appLimit < 1)) {
    throw new Error("throttleExports: appLimit must be a whole number of 1 or more.");
  }
  if (!Number.isInteger(windowSec) || windowSec < 1 || windowSec > WINDOW_MAX_SEC) {
    throw new Error("throttleExports: windowSec must be a whole number from 1 to " + WINDOW_MAX_SEC + ".");
  }
  const key = throttleKey(email, o.ns);
  const appKey = appThrottleKey(o.ns);
  const windowMs = windowSec * 1000;
  withScriptLock(() => {
    const cache = CacheService.getScriptCache();
    const now = Date.now();
    const read = (k: string): number[] => {
      try {
        const parsed: unknown = JSON.parse(cache.get(k) || "[]");
        if (!Array.isArray(parsed)) return [];
        return parsed
          .filter((t): t is number => typeof t === "number" && Number.isFinite(t) && t <= now && now - t < windowMs)
          .sort((a, b) => a - b);
      } catch {
        return [];
      }
    };
    // The minutes until the slot `max` places from the newest frees.
    const waitFor = (stamps: number[], max: number): number =>
      Math.max(1, Math.ceil((stamps[stamps.length - max]! + windowMs - now) / 60_000));
    const stamps = read(key);
    if (stamps.length >= limit) {
      throw new ApiError(
        "busy",
        "You can create " + plural(limit, "Google Sheet", "Google Sheets") + " every " + windowText(windowSec) +
          ". Try again in about " + plural(waitFor(stamps, limit), "minute", "minutes") + ".",
      );
    }
    const all = appLimit === undefined ? null : read(appKey);
    if (all && appLimit !== undefined && all.length >= appLimit) {
      throw new ApiError("busy", EXPORT_APP_BUSY_MESSAGE_START + " Try again in about " + plural(waitFor(all, appLimit), "minute", "minutes") + ".");
    }
    stamps.push(now);
    cache.put(key, JSON.stringify(stamps.slice(-limit)), windowSec);
    if (all && appLimit !== undefined) {
      all.push(now);
      cache.put(appKey, JSON.stringify(all.slice(-appLimit)), windowSec);
    }
  });
}

function requireAdvancedServices(): void {
  if (typeof Sheets === "undefined" || !Sheets || !Sheets.Spreadsheets || typeof Drive === "undefined" || !Drive || !Drive.Permissions || !Drive.Files) {
    throw new Error(ADVANCED_SERVICES_MESSAGE);
  }
}

const cell = (v: unknown): unknown =>
  v == null ? "" : typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : String(v);

/** The message of a thrown value, for the console only. */
const detailOf = (e: unknown): string => flatten(e instanceof Error ? e.message : String(e)).slice(0, 500);

/**
 * Create a new spreadsheet holding matrix (header row first) and share it with the viewer.
 * Refuses (ApiError "error", EXPORT_NOT_CREATED_MESSAGE) when the new id is empty or one of
 * forbidIds; the file is then left unwritten. When a later step throws, the new file is trashed
 * and the same ApiError is thrown, with the detail on the console only.
 */
export function createSheetExport(o: SheetExportOptions): SheetExportResult {
  if (!Array.isArray(o.matrix) || o.matrix.length === 0) throw new ApiError("error", NOTHING_TO_EXPORT_MESSAGE);
  if (!o.matrix.every((r) => Array.isArray(r))) throw new Error("createSheetExport: every row of the matrix must be an array.");
  const shareRole = o.shareRole ?? "writer";
  if (shareRole !== "writer" && shareRole !== "reader") throw new Error("createSheetExport: shareRole must be \"writer\" or \"reader\".");
  requireAdvancedServices();

  const tab = cleanTabName(o.tab);
  const prefix = flatten(o.prefix);
  const stamp = Utilities.formatDate(new Date(), o.tz || "Etc/GMT", "yyyy-MM-dd HH:mm");
  const title = (prefix ? prefix + " · " : "") + cleanTitle(o.title) + " · " + stamp;
  const values = o.matrix.map((r) => r.map(cell));
  const description = flatten(o.description).slice(0, EXPORT_DESCRIPTION_MAX);

  const created = Sheets!.Spreadsheets!.create({
    properties: { title },
    sheets: [{ properties: { title: tab, gridProperties: { frozenRowCount: 1 } } }],
  });
  const id = String((created && created.spreadsheetId) || "").trim();
  const forbid = (o.forbidIds ?? []).map((x) => String(x == null ? "" : x).trim()).filter(Boolean);
  // Never trashed: an empty id names nothing, and a forbidden id is a file the app must not touch.
  if (id === "" || forbid.includes(id)) throw new ApiError("error", EXPORT_NOT_CREATED_MESSAGE);
  const first = created.sheets && created.sheets[0] && created.sheets[0].properties;
  const gid = first && typeof first.sheetId === "number" ? first.sheetId : 0;

  const viewer = String(o.viewerEmail == null ? "" : o.viewerEmail).trim();
  // The deployer owns the file already, and Drive refuses a share with the owner.
  const shared = viewer !== "" && lower(viewer) !== lower(o.ownerEmail);
  let step = "flags";
  try {
    // The flags go on before any value is written: the file never holds data while re-shareable.
    const flags: { writersCanShare: boolean; copyRequiresWriterPermission?: boolean; description?: string } = { writersCanShare: false };
    if (o.noCopy) flags.copyRequiresWriterPermission = true;
    if (description) flags.description = description;
    Drive!.Files!.update(flags, id);
    step = "values";
    // RAW keeps a leading "=" or "+" as text: nothing in an export is ever evaluated as a formula.
    Sheets!.Spreadsheets!.Values!.update({ values }, id, "'" + tab.replace(/'/g, "''") + "'!A1", { valueInputOption: "RAW" });
    step = "format";
    Sheets!.Spreadsheets!.batchUpdate({
      requests: [{
        repeatCell: {
          range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1 },
          cell: { userEnteredFormat: { textFormat: { bold: true } } },
          fields: "userEnteredFormat.textFormat.bold",
        },
      }],
    }, id);
    step = "share";
    if (shared) {
      Drive!.Permissions!.create({ type: "user", role: shareRole, emailAddress: viewer }, id, { sendNotificationEmail: false });
    }
  } catch (e) {
    let trashed = false;
    try {
      Drive!.Files!.update({ trashed: true }, id);
      trashed = true;
    } catch (t) {
      console.error(JSON.stringify({ export: "sheet", trash: "failed", id, error: detailOf(t) }));
    }
    console.error(JSON.stringify({ export: "sheet", failed: step, id, trashed, error: detailOf(e) }));
    throw new ApiError("error", EXPORT_NOT_CREATED_MESSAGE);
  }
  const rows = values.length - 1;
  console.log(JSON.stringify({ export: "sheet", actor: viewer, rows, id, shared, role: shared ? shareRole : null }));
  return { id, url: String(created.spreadsheetUrl || ""), rows, shared };
}
