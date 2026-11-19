// Extracted from the author's production Apps Script apps; adapted.
// Promisified google.script.run. Every endpoint answers {ok, data} or {ok:false, error,
// errorKind}; a failure rejects with an RpcError whose `kind` is the errorKind. The forbidden
// envelope also carries the owner's address (`contact`, `contactUrl`) for the access card. An
// unexpected fault carries a short reference (`ref`) the person can quote, and, for an admin or
// the owner only, the fault's own text (`detail`); the message is then the server's fixed sentence.
// A busy envelope can be retried with backoff (opts.retry); every call logs its time.

/** @typedef {"error" | "busy" | "conflict" | "forbidden" | "cold"} ErrorKind */

export class RpcError extends Error {
  /**
   * @param {string} message
   * @param {ErrorKind} [kind]
   * @param {{ contact?: string, contactUrl?: string, ref?: unknown, detail?: unknown }} [extra]
   */
  constructor(message, kind, extra) {
    super(message);
    this.name = "RpcError";
    /** @type {ErrorKind} */
    this.kind = kind || "error";
    /** @type {string | undefined} */
    this.contact = extra && extra.contact;
    /** @type {string | undefined} */
    this.contactUrl = extra && extra.contactUrl;
    /** The fault's reference, as the server logged it. Only a non-empty string is kept. @type {string | undefined} */
    this.ref = extra && typeof extra.ref === "string" && extra.ref !== "" ? extra.ref : undefined;
    /** The fault's own text, sent only to an admin or the owner. Only a non-empty string is kept. @type {string | undefined} */
    this.detail = extra && typeof extra.detail === "string" && extra.detail !== "" ? extra.detail : undefined;
  }
}

/** Backoff before each busy retry, in ms: the last value repeats for further tries. */
const BUSY_BACKOFF_MS = [400, 1200];

/**
 * A monotonic clock in ms: performance.now() when there is one, else Date.now().
 * @returns {number}
 */
function clock() {
  const p = /** @type {any} */ (globalThis).performance;
  return p && typeof p.now === "function" ? p.now() : Date.now();
}

/**
 * Log one call's wall time, retries included, when there is a console.
 * @param {string} name
 * @param {number} t0
 */
function logTime(name, t0) {
  const c = /** @type {any} */ (globalThis).console;
  if (c && typeof c.debug === "function") c.debug("[rpc] " + name + " " + Math.round(clock() - t0) + "ms");
}

/**
 * One round trip to api_<name>, with no retry.
 * @param {string} name
 * @param {unknown} params
 * @returns {Promise<any>}
 */
function callOnce(name, params) {
  return new Promise((resolve, reject) => {
    const g = /** @type {any} */ (globalThis).google;
    if (!g || !g.script || !g.script.run) {
      reject(new RpcError("google.script.run is unavailable: open the app through its web address.", "error"));
      return;
    }
    const runner = g.script.run;
    const fn = "api_" + name;
    if (typeof runner[fn] !== "function") {
      reject(new RpcError("Unknown endpoint: " + name, "error"));
      return;
    }
    runner
      .withSuccessHandler((/** @type {any} */ res) => {
        if (res && res.ok) resolve(res.data);
        else {
          reject(new RpcError((res && res.error) || "Unknown server error", (res && res.errorKind) || "error", res || undefined));
        }
      })
      .withFailureHandler((/** @type {unknown} */ err) => {
        const e = err instanceof Error ? err : new Error(String(err));
        reject(new RpcError(e.message, "error"));
      })[fn](params === undefined ? {} : params);
  });
}

/**
 * Call the server function api_<name>. Resolves with the envelope's data.
 *
 * `opts.retry` (default 0) retries an envelope that fails with errorKind "busy" (the server
 * could not take its lock) up to that many times, waiting 400 ms before the first retry and
 * 1200 ms before each later one. No other kind is retried, and neither is a transport failure
 * (which always rejects as kind "error"). Only retry endpoints that are safe to repeat.
 *
 * Every call logs its total time, retries included, as console.debug("[rpc] <name> <ms>ms"),
 * on success and on failure.
 * @param {string} name
 * @param {unknown} [params]
 * @param {{ retry?: number }} [opts]
 * @returns {Promise<any>}
 */
export function call(name, params, opts) {
  const t0 = clock();
  const max = Math.max(0, Math.floor(Number(opts && opts.retry) || 0));
  /**
   * @param {number} n retries done so far
   * @returns {Promise<any>}
   */
  const attempt = (n) =>
    callOnce(name, params).catch((/** @type {unknown} */ e) => {
      if (!(e instanceof RpcError) || e.kind !== "busy" || n >= max) throw e;
      const wait = BUSY_BACKOFF_MS[Math.min(n, BUSY_BACKOFF_MS.length - 1)];
      return new Promise((resolve) => setTimeout(resolve, wait)).then(() => attempt(n + 1));
    });
  return attempt(0).then(
    (data) => {
      logTime(name, t0);
      return data;
    },
    (e) => {
      logTime(name, t0);
      throw e;
    },
  );
}

/**
 * @param {unknown} v
 * @returns {boolean}
 */
function isBootPayload(v) {
  const o = /** @type {any} */ (v);
  return !!o && typeof o === "object" && !!o.core && !!o.live;
}

/** Ids already taken, per document: the inline payload answers once per page. @type {WeakMap<object, Set<string>>} */
const TAKEN = new WeakMap();

/**
 * The boot payload the page carried, read ONCE and removed from the DOM: it is the state of the
 * world at page load, so it may answer the first boot() only, and a forced refresh asks the
 * server. Accepts the bare payload {core, live} or an {ok:true, data} envelope around it.
 * Only a script element whose type is application/json is read, and each id is taken once per
 * document: a later element with the same id (rendered markup, say) is ignored and gives null.
 * Empty, unreadable or not-ok content gives null.
 * @param {string} [id]
 * @returns {any}
 */
export function takeInlineBoot(id) {
  if (typeof document === "undefined") return null;
  const key = id || "boot";
  let taken = TAKEN.get(document);
  if (!taken) { taken = new Set(); TAKEN.set(document, taken); }
  if (taken.has(key)) return null;
  taken.add(key);
  const node = document.getElementById(key);
  if (!node) return null;
  if (String(node.tagName).toUpperCase() !== "SCRIPT") return null;
  if (String(node.getAttribute("type") || "").trim().toLowerCase() !== "application/json") return null;
  if (node.parentNode) node.parentNode.removeChild(node);
  const text = String(node.textContent || "").trim();
  if (!text) return null;
  try {
    const v = JSON.parse(text);
    const data = v && v.ok === true ? v.data : v;
    return isBootPayload(data) ? data : null;
  } catch (e) {
    return null;
  }
}

/**
 * The boot payload: the inline one when the page carried it, else call("bootstrap").
 * @param {{ id?: string, endpoint?: string }} [opts]
 * @returns {Promise<any>}
 */
export function boot(opts) {
  const inline = takeInlineBoot(opts && opts.id);
  if (inline) return Promise.resolve(inline);
  return call((opts && opts.endpoint) || "bootstrap");
}
