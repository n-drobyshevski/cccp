// Cross-request cache for the register and the bootstrap core, over CacheService.
//
// Derived from sidekick gas_ai/src/server/serverCache.ts at commit 77bcf22 (see VENDOR.md).
// Removed: the second (Wiz) version, the domain-tag stamp and the L2. The prefix is 'cccp', the
// version counters are DATA_VERSION and CFG_GEN, and each caller passes a TTL clamped to
// 60..21600 seconds.
//
//   register key  cccp:<EPOCH>:<DATA_VERSION>:register
//   core key      cccp:<EPOCH>:<DATA_VERSION>.<CFG_GEN>.<VIEWS_GEN>:core
//
// Invalidation is version-in-key: a bump makes every older entry unreachable and it ages out
// by TTL. Nothing per-viewer is EVER cached: keys carry no identity and callers cache only
// viewer-free values. CacheService caps a value at 100 KB, so a payload is gzip+base64 and
// split into chunks under `<key>:0..n-1` with a `<key>:m` count. Any cache failure degrades to
// compute().

import { sha1Hex } from "../vendor/gas_shared/domain/sha1";
import { getProp, PROP_KEYS, setProp } from "./props";

/** Bump to make every cached entry unreachable on the next deploy. */
export const CACHE_EPOCH = "1";
const KEY_PREFIX = "cccp:" + CACHE_EPOCH;
const CHUNK_CHARS = 90_000;
export const TTL_MIN_SEC = 60;
export const TTL_MAX_SEC = 21_600;

/** Which counters an entry's freshness depends on. */
export type CacheScope = "data" | "cfg";

const clampTtl = (s: number): number => Math.min(TTL_MAX_SEC, Math.max(TTL_MIN_SEC, Math.round(s) || TTL_MIN_SEC));

function counter(key: string): number {
  const n = Number(getProp(key));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** The register's version. Bumped by a reload and by a source or fields save. */
export function dataVersion(): number {
  return counter(PROP_KEYS.dataVersion);
}

/** The settings generation, the save base of api_saveSettings. Bumped by every settings save. */
export function cfgGen(): number {
  return counter(PROP_KEYS.cfgGen);
}

/** The shared-views generation: part of the core key, but not the settings save base. */
export function viewsGen(): number {
  return counter(PROP_KEYS.viewsGen);
}

export function bumpViewsGen(): number {
  const n = viewsGen() + 1;
  setProp(PROP_KEYS.viewsGen, String(n));
  return n;
}

export function bumpDataVersion(): number {
  const n = dataVersion() + 1;
  setProp(PROP_KEYS.dataVersion, String(n));
  return n;
}

export function bumpCfgGen(): number {
  const n = cfgGen() + 1;
  setProp(PROP_KEYS.cfgGen, String(n));
  return n;
}

/** Params as a short stable hash; absent params add nothing to the key. */
export function paramsHash(params: unknown): string {
  return sha1Hex(JSON.stringify(params ?? null)).slice(0, 12);
}

export function cacheKey(name: string, params: unknown, scope: CacheScope = "data"): string {
  const v = scope === "cfg" ? dataVersion() + "." + cfgGen() + "." + viewsGen() : String(dataVersion());
  return KEY_PREFIX + ":" + v + ":" + name + (params === undefined ? "" : ":" + paramsHash(params));
}

/** Pure chunk split (exported for tests). */
export function splitChunks(s: string, size = CHUNK_CHARS): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out.length ? out : [""];
}

export function cachePutJson(key: string, value: unknown, ttlSec: number, chunkChars = CHUNK_CHARS): number {
  const json = JSON.stringify(value);
  const gz = Utilities.gzip(Utilities.newBlob(json, "application/json"));
  const chunks = splitChunks(Utilities.base64Encode(gz.getBytes()), chunkChars);
  const entries: Record<string, string> = { [key + ":m"]: String(chunks.length) };
  chunks.forEach((c, i) => { entries[key + ":" + i] = c; });
  CacheService.getScriptCache().putAll(entries, clampTtl(ttlSec));
  return json.length;
}

/** The cached value, or undefined on a miss, a partial eviction or a parse failure. */
export function cacheGetJson(key: string): unknown | undefined {
  const cache = CacheService.getScriptCache();
  const meta = cache.get(key + ":m");
  if (!meta) return undefined;
  const n = Number(meta);
  if (!Number.isInteger(n) || n < 1) return undefined;
  const names: string[] = [];
  for (let i = 0; i < n; i++) names.push(key + ":" + i);
  const got = cache.getAll(names);
  let packed = "";
  for (const name of names) {
    const chunk = got[name];
    if (chunk === undefined || chunk === null) return undefined;
    packed += chunk;
  }
  const json = Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(packed), "application/x-gzip")).getDataAsString("UTF-8");
  return JSON.parse(json);
}

/**
 * Version-keyed read-through cache. `ttlSec` may be a function, called only on a miss, so a
 * hit never pays for reading the settings that decide it. A cache-layer error falls back to
 * compute(): caching is an optimisation, never a correctness dependency.
 */
export function cached<T>(
  name: string, params: unknown, compute: () => T, ttlSec: number | (() => number), scope: CacheScope = "data",
): T {
  let key: string | null = null;
  try {
    key = cacheKey(name, params, scope);
    const hit = cacheGetJson(key);
    if (hit !== undefined) return hit as T;
  } catch (e) {
    console.warn("Cache read failed for " + name + ": " + e);
    key = null;
  }
  const value = compute();
  if (key) {
    try {
      cachePutJson(key, value, typeof ttlSec === "function" ? ttlSec() : ttlSec);
    } catch (e) {
      console.warn("Cache write failed for " + name + ": " + e);
    }
  }
  return value;
}

/** What cached() would return, without computing on a miss: undefined on a miss or any error. */
export function peekCached(name: string, params: unknown, scope: CacheScope = "data"): unknown | undefined {
  try {
    return cacheGetJson(cacheKey(name, params, scope));
  } catch (e) {
    console.warn("Cache peek failed for " + name + ": " + e);
    return undefined;
  }
}

/** Store what cached() would have stored. Best-effort. */
export function primeCached(name: string, params: unknown, value: unknown, ttlSec: number, scope: CacheScope = "data"): void {
  try {
    cachePutJson(cacheKey(name, params, scope), value, ttlSec);
  } catch (e) {
    console.warn("Cache write failed for " + name + ": " + e);
  }
}
