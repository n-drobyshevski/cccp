// Extracted from the author's production Apps Script apps; adapted.
// A tiny synchronous store: set() shallow-merges a patch, and subscribers hear (state, prev)
// only when some key really changed.

/**
 * @template {Record<string, any>} S
 * @param {S | (() => S)} initial the first state, or a factory (reset() calls it again)
 * @returns {{
 *   get: () => S,
 *   set: (patch: Partial<S>) => S,
 *   subscribe: (fn: (state: S, prev: S) => void) => (() => void),
 *   reset: () => void,
 * }}
 */
export function createStore(initial) {
  const make = typeof initial === "function" ? /** @type {() => S} */ (initial) : () => ({ ...initial });
  let state = make();
  /** @type {Set<(state: S, prev: S) => void>} */
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      const prev = state;
      let changed = false;
      for (const k of Object.keys(patch)) {
        if (!Object.is(/** @type {any} */ (prev)[k], /** @type {any} */ (patch)[k])) { changed = true; break; }
      }
      if (!changed) return state;
      state = { ...prev, ...patch };
      for (const fn of Array.from(subs)) fn(state, prev);
      return state;
    },
    subscribe(fn) {
      subs.add(fn);
      return () => { subs.delete(fn); };
    },
    reset() {
      const prev = state;
      state = make();
      for (const fn of Array.from(subs)) fn(state, prev);
    },
  };
}
