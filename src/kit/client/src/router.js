// Extracted from the author's production Apps Script apps; adapted.
// A hash router with a sequence guard. Patterns look like "/item/:id". Each navigation tears
// down the previous page, then mounts the next; a mount that resolves after a newer navigation
// has begun is discarded (its teardown runs at once), so a slow page never paints over a fast
// one only if the page honours ctx.current(): an async mount must check it after every await and
// before renderRegion, because the router cannot stop a page from painting into the live region.
// Each navigation also runs the page-scoped timing cleanups (timing.js) and closes any open tip.
import { buildHash, parseHash } from "./url.js";
import { runPageTeardown } from "./timing.js";
import { closeTips } from "./tip.js";
import { renderRegion } from "./dom.js";
import { raw } from "./html.js";

/**
 * @typedef {(el: Element, params: Record<string, string>, ctx: { query: Record<string, string>, path: string, current: () => boolean }) => (void | (() => void) | Promise<void | (() => void)>)} Mount
 * @typedef {{ mount: Mount }} Route
 */

/**
 * @param {string} pattern
 * @returns {(path: string) => Record<string, string> | null}
 */
function compile(pattern) {
  const segs = pattern.replace(/^#?\/?/, "").split("/").filter(Boolean);
  return (path) => {
    const parts = path.split("/").filter(Boolean);
    if (parts.length !== segs.length) return null;
    /* Null prototype: a route without :constructor has no params.constructor. */
    /** @type {Record<string, string>} */
    const params = Object.create(null);
    for (let i = 0; i < segs.length; i++) {
      if (segs[i].charAt(0) === ":") {
        try { params[segs[i].slice(1)] = decodeURIComponent(parts[i]); } catch (e) { params[segs[i].slice(1)] = parts[i]; }
      } else if (segs[i] !== parts[i]) return null;
    }
    return params;
  };
}

/**
 * @param {{
 *   routes: Record<string, Route>,
 *   el: Element,
 *   notFound?: Mount,
 *   defaultPath?: string,
 *   win?: any,
 *   onError?: (e: unknown) => void,
 * }} opts
 * @returns {{
 *   start: () => void,
 *   stop: () => void,
 *   navigate: (path: string, query?: Record<string, unknown>) => void,
 *   current: () => { path: string, params: Record<string, string> } | null,
 * }}
 */
export function createRouter(opts) {
  const win = opts.win || /** @type {any} */ (globalThis).window;
  const table = Object.keys(opts.routes).map((p) => ({ match: compile(p), route: opts.routes[p] }));
  const onError = opts.onError || ((e) => { if (typeof console !== "undefined") console.error(e); });
  let seq = 0;
  /** @type {null | (() => void)} */
  let teardown = null;
  /** @type {{ path: string, params: Record<string, string> } | null} */
  let here = null;
  let listening = false;

  function runTeardown() {
    const t = teardown;
    teardown = null;
    if (t) { try { t(); } catch (e) { onError(e); } }
  }

  async function route() {
    const mine = ++seq;
    runTeardown();
    runPageTeardown();
    closeTips();
    const parsed = parseHash(win.location.hash);
    const path = parsed.path || String(opts.defaultPath || "").replace(/^\/+/, "");
    /** @type {Mount | null} */
    let mount = null;
    /** @type {Record<string, string>} */
    let params = Object.create(null);
    for (const r of table) {
      const m = r.match(path);
      if (m) { mount = r.route.mount; params = m; break; }
    }
    if (!mount) mount = opts.notFound || null;
    here = { path, params };
    if (!mount) {
      // Nothing matched and there is no notFound: the previous page was torn down, so its
      // markup must not stay behind as a dead page.
      renderRegion(opts.el, raw("") /* the empty string is markup-free */);
      return;
    }
    try {
      const out = await mount(opts.el, params, { query: parsed.query, path, current: () => mine === seq });
      if (mine !== seq) {
        if (typeof out === "function") { try { out(); } catch (e) { onError(e); } }
        return;
      }
      if (typeof out === "function") teardown = out;
    } catch (e) {
      if (mine === seq) onError(e);
    }
  }

  const onHash = () => { void route(); };

  return {
    start() {
      if (!listening) { win.addEventListener("hashchange", onHash); listening = true; }
      void route();
    },
    stop() {
      if (listening) { win.removeEventListener("hashchange", onHash); listening = false; }
      seq++;
      runTeardown();
      runPageTeardown();
      closeTips();
    },
    navigate(path, query) {
      const next = buildHash(path, query);
      if (next === win.location.hash) { void route(); return; }
      win.location.hash = next;
      if (!listening) void route();
    },
    current: () => here,
  };
}
