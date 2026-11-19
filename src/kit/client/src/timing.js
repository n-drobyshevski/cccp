// Extracted from the author's production Apps Script apps; adapted.
// Timing helpers. A page may register cleanups that run when the router leaves it (the router
// calls runPageTeardown() on every navigation); a page-scoped debounce cancels itself there, so
// a timer never fires into a page that is gone. Teardown clears the registry, so create a
// pageScoped debounce per page mount, not once at module level.

/** @type {Set<() => void>} */
const cleanups = new Set();

/**
 * Register a cleanup for the current page. Returns a function that unregisters it.
 * @param {() => void} fn
 * @returns {() => void}
 */
export function onPageTeardown(fn) {
  cleanups.add(fn);
  return () => { cleanups.delete(fn); };
}

/** Run and clear every registered cleanup. A cleanup that throws is logged, not rethrown. */
export function runPageTeardown() {
  const list = Array.from(cleanups);
  cleanups.clear();
  for (const fn of list) {
    try { fn(); } catch (e) { if (typeof console !== "undefined") console.warn("page teardown failed", e); }
  }
}

/**
 * Trailing debounce. The result has cancel() and a pending flag. With { pageScoped: true } the
 * pending call is cancelled when the page tears down.
 * @template {any[]} A
 * @param {(...args: A) => void} fn
 * @param {number} ms
 * @param {{ pageScoped?: boolean }} [opts]
 * @returns {((...args: A) => void) & { cancel: () => void, readonly pending: boolean }}
 */
export function debounce(fn, ms, opts) {
  /** @type {any} */
  let timer = null;
  let off = /** @type {null | (() => void)} */ (null);
  const cancel = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
  };
  /** @param {A} args */
  const run = (...args) => {
    cancel();
    timer = setTimeout(() => { timer = null; fn(...args); }, ms);
  };
  if (opts && opts.pageScoped) off = onPageTeardown(cancel);
  const out = /** @type {any} */ (run);
  out.cancel = () => { cancel(); if (off) { off(); off = null; } };
  // A getter, so pending reflects the timer now (Object.assign would copy its value once).
  Object.defineProperty(out, "pending", { get: () => timer !== null });
  return out;
}
