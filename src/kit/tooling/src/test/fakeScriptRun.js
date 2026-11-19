// Extracted from the author's production Apps Script apps; adapted.
// A stand-in for google.script.run for client tests and the dev server.
//
// Choices that mirror the real bridge:
//  - Delivery is asynchronous (a microtask), never synchronous. Known gap: the real bridge
//    delivers on a later macrotask (a network round trip). Code that relies on microtask ordering,
//    such as awaiting an already-resolved promise before the handler fires, passes here but can
//    race in production. A test that must model the gap can await a macrotask (setTimeout 0)
//    between the call and its assertions.
//  - Arguments cross a strict JSON boundary. A Date, function, symbol, bigint, or any non-plain object
//    (class instance, Map, Set, DOM node) anywhere inside an argument makes the call fail with an
//    "Illegal value" Error delivered to the failure handler (or recorded in `unhandled`), and the
//    server function never runs. undefined becomes null at top level and is dropped inside objects.
//  - A result holding any such value is delivered as null, the whole value (the real gotcha: the
//    success handler gets null, not a per-field null). Plain results are fresh copies.
//  - A throwing server function reaches the failure handler as an Error carrying the message.
//  - An exception thrown by a handler never reaches the failure handler (real: an uncaught browser
//    error). It is recorded in `handlerErrors`, and idle() rejects with it (see below).
//  - idle() rejects with the first handler error or unhandled failure recorded since the previous idle(),
//    so an assertion inside a handler fails the test. Pass { tolerateHandlerErrors: true } to opt out and
//    inspect `handlerErrors` / `unhandled` yourself.
//  - Names ending in an underscore are private on the real bridge: "Server function not found".
//  - withUserObject(x) is passed to the handler as its second argument.
//  - Handlers are per builder: with* returns a new runner, so one runner can be shared.

/**
 * @typedef {(result: any, userObject?: any) => void} SuccessHandler
 * @typedef {(error: Error, userObject?: any) => void} FailureHandler
 * @typedef {{ name: string, args: any[] }} RunCall
 */

/**
 * Throw if value holds anything the real bridge prohibits.
 * @param {any} value
 * @param {string} path
 * @param {any[]} [seen]
 */
function assertPlain(value, path, seen = []) {
  const t = typeof value;
  if (value === null || value === undefined || t === "string" || t === "boolean") return;
  if (t === "number") return;
  if (t !== "object") throw new Error("Illegal value (" + t + ") at " + path);
  if (seen.includes(value)) throw new Error("Illegal value (circular) at " + path);
  seen = seen.concat([value]);
  if (Array.isArray(value)) { value.forEach((v, i) => assertPlain(v, path + "[" + i + "]", seen)); return; }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error("Illegal value (" + (value instanceof Date ? "Date" : (proto.constructor && proto.constructor.name) || "object") + ") at " + path);
  }
  for (const k of Object.keys(value)) assertPlain(value[k], path + "." + k, seen);
}

/**
 * Strict JSON round trip: throws an "Illegal value" Error for a Date, function or other non-plain value.
 * @param {any} value
 * @returns {any}
 */
export function crossBridge(value) {
  assertPlain(value, "value");
  if (value === undefined) return null;
  const text = JSON.stringify(value);
  return text === undefined ? null : JSON.parse(text);
}

/**
 * Result direction: an illegal value yields null for the whole result.
 * @param {any} value
 * @returns {any}
 */
export function crossResult(value) {
  try { return crossBridge(value); } catch (e) { return null; }
}

/**
 * @param {Record<string, Function>} globals server functions by name (the entry delegators)
 * @param {{ log?: RunCall[], tolerateHandlerErrors?: boolean }} [opts] log: array to collect every call;
 *   tolerateHandlerErrors: idle() does not reject on handler errors or unhandled failures
 */
export function createScriptRun(globals, opts) {
  /** @type {RunCall[]} */
  const calls = (opts && opts.log) || [];
  /** @type {Array<{ name: string, error: Error }>} */
  const unhandled = [];
  /** @type {Array<{ name: string, error: Error }>} */
  const handlerErrors = [];
  let pending = 0;
  let reported = 0;
  /** @type {Array<() => void>} */
  let idleWaiters = [];
  const tolerate = !!(opts && opts.tolerateHandlerErrors);
  /** @returns {Promise<void>} */
  function report() {
    const all = [...handlerErrors, ...unhandled];
    const fresh = all.length - reported;
    reported = all.length;
    if (tolerate || fresh <= 0) return Promise.resolve();
    const errs = all.slice(all.length - fresh).map((x) => x.error);
    return Promise.reject(errs.length === 1 ? errs[0] : Object.assign(new Error("Several script.run handler errors: " + errs.map((e) => e.message).join("; ")), { errors: errs }));
  }

  function settle() {
    pending--;
    if (pending === 0) { const w = idleWaiters; idleWaiters = []; w.forEach((f) => f()); }
  }

  /**
   * @param {SuccessHandler | null} onOk
   * @param {FailureHandler | null} onFail
   * @param {any} userObject
   * @param {boolean} hasUser
   * @returns {any}
   */
  function builder(onOk, onFail, userObject, hasUser) {
    /** @type {Record<string, any>} */
    const base = {
      withSuccessHandler: (/** @type {any} */ f) => builder(f, onFail, userObject, hasUser),
      withFailureHandler: (/** @type {any} */ f) => builder(onOk, f, userObject, hasUser),
      withUserObject: (/** @type {any} */ o) => builder(onOk, onFail, o, true),
    };
    return new Proxy(base, {
      get(target, prop) {
        if (typeof prop !== "string") return undefined;
        if (Object.prototype.hasOwnProperty.call(target, prop)) return target[prop];
        if (prop === "then") return undefined;
        // Like the real bridge: only public top-level server functions exist on google.script.run.
        // An unknown or private (trailing underscore) name is undefined, so calling it throws a TypeError.
        if (/_$/.test(prop) || !Object.prototype.hasOwnProperty.call(globals, prop) || typeof globals[prop] !== "function") return undefined;
        return (/** @type {any[]} */ ...args) => {
          const name = prop;
          const extra = hasUser ? [userObject] : [];
          /** @type {any[] | null} */
          let sent = null;
          /** @type {Error | null} */
          let argError = null;
          try { sent = args.map(crossBridge); } catch (e) { argError = e instanceof Error ? e : new Error(String(e)); }
          if (sent) calls.push({ name, args: sent });
          pending++;
          queueMicrotask(() => {
            /** @type {{ ok: true, result: any } | { ok: false, error: Error }} */
            let outcome;
            try {
              if (argError) throw argError;
              const fn = /_$/.test(name) || !Object.prototype.hasOwnProperty.call(globals, name) ? null : globals[name];
              if (typeof fn !== "function") throw new Error("Server function not found: " + name);
              outcome = { ok: true, result: crossResult(fn(...(sent || []).map(crossBridge))) };
            } catch (e) {
              outcome = { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
            }
            try {
              if (outcome.ok) { if (onOk) onOk(outcome.result, ...extra); }
              else if (onFail) onFail(outcome.error, ...extra);
              else unhandled.push({ name, error: outcome.error });
            } catch (e) {
              handlerErrors.push({ name, error: e instanceof Error ? e : new Error(String(e)) });
            } finally { settle(); }
          });
        };
      },
    });
  }

  const run = builder(null, null, undefined, false);
  return {
    /** The object to install as google.script.run. */
    run,
    /** Every call made, with its arguments as the server saw them. */
    calls,
    /** Failures that had no failure handler. */
    unhandled,
    /** Exceptions thrown by success or failure handlers (uncaught browser errors on the real bridge). */
    handlerErrors,
    /**
     * Resolves when no call is in flight. Rejects with the first error (an Error with an `errors` array if several)
     * raised by a handler, or by a failure with no failure handler, since the last idle(), unless
     * tolerateHandlerErrors was set.
     * @returns {Promise<void>}
     */
    idle() {
      return (pending === 0 ? Promise.resolve() : new Promise((r) => idleWaiters.push(() => r(undefined)))).then(report);
    },
  };
}
