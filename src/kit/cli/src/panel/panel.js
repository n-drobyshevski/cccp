/* The control panel page. Every piece of text from the server goes in with textContent; nothing is built from
   strings of markup, so no markup is ever parsed here. The server sends the same checks as doctor. */
/**
 * The theme: "light" (the default; index.html already carries data-theme="light" for the first paint), "dark",
 * or "system" (no attribute, so the tokens follow prefers-color-scheme). The choice is kept in localStorage; every
 * access is wrapped, so with storage refused it reads as light and a switch still works for this page.
 * @param {{ setAttribute(n: string, v: string): void, removeAttribute(n: string): void }} root
 * @param {() => Storage} storage
 * @returns {{ current: () => string, set: (c: string) => string }}
 */
function gaskitPanelTheme(root, storage) {
  var KEY = "gaskit.panel.theme";
  /** @param {any} c */
  var known = function (c) { return c === "dark" || c === "system" ? c : "light"; };
  var choice = "light";
  try {
    choice = known(storage().getItem(KEY));
  } catch (e) {
    choice = "light";
  }
  /** @param {string} c */
  var apply = function (c) {
    if (c === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", c);
  };
  apply(choice);
  return {
    current: function () { return choice; },
    set: function (c) {
      choice = known(c);
      apply(choice);
      try {
        storage().setItem(KEY, choice);
      } catch (e) {
        /* Storage refused: the choice lasts for this page only. */
      }
      return choice;
    },
  };
}

(function () {
  "use strict";
  if (typeof document === "undefined") return; /* loaded by the tests for gaskitPanelTheme only */
  /* Applied as soon as this script runs. The CSP allows no inline script, so a stored dark or system choice
     shows a brief light flash first. */
  var theme = gaskitPanelTheme(document.documentElement, function () { return window.localStorage; });
  var MARK = /** @type {Record<string, string>} */ ( { ok: "✔", warn: "!", fail: "✖", info: "↑" });
  var WORD = /** @type {Record<string, string>} */ ( { ok: "OK", warn: "Needs attention", fail: "Problem", info: "News" });
  var token = "";
  var pollTimer = 0;

  /** @param {string} tag @param {string} [text] @param {string} [cls] @returns {HTMLElement} */
  function el(tag, text, cls) {
    var n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  }
  /** @param {string} id @returns {HTMLElement} */
  function byId(id) {
    return /** @type {HTMLElement} */ (document.getElementById(id));
  }
  /** @param {string} method @param {string} path @param {any} [body] @returns {Promise<any>} */
  async function api(method, path, body) {
    var headers = /** @type {Record<string, string>} */ ({});
    var init = /** @type {RequestInit} */ ({ method: method, headers: headers, credentials: "same-origin" });
    if (method === "POST") {
      headers["Content-Type"] = "application/json";
      headers["X-Gas-Kit-Token"] = token;
      init.body = JSON.stringify(body || {});
    }
    var res = await fetch(path, init);
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      var msg = data.error || "The panel said no (" + res.status + ")";
      throw new Error([msg, data.why, data.fix].filter(Boolean).join(" "));
    }
    return data;
  }
  /** @param {HTMLElement} box @param {string} text @param {boolean} [bad] */
  function say(box, text, bad) {
    box.textContent = (bad ? "✖ " : "✔ ") + text;
    box.className = "say " + (bad ? "bad" : "ok");
  }

  async function loadStatus() {
    var s = await api("GET", "/api/status");
    byId("app-name").textContent = s.product;
    byId("app-sub").textContent = s.where === "app" ? "kit " + (s.kitVersion || "unknown") : "the kit repository";
    /* The link always goes to the fixed /docs redirect; the address itself is never put in the page. */
    byId("docs").hidden = !s.docsUrl;
    var list = byId("status");
    list.replaceChildren();
    s.checks.forEach(function (/** @type {any} */ c) {
      var li = el("li", undefined, "row " + c.status);
      li.appendChild(el("span", MARK[c.status] || "?", "ic"));
      var body = el("div");
      body.appendChild(el("b", c.title + " (" + (WORD[c.status] || c.status) + ")"));
      if (c.detail) body.appendChild(el("span", c.detail, "muted"));
      if (c.id === "project-link" && c.status !== "ok") body.appendChild(el("span", "To fix: use Connect to Google Apps Script below.", "fix"));
      else if (c.fix && c.status !== "ok") body.appendChild(el("span", (c.fix.terminal ? "Run this in a terminal: " : "To fix: ") + c.fix.label, "fix"));
      li.appendChild(body);
      list.appendChild(li);
    });
    byId("status-sum").textContent = s.summary.needFixing ? s.summary.needFixing + (s.summary.needFixing === 1 ? " thing needs" : " things need") + " fixing." : "Everything looks fine.";
  }

  async function showJob() {
    var j = await api("GET", "/api/job");
    var pre = byId("job");
    pre.textContent = j.state === "idle" ? "Nothing has run yet." : j.lines.join("\n") || "Waiting for output";
    var head = j.state === "running" ? "Running npm run " + j.script : j.state === "done" ? "✔ npm run " + j.script + " finished" : j.state === "failed" ? "✖ npm run " + j.script + " did not finish" + (j.code === null ? "" : " (exit code " + j.code + ")") : "";
    var h = head ? "Output: " + head : "Output";
    var hEl = byId("job-h");
    if (hEl.textContent !== h) hEl.textContent = h;
    if (j.state === "running") pollTimer = window.setTimeout(showJob, 1000);
    return j;
  }

  /** @param {string} title @param {string} text @returns {{ card: HTMLElement, msg: HTMLElement }} */
  function card(title, text) {
    var c = el("div", undefined, "act");
    c.appendChild(el("b", title));
    c.appendChild(el("span", text, "muted"));
    var msg = el("p", "", "say");
    msg.setAttribute("role", "status");
    byId("actions").appendChild(c);
    return { card: c, msg: msg };
  }

  /** @param {string} action @param {string} label @param {string} text */
  function runCard(action, label, text) {
    var k = card(label, text);
    var b = el("button", label);
    b.setAttribute("type", "button");
    b.addEventListener("click", async function () {
      try {
        await api("POST", "/api/run", { action: action });
        window.clearTimeout(pollTimer);
        await showJob();
        k.msg.textContent = "";
      } catch (e) {
        say(k.msg, /** @type {Error} */ (e).message, true);
      }
    });
    k.card.appendChild(b);
    if (action === "dev") {
      var stop = el("button", "Stop the preview", "quiet");
      stop.setAttribute("type", "button");
      stop.addEventListener("click", async function () {
        try {
          await api("POST", "/api/stop", {});
          window.clearTimeout(pollTimer);
          await showJob();
        } catch (e) {
          say(k.msg, /** @type {Error} */ (e).message, true);
        }
      });
      k.card.appendChild(stop);
    }
    k.card.appendChild(k.msg);
  }

  function linkCard() {
    var k = card("Connect to Google Apps Script", "Paste the web address of your project (script.google.com, copied from the browser bar).");
    var input = /** @type {HTMLInputElement} */ (el("input"));
    input.type = "text";
    input.setAttribute("aria-label", "Project web address");
    input.setAttribute("autocomplete", "off");
    var b = el("button", "Connect");
    b.setAttribute("type", "button");
    b.addEventListener("click", async function () {
      try {
        var r = await api("POST", "/api/link", { script: input.value, force: rb.checked });
        say(k.msg, r.message);
        await loadStatus();
      } catch (e) {
        say(k.msg, /** @type {Error} */ (e).message, true);
      }
    });
    var replace = el("label", undefined, "confirm");
    var rb = /** @type {HTMLInputElement} */ (el("input"));
    rb.type = "checkbox";
    replace.appendChild(rb);
    replace.appendChild(el("span", " Replace the project this app is linked to now"));
    k.card.appendChild(input);
    k.card.appendChild(replace);
    k.card.appendChild(b);
    k.card.appendChild(k.msg);
  }

  function updateCard() {
    var k = card("Update the kit", "Looks for newer releases and shows what changes before anything is written.");
    var look = el("button", "Look for updates");
    look.setAttribute("type", "button");
    var out = el("div", undefined, "upd");
    look.addEventListener("click", async function () {
      try {
        out.replaceChildren();
        var u = await api("GET", "/api/update");
        if (!u.versions.length) return say(k.msg, "Your kit " + u.current + " is up to date.");
        k.msg.textContent = "";
        var sel = /** @type {HTMLSelectElement} */ (el("select"));
        sel.setAttribute("aria-label", "Version");
        u.versions.forEach(function (/** @type {string} */ v) {
          var o = /** @type {HTMLOptionElement} */ (el("option", v));
          o.value = v;
          sel.appendChild(o);
        });
        var changes = el("ul", undefined, "changes");
        var fill = function (/** @type {any} */ d) {
          changes.replaceChildren();
          d.changes.forEach(function (/** @type {string} */ c) { changes.appendChild(el("li", c)); });
          if (d.looser && d.looser.length) changes.appendChild(el("li", "Needs a terminal: this release makes the kit's checks looser (" + d.looser.join("; ") + "). Read it, then run npm run kit -- update --to " + d.version + " --accept-looser"));
          if (d.review && d.review.length) changes.appendChild(el("li", "Review in your app: " + d.review.join(", ")));
        };
        fill(u.selected);
        sel.addEventListener("change", async function () {
          try {
            fill(await api("GET", "/api/update?version=" + encodeURIComponent(sel.value)));
          } catch (e) {
            say(k.msg, /** @type {Error} */ (e).message, true);
          }
        });
        var label = el("label", undefined, "confirm");
        var cb = /** @type {HTMLInputElement} */ (el("input"));
        cb.type = "checkbox";
        label.appendChild(cb);
        label.appendChild(el("span", " I have read what changes and want to update"));
        var go = el("button", "Update now");
        go.setAttribute("type", "button");
        go.addEventListener("click", async function () {
          try {
            say(k.msg, "Updating. This can take a minute.");
            var r = await api("POST", "/api/update", { version: sel.value, confirm: cb.checked });
            say(k.msg, r.message);
            await loadStatus();
          } catch (e) {
            say(k.msg, /** @type {Error} */ (e).message, true);
          }
        });
        out.appendChild(sel);
        out.appendChild(changes);
        out.appendChild(label);
        out.appendChild(go);
      } catch (e) {
        say(k.msg, /** @type {Error} */ (e).message, true);
      }
    });
    k.card.appendChild(look);
    k.card.appendChild(out);
    k.card.appendChild(k.msg);
  }

  function themeSwitch() {
    var buttons = Array.prototype.slice.call(document.querySelectorAll("[data-theme-choice]"));
    var show = function () {
      buttons.forEach(function (/** @type {HTMLElement} */ b) { b.setAttribute("aria-pressed", String(b.dataset.themeChoice === theme.current())); });
    };
    buttons.forEach(function (/** @type {HTMLElement} */ b) {
      b.addEventListener("click", function () {
        theme.set(b.dataset.themeChoice || "light");
        show();
      });
    });
    show();
  }

  async function start() {
    // The token comes in the address fragment, which no server ever sees. Keep it for this tab only (sessionStorage
    // is per origin, port included) and take it out of the address bar.
    var fromHash = window.location.hash.replace(/^#/, "");
    if (/^[0-9a-f]{64}$/.test(fromHash)) {
      window.sessionStorage.setItem("gaskit-token", fromHash);
      window.history.replaceState(null, "", window.location.pathname);
    }
    token = window.sessionStorage.getItem("gaskit-token") || "";
    runCard("check", "Check that everything works", "Runs npm run check.");
    runCard("dev", "Preview the app", "Runs npm run dev; stop it when you are done.");
    runCard("push", "Put the app online", "Runs npm run push. Sign in to Google first (see the list on the left).");
    linkCard();
    updateCard();
    byId("recheck").addEventListener("click", function () { loadStatus().catch(function () {}); });
    await loadStatus();
    var j = await showJob();
    if (j.state === "idle") byId("job").textContent = "Nothing has run yet.";
  }
  themeSwitch();
  start().catch(function (e) {
    byId("app-name").textContent = "The panel could not start";
    byId("app-sub").textContent = e.message + " Open the address printed in the terminal again.";
  });
})();
