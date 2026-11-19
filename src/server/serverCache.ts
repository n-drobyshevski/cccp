// Cross-request cache for the register and the bootstrap core: the kit's createCache (JSON, gzip,
// base64, 90 000-character chunks plus a checksummed head record, TTL clamped to 60..21600) and
// the three version counters the keys carry.
//
//   register  register1 . <DATA_VERSION>
//   core      core1     . <DATA_VERSION>.<CFG_GEN>.<VIEWS_GEN>
//   headers   headers1  . <DATA_VERSION>.<checksum of the probe>
//
// Invalidation is version-in-key: a bump makes every older entry unreachable and it ages out by
// TTL. Nothing per-viewer is EVER cached: keys carry no identity and callers cache only
// viewer-free values. Any cache failure degrades to compute() inside the kit.
//
// No forbid() hook: the register is the source sheet's rows and the core holds the public
// settings and shared views, and both legitimately contain addresses. A hook that refuses a write
// holding the caller's address would let anyone who can edit the sheet keep chosen people out on a
// cold cache. Viewer-freedom is pinned by the viewerFreeCore contract and test/server/bootstrap.test.ts.

import { checksum, createCache, getProp, setProp, TTL_MIN_SEC } from "@gas-kit/server";
import { CACHE_EPOCH, CACHE_PREFIX, PROP_KEYS } from "./config";

export { TTL_MIN_SEC };

export const cache = createCache({ prefix: CACHE_PREFIX, epoch: CACHE_EPOCH });

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

/** The register's key within register1: freshness depends on the data only. */
export function registerKey(): string {
  return String(dataVersion());
}

/** The core's key within core1: freshness depends on the data, the settings and the shared views. */
export function coreKey(): string {
  return dataVersion() + "." + cfgGen() + "." + viewsGen();
}

/** A key for a cached answer that depends on parameters: the data version, a checksum of the parameters and their length. */
export function paramsKey(params: unknown): string {
  const json = JSON.stringify(params ?? null);
  return dataVersion() + "." + checksum(json) + "." + json.length.toString(36);
}
