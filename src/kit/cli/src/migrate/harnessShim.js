/* Harness shim: stands in for the Apps Script client runtime on a page served by the migrate harness.
   It answers google.script.run from the recorded map in the page, and nothing else: no network. */
(function () {
  /** @type {any} */
  var w = globalThis;
  /** @type {Record<string, any>} */
  var rpc = {};
  try {
    var holder = w.document.getElementById("__harness-rpc");
    rpc = JSON.parse((holder && holder.textContent) || "{}") || {};
  } catch (e) {
    rpc = {};
  }
  var has = Object.prototype.hasOwnProperty;
  /* Answers recorded with their parameters ({ name, params, result }): a call whose name and
     parameters match one gets that answer before the per-name one in rpc. */
  /** @type {{ name: string, key: string, result: any }[]} */
  var calls = [];
  try {
    var held = w.document.getElementById("__harness-calls");
    var list = JSON.parse((held && held.textContent) || "[]");
    if (Array.isArray(list)) list.forEach(function (c) {
      if (c && typeof c.name === "string") calls.push({ name: c.name, key: canon(c.params), result: c.result });
    });
  } catch (e) {
    calls = [];
  }

  /* One text per value whatever its key order; undefined and null are one. */
  /** @param {any} v @returns {string} */
  function canon(v) {
    if (v === undefined || v === null) return "null";
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    if (typeof v === "object") return "{" + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; }).map(function (k) { return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
    return JSON.stringify(v);
  }

  /** @param {string} name @param {any} params @returns {{ result: any } | null} */
  function byParams(name, params) {
    var alt = name.indexOf("api_") === 0 ? name.slice(4) : "api_" + name;
    var key = canon(params);
    for (var i = 0; i < calls.length; i++) {
      var c = calls[i];
      if ((c.name === name || c.name === alt) && c.key === key) return { result: c.result };
    }
    return null;
  }

  /* The recorded name, else the name without or with the api_ prefix kit apps use for their delegators. */
  /** @param {string} name */
  function recorded(name) {
    var alt = name.indexOf("api_") === 0 ? name.slice(4) : "api_" + name;
    return has.call(rpc, name) ? name : has.call(rpc, alt) ? alt : null;
  }

  /** @param {any} v */
  function copy(v) {
    return v === undefined ? v : JSON.parse(JSON.stringify(v));
  }

  /** @param {any} ok @param {any} fail @param {any} user @returns {any} */
  function runner(ok, fail, user) {
    var target = {};
    return new Proxy(target, {
      get: function (_t, name) {
        if (typeof name !== "string" || name === "then") return undefined;
        if (name === "withSuccessHandler") return /** @param {any} fn */ function (fn) { return runner(fn, fail, user); };
        if (name === "withFailureHandler") return /** @param {any} fn */ function (fn) { return runner(ok, fn, user); };
        if (name === "withUserObject") return /** @param {any} obj */ function (obj) { return runner(ok, fail, obj); };
        return function (/** @type {any} */ params) {
          setTimeout(function () {
            var exact = byParams(name, params);
            if (exact) {
              if (typeof ok === "function") ok(copy(exact.result), user);
              return;
            }
            var hit = recorded(name);
            if (hit !== null) {
              if (typeof ok === "function") ok(copy(rpc[hit]), user);
              return;
            }
            var err = new Error("no recorded answer for " + name);
            if (typeof fail === "function") fail(err, user);
            else console.error(err.message);
          }, 0);
        };
      },
    });
  }

  function location_() {
    var qs = w.location.search.replace(/^\?/, "");
    /** @type {Record<string, string>} */
    var parameter = {};
    /** @type {Record<string, string[]>} */
    var parameters = {};
    new URLSearchParams(qs).forEach(function (v, k) {
      parameter[k] = v;
      (parameters[k] = parameters[k] || []).push(v);
    });
    return { hash: w.location.hash.replace(/^#/, ""), parameter: parameter, parameters: parameters, queryString: qs };
  }

  /** @param {any} params @param {any} hash */
  function urlFor(params, hash) {
    var q = "";
    if (params && typeof params === "object") {
      var sp = new URLSearchParams();
      Object.keys(params).forEach(function (k) {
        var v = params[k];
        (Array.isArray(v) ? v : [v]).forEach(function (x) { sp.append(k, String(x)); });
      });
      q = sp.toString();
    }
    return w.location.pathname + (q ? "?" + q : "") + (hash ? "#" + hash : "");
  }

  /** @type {any} */
  var handler = null;
  w.addEventListener("popstate", /** @param {any} ev */ function (ev) {
    if (typeof handler === "function") handler({ state: ev.state, location: location_() });
  });

  var g = w.google || (w.google = {});
  g.script = g.script || {};
  g.script.run = runner(null, null, undefined);
  g.script.url = { getLocation: /** @param {any} cb */ function (cb) { setTimeout(function () { cb(location_()); }, 0); } };
  g.script.history = {
    push: /** @param {any} state @param {any} params @param {any} hash */ function (state, params, hash) { w.history.pushState(state || null, "", urlFor(params, hash)); },
    replace: /** @param {any} state @param {any} params @param {any} hash */ function (state, params, hash) { w.history.replaceState(state || null, "", urlFor(params, hash)); },
    setChangeHandler: /** @param {any} fn */ function (fn) { handler = fn; },
  };
  g.script.host = g.script.host || { close: function () {}, setHeight: function () {}, setWidth: function () {}, editor: { focus: function () {} } };
})();
