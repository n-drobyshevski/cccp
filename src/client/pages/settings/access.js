// Access tab: who can open CCCP and who can change that. The mode (everyone at the owner's
// domain, or only the people listed) is the owner's alone; People is the owner's and the admins';
// Admins is shown only to the owner. Access saves are their own calls (api_saveAccess,
// api_saveAdmins, api_saveAccessMode), not part of the batched settings patch, so this tab has a
// Save access button of its own and its own unsaved-changes guard.
//
// THE PANEL IS NOT THE BOUNDARY. Every endpoint behind it checks the role again on the server;
// what is decided here is only what to draw. The roster rules (owner row locked, outside-domain
// warning, who a save would lock out, what is sent) are the vendored accessModel, and notKept and
// guardUnsaved are the vendored accessSave helpers.
//
// access.js is a controller (createAccess) plus a pure view (accessView). The controller holds
// the roster being edited and asks page.js to redraw; the view only reads its state.
import { guardUnsaved, notKept } from "gas_shared/ui/accessSave.js";
import {
  ADD_REJECTION, isAddable, isDirty, outsideDomain, pendingSaves, removals, splitRoster,
} from "../../../vendor/gas_hub/src/client/js/pages/accessModel.js";
import { delegate } from "../../lib/dom.js";
import { confirmDialog } from "../../lib/confirm.js";
import { count } from "../../lib/format.js";
import { html } from "../../lib/html.js";
import * as rpc from "../../lib/rpc.js";
import { toast } from "../../lib/toast.js";

/** Two letters for the avatar: 'jane.doe@x.com' is JD. */
export function initials(email) {
  const local = String(email == null ? "" : email).split("@")[0];
  const parts = local.split(/[._-]+/).filter(Boolean);
  const s = parts.length > 1 ? parts[0][0] + parts[1][0] : local.slice(0, 2);
  return (s || "?").toUpperCase();
}

/**
 * Everyone who can open CCCP in list mode: the owner, the admins and the people listed, once
 * each. This is the number the switch back to list states, so nobody is surprised by it.
 */
export function keepers(info) {
  const seen = [];
  const add = (e) => {
    const k = String(e || "").trim().toLowerCase();
    if (k && seen.indexOf(k) < 0) seen.push(k);
  };
  add(info && info.owner);
  for (const e of (info && info.users) || []) add(e);
  for (const e of (info && info.admins) || []) add(e);
  return seen;
}

/** The words of the two confirmations, so a test can read them without a dialog. */
export function modeConfirm(mode, info) {
  const domain = String((info && info.domain) || "");
  if (mode === "org") {
    return {
      title: "Let everyone at " + domain + " open CCCP?",
      body: "Anyone signed in with an address ending in @" + domain + " will be able to open CCCP, read only, without being on the list. Admins and the owner stay as they are.",
      confirmLabel: "Allow " + domain,
      danger: false,
    };
  }
  const n = keepers(info).length;
  return {
    title: "Go back to the list?",
    body: count(n, "person", "people") + " keep" + (n === 1 ? "s" : "") + " access: the owner, the admins and the people on the list. Everyone else at " + (domain || "your organization") + " loses access on their next request.",
    confirmLabel: "Use the list",
    danger: true,
  };
}

const emptyState = () => ({
  status: "idle", message: "",
  canEditAdmins: false, canEditMode: false, mode: "list", owner: "", domain: "",
  users: [], admins: [],
  baseline: { users: [], admins: [] }, saved: { users: "", admins: "" },
  typed: { users: "", admins: "" }, note: { users: "", admins: "" },
  busy: false,
});

// ------------------------------------------------------------------------------------ view

function personRow(email, domain, list, canRemove) {
  const off = outsideDomain(email, domain);
  const tip = "This address is not in " + domain + ", so no Google account here can match it and adding it grants nothing.";
  return html`<div class="prow" data-person="${email}"><span class="av" aria-hidden="true">${initials(email)}</span><span class="pe">${email}</span>${off ? html`<span class="pwarn" tabindex="0" data-tip="${tip}" aria-label="Outside ${domain}. ${tip}">outside ${domain}</span>` : ""}${canRemove ? html`<button type="button" class="prm" data-act="a-remove" data-list="${list}" data-email="${email}" data-k="rm-${list}-${email}" aria-label="Remove ${email}">×</button>` : ""}</div>`;
}

/** Admins are few: they are shown as chips, as in the approved Settings mockup. */
function chip(email, domain, list) {
  const off = outsideDomain(email, domain);
  const tip = "This address is not in " + domain + ", so no Google account here can match it and adding it grants nothing.";
  return html`<span class="pchip" data-person="${email}"><span class="av" aria-hidden="true">${initials(email)}</span>${email}${off ? html`<span class="pwarn" tabindex="0" data-tip="${tip}" aria-label="Outside ${domain}. ${tip}">outside ${domain}</span>` : ""}<button type="button" class="prm" data-act="a-remove" data-list="${list}" data-email="${email}" data-k="rm-${list}-${email}" aria-label="Remove ${email}">×</button></span>`;
}

function addRow(a, list, placeholder) {
  const note = a.note[list];
  return html`<div class="addp"><input class="inp wide" data-add="${list}" data-k="add-${list}" placeholder="${placeholder}" aria-label="${placeholder}" value="${a.typed[list]}"${note ? html` aria-invalid="true"` : ""}><button type="button" class="btn" data-act="a-add" data-list="${list}" data-k="add-btn-${list}">Add</button></div>${note ? html`<small class="errtxt" role="alert" data-add-note="${list}">${note}</small>` : ""}`;
}

function sf(label, help, ctrl) {
  return html`<div class="sf"><div class="sfl"><b>${label}</b>${help ? html`<small>${help}</small>` : ""}</div><div class="sfc">${ctrl}</div></div>`;
}

function modeCards(a) {
  const noDomain = a.domain === "";
  const cards = [
    ["org", noDomain ? "Everyone in your organization" : "Everyone at " + a.domain, noDomain ? "The owner's address has no company domain, so this is not available." : "Anyone signed in with an @" + a.domain + " account"],
    ["list", "Only the people listed", "The owner, the admins and the people below"],
  ];
  return html`<div class="rcards" role="radiogroup" aria-label="Who can open CCCP">${cards.map(([v, title, small]) => html`<label class="rcard"><input type="radio" name="who" value="${v}" data-mode="${v}" data-k="mode-${v}"${a.mode === v ? html` checked` : ""}${!a.canEditMode || (v === "org" && noDomain) ? html` disabled` : ""}><span><b>${title}</b><small>${small}</small></span></label>`)}</div>${a.canEditMode ? "" : html`<small class="mut why-ro" data-mode-ro>Only the owner can change this.</small>`}`;
}

function peopleBlock(a) {
  const owner = html`<div class="prow locked" data-owner-row><span class="av" aria-hidden="true">${initials(a.owner)}</span><span class="pe">${a.owner}</span><span class="mut">Owner · always has access</span></div>`;
  const empty = a.users.length ? "" : html`<p class="mut small">Nobody else yet. Only the owner and the admins can open CCCP${a.mode === "org" ? " unless everyone at " + a.domain + " is let in" : ""}.</p>`;
  return html`${owner}${empty}${a.users.map((e) => personRow(e, a.domain, "users", true))}${addRow(a, "users", "Add someone by email")}`;
}

function adminsBlock(a) {
  if (!a.canEditAdmins) return "";
  const empty = a.admins.length ? "" : html`<p class="mut small">No admins. Only the owner can change settings.</p>`;
  return html`${empty}${a.admins.length ? html`<div class="pchips">${a.admins.map((e) => chip(e, a.domain, "admins"))}</div>` : ""}${addRow(a, "admins", "Add an admin by email")}`;
}

/** ctx: {access}, the controller's state. */
export function accessView(ctx) {
  const a = ctx.access;
  if (a.status === "idle" || a.status === "loading") return html`<p class="mut" role="status" aria-busy="true"><span class="spin" aria-hidden="true"></span>Loading who has access…</p>`;
  if (a.status === "error") return html`<div class="callout error" role="alert" data-banner="error"><span>${a.message}</span><button type="button" class="btn sm" data-act="a-retry" data-k="a-retry">Retry</button></div>`;
  if (a.status === "forbidden") return html`<p class="mut" role="status">Only the owner or an admin can see who has access.</p>`;
  const dirty = isDirty(a, a.saved);
  return html`<div class="sgrp" data-region="access">
    ${sf("Who can open CCCP", "Everyone opens it read only.", modeCards(a))}
    ${sf("People", "People who can open CCCP, read only. Admins can add and remove them." + (a.canEditAdmins ? "" : " Only the owner can change who is an admin."), html`<div class="acl" data-people>${peopleBlock(a)}</div>`)}
    ${a.canEditAdmins ? sf("Admins", "Admins see this Settings page. Only you, as the owner, can change who is an admin.", html`<div class="acl" data-admins-editor>${adminsBlock(a)}</div>`) : ""}</div>
    <div class="accfoot"><button type="button" class="btn pri" data-act="a-save" data-k="a-save"${a.busy ? html` disabled` : ""}>Save access</button>${dirty ? html`<span class="unsaved" data-access-dirty><span class="dirtydot" aria-hidden="true"></span>Unsaved changes</span>` : ""}</div>`;
}

// ------------------------------------------------------------------------------------ controller

/**
 * One controller per mounted Settings page. `el` is the page element (delegation root) and
 * `redraw` asks the page to render again. Returns {state, ensureLoaded, dirty, dispose}.
 */
export function createAccess({ el, redraw }) {
  const state = emptyState();
  const baseline = state.baseline;
  const saved = state.saved;
  const addInputs = new Map();
  const typedButNotAdded = () => Array.from(addInputs.values()).some((a) => a.text().trim() !== "");
  const offs = [];

  function adopt(info) {
    const r = splitRoster(info);
    state.owner = r.owner;
    state.domain = r.domain;
    state.users = r.users;
    state.admins = r.admins;
    state.mode = info.mode === "org" ? "org" : "list";
    state.canEditAdmins = !!info.canEditAdmins;
    state.canEditMode = !!info.canEditMode;
    baseline.users = r.users.slice();
    baseline.admins = r.admins.slice();
    saved.users = baseline.users.join(",");
    saved.admins = baseline.admins.join(",");
    addInputs.clear();
    register("users", () => state.users);
    if (state.canEditAdmins) register("admins", () => state.admins);
  }

  // An address typed and not yet added is part of a save: see save().
  function register(list, items) {
    const commit = (flushing) => {
      const verdict = isAddable(state.typed[list], items(), state.owner);
      if (!verdict.ok) {
        if (verdict.reason === "empty") return true;
        if (flushing && verdict.reason !== "not-an-address") {
          state.typed[list] = "";
          return true;
        }
        state.note[list] = ADD_REJECTION[verdict.reason];
        redraw();
        return false;
      }
      state.typed[list] = "";
      state.note[list] = "";
      items().push(verdict.value);
      redraw();
      return true;
    };
    addInputs.set(list, { text: () => state.typed[list], commit });
  }

  async function load() {
    state.status = "loading";
    try {
      const info = await rpc.call("getAccess");
      if (!info || !info.canEditUsers) state.status = "forbidden";
      else { adopt(info); state.status = "ready"; }
    } catch (e) {
      state.status = "error";
      state.message = e.message;
    }
    redraw();
  }

  async function save() {
    if (state.busy) return;
    // AN ADDRESS TYPED BUT NOT ADDED IS PART OF THE SAVE, and a bad one stops it.
    for (const { commit } of Array.from(addInputs.values())) {
      if (!commit(true)) return;
    }
    if (!isDirty(state, saved)) {
      toast("No changes to save.");
      return;
    }
    // REMOVALS GET A CONFIRMATION NAMING NAMES: a removal locks someone out on their next request.
    const gone = removals(baseline, state);
    if (gone.length) {
      const ok = await confirmDialog({
        title: gone.length === 1 ? "Remove one person?" : "Remove " + gone.length + " people?",
        body: gone.join(", ") + " will lose access on their next request.",
        confirmLabel: "Remove",
        danger: true,
      });
      if (!ok) return;
    }
    const pending = pendingSaves(state, saved, state.canEditAdmins);
    const sentUsers = pending.users ? state.users.slice() : [];
    const sentAdmins = pending.admins ? state.admins.slice() : [];
    state.busy = true;
    redraw();
    try {
      if (pending.users) await rpc.call("saveAccess", { users: state.users.join(", ") });
      if (pending.admins) await rpc.call("saveAdmins", { admins: state.admins.join(", ") });
      // Re-read rather than trust the local lists: the owner is written back in, and the server
      // is what decides what was kept.
      const fresh = await rpc.call("getAccess");
      const lost = notKept(sentUsers, fresh.users || []).concat(notKept(sentAdmins, fresh.admins || []));
      if (lost.length) toast("Not saved: " + lost.join(", ") + ". Reload and try again.", { kind: "err" });
      else toast("Access updated.");
      adopt(fresh);
    } catch (e) {
      toast(e.message, { kind: "err" });
    }
    state.busy = false;
    redraw();
  }

  async function setMode(mode) {
    if (!state.canEditMode || mode === state.mode || (mode !== "org" && mode !== "list")) { redraw(); return; }
    const info = { owner: state.owner, domain: state.domain, users: baseline.users, admins: baseline.admins };
    const ok = await confirmDialog(modeConfirm(mode, info));
    if (!ok) { redraw(); return; }
    try {
      const res = await rpc.call("saveAccessMode", { mode });
      state.mode = res.mode === "org" ? "org" : "list";
      toast(state.mode === "org"
        ? "Everyone at " + state.domain + " can now open CCCP."
        : "Back to the list. " + count(keepers(info).length, "person", "people") + " keep access.");
    } catch (e) {
      toast(e.message, { kind: "err" });
    }
    redraw();
  }

  const listOf = (name) => (name === "admins" ? state.admins : state.users);

  offs.push(delegate(el, "click", "[data-act]", (ev, b) => {
    const act = b.getAttribute("data-act");
    if (act.indexOf("a-") !== 0) return;
    const list = b.getAttribute("data-list");
    if (act === "a-save") save();
    else if (act === "a-retry") load();
    else if (act === "a-add" && addInputs.has(list)) addInputs.get(list).commit(false);
    else if (act === "a-remove" && addInputs.has(list)) {
      const at = listOf(list).indexOf(b.getAttribute("data-email"));
      if (at >= 0) { listOf(list).splice(at, 1); redraw(); }
    }
  }));
  offs.push(delegate(el, "input", "input[data-add]", (ev, t) => {
    state.typed[t.getAttribute("data-add")] = t.value;
    if (state.note[t.getAttribute("data-add")]) state.note[t.getAttribute("data-add")] = "";
  }));
  offs.push(delegate(el, "keydown", "input[data-add]", (ev, t) => {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    const a = addInputs.get(t.getAttribute("data-add"));
    if (a) a.commit(false);
  }));
  offs.push(delegate(el, "change", "input[data-mode]", (ev, t) => setMode(t.getAttribute("data-mode"))));

  // A reload with unsaved edits, or an address still in its box, asks first.
  guardUnsaved(el, () => isDirty(state, saved) || typedButNotAdded());

  return {
    state,
    ensureLoaded() { if (state.status === "idle") load(); },
    dirty: () => state.status === "ready" && (isDirty(state, saved) || typedButNotAdded()),
    dispose() { offs.forEach((f) => f()); },
  };
}
