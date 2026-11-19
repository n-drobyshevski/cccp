// Deep links that survive a reload inside the Apps Script iframe. The address bar belongs to the
// parent page, so state goes through google.script.history (push and replace) and is read back
// through google.script.url.getLocation. Without that bridge (dev server, tests) the bridge falls
// back to the hash helpers of url.js. Standalone helper: the app calls it, the router is untouched.
import { buildHash, parseHash } from "./url.js";

const DEFAULT_MAX_QUERY = 2000;
const DEFAULT_TIMEOUT_MS = 400;

/**
 * @typedef {Object} ScriptUrlHost
 * @property {any} [script] google.script (history and url members are optional)
 * @property {any} [location] a location-like object for the hash fallback
 * @property {any} [history] a History-like object for the hash fallback
 */

/**
 * @typedef {Object} ScriptUrlOptions
 * @property {Record<string, (value: string) => boolean | string | null | undefined>} schema
 *   Whitelist of allowed keys. A validator returns false/null/undefined to drop the value, a
 *   string to replace it (normalise), or true to keep it unchanged.
 * @property {number} [maxQuery] longest accepted query string (default 2000)
 * @property {number} [timeoutMs] how long to wait for getLocation (default 400)
 * @property {ScriptUrlHost} [host] injected globals (default globalThis)
 */

/**
 * Keep only whitelisted keys whose values pass their validator.
 * @param {Record<string, unknown> | null | undefined} params
 * @param {ScriptUrlOptions["schema"]} schema
 * @returns {Record<string, string>}
 */
export function sanitizeState(params, schema) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!params || typeof params !== "object") return out;
  for (const k of Object.keys(schema || {})) {
    if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
    const raw = /** @type {any} */ (params)[k];
    const v = Array.isArray(raw) ? raw[raw.length - 1] : raw;
    if (v == null || typeof v === "object" || typeof v === "function") continue;
    const s = String(v);
    if (s === "") continue;
    let ok;
    try { ok = schema[k](s); } catch (e) { ok = false; }
    if (ok === true) out[k] = s;
    else if (typeof ok === "string" && ok !== "") out[k] = ok;
  }
  return out;
}

/**
 * Encode a state as a query string (no leading question mark) in schema order. Empty values
 * and invalid or unknown keys are dropped; a key whose piece would push the result past maxQuery
 * is skipped and later, smaller keys are still kept.
 * @param {Record<string, unknown>} state
 * @param {ScriptUrlOptions["schema"]} schema
 * @param {number} [maxQuery]
 * @returns {string}
 */
export function encodeState(state, schema, maxQuery) {
  const cap = maxQuery == null ? DEFAULT_MAX_QUERY : maxQuery;
  const clean = sanitizeState(state, schema);
  let out = "";
  for (const k of Object.keys(schema)) {
    if (!(k in clean)) continue;
    const piece = encodeURIComponent(k) + "=" + encodeURIComponent(clean[k]);
    const len = out.length + (out ? 1 : 0) + piece.length;
    if (len > cap) continue;
    out += (out ? "&" : "") + piece;
  }
  return out;
}

/**
 * Size of a parameter map once encoded as a query string.
 * @param {any} params
 * @returns {number}
 */
function paramsSize(params) {
  if (!params || typeof params !== "object") return 0;
  let n = 0;
  for (const k of Object.keys(params)) {
    const raw = params[k];
    const list = Array.isArray(raw) ? raw : [raw];
    for (const v of list) {
      if (v == null || typeof v === "object" || typeof v === "function") continue;
      n += encodeURIComponent(k).length + 1 + encodeURIComponent(String(v)).length + 1;
    }
  }
  return Math.max(0, n - 1);
}

/**
 * Decode a query string into a sanitised state. Over-long queries are ignored whole.
 * @param {string} query
 * @param {ScriptUrlOptions["schema"]} schema
 * @param {number} [maxQuery]
 * @returns {Record<string, string>}
 */
export function decodeState(query, schema, maxQuery) {
  const cap = maxQuery == null ? DEFAULT_MAX_QUERY : maxQuery;
  const q = String(query || "").replace(/^\?/, "");
  if (q.length > cap) return {};
  return sanitizeState(parseHash("#/?" + q).query, schema);
}

/**
 * Create the bridge.
 * @param {ScriptUrlOptions} opts
 * @returns {{
 *   bridged: boolean,
 *   read: () => Promise<Record<string, string>>,
 *   push: (state: Record<string, unknown>) => boolean,
 *   replace: (state: Record<string, unknown>) => boolean,
 *   onChange: (fn: (state: Record<string, string>) => void) => void
 * }}
 */
export function createScriptUrl(opts) {
  const schema = opts.schema;
  const cap = opts.maxQuery == null ? DEFAULT_MAX_QUERY : opts.maxQuery;
  const host = opts.host || /** @type {any} */ (globalThis);
  const injected = host.script && typeof host.script === "object"
    && ((host.script.history && typeof host.script.history === "object") || (host.script.url && typeof host.script.url === "object"))
    ? host.script : null;
  const script = (host.google && host.google.script) || injected || null;
  const hist = script && script.history && typeof script.history.push === "function" ? script.history : null;
  const urlApi = script && script.url && typeof script.url.getLocation === "function" ? script.url : null;
  const bridged = !!(hist || urlApi);
  /** @type {string | null} */
  let last = null;

  /** State from the current hash; an over-long query is ignored whole. */
  function hashState() {
    const h = host.location && typeof host.location.hash === "string" ? host.location.hash : "";
    const i = h.indexOf("?");
    return i < 0 ? {} : decodeState(h.slice(i + 1), schema, cap);
  }

  /** @param {"push" | "replace"} kind @param {Record<string, unknown>} state */
  function write(kind, state) {
    const q = encodeState(state, schema, cap);
    if (q === last) return false;
    if (hist && typeof hist[kind] === "function") {
      last = q;
      hist[kind](null, sanitizeState(parseHash("#/?" + q).query, schema), "");
      return true;
    }
    if (bridged || !host.location) return false;
    const next = buildHash(parseHash(host.location.hash).path, parseHash("#/?" + q).query);
    last = q;
    if (next === host.location.hash) return false;
    if (kind === "push") host.location.hash = next;
    else if (host.history && typeof host.history.replaceState === "function") host.history.replaceState(null, "", next);
    else host.location.hash = next;
    return true;
  }

  return {
    bridged,
    /** Read the initial location; resolves {} on timeout or when there is nothing. */
    read() {
      return new Promise((resolve) => {
        const finish = (/** @type {any} */ params) => {
          const s = paramsSize(params) > cap ? {} : sanitizeState(params, schema);
          last = encodeState(s, schema, cap);
          resolve(s);
        };
        if (!urlApi) {
          const s = hashState();
          last = encodeState(s, schema, cap);
          resolve(s);
          return;
        }
        let done = false;
        const t = setTimeout(() => { if (!done) { done = true; finish({}); } }, opts.timeoutMs == null ? DEFAULT_TIMEOUT_MS : opts.timeoutMs);
        try {
          urlApi.getLocation((/** @type {any} */ loc) => {
            if (done) return;
            done = true; clearTimeout(t);
            finish(loc && loc.parameter);
          });
        } catch (e) { if (!done) { done = true; clearTimeout(t); finish({}); } }
      });
    },
    /** Add a history entry (a route change). Returns false when nothing changed. */
    push: (state) => write("push", state),
    /** Replace the current entry (a filter or state change). */
    replace: (state) => write("replace", state),
    /** Listen for Back and Forward; the callback gets the sanitised state. */
    onChange(fn) {
      /** @param {any} params */
      const apply = (params) => {
        const s = paramsSize(params) > cap ? {} : sanitizeState(params, schema);
        last = encodeState(s, schema, cap);
        fn(s);
      };
      if (hist && script.history && typeof script.history.setChangeHandler === "function") {
        script.history.setChangeHandler((/** @type {any} */ ev) => apply(ev && ev.location ? ev.location.parameter : {}));
      } else if (typeof host.addEventListener === "function") {
        host.addEventListener("hashchange", () => {
          const s = hashState();
          if (encodeState(s, schema, cap) === last) return;
          last = encodeState(s, schema, cap);
          fn(s);
        });
      }
    },
  };
}
