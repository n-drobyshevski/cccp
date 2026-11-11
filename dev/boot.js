// Local dev bootstrap. Runs after gas-shims.js, the workbook data, dist/server.js and
// dist/entry.js, and before the client bundle.
//
// Derived from sidekick gas_hub/dev/boot.js at commit 77bcf22 (see VENDOR.md). Differences:
//   - google.script.run dispatches to window.api_<name>, the delegators in dist/entry.js, so
//     the access gate and the timing log are exercised exactly as in a deployment.
//   - Results and parameters pass through JSON, as the real bridge serialises them.
//   - google.script.url and google.script.history are shimmed over the real location.
//   - Script Properties are seeded; the fake workbook is loaded; flags are read.
//
// Flags (query string):
//   as=<email>     who is signed in (default owner@example.com; viewer@ and admin@ are seeded)
//   mode=org       ACCESS_MODE=org
//   admins=<list>  override ALLOWED_ADMINS (empty value: no admins)
//   nosource       no CFG_SOURCE, so the app starts unconfigured
//   empty          the workbook keeps header rows only
//   coldcache      CacheService accepts writes but never returns them
//   slow=<ms>      artificial RPC latency
//   tz=<IANA>      the spreadsheet's time zone (default Europe/Paris)
//   hideprefix=<s> Display setting: hide apps whose name starts with s
//   inline         ship the bootstrap in the page, as doGet does when the register is warm
//
// window.__rpcLog lists the name of every google.script.run call the client made, in order.

(function () {
  "use strict";

  var query = new URLSearchParams(location.search);
  var fakes = window.__gasFakes;
  var flag = function (n) { return query.has(n); };

  var wb = window.__CCCP_WORKBOOK__;
  var tz = query.get("tz") || (wb && wb.tz) || "Europe/Paris";
  if (wb) fakes.loadWorkbook(wb, { empty: flag("empty"), tz: tz });

  var as = query.get("as");
  if (as) fakes.setActiveUser(as);
  fakes.setCacheDisabled(flag("coldcache"));
  fakes.seedDefaults({
    sheetId: wb ? wb.id : "",
    mode: query.get("mode"),
    admins: query.has("admins") ? query.get("admins") : null,
    nosource: flag("nosource"),
    hidePrefix: query.get("hideprefix"),
  });
  console.log("[dev] seeded: signed in as " + (as || fakes.OWNER) + ", tz " + tz +
    (wb ? ", workbook " + wb.source : ", no workbook"));

  window.__rpcLog = [];

  // doGet inlines the bootstrap, and the register when it is warm. Priming the register first
  // makes the same true here. Direct calls, so they are not in __rpcLog.
  if (flag("inline")) {
    try {
      window.api_getRegister({});
      var boot = document.getElementById("boot-data");
      if (boot) boot.textContent = JSON.stringify(window.api_bootstrap({}));
    } catch (e) {
      console.error("[dev] inline bootstrap failed:", e);
    }
  }

  var SLOW_MS = Math.max(0, Number(query.get("slow")) || 0);

  function roundTrip(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }

  // google.script.run: chainable handler setters, then any api_* name invokes the RPC.
  function makeRunner(onSuccess, onFailure) {
    var target = {
      withSuccessHandler: function (fn) { return makeRunner(fn, onFailure); },
      withFailureHandler: function (fn) { return makeRunner(onSuccess, fn); },
      withUserObject: function () { return this; },
    };
    return new Proxy(target, {
      get: function (t, prop) {
        if (prop in t) return t[prop];
        if (typeof prop !== "string") return undefined;
        return function (params) {
          window.__rpcLog.push(String(prop).replace(/^api_/, ""));
          var arg = roundTrip(params);
          setTimeout(function () {
            try {
              var fn = window[prop];
              if (typeof fn !== "function" || prop.indexOf("api_") !== 0) throw new Error("Unknown RPC " + prop);
              var result = roundTrip(fn(arg));
              if (onSuccess) onSuccess(result);
            } catch (e) {
              if (onFailure) onFailure(e);
              else console.error("[dev] RPC " + prop + " failed:", e);
            }
          }, SLOW_MS);
        };
      },
    });
  }

  // google.script.url / .history: the app reads and writes its state through these.
  function paramsOf(search) {
    var parameter = {}, parameters = {};
    new URLSearchParams(search).forEach(function (v, k) {
      parameter[k] = v;
      (parameters[k] = parameters[k] || []).push(v);
    });
    return { parameter: parameter, parameters: parameters };
  }
  function locationObject() {
    var p = paramsOf(location.search);
    return { hash: location.hash.replace(/^#/, ""), parameter: p.parameter, parameters: p.parameters };
  }
  var listener = null;
  window.addEventListener("popstate", function (ev) {
    if (listener) listener({ state: ev.state, location: locationObject() });
  });
  function setUrl(kind, state, params, hash) {
    var qs = new URLSearchParams(params || {}).toString();
    var url = location.pathname + (qs ? "?" + qs : "") + (hash ? "#" + hash : "");
    history[kind](state || null, "", url);
  }

  window.google = {
    script: {
      run: makeRunner(null, null),
      url: { getLocation: function (cb) { cb(locationObject()); } },
      history: {
        push: function (state, params, hash) { setUrl("pushState", state, params, hash); },
        replace: function (state, params, hash) { setUrl("replaceState", state, params, hash); },
        setChangeHandler: function (fn) { listener = fn; },
      },
    },
  };
  console.log("[dev] google.script.run shim installed: calls go through window.api_*");
})();
