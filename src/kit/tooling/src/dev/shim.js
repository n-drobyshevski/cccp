// @ts-nocheck
/* Extracted from the author's production Apps Script apps; adapted.
   The google.script.run shim the dev server injects as the first child of head. It is served code,
   so it follows the served-code rules: no backticks and no double slash in any string. The server
   sets window.__GK_DEV = { names, reload } just before it. */
/* global EventSource */
(function () {
  var w = /** @type {any} */ (window);
  var cfg = w.__GK_DEV || {};
  var names = Object.create(null);
  (cfg.names || []).forEach(function (n) { names[n] = true; });
  var search = w.location.search || "";

  /* Illegal values travel as markers ({__illegal: kind}) so the server-side bridge rule rejects them.
     A legitimate plain object that itself has an __illegal or __escaped key is wrapped in {__escaped}. */
  function kindOf(v, seen) {
    var t = typeof v;
    if (t === "function" || t === "symbol" || t === "bigint") return t;
    if (t !== "object" || v === null) return "";
    if (seen.indexOf(v) >= 0) return "circular";
    if (Object.prototype.toString.call(v) === "[object Date]") return "Date";
    if (Array.isArray(v)) return "";
    var proto = Object.getPrototypeOf(v);
    if (proto === null || Object.getPrototypeOf(proto) === null) return "";
    return (proto.constructor && proto.constructor.name) || "object";
  }
  function wire(v, seen) {
    seen = seen || [];
    var kind = kindOf(v, seen);
    if (kind) return { __illegal: kind };
    if (v === undefined) return null;
    if (v === null || typeof v !== "object") return v;
    var next = seen.concat([v]);
    if (Array.isArray(v)) return v.map(function (x) { return wire(x, next); });
    var o = {};
    Object.keys(v).forEach(function (k) {
      if (v[k] !== undefined) Object.defineProperty(o, k, { value: wire(v[k], next), enumerable: true, writable: true, configurable: true });
    });
    if (Object.prototype.hasOwnProperty.call(o, "__illegal") || Object.prototype.hasOwnProperty.call(o, "__escaped")) return { __escaped: o };
    return o;
  }

  function invoke(name, args, ok, fail, user) {
    var body = JSON.stringify(args.map(function (a) { return wire(a); }));
    function failWith(msg) {
      setTimeout(function () {
        if (typeof fail === "function") fail(new Error(msg), user);
        else console.error("google.script.run." + name + " failed: " + msg);
      }, 0);
    }
    fetch("/__rpc/" + encodeURIComponent(name) + search, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body,
    }).then(function (res) {
      return res.text().then(function (text) {
        if (res.status !== 200) {
          // A thrown server error answers 500 with {"__error": message}; anything else non-200 is plain text.
          var msg = text;
          try { var e = JSON.parse(text); if (e && typeof e.__error === "string") msg = e.__error; } catch (_) { /* plain text */ }
          failWith(msg || ("HTTP " + res.status));
          return;
        }
        var v = text ? JSON.parse(text) : null;
        setTimeout(function () { if (typeof ok === "function") ok(v, user); }, 0);
      });
    }, function (e) { failWith(String((e && e.message) || e)); });
  }

  function runner(ok, fail, user) {
    return new Proxy({}, {
      get: function (_t, prop) {
        if (prop === "withSuccessHandler") return function (fn) { return runner(fn, fail, user); };
        if (prop === "withFailureHandler") return function (fn) { return runner(ok, fn, user); };
        if (prop === "withUserObject") return function (obj) { return runner(ok, fail, obj); };
        if (typeof prop !== "string" || !names[prop]) return undefined;
        return function () { invoke(prop, Array.prototype.slice.call(arguments), ok, fail, user); };
      },
      has: function (_t, prop) { return typeof prop === "string" && (prop === "withSuccessHandler" || prop === "withFailureHandler" || prop === "withUserObject" || !!names[prop]); },
    });
  }

  function getLocation(cb) {
    var sp = new URLSearchParams(w.location.search);
    var parameter = {};
    var parameters = {};
    sp.forEach(function (val, key) {
      if (!Object.prototype.hasOwnProperty.call(parameter, key)) parameter[key] = val;
      if (!Object.prototype.hasOwnProperty.call(parameters, key)) parameters[key] = [];
      parameters[key].push(val);
    });
    var loc = { hash: String(w.location.hash || "").replace(/^#/, ""), parameter: parameter, parameters: parameters };
    setTimeout(function () { cb(loc); }, 0);
  }

  var g = (w.google = w.google || {});
  g.script = {
    run: runner(null, null, undefined),
    host: { origin: w.location.origin, close: function () {}, setHeight: function () {}, setWidth: function () {} },
    url: { getLocation: getLocation },
  };

  if (cfg.reload && typeof EventSource === "function") {
    var es = new EventSource("/__events");
    es.addEventListener("reload", function () { w.location.reload(); });
  }
})();
