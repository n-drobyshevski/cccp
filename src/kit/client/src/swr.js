// Extracted from the author's production Apps Script apps; adapted.
// Stale-while-revalidate over an RPC function. A revisit resolves at once from memory (or from
// storage, across page loads) while the call is repeated in the background; onFresh fires only
// when the revalidated payload really differs. A hit whose first fetch is still in flight is
// shared, not duplicated. A failed background refresh keeps the stale value; a failed first
// fetch leaves nothing behind. A forbidden answer (an error whose kind is "forbidden", as
// RpcError gives after a revocation or a role change) removes every entry of the scope (each
// key, not only the refused one) from memory, storage and the index, and fences every fetch
// still in flight, before the error is passed on, so no role-gated payload from before the
// change is shown again. Persisted entries
// of the current scope older than maxAgeMs are swept when the instance is created.

/**
 * @typedef {{ data: any, stale: boolean, refresh: () => Promise<any> }} SwrResult
 * @typedef {{ get: (key: string) => any, set: (key: string, value: any) => boolean, remove: (key: string) => boolean }} SwrStorage
 */


/**
 * @param {{
 *   call: (name: string, params?: any) => Promise<any>,
 *   storage?: SwrStorage | null,
 *   ttlMs?: number,
 *   maxAgeMs?: number,
 *   version?: string,
 *   viewer?: string,
 *   now?: () => number,
 * }} opts
 * @returns {{
 *   cached: (name: string, params?: any, o?: { onFresh?: (data: any) => void }) => Promise<SwrResult>,
 *   invalidate: (name?: string) => void,
 * }}
 */
export function createSwr(opts) {
  const ttl = opts.ttlMs === undefined ? 60000 : opts.ttlMs;
  // A stored entry older than maxAgeMs is never served, however stale-while-revalidate would
  // like to (default one day). Pass Infinity to disable.
  const maxAge = opts.maxAgeMs === undefined ? 86400000 : opts.maxAgeMs;
  const now = opts.now || (() => Date.now());
  // Persisted entries live under a scope of version (for example the build id plus a namespace)
  // and viewer (so a role-gated payload is not shown to another account on the same browser
  // profile). A different scope is a miss, and its old keys are pruned.
  // With storage, `viewer` should be given: leaving it out shares role-gated payloads between
  // accounts on one browser profile. This is warned about rather than thrown so an existing
  // caller keeps working; pass "" explicitly for an app with no per-viewer data.
  if (opts.storage && opts.viewer === undefined && typeof console !== "undefined") {
    console.warn("createSwr: storage is set without a viewer; persisted payloads are shared by every account on this browser profile. Pass viewer (or an empty string to confirm).");
  }
  const scope = encodeURIComponent(String(opts.version || "")) + "|" + encodeURIComponent(String(opts.viewer || ""));
  const sid = (/** @type {string} */ key) => scope + "|" + key;
  const storage = opts.storage || null;
  /** @type {Map<string, { data: any, at: number } | { p: Promise<any>, pending: true }>} */
  const mem = new Map();

  let epoch = 0;
  /** @type {Map<string, number>} */
  const seqs = new Map();

  /** @param {string} name @param {any} params */
  const keyOf = (name, params) => name + ":" + JSON.stringify(params === undefined ? {} : params);

  // One index per scope, so instances with different versions never touch each other's entries.
  const INDEX_KEY = "swr.index:" + scope;
  /** @returns {string[]} */
  function readIndex() {
    const v = storage ? storage.get(INDEX_KEY) : null;
    return Array.isArray(v) ? v : [];
  }

  /** @param {string} id */
  function dropFromIndex(id) {
    const idx = readIndex();
    const i = idx.indexOf(id);
    if (i >= 0) { idx.splice(i, 1); /** @type {SwrStorage} */ (storage).set(INDEX_KEY, idx); }
  }

  /** @param {string} key @param {any} data @param {number} at */
  function persist(key, data, at) {
    if (!storage) return;
    // A write the browser refused leaves nothing to index.
    if (!storage.set("swr:" + sid(key), { at, data })) return;
    const idx = readIndex();
    if (idx.indexOf(sid(key)) < 0) { idx.push(sid(key)); storage.set(INDEX_KEY, idx); }
  }

  /** Forget one key everywhere and fence any fetch of it still in flight. @param {string} key */
  function drop(key) {
    mem.delete(key);
    seqs.set(key, (seqs.get(key) || 0) + 1);
    if (!storage) return;
    storage.remove("swr:" + sid(key));
    dropFromIndex(sid(key));
  }

  /**
   * A forbidden answer: the viewer lost a role, so every payload of the scope may be one it can
   * no longer see. Forget them all, in memory and in storage, drop the index, and fence every
   * fetch still in flight (the epoch) so none is stored after this.
   */
  function dropScope() {
    epoch++;
    mem.clear();
    if (!storage) return;
    for (const id of readIndex()) if (typeof id === "string") storage.remove("swr:" + id);
    storage.set(INDEX_KEY, []);
  }

  /** @param {string} key */
  function fromStorage(key) {
    if (!storage) return null;
    const v = storage.get("swr:" + sid(key));
    if (!v || typeof v !== "object" || typeof v.at !== "number") return null;
    if (now() - v.at > maxAge) { storage.remove("swr:" + sid(key)); dropFromIndex(sid(key)); return null; }
    return v;
  }

  // A global registry of scopes (scope -> last seen ms) under one key. A scope not seen within
  // maxAge is dead (an old build or viewer): its entries and index are deleted. Other live scopes
  // are never touched.
  const SCOPES_KEY = "swr.scopes";
  function pruneScopes() {
    if (!storage) return;
    const raw = storage.get(SCOPES_KEY);
    /** @type {Record<string, number>} */
    const seen = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const t = now();
    for (const other of Object.keys(seen)) {
      if (other === scope) continue;
      const at = seen[other];
      if (typeof at === "number" && t - at <= maxAge) continue;
      const idxKey = "swr.index:" + other;
      const idx = storage.get(idxKey);
      if (Array.isArray(idx)) for (const id of idx) if (typeof id === "string") storage.remove("swr:" + id);
      storage.remove(idxKey);
      delete seen[other];
    }
    seen[scope] = t;
    storage.set(SCOPES_KEY, seen);
    // The current scope's own entries are swept too: one that is never read again would
    // otherwise stay in storage for good.
    const idx = readIndex();
    const keep = idx.filter((id) => {
      if (typeof id !== "string") return false;
      const v = storage.get("swr:" + id);
      if (v && typeof v === "object" && typeof v.at === "number" && t - v.at <= maxAge) return true;
      storage.remove("swr:" + id);
      return false;
    });
    if (keep.length !== idx.length) storage.set(INDEX_KEY, keep);
  }
  pruneScopes();

  /**
   * Resolves { data, live }: live is false when the result was fenced (an invalidate() ran, or a
   * newer fetch of the key started) and so was returned unstored.
   * @param {string} name @param {any} params @param {string} key
   * @returns {Promise<{ data: any, live: boolean }>}
   */
  function fetchRaw(name, params, key) {
    // A result is written only if no invalidate() ran and no newer fetch of the key started
    // since this one began; otherwise it may carry pre-save data and is returned unstored.
    const startEpoch = epoch;
    const seq = (seqs.get(key) || 0) + 1;
    seqs.set(key, seq);
    return opts.call(name, params).then((data) => {
      if (startEpoch !== epoch || seqs.get(key) !== seq) return { data, live: false };
      const at = now();
      mem.set(key, { data, at });
      persist(key, data, at);
      return { data, live: true };
    }, (e) => {
      if (e && /** @type {any} */ (e).kind === "forbidden") dropScope();
      throw e;
    });
  }

  /** @param {string} name @param {any} params @param {string} key @returns {Promise<any>} */
  function fetchFresh(name, params, key) {
    return fetchRaw(name, params, key).then((r) => r.data);
  }

  /**
   * @param {string} name
   * @param {any} [params]
   * @param {{ onFresh?: (data: any) => void }} [o]
   * @returns {Promise<SwrResult>}
   */
  function cached(name, params, o) {
    const key = keyOf(name, params);
    const refresh = () => fetchFresh(name, params, key);
    let hit = mem.get(key);
    if (!hit) {
      const s = fromStorage(key);
      if (s) { hit = { data: s.data, at: s.at }; mem.set(key, hit); }
    }
    if (!hit) {
      /** @type {{ p: Promise<any>, pending: true }} */
      const slot = { p: /** @type {any} */ (null), pending: true };
      slot.p = fetchFresh(name, params, key).catch((e) => { if (mem.get(key) === slot) mem.delete(key); throw e; });
      const p = slot.p;
      mem.set(key, slot);
      return p.then((data) => ({ data, stale: false, refresh }));
    }
    if ("pending" in hit) return hit.p.then((data) => ({ data, stale: false, refresh }));
    const entry = hit;
    const stale = now() - entry.at > ttl;
    if (stale) {
      fetchRaw(name, params, key).then(
        (r) => {
          // A fenced result is never announced: it may carry pre-save data.
          if (r.live && o && o.onFresh && JSON.stringify(r.data) !== JSON.stringify(entry.data)) o.onFresh(r.data);
        },
        () => { /* a failed background refresh keeps the stale value */ },
      );
    }
    return Promise.resolve({ data: entry.data, stale, refresh });
  }

  /**
   * Forget cached answers: all of them, or those of one endpoint.
   * @param {string} [name]
   */
  function invalidate(name) {
    const match = (/** @type {string} */ k) => !name || k.indexOf(name + ":") === 0;
    epoch++;
    for (const k of Array.from(mem.keys())) if (match(k)) mem.delete(k);
    if (!storage) return;
    const keep = [];
    const mine = scope + "|";
    for (const id of readIndex()) {
      const k = typeof id === "string" && id.indexOf(mine) === 0 ? id.slice(mine.length) : null;
      if (k !== null && match(k)) storage.remove("swr:" + id);
      else keep.push(id);
    }
    storage.set(INDEX_KEY, keep);
  }

  return { cached, invalidate };
}
