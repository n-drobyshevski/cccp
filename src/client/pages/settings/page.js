// The Settings page (route 'settings', ?r=settings&tab=...), layout C: five tabs, a sticky save
// bar, one save call. Admins and the owner only (the router shows the Only admins card to
// everyone else; the page checks again). The draft lives in the store, so leaving the page and
// coming back keeps unsaved edits; draft.js holds all the rules, this file wires them to the
// RPCs and the DOM.
//
// Saving sends ONE api_saveSettings({patch, baseGen}). A conflict reloads the server's settings
// and says so. After a source or fields change the register is fetched again; after a rules or
// display change it is derived again from the copy in memory.
import { delegate, qs, renderRegion } from "../../lib/dom.js";
import { html } from "../../lib/html.js";
import { icon } from "../../lib/icons.js";
import * as rpc from "../../lib/rpc.js";
import { toast } from "../../lib/toast.js";
import { savebar } from "../../components/savebar.js";
import { homeRoute } from "../../shell/appbar.js";
import { registerPage } from "../../shell/router.js";
import * as theme from "../../shell/theme.js";
import { armSlow, onlyAdmins, skeleton } from "../../shell/states.js";
import * as register from "../../state/register.js";
import { isNoSource } from "../../state/noSource.js";
import { withRefresh } from "../../state/refresh.js";
import { store } from "../../state/store.js";
import { navigate } from "../../state/url.js";
import {
  SETTINGS_TABS, barModel, clampedText, committed, discard, edit, errorsOf, form, guardSettings, isDirty,
  newSession, sectionsOf, tabMarks, toPatch,
} from "./draft.js";
import { accessView, createAccess } from "./access.js";
import { displayView } from "./display.js";
import { fieldsView } from "./fields.js";
import { editRule, toggleTier, rulesView } from "./rules.js";
import { sourceView } from "./source.js";

const VIEWS = { source: sourceView, fields: fieldsView, rules: rulesView, access: accessView, display: displayView };

/** Another step may register a tab view: registerSettingsTab(key, view). */
export function registerSettingsTab(key, view) {
  VIEWS[key] = view;
}

const soon = () => html`<p class="mut">This section arrives in a later step.</p>`;

const sessionOf = () => store.get().settingsDraft;

const metaUrl = () => {
  const c = store.get().core;
  return c && c.sourceMeta ? c.sourceMeta.url : "";
};

/** The register and the bootstrap again, after a change that alters what the Sheet yields. */
// The page keeps its old data on screen meanwhile, under the thin refresh bar.
function refreshData() {
  return withRefresh(async () => {
    const data = await rpc.call("bootstrap");
    const { core, live } = data;
    const noSource = isNoSource(core);
    const context = { rules: core.publicSettings.rules, display: core.publicSettings.display, today: live.today };
    if (!noSource) register.load(data.register || (await rpc.call("getRegister")), context);
    store.set({ core, live, boot: { status: noSource ? "nosource" : "ready", message: "" } });
    theme.init(core.publicSettings.display.theme);
  });
}

/** The server's saved settings become the page's: rules and display are public to all viewers. */
function adoptPublic(settings, cfgGen) {
  const s = store.get();
  const core = { ...s.core, publicSettings: { ...s.core.publicSettings, rules: settings.rules, display: settings.display } };
  store.set({ core, live: { ...s.live, cfgGen } });
  register.rederive({ rules: settings.rules, display: settings.display });
  theme.init(settings.display.theme);
}

function tabsView(tab, marks) {
  return html`<div class="stabs" role="tablist" aria-label="Settings sections">${SETTINGS_TABS.map((t) => {
    const m = marks[t.key];
    const on = t.key === tab;
    return html`<button type="button" role="tab" id="st-tab-${t.key}" aria-selected="${on ? "true" : "false"}" aria-controls="st-panel" tabindex="${on ? "0" : "-1"}" data-act="s-tab" data-tab="${t.key}" data-k="stt-${t.key}">${t.label}${m.dirty ? html`<span class="dirtydot" data-tip="Unsaved changes" aria-hidden="true"></span><span class="sr-only"> (unsaved changes)</span>` : ""}${m.warn ? html`<span class="warnmark" data-tip="Fields not mapped" aria-hidden="true"></span><span class="sr-only"> (fields not mapped)</span>` : ""}${m.invalid ? html`<span class="badmark" data-tip="Needs a fix" aria-hidden="true"></span><span class="sr-only"> (needs a fix)</span>` : ""}</button>`;
  })}</div>`;
}

function bannerView(b) {
  if (!b) return "";
  return html`<div class="callout ${b.kind}" role="alert" data-banner="${b.kind}"><span>${b.text}</span><button type="button" class="btn sm" data-act="s-dismiss" data-k="dismiss">Dismiss</button></div>`;
}

function problemsView(problems) {
  if (!problems.length) return "";
  return html`<ul class="issues bad" role="alert" data-problems>${problems.map((p) => html`<li><span class="dot bad" aria-hidden="true"></span><span>${p}</span></li>`)}</ul>`;
}

const nextTab = (tab, step) => {
  const keys = SETTINGS_TABS.map((t) => t.key);
  return keys[(keys.indexOf(tab) + step + keys.length) % keys.length];
};

export const settingsPage = {
  mount(el, ctx) {
    const s0 = store.get();
    if (!(s0.live && s0.live.viewer && s0.live.viewer.canEditSettings)) {
      renderRegion(el, onlyAdmins(), { keepFocus: false, keepScroll: false });
      return null;
    }
    let alive = true;
    let busy = false;
    let banner = null;
    const ui = { adv: false, probe: { state: "idle" }, reloadBusy: false, reloadedAt: false };
    guardSettings(() => isDirty(sessionOf()));
    const accessCtl = createAccess({ el, redraw: () => draw() });

    function draw() {
      const st = store.get();
      const session = st.settingsDraft;
      if (!alive || !session) return;
      const tab = form.normalizeTab(st.tab);
      const { errors, problems } = errorsOf(session);
      const marks = tabMarks(session, errors);
      marks.access = { ...marks.access, dirty: accessCtl.dirty() };
      const bar = barModel(session);
      const view = VIEWS[tab] || soon;
      const vctx = { session, meta: st.core.sourceMeta, viewer: st.live.viewer, ui, errors, rows: register.allRows(), today: st.live.today, access: accessCtl.state };
      const def = SETTINGS_TABS.find((t) => t.key === tab);
      if (tab === "access") accessCtl.ensureLoaded();
      renderRegion(el, html`<div class="stw" data-page="settings" data-tab="${tab}">
        <div class="top"><button type="button" class="backbtn" data-act="s-back" data-k="back">${icon("arrowleft")}Back</button></div>
        <div class="sth"><h1>Settings</h1><p>Changes apply to everyone who opens CCCP after you save.</p></div>
        ${bannerView(banner)}
        <div class="panel">
          ${tabsView(tab, marks)}
          <section class="sts" id="st-panel" role="tabpanel" aria-labelledby="st-tab-${tab}">
            <header><h2>${def.label}</h2><p>${def.help}.</p></header>
            ${problemsView(problems)}
            ${view(vctx)}
          </section>
        </div>
        ${savebar({ count: bar.count, text: bar.text, tabs: bar.tabs, busy, problems: problems.length })}
      </div>`);
    }

    function setRule(id, prop, value) {
      const s = sessionOf();
      if (!s) return;
      store.set({ settingsDraft: prop === "tier" ? toggleTier(s, id, value) : editRule(s, id, prop, value) });
    }

    function setDraft(key, value) {
      const s = sessionOf();
      if (s) store.set({ settingsDraft: edit(s, key, value) });
    }

    let stopSlow = null;
    const endWait = () => { if (stopSlow) stopSlow(); stopSlow = null; };

    async function load() {
      endWait();
      renderRegion(el, skeleton("settings", "Opening the settings"), { keepFocus: false, keepScroll: false });
      stopSlow = armSlow(el);
      try {
        const resp = await rpc.call("getSettings");
        endWait();
        if (!alive || !ctx.current()) return;
        const fresh = newSession(resp, metaUrl());
        const old = sessionOf();
        if (old && isDirty(old)) {
          // Unsaved edits are never dropped silently. If the settings moved meanwhile, keep the
          // session as it was (so a save reports the conflict) and say so.
          if (old.baseGen !== resp.cfgGen) banner = { kind: "conflict", text: "The settings were changed by someone else since you opened them. Your unsaved changes are kept; saving will reload the current settings." };
        } else {
          store.set({ settingsDraft: fresh });
        }
      } catch (e) {
        endWait();
        if (!alive || !ctx.current()) return;
        renderRegion(el, html`<section class="state error" role="alert"><h1>The settings could not be opened</h1><p>${e.message}</p><p class="state-act"><button type="button" class="btn" data-act="s-retry" data-k="retry">Retry</button></p></section>`, { keepFocus: false, keepScroll: false });
        return;
      }
      draw();
      if (s0.live.viewer.canEditSource) quietProbe();
    }

    // The owner's tab lists come from the workbook itself; failing to read it is not an error here.
    async function quietProbe() {
      try {
        const r = await rpc.call("probeSource", { url: "" });
        if (alive && ui.probe.state === "idle") { ui.probe = { state: "quiet", result: r }; draw(); }
      } catch (e) { /* the Probe button reports it when asked */ }
    }

    async function probe() {
      const s = sessionOf();
      ui.probe = { state: "busy" };
      draw();
      try {
        ui.probe = { state: "ok", result: await rpc.call("probeSource", { url: s.draft["source.sheetId"] }) };
      } catch (e) {
        ui.probe = { state: "err", message: e.message };
      }
      draw();
    }

    async function reload() {
      if (ui.reloadBusy) return;
      ui.reloadBusy = true;
      draw();
      try {
        await withRefresh(async () => {
          await rpc.call("reloadData");
          await refreshData();
        });
        ui.reloadedAt = true;
        toast("Data reloaded · " + register.allRows().length + " applications");
      } catch (e) {
        toast(e.message, { kind: "err" });
      }
      ui.reloadBusy = false;
      draw();
    }

    async function conflict(e) {
      try {
        const resp = await rpc.call("getSettings");
        store.set({ settingsDraft: newSession(resp, metaUrl()) });
        banner = { kind: "conflict", text: e.message + " The settings on this page were reloaded, so your unsaved changes were discarded. Make them again and save." };
        toast("Settings reloaded: someone else saved first", { kind: "err" });
      } catch (e2) {
        banner = { kind: "error", text: e2.message };
      }
    }

    async function save() {
      const session = sessionOf();
      if (busy || !session || errorsOf(session).problems.length) return;
      const patch = toPatch(session.savedDraft, session.draft);
      if (!Object.keys(patch).length) return;
      busy = true;
      banner = null;
      draw();
      try {
        const res = await rpc.call("saveSettings", { patch, baseGen: session.baseGen });
        const sections = sectionsOf(patch);
        adoptPublic(res.settings, res.cfgGen);
        let next = committed(session, res.settings, res.cfgGen, metaUrl());
        if (sections.indexOf("source") >= 0 || sections.indexOf("fields") >= 0) {
          await refreshData();
          const resp = await rpc.call("getSettings");
          next = { ...committed(session, res.settings, resp.cfgGen, metaUrl()), headers: resp.headers, examples: resp.examples };
          ui.probe = { state: "idle" };
        }
        store.set({ settingsDraft: next });
        toast(clampedText(res.clamped) || "Settings saved");
      } catch (e) {
        if (e.kind === "conflict") await conflict(e);
        else {
          banner = { kind: "error", text: e.kind === "busy" ? "Someone else is saving the settings right now. Wait a moment and save again." : e.message };
          toast(e.message, { kind: "err" });
        }
      }
      busy = false;
      draw();
    }

    const offs = [];
    offs.push(store.subscribe((n, p) => {
      if (n.settingsDraft !== p.settingsDraft || n.tab !== p.tab || n.core !== p.core) draw();
    }));

    offs.push(delegate(el, "click", "[data-act]", (ev, b) => {
      const act = b.getAttribute("data-act");
      if (act.indexOf("s-") !== 0) return;
      const s = sessionOf();
      if (act === "s-tab") navigate({ tab: b.getAttribute("data-tab") }, "replace");
      else if (act === "s-back") navigate({ route: homeRoute(store.get()), app: null, tab: null, view: null }, "push");
      else if (act === "s-tier") setRule(b.getAttribute("data-rule"), "tier", Number(b.getAttribute("data-tier")));
      else if (act === "s-set") setDraft(b.getAttribute("data-key"), b.getAttribute("data-v"));
      else if (act === "s-discard" && s) { banner = null; ui.probe = { state: "idle" }; store.set({ settingsDraft: discard(s) }); draw(); }
      else if (act === "s-save") save();
      else if (act === "s-reload") reload();
      else if (act === "s-probe") probe();
      else if (act === "s-adv") { ui.adv = !ui.adv; draw(); }
      else if (act === "s-dismiss") { banner = null; draw(); }
      else if (act === "s-retry") load();
    }));

    const read = (t) => {
      const type = t.getAttribute("data-type");
      if (type === "bool") return t.checked;
      if (type === "number") return t.value.trim() !== "" && Number.isFinite(Number(t.value)) ? Number(t.value) : undefined;
      return t.value;
    };
    const onField = (ev, t) => {
      const v = read(t);
      if (v !== undefined) setDraft(t.getAttribute("data-key"), v);
    };
    const onRule = (ev, t) => {
      const v = read(t);
      if (v !== undefined) setRule(t.getAttribute("data-rule"), t.getAttribute("data-prop"), v);
    };
    offs.push(delegate(el, "input", "input[data-rule][data-type=number]", onRule));
    offs.push(delegate(el, "change", "input[data-rule][type=checkbox]", onRule));
    offs.push(delegate(el, "input", "input[data-key]:not([type=checkbox])", onField));
    offs.push(delegate(el, "change", "select[data-key], input[type=checkbox][data-key]", onField));

    offs.push(delegate(el, "keydown", '[role="tab"]', (ev, t) => {
      const step = ev.key === "ArrowRight" ? 1 : ev.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      ev.preventDefault();
      const to = nextTab(t.getAttribute("data-tab"), step);
      navigate({ tab: to }, "replace");
      const b = qs(el, '[data-k="stt-' + to + '"]');
      if (b) b.focus();
    }));

    load();
    return () => { alive = false; endWait(); offs.forEach((f) => f()); accessCtl.dispose(); };
  },
};

registerPage("settings", settingsPage);
