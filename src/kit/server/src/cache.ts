// Extracted from the author's production Apps Script apps; adapted.
// Cross-request cache over CacheService: JSON, gzip, base64, split into chunks plus a head
// record. A missing or corrupt chunk is a miss (and the entry is removed). Nothing per-viewer
// may be cached: callers pass viewer-free values only. A hit returns the JSON round-tripped
// value (Dates become strings, undefined fields vanish); a miss returns fn()'s raw value.
// Head record: {n: chunk count, sum: checksum of the packed text}. Keys: at most 244 characters.
//
// Each instance also keeps a per-execution memory of the values it read or wrote, so a second
// get of the same key in one execution costs no CacheService call and no unzip. Values returned
// from it are SHARED: treat every value a get, peek or getOrCompute returns as read-only. Within
// one execution a get after a put returns the very value put (not a JSON round trip). The memory
// is dropped at the next execution (beginExecution, which run() calls) and when the CacheService
// global changes (fresh test fakes). A miss is never remembered.
//
// Log lines and error messages name the namespace and a short hash of the key (keyRef), never
// the key text, which can embed a source id.
//
// forbid() is a TRIPWIRE FOR THE LITERAL ADDRESS, NOT A CONTROL. It returns strings no cached key
// or value may contain (an app passes the active viewer's address). A write whose key or JSON
// holds one, in any case, is SKIPPED: nothing is stored (an older entry under the key is removed),
// the value is still returned to the caller uncached for this execution, and one console.warn
// line {cache: ns, key: keyRef, skipped: "forbidden"} says so. It never throws, because shared,
// viewer-free data (a register cell, a setting) can hold a viewer's address too, and a throw then
// locked that viewer, the owner and the trigger out on a cold cache. A getter that throws or
// answers anything but an array of strings skips every write (fail closed). It only matches the
// literal string: a model keyed by a hash or a role, or holding the address percent-encoded, in
// base64 or split in two, is not caught. Keep per-viewer data out of the cache by design.

import { executionGeneration } from "./execution";

export const CHUNK_CHARS = 90_000;
export const TTL_MIN_SEC = 60;
export const TTL_MAX_SEC = 21_600;
export const KEY_MAX = 250;
/** Room kept under KEY_MAX for the ":m" head suffix and ":<index>" chunk suffixes. */
const SUFFIX_RESERVE = 6;
/** Upper bound on a head record's chunk count (about 90 MB); more is a malformed head. */
export const MAX_CHUNKS = 1000;
const NAMESPACE_RE = /^[a-z][a-zA-Z]*\d+$/;

/** Throws unless ns looks like a versioned namespace such as "register3". */
export function assertNamespace(ns: string): void {
  if (typeof ns !== "string" || !NAMESPACE_RE.test(ns)) {
    throw new Error("Cache namespace must match " + String(NAMESPACE_RE) + ": " + String(ns));
  }
}

/** Clamp to 60..21600 seconds; a non-finite or zero value becomes the minimum. */
export function clampTtl(sec: number): number {
  const n = Math.round(Number(sec));
  if (!Number.isFinite(n) || n <= 0) return TTL_MIN_SEC;
  return Math.min(TTL_MAX_SEC, Math.max(TTL_MIN_SEC, n));
}

/** Pure chunk split; an empty string is one empty chunk so a value always has a chunk. */
export function splitChunks(s: string, size = CHUNK_CHARS): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out.length ? out : [""];
}

/** A small non-cryptographic checksum (FNV-1a, 32 bit) as hex. */
export function checksum(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

export interface CacheOptions {
  prefix: string;
  epoch: number | string;
  cache?: () => GoogleAppsScript.Cache.Cache;
  /**
   * Strings no key or value may contain, compared without case; each one shorter than 3
   * characters is ignored. A matching write is skipped and logged, never thrown. A getter that
   * throws or answers anything but an array of strings skips every write (fail closed). A
   * tripwire for the literal address, not a control.
   */
  forbid?: () => string[];
  /** Most chunks one value may take. Default MAX_CHUNKS; a lower value is for tests. Clamped to 1..MAX_CHUNKS; a non-integer reads as the default. */
  maxChunks?: number;
}

export interface Cache {
  /** The cached value, or undefined on a miss. The value is shared: treat it as read-only. */
  get(ns: string, key: string): unknown | undefined;
  /** The same as get, never computes: named for doGet paths that only inline a warm value. */
  peek(ns: string, key: string): unknown | undefined;
  put(ns: string, key: string, value: unknown, ttlSec: number): void;
  /**
   * The cached value, else fn() stored and returned. A miss logs one JSON line
   * {cache, hit:false, ms, chars}: compute milliseconds and stored characters (0 when the write
   * failed). A failed write is a warning, never a throw.
   */
  getOrCompute<T>(ns: string, key: string, ttlSec: number | (() => number), fn: () => T): T;
  /** Compute fn() and write it over the old entry (no remove first, so readers never see a gap). */
  refresh<T>(ns: string, key: string, ttlSec: number | (() => number), fn: () => T): T;
  remove(ns: string, key: string): void;
}

interface Head { n: number; sum: string }

/** How a key is named in a log line or an error: the namespace and a short hash, never the text. */
export function keyRef(ns: string, key: string): string {
  return String(ns) + "#" + checksum(String(key));
}

const FORBID_MIN = 3;

export function createCache(opts: CacheOptions): Cache {
  const store = opts.cache ?? (() => CacheService.getScriptCache());
  const maxChunks =
    typeof opts.maxChunks === "number" && Number.isInteger(opts.maxChunks) ? Math.min(MAX_CHUNKS, Math.max(1, opts.maxChunks)) : MAX_CHUNKS;
  // Per-execution memory, by full key. Tied to the CacheService global it was filled under.
  const mem = new Map<string, unknown>();
  let memOwner: unknown = null;
  let memGen = -1;
  function memory(): Map<string, unknown> {
    const owner = (globalThis as { CacheService?: unknown }).CacheService;
    const gen = executionGeneration();
    if (owner !== memOwner || gen !== memGen) {
      mem.clear();
      memOwner = owner;
      memGen = gen;
    }
    return mem;
  }

  function fullKey(ns: string, key: string): string {
    assertNamespace(ns);
    const k = opts.prefix + ".e" + opts.epoch + "." + ns + "." + key;
    if (k.length + SUFFIX_RESERVE > KEY_MAX) {
      throw new Error("Cache key too long (" + k.length + " characters, limit " + (KEY_MAX - SUFFIX_RESERVE) + "): " + keyRef(ns, key));
    }
    return k;
  }

  /** True when forbid() says this write must be skipped (a match, or a getter that is not usable). */
  function forbidden(key: string, json: string): boolean {
    if (!opts.forbid) return false;
    let list: unknown;
    try {
      list = opts.forbid();
    } catch {
      return true;
    }
    if (!Array.isArray(list) || !list.every((x) => typeof x === "string")) return true;
    const words = (list as string[]).map((x) => x.trim().toLowerCase()).filter((x) => x.length >= FORBID_MIN);
    if (words.length === 0) return false;
    const k = String(key).toLowerCase();
    const body = json.toLowerCase();
    return words.some((w) => k.includes(w) || body.includes(w));
  }

  /** A skipped write: no entry under the key (an older one is removed) and one log line. */
  function skip(ns: string, key: string, k: string): void {
    memory().delete(k);
    try {
      store().remove(k + ":m"); // without its head an old entry is a miss; its chunks expire
    } catch {
      // best-effort
    }
    try {
      console.warn(JSON.stringify({ cache: ns, key: keyRef(ns, key), skipped: "forbidden" }));
    } catch {
      // best-effort
    }
  }

  function names(k: string, n: number): string[] {
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(k + ":" + i);
    return out;
  }

  function drop(k: string, n: number): void {
    try {
      store().removeAll([k + ":m", ...names(k, n)]);
    } catch {
      // cleanup is best-effort
    }
  }

  function readEntry(k: string): unknown | undefined {
    const c = store();
    const raw = c.get(k + ":m");
    if (!raw) return undefined;
    let head: Head;
    try {
      head = JSON.parse(raw) as Head;
    } catch {
      drop(k, 0);
      return undefined;
    }
    const n = head && head.n;
    if (!Number.isInteger(n) || n < 1 || n > maxChunks || typeof head.sum !== "string") {
      drop(k, 0);
      return undefined;
    }
    const want = names(k, n);
    const got = c.getAll(want);
    let packed = "";
    for (const name of want) {
      const chunk = got[name];
      if (chunk === undefined || chunk === null) {
        drop(k, n);
        return undefined;
      }
      packed += chunk;
    }
    if (checksum(packed) !== head.sum) {
      drop(k, n);
      return undefined;
    }
    try {
      const bytes = Utilities.base64Decode(packed);
      const blob = Utilities.newBlob(bytes, "application/x-gzip");
      return JSON.parse(Utilities.ungzip(blob).getDataAsString()) as unknown;
    } catch {
      drop(k, n);
      return undefined;
    }
  }

  function get(ns: string, key: string): unknown | undefined {
    const k = fullKey(ns, key);
    const m = memory();
    if (m.has(k)) return m.get(k);
    try {
      const v = readEntry(k);
      if (v !== undefined) m.set(k, v);
      return v;
    } catch (e) {
      console.warn("Cache read failed for " + keyRef(ns, key) + ": " + String(e));
      return undefined;
    }
  }

  /** Write one entry; returns the characters stored (0 when there was nothing to store or forbid skipped it). */
  function write(ns: string, key: string, value: unknown, ttlSec: number): number {
    const k = fullKey(ns, key);
    const json = JSON.stringify(value);
    if (json === undefined) return 0;
    if (forbidden(key, json)) {
      skip(ns, key, k);
      return 0;
    }
    const gz = Utilities.gzip(Utilities.newBlob(json, "application/json"));
    const chunks = splitChunks(Utilities.base64Encode(gz.getBytes()));
    // readEntry treats a head above the cap as malformed, so writing one would only be dropped
    // again on every read. Refuse it up front.
    if (chunks.length > maxChunks) {
      throw new Error("Cache value too large (" + chunks.length + " chunks, limit " + maxChunks + "): " + keyRef(ns, key));
    }
    const head: Head = { n: chunks.length, sum: checksum(chunks.join("")) };
    const entries: Record<string, string> = { [k + ":m"]: JSON.stringify(head) };
    chunks.forEach((c, i) => { entries[k + ":" + i] = c; });
    store().putAll(entries, clampTtl(ttlSec));
    memory().set(k, value);
    let chars = 0;
    for (const c of chunks) chars += c.length;
    return chars;
  }

  function put(ns: string, key: string, value: unknown, ttlSec: number): void {
    write(ns, key, value, ttlSec);
  }

  function remove(ns: string, key: string): void {
    const k = fullKey(ns, key);
    memory().delete(k);
    const c = store();
    let n = 0;
    try {
      const raw = c.get(k + ":m");
      if (raw) {
        const h = Number((JSON.parse(raw) as Head).n);
        n = Number.isInteger(h) && h >= 1 && h <= MAX_CHUNKS ? h : 0;
      }
    } catch {
      n = 0;
    }
    c.removeAll([k + ":m", ...names(k, n)]);
  }

  /** Compute and store; a failed write is a warning and the value is still kept for this execution. */
  function computeAndStore<T>(ns: string, key: string, ttlSec: number | (() => number), fn: () => T): { value: T; ms: number; chars: number } {
    const t0 = Date.now();
    const value = fn();
    const ms = Date.now() - t0;
    let chars = 0;
    try {
      chars = write(ns, key, value, typeof ttlSec === "function" ? ttlSec() : ttlSec);
    } catch (e) {
      console.warn("Cache write failed for " + keyRef(ns, key) + ": " + String(e));
      if (value !== undefined) memory().set(fullKey(ns, key), value);
    }
    return { value, ms, chars };
  }

  function getOrCompute<T>(ns: string, key: string, ttlSec: number | (() => number), fn: () => T): T {
    const hit = get(ns, key);
    if (hit !== undefined) return hit as T;
    const r = computeAndStore(ns, key, ttlSec, fn);
    console.log(JSON.stringify({ cache: ns, hit: false, ms: r.ms, chars: r.chars }));
    return r.value;
  }

  function refresh<T>(ns: string, key: string, ttlSec: number | (() => number), fn: () => T): T {
    fullKey(ns, key);
    return computeAndStore(ns, key, ttlSec, fn).value;
  }

  return { get, peek: get, put, getOrCompute, refresh, remove };
}
