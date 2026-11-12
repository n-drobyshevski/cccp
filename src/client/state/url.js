// The URL bridge. Inside the Apps Script frame the address bar belongs to the parent page, so
// the app talks to it through google.script.history and google.script.url. A page change
// pushes a history entry; a filter, sort or metric change replaces the current one; Back
// arrives through the change listener. Nothing writes an in-iframe hash.
import { defaultState, fromParams, parseQuery, toQuery } from "../../domain/viewState";
import { store } from "./store.js";

/** Routes whose state carries the list filters in the URL. */
const FILTERED = ["list", "heatmap", "landscape"];
const LOCATION_TIMEOUT_MS = 400;

let lastQuery = null;
let applying = false;
let defaultRoute = "list";
let onApplied = null;

const bridge = () => (typeof google !== "undefined" && google.script ? google.script : null);

/** The view state a URL for this store state would carry. */
export function stateOf(s) {
  const d = defaultState(s.route);
  if (FILTERED.indexOf(s.route) < 0) return d;
  return { route: s.route, q: s.q, f: s.f, sort: s.sort, desc: s.desc, cols: s.cols, metric: s.metric };
}

function linkOf(s) {
  const link = {};
  if (s.route === "app" && s.app) link.app = s.app;
  if (s.route === "settings" && s.tab) link.tab = s.tab;
  if (FILTERED.indexOf(s.route) >= 0 && s.view) link.view = s.view;
  return link;
}

/** The query string (no '?') for a store state. */
export function queryFor(s) {
  return toQuery(stateOf(s), linkOf(s));
}

/** The shareable address: the service URL plus the query. Empty when there is no service URL. */
export function linkFor(serviceUrl, s) {
  if (!serviceUrl) return "";
  const q = queryFor(s);
  return serviceUrl + (q ? "?" + q : "");
}

/** What a parsed location changes in the store. */
export function patchFromParams(params) {
  const p = fromParams(params || {});
  let route = p.state.route;
  if (p.app && (route === "" || route === "app")) route = "app";
  if (route === "app" && !p.app) route = "";
  if (route === "" && p.view) route = "list";
  if (route === "") route = defaultRoute;
  return {
    route,
    app: route === "app" ? p.app || null : null,
    tab: p.tab || null,
    view: p.view || null,
    q: p.state.q,
    f: p.state.f,
    sort: p.state.sort,
    desc: p.state.desc,
    cols: p.state.cols,
    metric: p.state.metric,
  };
}

function write(kind, s) {
  const b = bridge();
  const q = queryFor(s);
  if (q === lastQuery) return false;
  lastQuery = q;
  if (b && b.history && typeof b.history[kind] === "function") b.history[kind](null, parseQuery(q), "");
  return true;
}

/**
 * Apply a patch to the store and record it in the address: mode 'push' for a page change,
 * 'replace' for a filter-like change, 'none' to leave the URL alone.
 */
export function navigate(patch, mode) {
  const next = { ...store.get(), ...patch };
  if (mode === "push" || mode === "replace") write(mode, next);
  store.set(patch);
}

export const push = (patch) => navigate(patch, "push");
export const replace = (patch) => navigate(patch, "replace");

/** Read google.script.url.getLocation, giving up after 400 ms. Resolves a parameter map. */
export function readLocation(timeoutMs) {
  return new Promise((resolve) => {
    const b = bridge();
    if (!b || !b.url || typeof b.url.getLocation !== "function") { resolve({}); return; }
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const t = setTimeout(() => finish({}), timeoutMs == null ? LOCATION_TIMEOUT_MS : timeoutMs);
    try {
      b.url.getLocation((loc) => { clearTimeout(t); finish((loc && loc.parameter) || {}); });
    } catch (e) { clearTimeout(t); finish({}); }
  });
}

/**
 * Read the address into the store and listen for Back and Forward. `fallbackRoute` is the
 * route a bare address opens (the Display default). `afterApply` runs after a Back/Forward
 * location has been applied.
 */
export function init(opts) {
  const o = opts || {};
  defaultRoute = o.fallbackRoute || "list";
  onApplied = o.afterApply || null;
  return readLocation(o.timeoutMs).then((params) => {
    const patch = patchFromParams(params);
    applying = true;
    try { store.set(patch); } finally { applying = false; }
    lastQuery = queryFor(store.get());
    const b = bridge();
    if (b && b.history && typeof b.history.setChangeHandler === "function") {
      b.history.setChangeHandler((ev) => {
        const next = patchFromParams(ev && ev.location ? ev.location.parameter : {});
        applying = true;
        try { store.set(next); } finally { applying = false; }
        lastQuery = queryFor(store.get());
        if (onApplied) onApplied(store.get());
      });
    }
    return patch;
  });
}

/** True while a Back or Forward location is being applied (nothing may write the URL then). */
export const isApplying = () => applying;

/** Test seam: forget what was written last. */
export function resetUrlState() {
  lastQuery = null;
  applying = false;
  defaultRoute = "list";
  onApplied = null;
}
