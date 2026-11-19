// Extracted from the author's production Apps Script apps; adapted.
// In-memory fakes of the Apps Script services a kit app touches, for node tests.
// installGasFakes() puts them on globalThis and returns handles plus uninstall().
//
// THE SOURCE FAKE IS READ-ONLY. Every mutator on Spreadsheet, Sheet and Range throws
// "source is read-only". UserProperties, the user and document caches and locks are refused
// too: under USER_DEPLOYING they would be the deployer's store.
//
// OUTSIDE SHEETS. The real SpreadsheetApp opens any spreadsheet the deploying account can read,
// not only the app's source. addSheet(id, spec, { outside: true }) (or opts.outsideSheets) adds
// such a sheet: it opens like any other (and is read-only), and outsideOpened() lists the ones
// that were opened, so a test can prove the app refused it for its own reason.
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { parseCsv } from "./csv";

export const READ_ONLY_ERROR = "source is read-only";
/** The most characters Sheets takes in one cell; Values.update and Values.append refuse more. */
export const SHEETS_CELL_MAX = 50_000;
/** The error Values.update and Values.append throw for a longer cell (Google's wording). */
export const SHEETS_CELL_ERROR = "Your input contains more than the maximum of 50000 characters in a single cell.";
export const PROPERTY_VALUE_MAX = 9 * 1024;
export const PROPERTY_STORE_MAX = 500 * 1024;
export const CACHE_VALUE_MAX = 100 * 1024;
/** The script cache item cap, and how many items survive once it is exceeded. */
export const CACHE_ITEM_MAX = 1000;
export const CACHE_ITEM_KEEP = 900;
export const CACHE_KEY_MAX = 250;
export const CACHE_TTL_MAX = 21600;
export const CACHE_TTL_DEFAULT = 600;
export const QUOTA_ERROR = "You have exceeded the property storage quota. Please remove some properties and try again.";

/** A cell: a string or number or boolean or Date, or { $wall: "yyyy-MM-dd" } for a date in the sheet zone. */
export type Cell = string | number | boolean | Date | null | { $wall: string };
/** A tab is rows of cells, or CSV text (every cell then a string). */
export type TabData = Cell[][] | string;
export interface SheetSpec { name?: string; tz?: string; tabs: Record<string, TabData> }
export interface FakeOptions {
  /** The owner: the effective user, and the default active user. Default owner@example.org. */
  owner?: string;
  /** Script time zone, and the default for source sheets. Default UTC. */
  tz?: string;
  /** Base clock in epoch ms. Default: Date.now() captured once at install (frozen). A function is called on each read. The clock moves only via advance(), sleep() and a failed tryLock. */
  now?: number | (() => number);
  /** Source workbooks by spreadsheet id. */
  sheets?: Record<string, SheetSpec>;
  /** Workbooks the deployer can read but the app must never open (see outsideOpened()). */
  outsideSheets?: Record<string, SheetSpec>;
  /** Manifest scopes the user has not granted: ScriptApp.requireAllScopes then throws. */
  missingScopes?: string[];
  /** Html files by name (without .html). */
  htmlFiles?: Record<string, string>;
  /** The web app URL. Default is a neutral example. */
  serviceUrl?: string;
  /**
   * Install the Sheets (v4) and Drive (v3) advanced-service fakes too. Default false: like a
   * project that has not enabled them, the globals are then absent.
   */
  advanced?: boolean;
}

export type AdvancedMethod =
  | "Sheets.Spreadsheets.create" | "Sheets.Spreadsheets.Values.update" | "Sheets.Spreadsheets.Values.append"
  | "Sheets.Spreadsheets.batchUpdate" | "Drive.Permissions.create" | "Drive.Files.update";
/** The Drive file fields Files.update accepts in the fake; any other field throws. */
export const DRIVE_FILE_FIELDS = ["name", "description", "trashed", "writersCanShare", "copyRequiresWriterPermission"] as const;
/** The error ScriptApp.requireAllScopes throws when a scope is missing. */
export const SCOPES_MISSING_ERROR = "Authorization is required to perform that action.";
/** One recorded advanced-service call, with its arguments deep-copied. */
export interface AdvancedCall {
  method: AdvancedMethod;
  args: unknown[];
}
/** A spreadsheet made through the Sheets advanced-service fake. */
export interface CreatedSpreadsheet {
  id: string;
  url: string;
  title: string;
  sheets: { sheetId: number; title: string; frozenRowCount: number }[];
  /** Values written, by tab title (a later write to the same tab replaces the grid). */
  values: Record<string, unknown[][]>;
  /** The valueInputOption of the last Values.update or Values.append. */
  valueInputOption: string | null;
  /** Rows appended with Values.append, by tab title, in order (each also lands in values). */
  appended: Record<string, unknown[][]>;
  /** Drive file flags, as Drive defaults them until Files.update changes them. */
  writersCanShare: boolean;
  copyRequiresWriterPermission: boolean;
  description: string | null;
  trashed: boolean;
  /** Every batchUpdate request, in order. */
  requests: Obj[];
  /** Drive permissions created; sendNotificationEmail is true unless the call said otherwise, as in Drive. */
  permissions: { type: string; role: string; emailAddress: string; sendNotificationEmail: boolean }[];
}

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * One scripted UrlFetchApp answer. status defaults to 200, body to "". throws: the fetch call
 * throws an Error with this text instead of answering (a DNS failure, a timeout, a refused host).
 */
export interface ScriptedFetch {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
  throws?: string;
}
/** One recorded UrlFetchApp.fetch call: the url and a deep copy of the params as passed. */
export interface FetchCall {
  url: string;
  params: Obj;
  /** True for the request the fake made itself to follow a redirect. */
  redirected?: boolean;
}
/** The error the UrlFetchApp fake throws when a fetch has no scripted answer. */
export const FETCH_UNSCRIPTED_ERROR = "UrlFetchApp fake: no response is scripted for this request";

function byteLen(s: unknown): number { return Buffer.byteLength(String(s), "utf8"); }
function toSigned(b: Uint8Array): number[] { return Array.from(b, (x) => (x > 127 ? x - 256 : x)); }
function toBuf(bytes: ArrayLike<number>): Buffer { return Buffer.from(Uint8Array.from(Array.from(bytes), (b) => b & 0xff)); }

class FakeBlob {
  constructor(private data: string | number[], private type: string | null, private name: string | null) {}
  getBytes(): number[] { return typeof this.data === "string" ? toSigned(Buffer.from(this.data, "utf8")) : this.data.slice(); }
  getDataAsString(): string { return typeof this.data === "string" ? this.data : toBuf(this.data).toString("utf8"); }
  getContentType(): string | null { return this.type; }
  setContentType(t: string): FakeBlob { this.type = t; return this; }
  getName(): string | null { return this.name; }
  setName(n: string): FakeBlob { this.name = n; return this; }
  copyBlob(): FakeBlob { return new FakeBlob(this.getBytes(), this.type, this.name); }
}

// ----------------------------------------------------------------------- dates
const partsFmt = new Map<string, Intl.DateTimeFormat>();
function zoneParts(ms: number, tz: string): Record<string, string> {
  let f = partsFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
    });
    partsFmt.set(tz, f);
  }
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  return o;
}
const pad = (n: number | string, w: number): string => String(n).padStart(w, "0");
function offsetMinutes(ms: number, tz: string): number {
  const p = zoneParts(ms, tz);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

const nameFmts = new Map<string, Intl.DateTimeFormat>();
function zoneNames(ms: number, tz: string): { month: string; weekday: string } {
  let f = nameFmts.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "long", weekday: "long" }); nameFmts.set(tz, f); }
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { month: o.month, weekday: o.weekday };
}

/**
 * Utilities.formatDate in an IANA zone. Supported: yyyy yy MMMM MMM MM M dd d HH H hh h mm m ss s SSS
 * EEEE EEE a XXX Z ZZZ and 'literals'. Any other unquoted letter throws (the fake never guesses).
 */
export function formatDate(date: Date | number, tz: string, fmt: string): string {
  const ms = date instanceof Date ? date.getTime() : +date;
  if (Number.isNaN(ms)) throw new Error("Invalid date");
  const p = zoneParts(ms, tz);
  const names = zoneNames(ms, tz);
  const off = offsetMinutes(ms, tz);
  const ao = Math.abs(off);
  const hh = pad(Math.floor(ao / 60), 2), mm = pad(ao % 60, 2);
  const sign = off < 0 ? "-" : "+";
  const h12 = +p.hour % 12 === 0 ? 12 : +p.hour % 12;
  return String(fmt).replace(/'([^']*)'|([A-Za-z])\2*/g, (t: string, lit?: string) => {
    if (lit !== undefined) return lit === "" ? "'" : lit;
    switch (t) {
      case "yyyy": return p.year;
      case "yy": return p.year.slice(2);
      case "MMMM": return names.month;
      case "MMM": return names.month.slice(0, 3);
      case "MM": return p.month;
      case "M": return String(+p.month);
      case "dd": return p.day;
      case "d": return String(+p.day);
      case "HH": return p.hour;
      case "H": return String(+p.hour);
      case "hh": return pad(h12, 2);
      case "h": return String(h12);
      case "mm": return p.minute;
      case "m": return String(+p.minute);
      case "ss": return p.second;
      case "s": return String(+p.second);
      case "SSS": return pad(((ms % 1000) + 1000) % 1000, 3);
      case "EEEE": return names.weekday;
      case "EEE": return p.weekday;
      case "a": return +p.hour < 12 ? "AM" : "PM";
      case "XXX": return off === 0 ? "Z" : sign + hh + ":" + mm;
      case "Z": case "ZZZ": return sign + hh + mm;
      default: throw new Error("Unsupported date pattern letter in the fake: " + t);
    }
  });
}
function zonedWall(y: number, m: number, d: number, h: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, h);
  const off = offsetMinutes(guess, tz);
  const t = guess - off * 60000;
  const off2 = offsetMinutes(t, tz);
  return off2 === off ? t : guess - off2 * 60000;
}
/** Midnight of a calendar day in tz; where a DST gap swallows midnight, the first instant of that day. */
function zonedMidnight(y: number, m: number, d: number, tz: string): number {
  for (let h = 0; h < 4; h++) {
    const t = zonedWall(y, m, d, h, tz);
    const p = zoneParts(t, tz);
    if (+p.year === y && +p.month === m && +p.day === d) return t;
  }
  return zonedWall(y, m, d, 0, tz);
}

// ---------------------------------------------------------------- the installer
const SERVICES = [
  "PropertiesService", "CacheService", "LockService", "Session", "HtmlService", "ScriptApp",
  "Utilities", "SpreadsheetApp", "UrlFetchApp",
] as const;
/** The advanced services installGasFakes({ advanced: true }) adds. */
const ADVANCED_SERVICES = ["Sheets", "Drive"] as const;

export interface TriggerRecord { id: string; handler: string; kind: string; schedule: Obj }

let activeInstall = false;

export function installGasFakes(opts: FakeOptions = {}) {
  if (activeInstall) throw new Error("installGasFakes: fakes are already installed; call uninstall() on the previous handle first.");
  const preInstallKeys = new Set(Object.getOwnPropertyNames(globalThis));
  const OWNER = opts.owner ?? "owner@example.org";
  const TZ = opts.tz ?? "UTC";
  const baseNow = opts.now ?? Date.now();
  let offset = 0;
  const now = (): number => (typeof baseNow === "function" ? baseNow() : baseNow) + offset;
  const advance = (ms: number): void => { offset += Math.max(0, ms); };

  let activeUser = OWNER;
  let lockHeldElsewhere = false;
  let seq = 0;
  // propGet: getProperty calls; propGetAll: getProperties calls (each one a whole-store read).
  // cacheGet/cacheHit: keys read (getAll counts each key); cacheRead: get and getAll CALLS.
  // sheetOpen: openById and openByUrl calls; sheetRead: getValues/getDisplayValues grids.
  const counters = { propGet: 0, propGetAll: 0, propSet: 0, cacheGet: 0, cacheRead: 0, cachePut: 0, cacheHit: 0, cacheEvict: 0, sheetOpen: 0, sheetRead: 0, lockWait: 0 };

  // ------------------------------------------------------------ Properties
  const props = new Map<string, string>();
  const storeBytes = (m: Map<string, string>): number => { let n = 0; for (const [k, v] of m) n += byteLen(k) + byteLen(v); return n; };
  const checkProp = (k: string, v: string): void => {
    if (byteLen(v) > PROPERTY_VALUE_MAX) throw new Error("Argument too large: value");
    if (byteLen(k) > PROPERTY_VALUE_MAX) throw new Error("Argument too large: key");
  };
  const scriptProps: Obj = {
    getProperty: (k: unknown) => { counters.propGet++; const key = String(k); return props.has(key) ? props.get(key)! : null; },
    // Real GAS converts every key to a string, so the Map key is converted here too.
    setProperty(k0: unknown, v: unknown) {
      const k = String(k0);
      const s = String(v);
      checkProp(k, s);
      const next = new Map(props); next.set(k, s);
      if (storeBytes(next) > PROPERTY_STORE_MAX) throw new Error(QUOTA_ERROR);
      counters.propSet++; props.set(k, s);
      return scriptProps;
    },
    setProperties(o: Record<string, unknown>, deleteAll?: boolean) {
      const next = deleteAll ? new Map<string, string>() : new Map(props);
      for (const k of Object.keys(o)) { const s = String(o[k]); checkProp(k, s); next.set(String(k), s); }
      if (storeBytes(next) > PROPERTY_STORE_MAX) throw new Error(QUOTA_ERROR);
      counters.propSet += Object.keys(o).length;
      props.clear(); next.forEach((v, k) => props.set(k, v));
      return scriptProps;
    },
    deleteProperty(k: unknown) { props.delete(String(k)); return scriptProps; },
    deleteAllProperties() { props.clear(); return scriptProps; },
    getProperties: () => { counters.propGetAll++; return Object.fromEntries(props); },
    getKeys: () => Array.from(props.keys()),
  };
  const PropertiesService = {
    getScriptProperties: () => scriptProps,
    getUserProperties: () => { throw new Error("UserProperties is banned"); },
    getDocumentProperties: () => { throw new Error("DocumentProperties is banned"); },
  };

  // ----------------------------------------------------------------- Cache
  const cache = new Map<string, { v: string; exp: number }>();
  const live = (k: unknown) => {
    const key = checkKey(k);
    const e = cache.get(key);
    if (!e) return null;
    if (e.exp <= now()) { cache.delete(key); return null; }
    return e;
  };
  const ttlSeconds = (ttl: unknown): number => {
    if (ttl == null) return CACHE_TTL_DEFAULT;
    const n = Number(ttl);
    // The real minimum is one second, so a fractional value below 1 is refused as well. A value
    // above the 6 hour maximum is clamped on purpose (the clock in this fake never needs more).
    if (!Number.isFinite(n) || n < 1) throw new Error("Invalid argument: expirationInSeconds");
    return Math.min(n, CACHE_TTL_MAX);
  };
  const checkKey = (k: unknown): string => {
    const key = String(k);
    if (key.length > CACHE_KEY_MAX) throw new Error("Argument too large: key");
    return key;
  };
  const checkCache = (k: string, v: unknown): void => {
    checkKey(k);
    if (byteLen(v) > CACHE_VALUE_MAX) throw new Error("Argument too large: value");
  };
  // The script cache holds 1000 items in all, shared by every namespace and chunk. Past that the
  // real cache keeps the 900 farthest from expiration: drop the entries nearest to expiry.
  const evictOverCap = (): void => {
    for (const [k, e] of cache) if (e.exp <= now()) cache.delete(k);
    if (cache.size <= CACHE_ITEM_MAX) return;
    // Ties keep the newest write, so the put that tipped the cap is never its own victim.
    const keep = [...cache.entries()].map((e, i) => ({ e, i })).sort((a, b) => b.e[1].exp - a.e[1].exp || b.i - a.i).slice(0, CACHE_ITEM_KEEP).sort((a, b) => a.i - b.i).map((x) => x.e);
    counters.cacheEvict += cache.size - keep.length;
    cache.clear();
    for (const [k, e] of keep) cache.set(k, e);
  };
  const cachePut = (k: string, v: unknown, ttl?: number): void => {
    checkCache(k, v);
    const sec = ttlSeconds(ttl);
    counters.cachePut++;
    cache.set(String(k), { v: String(v), exp: now() + sec * 1000 });
    evictOverCap();
  };
  const readKey = (k: string): string | null => { counters.cacheGet++; const e = live(k); if (e) counters.cacheHit++; return e ? e.v : null; };
  const scriptCache: Obj = {
    get(k: string) { counters.cacheRead++; return readKey(k); },
    getAll(keys: string[]) {
      counters.cacheRead++;
      const out: Record<string, string> = {};
      for (const k of keys) { const v = readKey(k); if (v != null) out[String(k)] = v; }
      return out;
    },
    put: (k: string, v: unknown, ttl?: number) => cachePut(k, v, ttl),
    putAll(o: Record<string, unknown>, ttl?: number) {
      ttlSeconds(ttl);
      for (const k of Object.keys(o)) checkCache(k, o[k]);
      for (const k of Object.keys(o)) cachePut(k, o[k], ttl);
    },
    remove(k: string) { cache.delete(checkKey(k)); },
    removeAll(keys: string[]) { const ks = keys.map(checkKey); for (const k of ks) cache.delete(k); },
  };
  const CacheService = {
    getScriptCache: () => scriptCache,
    getUserCache: () => { throw new Error("The user cache is banned: nothing per-viewer may be cached"); },
    getDocumentCache: () => { throw new Error("The document cache is banned"); },
  };

  // ------------------------------------------------------------------ Lock
  let lockOwner: object | null = null;
  const makeLock = (): Obj => {
    const lk: Obj = {
      tryLock(ms: number) {
        if (lockOwner === lk) return true; // already ours: holdLock() only affects locks that do not hold it
        if (lockHeldElsewhere || lockOwner) { counters.lockWait++; advance(+ms || 0); return false; }
        lockOwner = lk; return true;
      },
      waitLock(ms: number) {
        if (!lk.tryLock(ms)) throw new Error("Lock timeout: Could not obtain lock after " + (+ms || 0) + " milliseconds.");
      },
      releaseLock() { if (lockOwner === lk) lockOwner = null; },
      hasLock: () => lockOwner === lk,
    };
    return lk;
  };
  const LockService = {
    getScriptLock: () => makeLock(),
    getUserLock: () => { throw new Error("The user lock is banned"); },
    getDocumentLock: () => { throw new Error("The document lock is banned"); },
  };

  // --------------------------------------------------------------- Session
  const Session = {
    getActiveUser: () => ({ getEmail: () => activeUser }),
    getEffectiveUser: () => ({ getEmail: () => OWNER }),
    getScriptTimeZone: () => TZ,
  };

  // ------------------------------------------------------------ HtmlService
  const htmlFiles = new Map<string, string>(Object.entries(opts.htmlFiles ?? {}));
  const readHtml = (name: string): string => {
    const v = htmlFiles.get(name);
    if (v === undefined) throw new Error("No HTML file named " + name + " was found.");
    return v;
  };
  // Template subset: <?= expr ?> (escaped) and <?!= expr ?> (raw). An expr is a dotted path, a string
  // or number literal, or a call of a path (JSON.stringify(x), include('f'), obj.fn(a, 'b')). Roots
  // resolve against the template's variables, then globalThis (so an app-defined include() works).
  // An unknown name throws ReferenceError as in GAS. Code scriptlets <? ... ?> throw: not supported.
  // Names a template may fall back to: the JS built-ins and anything defined on globalThis after install
  // (an app's include()). Node-only globals (process, crypto, navigator, ...) do not resolve, so a
  // variable the doGet forgot to set fails instead of passing silently. <?= ?> always HTML-entity
  // escapes; real GAS escapes by context (for example inside a script tag), which the fake does not model.
  const kitGlobals = new Set(["JSON", "Math", "Number", "String", "Boolean", "Array", "Object", "Date", "parseInt", "parseFloat", "encodeURIComponent", "decodeURIComponent", "undefined", "NaN", "Infinity", ...SERVICES]);
  const installedGlobals = { has: (n: string): boolean => !preInstallKeys.has(n) && Object.prototype.hasOwnProperty.call(globalThis, n) };
  const unsupported = (expr: string): never => { throw new Error("Unsupported template expression in the fake: " + expr); };
  const evalExpr = (src: string, vars: Obj): unknown => {
    let i = 0;
    const ws = (): void => { while (i < src.length && /\s/.test(src[i])) i++; };
    const ident = (): string => {
      const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
      if (!m) return unsupported(src);
      i += m[0].length; return m[0];
    };
    const value = (): unknown => {
      ws();
      const q = src[i];
      if (q === "'" || q === '"') {
        const end = src.indexOf(q, i + 1);
        if (end < 0) return unsupported(src);
        const lit = src.slice(i + 1, end); i = end + 1; return lit;
      }
      const num = /^-?\d+(\.\d+)?/.exec(src.slice(i));
      if (num) { i += num[0].length; return Number(num[0]); }
      let name = ident();
      let ctx: unknown = undefined;
      let cur: unknown;
      if (Object.prototype.hasOwnProperty.call(vars, name) && name !== "evaluate") cur = vars[name];
      else if (installedGlobals.has(name) || kitGlobals.has(name)) cur = (globalThis as Obj)[name];
      else throw new ReferenceError(name + " is not defined");
      for (;;) {
        ws();
        if (src[i] === ".") {
          i++; name = ident();
          if (cur == null) throw new TypeError("Cannot read properties of " + cur + " (reading '" + name + "')");
          ctx = cur; cur = (cur as Obj)[name];
        } else if (src[i] === "(") {
          i++;
          const args: unknown[] = [];
          ws();
          if (src[i] === ")") i++;
          else for (;;) {
            args.push(value()); ws();
            if (src[i] === ",") { i++; continue; }
            if (src[i] === ")") { i++; break; }
            return unsupported(src);
          }
          if (typeof cur !== "function") throw new TypeError(name + " is not a function");
          cur = (cur as (...a: unknown[]) => unknown).apply(ctx, args); ctx = undefined;
        } else break;
      }
      return cur;
    };
    const v = value(); ws();
    if (i < src.length) return unsupported(src);
    return v;
  };
  const evaluateScriptlets = (src: string, vars: Obj): string =>
    src.replace(/<\?(!?=)?([\s\S]*?)\?>/g, (_m, kind: string | undefined, expr: string) => {
      if (!kind) return unsupported("<?" + expr.trim() + "?> (code scriptlets are not supported)");
      const v = evalExpr(expr.trim().replace(/;$/, ""), vars);
      const s = v == null ? "" : String(v);
      return kind === "=" ? s.replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";") : s;
    });
  const outputs: Obj[] = [];
  const makeOutput = (content: string): Obj => {
    const out: Obj = {
      title: "", meta: {} as Record<string, string>, xFrameMode: null as string | null,
      faviconUrl: null as string | null, sandboxMode: null as string | null,
      getContent: () => content,
      setContent(c: string) { content = String(c); return out; },
      setTitle(t: string) { out.title = String(t); return out; },
      getTitle: () => out.title,
      addMetaTag(n: string, c: string) { out.meta[n] = c; return out; },
      setXFrameOptionsMode(m: string) {
        if (m !== "ALLOWALL" && m !== "DEFAULT") throw new Error("Invalid argument: mode");
        out.xFrameMode = m; return out;
      },
      setFaviconUrl(u: string) { out.faviconUrl = String(u); return out; },
      setSandboxMode(m: string) { out.sandboxMode = m; return out; },
      append(c: string) { content += String(c); return out; },
    };
    outputs.push(out);
    return out;
  };
  const HtmlService = {
    XFrameOptionsMode: { ALLOWALL: "ALLOWALL", DEFAULT: "DEFAULT" },
    SandboxMode: { EMULATED: "EMULATED", IFRAME: "IFRAME", NATIVE: "NATIVE" },
    createHtmlOutput: (s?: unknown) => makeOutput(s == null ? "" : String(s)),
    createHtmlOutputFromFile: (name: string) => makeOutput(readHtml(name)),
    createTemplateFromFile(name: string) {
      const src = readHtml(name);
      const tpl: Obj = { evaluate: () => makeOutput(evaluateScriptlets(src, tpl)) };
      return tpl;
    },
  };

  // ------------------------------------------------------------- ScriptApp
  const triggers: TriggerRecord[] = [];
  const SERVICE_URL = opts.serviceUrl ?? ["https:", "", "script.google.com", "macros", "s", "EXAMPLE_DEPLOYMENT", "exec"].join("/");
  const EventType = { CLOCK: "CLOCK", ON_OPEN: "ON_OPEN", ON_EDIT: "ON_EDIT", ON_FORM_SUBMIT: "ON_FORM_SUBMIT", ON_CHANGE: "ON_CHANGE", ON_EVENT_UPDATED: "ON_EVENT_UPDATED" };
  const TriggerSource = { CLOCK: "CLOCK", SPREADSHEETS: "SPREADSHEETS", FORMS: "FORMS", CALENDAR: "CALENDAR", DOCUMENTS: "DOCUMENTS" };
  const TRIGGER_QUOTA = 20;
  const MINUTES_OK = [1, 5, 10, 15, 30];
  const HOURS_OK = [1, 2, 4, 6, 8, 12];
  const SCHEDULE_KEYS = ["everyMinutes", "everyHours", "everyDays", "everyWeeks", "at", "after", "onMonthDay"];
  const triggerObject = (t: TriggerRecord): Obj => ({
    getHandlerFunction: () => t.handler, getUniqueId: () => t.id, getEventType: () => EventType.CLOCK, getTriggerSource: () => TriggerSource.CLOCK,
  });
  const newTrigger = (handler: string): Obj => {
    const schedule: Obj = {};
    const tb: Obj = {};
    for (const m of ["everyMinutes", "everyHours", "everyDays", "everyWeeks", "atHour", "nearMinute", "onWeekDay", "onMonthDay", "inTimezone", "at", "after"]) {
      tb[m] = (...a: unknown[]) => {
        if (m === "everyMinutes" && !MINUTES_OK.includes(a[0] as number)) throw new Error("Invalid number of minutes: everyMinutes must be 1, 5, 10, 15 or 30.");
        if (m === "everyHours" && !HOURS_OK.includes(a[0] as number)) throw new Error("Invalid number of hours: everyHours must be 1, 2, 4, 6, 8 or 12.");
        if (m === "atHour" && !(Number.isInteger(a[0]) && (a[0] as number) >= 0 && (a[0] as number) <= 23)) throw new Error("Invalid hour: atHour must be an integer from 0 to 23.");
        if (m === "nearMinute" && !(Number.isInteger(a[0]) && (a[0] as number) >= 0 && (a[0] as number) <= 59)) throw new Error("Invalid minute: nearMinute must be an integer from 0 to 59.");
        if ((m === "atHour" || m === "nearMinute") && !("everyDays" in schedule || "everyWeeks" in schedule || "onMonthDay" in schedule)) throw new Error(m + " needs everyDays, everyWeeks or onMonthDay first.");
        if (m === "after" && !(Number(a[0]) >= 1)) throw new Error("Invalid argument: after(durationMilliseconds)");
        schedule[m] = a.length === 1 ? a[0] : a; return tb;
      };
    }
    tb.create = () => {
      if (!SCHEDULE_KEYS.some((k) => k in schedule)) throw new Error("Trigger has no schedule: call everyMinutes, everyHours, everyDays, everyWeeks, at, after or onMonthDay first.");
      if (triggers.length >= TRIGGER_QUOTA) throw new Error("This script has too many triggers. Triggers must be deleted from the script before more can be added.");
      const rec: TriggerRecord = { id: "trigger-" + (++seq), handler, kind: "CLOCK", schedule };
      triggers.push(rec);
      return triggerObject(rec);
    };
    return { timeBased: () => tb };
  };
  const AuthMode = { NONE: "NONE", CUSTOM_FUNCTION: "CUSTOM_FUNCTION", LIMITED: "LIMITED", FULL: "FULL" };
  const missingScopes = new Set<string>((opts.missingScopes ?? []).map(String));
  const ScriptApp = {
    EventType, TriggerSource, AuthMode,
    requireAllScopes(mode: string) {
      if (!Object.prototype.hasOwnProperty.call(AuthMode, String(mode))) throw new Error("Invalid argument: authMode");
      if (missingScopes.size) throw new Error(SCOPES_MISSING_ERROR);
    },
    getService: () => ({ getUrl: () => SERVICE_URL }),
    getScriptId: () => "EXAMPLE_SCRIPT",
    newTrigger,
    getProjectTriggers: () => triggers.map(triggerObject),
    deleteTrigger(t: { getUniqueId(): string }) {
      const i = triggers.findIndex((x) => x.id === t.getUniqueId());
      if (i >= 0) triggers.splice(i, 1);
    },
  };

  // ------------------------------------------------------------- Utilities
  const DigestAlgorithm = { MD5: "MD5", SHA_1: "SHA_1", SHA_256: "SHA_256", SHA_384: "SHA_384", SHA_512: "SHA_512" };
  const HASH_NAMES: Record<string, string> = { MD5: "md5", SHA_1: "sha1", SHA_256: "sha256", SHA_384: "sha384", SHA_512: "sha512" };
  const Charset = { UTF_8: "UTF_8", US_ASCII: "US_ASCII" };
  const Utilities = {
    DigestAlgorithm, Charset,
    newBlob: (data: string | number[], contentType?: string, name?: string) => new FakeBlob(data, contentType ?? null, name ?? null),
    gzip(blob: FakeBlob, name?: string) {
      return new FakeBlob(toSigned(gzipSync(toBuf(blob.getBytes()))), "application/x-gzip", name ?? blob.getName());
    },
    ungzip(blob: FakeBlob) {
      const bytes = blob.getBytes();
      if (!(bytes.length > 2 && (bytes[0] & 0xff) === 0x1f && (bytes[1] & 0xff) === 0x8b)) throw new Error("Invalid argument: blob is not gzip data");
      return new FakeBlob(toSigned(gunzipSync(toBuf(bytes))), "application/octet-stream", blob.getName());
    },
    base64Encode: (input: string | number[]) => (typeof input === "string" ? Buffer.from(input, "utf8") : toBuf(input)).toString("base64"),
    base64Decode: (s: string) => toSigned(Buffer.from(s, "base64")),
    computeDigest(algo: string, value: string | number[], charset?: string) {
      const name = HASH_NAMES[algo];
      if (!name) throw new Error("Invalid argument: algorithm");
      // US_ASCII is not modelled: only UTF-8 text is hashed, so a different charset is refused.
      if (charset !== undefined && charset !== Charset.UTF_8) throw new Error("Unsupported charset in the fake: " + String(charset));
      return toSigned(createHash(name).update(typeof value === "string" ? Buffer.from(value, "utf8") : toBuf(value)).digest());
    },
    sleep: (ms: number) => advance(+ms || 0),
    getUuid: () => "00000000-0000-4000-8000-" + pad((++seq).toString(16), 12),
    formatDate,
  };

  // ----------------------------------------------------- SpreadsheetApp (read-only)
  const refuse = (): never => { throw new Error(READ_ONLY_ERROR); };
  // Any method whose name starts with one of these is a mutator and throws READ_ONLY_ERROR, whether or
  // not the fake knows it. Any other unknown method throws "not implemented in the fake".
  const MUTATOR = /^(set|insert|delete|clear|append|remove|add|hide|show|unhide|move|copy|merge|break|sort|protect|rename|duplicate|activate|auto|randomize|check|uncheck|trim|update|expand|collapse|group|ungroup|resize|create|toast|apply|fill|split|transpose|import|reset)([A-Z0-9_]|$)/;
  const PASSTHROUGH = new Set(["then", "toJSON", "asymmetricMatch", "nodeType", "constructor", "inspect", "toString", "valueOf", "hasOwnProperty"]);
  const guard = <T extends object>(target: T, label: string): T => new Proxy(target, {
    get(t, prop, receiver) {
      if (typeof prop !== "string" || prop in t || PASSTHROUGH.has(prop) || !/^[a-z][A-Za-z0-9]*$/.test(prop)) return Reflect.get(t, prop, receiver);
      if (MUTATOR.test(prop)) return refuse;
      return () => { throw new Error(label + "." + prop + " is not implemented in the fake"); };
    },
    set: () => refuse(),
    defineProperty: () => refuse(),
    deleteProperty: () => refuse(),
    // Swapping the prototype or sealing the object would otherwise defeat the guard.
    setPrototypeOf: () => refuse(),
    preventExtensions: () => refuse(),
  });

  const cellValue = (cell: Cell | undefined, tz: string): Exclude<Cell, { $wall: string }> | "" => {
    if (cell == null) return "";
    if (cell instanceof Date) return new Date(cell.getTime());
    if (typeof cell === "object") {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cell.$wall);
      if (!m) throw new Error("Bad $wall cell: " + cell.$wall);
      return new Date(zonedMidnight(+m[1], +m[2], +m[3], tz));
    }
    return cell;
  };
  const displayOf = (v: unknown, tz: string): string =>
    v instanceof Date ? formatDate(v, tz, "yyyy-MM-dd") : v === true ? "TRUE" : v === false ? "FALSE" : v == null ? "" : String(v);

  const colLetters = (n: number): string => { let s = ""; for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s; return s; };
  const colNumber = (letters: string): number => { let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };
  const OUTSIDE = "The coordinates of the range are outside the dimensions of the sheet.";

  // Internals live in WeakMaps keyed by the guarded object, so no caller can reach or edit them.
  const rangeState = new WeakMap<object, { sheet: FakeSheet; r: number; c: number; nr: number; nc: number }>();
  const sheetState = new WeakMap<object, { book: FakeSpreadsheet; name: string; gid: number; rows: Cell[][]; width: number }>();
  const bookState = new WeakMap<object, { id: string; spec: SheetSpec; tz: string; sheets: FakeSheet[] }>();
  const copyCell = (c: Cell): Cell => (c instanceof Date ? new Date(c.getTime()) : c !== null && typeof c === "object" ? { ...c } : c);

  class FakeRange {
    constructor(sheet: FakeSheet, r: number, c: number, nr: number, nc: number) {
      const self = guard(this, "Range");
      rangeState.set(self, { sheet, r, c, nr, nc });
      return self;
    }
    private grid(display: boolean): unknown[][] {
      counters.sheetRead++;
      const st = rangeState.get(this)!;
      const sh = sheetState.get(st.sheet)!;
      const tz = bookState.get(sh.book)!.tz;
      const out: unknown[][] = [];
      for (let i = 0; i < st.nr; i++) {
        const row: unknown[] = [];
        for (let j = 0; j < st.nc; j++) {
          const v = cellValue(sh.rows[st.r + i]?.[st.c + j], tz);
          row.push(display ? displayOf(v, tz) : v);
        }
        out.push(row);
      }
      return out;
    }
    getValues() { return this.grid(false); }
    getDisplayValues() { return this.grid(true); }
    getValue() { return this.grid(false)[0][0]; }
    getDisplayValue() { return this.grid(true)[0][0]; }
    getNumRows() { return rangeState.get(this)!.nr; }
    getNumColumns() { return rangeState.get(this)!.nc; }
    getRow() { return rangeState.get(this)!.r + 1; }
    getColumn() { return rangeState.get(this)!.c + 1; }
    getLastRow() { const st = rangeState.get(this)!; return st.r + st.nr; }
    getLastColumn() { const st = rangeState.get(this)!; return st.c + st.nc; }
    getSheet() { return rangeState.get(this)!.sheet; }
    getA1Notation() {
      const st = rangeState.get(this)!;
      const a1 = (r: number, c: number) => colLetters(c + 1) + (r + 1);
      return st.nr === 1 && st.nc === 1 ? a1(st.r, st.c) : a1(st.r, st.c) + ":" + a1(st.r + st.nr - 1, st.c + st.nc - 1);
    }
  }

  /** A sheet is exactly as big as its data (at least 1x1); a range beyond that throws as in Sheets. */
  class FakeSheet {
    constructor(book: FakeSpreadsheet, name: string, data: TabData, gid: number) {
      const raw: Cell[][] = typeof data === "string" ? parseCsv(data) : data;
      let width = 0;
      for (const r of raw) if (r.length > width) width = r.length;
      const rows = raw.map((r) => { const c = r.map(copyCell); while (c.length < width) c.push(""); return c; });
      const self = guard(this, "Sheet");
      sheetState.set(self, { book, name, gid, rows, width });
      return self;
    }
    getName() { return sheetState.get(this)!.name; }
    getSheetId() { return sheetState.get(this)!.gid; }
    getParent() { return sheetState.get(this)!.book; }
    getLastRow() { return sheetState.get(this)!.rows.length; }
    getLastColumn() { return sheetState.get(this)!.width; }
    getMaxRows() { return Math.max(1, this.getLastRow()); }
    getMaxColumns() { return Math.max(1, this.getLastColumn()); }
    getDataRange() { return this.getRange(1, 1, this.getMaxRows(), this.getMaxColumns()); }
    getRange(a: number | string, c?: number, nr?: number, nc?: number) {
      let row: number, col: number, rows: number, cols: number;
      if (typeof a === "string") {
        const m = /^\s*([A-Za-z]+)(\d+)(?::([A-Za-z]+)(\d+))?\s*$/.exec(a);
        if (!m) throw new Error("getRange(" + JSON.stringify(a) + "): only A1 and A1:B2 notation is supported by the fake");
        row = +m[2]; col = colNumber(m[1].toUpperCase());
        rows = m[4] ? +m[4] - row + 1 : 1; cols = m[3] ? colNumber(m[3].toUpperCase()) - col + 1 : 1;
      } else { row = a; col = c as number; rows = nr ?? 1; cols = nc ?? 1; }
      if (![row, col, rows, cols].every((n) => Number.isInteger(n))) throw new Error("The parameters (" + [a, c, nr, nc].filter((x) => x !== undefined).join(",") + ") do not match the method signature for SpreadsheetApp.Sheet.getRange.");
      if (row < 1 || col < 1 || rows < 1 || cols < 1) throw new Error("The coordinates or dimensions of the range are invalid.");
      if (row + rows - 1 > this.getMaxRows() || col + cols - 1 > this.getMaxColumns()) throw new Error(OUTSIDE);
      return new FakeRange(this, row - 1, col - 1, rows, cols);
    }
    isSheetHidden() { return false; }
  }

  class FakeSpreadsheet {
    constructor(id: string, spec: SheetSpec) {
      const self = guard(this, "Spreadsheet");
      const sheets: FakeSheet[] = [];
      bookState.set(self, { id, spec, tz: spec.tz ?? TZ, sheets });
      Object.keys(spec.tabs).forEach((n, i) => sheets.push(new FakeSheet(self, n, spec.tabs[n], i)));
      return self;
    }
    getId() { return bookState.get(this)!.id; }
    getName() { const st = bookState.get(this)!; return st.spec.name ?? st.id; }
    getUrl() { return ["https:", "", "docs.google.com", "spreadsheets", "d", this.getId(), "edit"].join("/"); }
    getSpreadsheetTimeZone() { return bookState.get(this)!.tz; }
    getSheets() { return bookState.get(this)!.sheets.slice(); }
    getSheetByName(n: string) { return this.getSheets().find((s) => s.getName() === n) ?? null; }
    getSheetById(g: number) { return this.getSheets().find((s) => s.getSheetId() === g) ?? null; }
  }

  const sources = new Map<string, SheetSpec>(Object.entries(opts.sheets ?? {}));
  const outside = new Set<string>();
  for (const [id, spec] of Object.entries(opts.outsideSheets ?? {})) { sources.set(id, spec); outside.add(id); }
  const outsideOpened: string[] = [];
  let sourceAccess = true;
  const openBook = (id: string): FakeSpreadsheet => {
    counters.sheetOpen++;
    const spec = sourceAccess ? sources.get(String(id)) : undefined;
    if (!spec) throw new Error("No item with the given ID could be found, or you do not have permission to access it.");
    if (outside.has(String(id))) outsideOpened.push(String(id));
    return new FakeSpreadsheet(String(id), spec);
  };
  const SpreadsheetApp = guard({
    openById: openBook,
    openByUrl(url: string) {
      const m = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(String(url));
      if (!m) throw new Error("Invalid argument: url");
      return openBook(m[1]);
    },
    getActiveSpreadsheet: () => null,
    create: refuse,
    open: refuse,
    flush: () => undefined,
  }, "SpreadsheetApp");

  // --------------------------------------- Sheets and Drive advanced services (opt-in)
  // Only new files can be written: Values.update, batchUpdate and Permissions.create on a source
  // id throw READ_ONLY_ERROR, and on an id the fake never created they throw "not found".
  const created = new Map<string, CreatedSpreadsheet>();
  const advancedCalls: AdvancedCall[] = [];
  const queuedIds: string[] = [];
  const failures: { method: AdvancedMethod; message: string }[] = [];
  /** Throw a queued failure for this method, once. */
  const failIfQueued = (method: AdvancedMethod): void => {
    const i = failures.findIndex((x) => x.method === method);
    if (i >= 0) { const f = failures.splice(i, 1)[0]!; throw new Error(f.message); }
  };
  let createSeq = 0;
  const copy = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)) as T);
  const record = (method: AdvancedMethod, args: unknown[]): void => { advancedCalls.push({ method, args: args.map(copy) }); failIfQueued(method); };
  const target = (id: unknown, what: string): CreatedSpreadsheet => {
    const key = String(id);
    if (sources.has(key)) throw new Error(READ_ONLY_ERROR);
    const f = created.get(key);
    if (!f) throw new Error(what === "Drive" ? "File not found: " + key + "." : "Requested entity was not found.");
    return f;
  };
  // Sheets refuses the whole write when one cell holds more than 50,000 characters.
  const checkCells = (values: unknown[][]): void => {
    for (const r of values) for (const c of r) if (typeof c === "string" && c.length > SHEETS_CELL_MAX) throw new Error(SHEETS_CELL_ERROR);
  };
  const sheetUrl = (id: string): string => ["https:", "", "docs.google.com", "spreadsheets", "d", id, "edit"].join("/");
  // A1 notation: 'Tab name'!A1 (a quote inside doubled) or Tab!A1. Only the tab is resolved.
  const tabOf = (range: string): string | null => {
    const q = /^'((?:[^']|'')+)'!/.exec(range);
    if (q) return q[1].replace(/''/g, "'");
    const p = /^([^'!]+)!/.exec(range);
    return p ? p[1] : null;
  };
  const Sheets = {
    Spreadsheets: {
      create(resource: Obj) {
        record("Sheets.Spreadsheets.create", [resource]);
        const title = String(resource?.properties?.title ?? "");
        if (title === "") throw new Error("Invalid requests: the spreadsheet title is empty.");
        const id = queuedIds.length ? queuedIds.shift()! : "export-sheet-" + (++createSeq);
        const specs: Obj[] = Array.isArray(resource?.sheets) && resource.sheets.length ? resource.sheets : [{ properties: { title: "Sheet1" } }];
        const sheets = specs.map((s, i) => ({
          sheetId: i,
          title: String(s?.properties?.title ?? "Sheet" + (i + 1)),
          frozenRowCount: Number(s?.properties?.gridProperties?.frozenRowCount ?? 0),
        }));
        const titles = sheets.map((s) => s.title);
        if (titles.some((t, i) => t === "" || titles.indexOf(t) !== i)) throw new Error("Invalid requests: sheet titles must be unique and non-empty.");
        // A queued id that names a source is returned (so a caller's refusal can be tested) but never stored over it.
        if (id !== "" && !sources.has(id)) {
          created.set(id, {
            id, url: sheetUrl(id), title, sheets, values: {}, valueInputOption: null, appended: {}, requests: [], permissions: [],
            writersCanShare: true, copyRequiresWriterPermission: false, description: null, trashed: false,
          });
        }
        return { spreadsheetId: id, spreadsheetUrl: id ? sheetUrl(id) : "", properties: { title }, sheets: sheets.map((s) => ({ properties: { sheetId: s.sheetId, title: s.title } })) };
      },
      batchUpdate(resource: Obj, id: string) {
        record("Sheets.Spreadsheets.batchUpdate", [resource, id]);
        const f = target(id, "Sheets");
        const requests: Obj[] = Array.isArray(resource?.requests) ? resource.requests : [];
        if (requests.length === 0) throw new Error("Invalid requests: at least one request is required.");
        for (const r of requests) {
          const gid = r?.repeatCell?.range?.sheetId;
          if (r?.repeatCell && !f.sheets.some((s) => s.sheetId === (gid ?? 0))) throw new Error("Invalid requests[0].repeatCell: No grid with id: " + gid);
          f.requests.push(copy(r));
        }
        return { spreadsheetId: f.id, replies: requests.map(() => ({})) };
      },
      Values: {
        update(resource: Obj, id: string, range: string, optionalArgs?: Obj) {
          record("Sheets.Spreadsheets.Values.update", optionalArgs === undefined ? [resource, id, range] : [resource, id, range, optionalArgs]);
          const f = target(id, "Sheets");
          const option = optionalArgs?.valueInputOption;
          if (option !== "RAW" && option !== "USER_ENTERED") throw new Error("'valueInputOption' is required but not specified");
          const tab = tabOf(String(range));
          const sheet = tab === null ? undefined : f.sheets.find((s) => s.title === tab);
          if (!sheet) throw new Error("Unable to parse range: " + range);
          const values = resource?.values;
          if (!Array.isArray(values) || !values.every((r: unknown) => Array.isArray(r))) throw new Error("Invalid value: values must be a list of rows.");
          checkCells(values);
          f.values[sheet.title] = copy(values);
          f.valueInputOption = option;
          const cells = values.reduce((n: number, r: unknown[]) => n + r.length, 0);
          return { spreadsheetId: f.id, updatedRange: range, updatedRows: values.length, updatedCells: cells };
        },
        // Appends after the last row of the tab named by the range; nothing is ever overwritten.
        append(resource: Obj, id: string, range: string, optionalArgs?: Obj) {
          record("Sheets.Spreadsheets.Values.append", optionalArgs === undefined ? [resource, id, range] : [resource, id, range, optionalArgs]);
          const f = target(id, "Sheets");
          const option = optionalArgs?.valueInputOption;
          if (option !== "RAW" && option !== "USER_ENTERED") throw new Error("'valueInputOption' is required but not specified");
          const insert = optionalArgs?.insertDataOption;
          if (insert !== undefined && insert !== "INSERT_ROWS" && insert !== "OVERWRITE") throw new Error("Invalid value at 'insert_data_option'");
          const tab = tabOf(String(range));
          const sheet = tab === null ? undefined : f.sheets.find((s) => s.title === tab);
          if (!sheet) throw new Error("Unable to parse range: " + range);
          const values = resource?.values;
          if (!Array.isArray(values) || !values.every((r: unknown) => Array.isArray(r))) throw new Error("Invalid value: values must be a list of rows.");
          checkCells(values);
          const rows = copy(values) as unknown[][];
          f.values[sheet.title] = [...(f.values[sheet.title] ?? []), ...rows];
          f.appended[sheet.title] = [...(f.appended[sheet.title] ?? []), ...copy(rows)];
          f.valueInputOption = option;
          return { spreadsheetId: f.id, tableRange: range, updates: { updatedRows: rows.length } };
        },
      },
    },
  };
  const Drive = {
    Files: {
      // Metadata only (patch semantics); a media upload or an unknown field throws.
      update(resource: Obj, fileId: string, mediaData?: unknown, optionalArgs?: Obj) {
        const args: unknown[] = [resource, fileId];
        if (mediaData !== undefined || optionalArgs !== undefined) args.push(mediaData ?? null);
        if (optionalArgs !== undefined) args.push(optionalArgs);
        record("Drive.Files.update", args);
        const f = target(fileId, "Drive");
        if (mediaData !== undefined && mediaData !== null) throw new Error("Unsupported in the fake: a media upload through Files.update.");
        const r: Obj = resource ?? {};
        for (const k of Object.keys(r)) {
          if (!(DRIVE_FILE_FIELDS as readonly string[]).includes(k)) throw new Error("Unsupported field in the fake: " + k);
        }
        for (const k of ["trashed", "writersCanShare", "copyRequiresWriterPermission"] as const) {
          if (k in r && typeof r[k] !== "boolean") throw new Error("Invalid value for " + k + ": a boolean is required.");
        }
        if ("name" in r) f.title = String(r.name);
        if ("description" in r) f.description = r.description == null ? null : String(r.description);
        if ("trashed" in r) f.trashed = r.trashed;
        if ("writersCanShare" in r) f.writersCanShare = r.writersCanShare;
        if ("copyRequiresWriterPermission" in r) f.copyRequiresWriterPermission = r.copyRequiresWriterPermission;
        return {
          id: f.id, name: f.title, description: f.description, trashed: f.trashed,
          writersCanShare: f.writersCanShare, copyRequiresWriterPermission: f.copyRequiresWriterPermission,
        };
      },
    },
    Permissions: {
      create(resource: Obj, fileId: string, optionalArgs?: Obj) {
        record("Drive.Permissions.create", optionalArgs === undefined ? [resource, fileId] : [resource, fileId, optionalArgs]);
        const f = target(fileId, "Drive");
        const type = String(resource?.type ?? "");
        const role = String(resource?.role ?? "");
        const emailAddress = String(resource?.emailAddress ?? "");
        if (!type || !role) throw new Error("Invalid permission: type and role are required.");
        if (type === "user" && !emailAddress) throw new Error("Invalid permission: emailAddress is required for type user.");
        if (emailAddress.toLowerCase() === OWNER.toLowerCase()) throw new Error("The owner of a file cannot be given another role on it.");
        f.permissions.push({ type, role, emailAddress, sendNotificationEmail: optionalArgs?.sendNotificationEmail !== false });
        return { id: "perm-" + (++seq), type, role, emailAddress };
      },
    },
  };

  // ------------------------------------------------------------ UrlFetchApp
  // Every call is recorded, then answered from the script queue in order; with nothing scripted
  // the call throws, so a test can never reach a network by accident. Modelled from the real
  // service: muteHttpExceptions false (the default) throws on a status of 400 or more; a 3xx with a
  // Location header is followed (the next scripted answer, recorded as redirected) unless
  // followRedirects is false.
  const fetchCalls: FetchCall[] = [];
  const fetchQueue: ScriptedFetch[] = [];
  const copyParams = (o: unknown): Obj => (o == null ? {} : JSON.parse(JSON.stringify(o)));
  const fakeResponse = (r: ScriptedFetch): Obj => {
    const text = r.body ?? "";
    const headers = { ...(r.headers ?? {}) };
    return {
      getResponseCode: () => r.status ?? 200,
      getContentText: () => text,
      getContent: () => toSigned(Buffer.from(text, "utf8")),
      getHeaders: () => ({ ...headers }),
      getAllHeaders: () => ({ ...headers }),
      getBlob: () => new FakeBlob(text, headers["Content-Type"] ?? null, null),
    };
  };
  const answer = (url: string, params: Obj, redirected: boolean, hops: number): Obj => {
    fetchCalls.push(redirected ? { url, params: copyParams(params), redirected } : { url, params: copyParams(params) });
    const r = fetchQueue.shift();
    if (!r) throw new Error(FETCH_UNSCRIPTED_ERROR + ": " + url);
    if (r.throws !== undefined) throw new Error(r.throws);
    const status = r.status ?? 200;
    const location = r.headers?.Location ?? r.headers?.location;
    if (status >= 300 && status < 400 && location && params.followRedirects !== false) {
      if (hops >= 10) throw new Error("UrlFetchApp fake: too many redirects");
      return answer(location, params, true, hops + 1);
    }
    if (status >= 400 && params.muteHttpExceptions !== true) {
      throw new Error("Request failed for " + url + " returned code " + status + ". Truncated server response: " + (r.body ?? "").slice(0, 100));
    }
    return fakeResponse(r);
  };
  const UrlFetchApp = {
    fetch(url: unknown, params?: Obj) {
      if (typeof url !== "string") throw new Error("Invalid argument: url");
      return answer(url, params ?? {}, false, 0);
    },
    fetchAll() { throw new Error("UrlFetchApp.fetchAll is not modelled by the fake"); },
    getRequest() { throw new Error("UrlFetchApp.getRequest is not modelled by the fake"); },
  };

  // ----------------------------------------------------------- install/uninstall
  const fakes: Record<(typeof SERVICES)[number], unknown> = {
    PropertiesService, CacheService, LockService, Session, HtmlService, ScriptApp, Utilities, SpreadsheetApp, UrlFetchApp,
  };
  const G = globalThis as unknown as Obj;
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const name of SERVICES) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value: fakes[name], configurable: true, writable: true, enumerable: true });
  }
  const advancedFakes: Record<(typeof ADVANCED_SERVICES)[number], unknown> = { Sheets, Drive };
  if (opts.advanced) {
    for (const name of ADVANCED_SERVICES) {
      saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { value: advancedFakes[name], configurable: true, writable: true, enumerable: true });
    }
  }
  let installed = true;
  activeInstall = true;

  return {
    /** The service objects, also on globalThis until uninstall(). */
    services: fakes,
    owner: OWNER,
    /** Fake clock. advance() moves cache expiry and lock timeouts; sleep() and a failed tryLock advance it too. */
    clock: { now, advance },
    /** Switch the active (viewing) user. The effective user stays the owner. */
    as(email: string): void { activeUser = String(email); },
    /** Make tryLock return false and waitLock throw, as if another execution held the lock. */
    holdLock(held: boolean): void { lockHeldElsewhere = !!held; },
    /** Release the script lock if this execution holds it, as Apps Script does when an execution ends. Leaves holdLock() alone. */
    resetLocks(): void { lockOwner = null; },
    /** Make openById/openByUrl fail as if the owner lost access to the source. */
    setSourceAccess(ok: boolean): void { sourceAccess = !!ok; },
    /**
     * Add or replace a source workbook. With { outside: true } it is a sheet the deployer can read
     * but the app must refuse: it opens (read-only), and outsideOpened() records it.
     */
    addSheet(id: string, spec: SheetSpec, o: { outside?: boolean } = {}): void {
      sources.set(id, spec);
      if (o.outside) outside.add(id); else outside.delete(id);
    },
    /** The outside sheets (addSheet with outside: true) opened so far, in order, repeats kept. */
    outsideOpened(): string[] { return outsideOpened.slice(); },
    /** Seed missing scopes (none: every scope granted): ScriptApp.requireAllScopes then throws. */
    setMissingScopes(...scopes: string[]): void { missingScopes.clear(); for (const x of scopes) missingScopes.add(String(x)); },
    /** Raw script property store and cache expiry, for assertions. */
    props, cache,
    counters: () => ({ ...counters }),
    resetCounters(): void { for (const k of Object.keys(counters) as Array<keyof typeof counters>) counters[k] = 0; },
    clearCache(): void { cache.clear(); },
    /** Triggers created through ScriptApp.newTrigger, with their recorded schedule. */
    triggers,
    /** Add or replace an html file served by HtmlService. */
    setHtmlFile(name: string, content: string): void { htmlFiles.set(name, content); },
    /** Every HtmlOutput created, in order. */
    outputs,
    /** The X-Frame-Options mode set on each HtmlOutput, in order (null where none was set). */
    frameModes(): (string | null)[] { return outputs.map((o) => (o.xFrameMode ?? null) as string | null); },
    /**
     * The Sheets and Drive advanced-service fakes (on globalThis only with advanced: true).
     * calls: every call in order; files: the spreadsheets created, by id; nextId(...ids): the ids
     * the next creates return, in order ("" or a source id to test a caller's refusal);
     * failNext(method, message?): the next call of that method throws (after it is recorded).
     */
    advanced: {
      services: advancedFakes,
      calls: advancedCalls,
      files: created,
      nextId(...ids: string[]): void { queuedIds.push(...ids.map(String)); },
      failNext(method: AdvancedMethod, message = "Internal error encountered."): void { failures.push({ method, message: String(message) }); },
    },
    /**
     * The UrlFetchApp fake. calls: every fetch in order (url and copied params, so a test can
     * assert followRedirects false); respond(...answers): queue answers, consumed in order;
     * clear(): drop the calls and the queue. A fetch with no queued answer throws.
     */
    urlFetch: {
      calls: fetchCalls,
      respond(...answers: ScriptedFetch[]): void { fetchQueue.push(...answers.map((a) => ({ ...a }))); },
      pending(): number { return fetchQueue.length; },
      clear(): void { fetchCalls.length = 0; fetchQueue.length = 0; },
    },
    uninstall(): void {
      if (!installed) return;
      installed = false;
      activeInstall = false;
      for (const [name, d] of saved) {
        if (d) Object.defineProperty(globalThis, name, d); else delete G[name];
      }
    },
  };
}

export type GasFakes = ReturnType<typeof installGasFakes>;
