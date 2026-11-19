// Access tab: who can open CCCP and who can change that. The mode (everyone at the owner's
// domain, or only the people listed) is the owner's alone; People is the owner's and the admins';
// Admins is shown only to the owner. Access saves are their own calls (api_saveAccess,
// api_saveAdmins, api_saveAccessMode), not part of the batched settings patch, so this tab has a
// Save access button of its own and its own unsaved-changes guard.
//
// THE PANEL IS NOT THE BOUNDARY. Every endpoint behind it checks the role again on the server;
// what is decided here is only what to draw. The roster rules (address parsing, the owner who
// cannot be removed, the diff of a save, whether the server kept what was sent) are the kit's
// accessModel; the unsaved guard is the kit's guardUnsaved. The view stays app-owned (Identity G
// rows, avatars, chips): the kit accessEditor holds the mode in the same draft and has no
// confirmation step, while here the mode is the owner's own call (saveAccessMode) that names what
// it will do first.
//
// access.js is a controller (createAccess) plus a pure view (accessView). The controller holds
// the roster being edited and asks page.js to redraw; the view only reads its state.
import {
  accessDiff, accessPatch, addEmails, createDraft, domainOf, normEmail, notKept, removeEmail,
} from "@gas-kit/ui/components/accessModel.js";
import { guardUnsaved } from "@gas-kit/client/unsaved.js";
import { delegate } from "@gas-kit/client/dom.js";
import { confirmDialog } from "../../lib/confirm.js";
import { pluralize } from "@gas-kit/client/format.js";
import { html } from "@gas-kit/client/html.js";
import * as rpc from "@gas-kit/client/rpc.js";
import { toast } from "../../lib/toast.js";
import { errorText } from "../../lib/errorText.js";

/** The words each refusal of an address gets. */
export const ADD_REJECTION = {
  "not-an-address": "That doesn't look like an email address.",
  "already-the-owner": "The owner always has access.",
  "already-listed": "That person is already on the list.",
  full: "The list is full, so that address does not fit.",
};

/**
 * Why the kit refused an address, as one of the keys of ADD_REJECTION. The owner is in the
 * kit's users list, so adding them reads there as already listed; here it has its own sentence.
 * @param {{value: string, reason: string}} r
 * @param {string} owner
 */
export function rejectionKey(r, owner) {
  if (r.value === normEmail(owner) || /owner/.test(r.reason)) return "already-the-owner";
  if (/already/.test(r.reason)) return "already-listed";
  if (/full/.test(r.reason)) return "full";
  return "not-an-address";
}

/** An address outside the owner's domain can never match a Google account here; flagged, not refused. */
export const outsideDomain = (email, domain) => !!domain && domainOf(email) !== String(domain).toLowerCase();

/** The editable people of a list: the owner is drawn as a locked row, never in the list. */
export const editable = (draft, list) => draft[list].filter((e) => e !== draft.owner);

/** Who a save would lock out, by name: the removals from users, then from admins. */
export function removals(base, draft) {
  const d = accessDiff(base, draft);
  return d.users.removed.concat(d.admins.removed);
}

/** Whether either list moved since it was loaded. */
export const isDirty = (base, draft) => accessDiff(base, draft).count > 0;

/**
 * Which save calls a submit needs. An unchanged list is not sent; the admins list is the
 * owner's, so it is never sent from an admin's panel (the server would refuse a no-op).
 */
export function pendingSaves(base, draft, canEditAdmins) {
  const p = accessPatch(base, draft);
  return { users: p.users !== undefined, admins: !!canEditAdmins && p.admins !== undefined };
}

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
    body: pluralize(n, "person", "people") + " keep" + (n === 1 ? "s" : "") + " access: the owner, the admins and the people on the list. Everyone else at " + (domain || "your organization") + " loses access on their next request.",
    confirmLabel: "Use the list",
    danger: true,
  };
}

const emptyState = () => ({
  status: "idle", message: "",
  canEditAdmins: false, canEditMode: false, mode: "list", owner: "", domain: "",
  draft: createDraft({}), base: createDraft({}),
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
  const users = editable(a.draft, "users");
  const empty = users.length ? "" : html`<p class="mut small">Nobody else yet. Only the owner and the admins can open CCCP${a.mode === "org" ? " unless everyone at " + a.domain + " is let in" : ""}.</p>`;
  return html`${owner}${empty}${users.map((e) => personRow(e, a.domain, "users", true))}${addRow(a, "users", "Add someone by email")}`;
}

function adminsBlock(a) {
  if (!a.canEditAdmins) return "";
  const admins = a.draft.admins;
  const empty = admins.length ? "" : html`<p class="mut small">No admins. Only the owner can change settings.</p>`;
  return html`${empty}${admins.length ? html`<div class="pchips">${admins.map((e) => chip(e, a.domain, "admins"))}</div>` : ""}${addRow(a, "admins", "Add an admin by email")}`;
}

/** ctx: {access}, the controller's state. */
export function accessView(ctx) {
  const a = ctx.access;
  if (a.status === "idle" || a.status === "loading") return html`<p class="mut" role="status" aria-busy="true"><span class="spin" aria-hidden="true"></span>Loading who has access…</p>`;
  if (a.status === "error") return html`<div class="callout error" role="alert" data-banner="error"><span>${a.message}</span><button type="button" class="btn sm" data-act="a-retry" data-k="a-retry">Retry</button></div>`;
  if (a.status === "forbidden") return html`<p class="mut" role="status">Only the owner or an admin can see who has access.</p>`;
  const dirty = isDirty(a.base, a.draft);
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
  /** @type {Map<string, any>} */
  const addInputs = new Map();
  const typedButNotAdded = () => Array.from(addInputs.values()).some((a) => a.text().trim() !== "");
  const offs = [];

  function adopt(info) {
    state.owner = normEmail(info.owner);
    state.domain = String(info.domain || "");
    // The owner is in the kit draft's users list, first; the view lifts it out and a save sends the list without it.
    state.draft = createDraft({ owner: info.owner, users: info.users, admins: info.admins, mode: info.mode });
    state.base = createDraft({ owner: info.owner, users: info.users, admins: info.admins, mode: info.mode });
    state.mode = state.draft.mode;
    state.canEditAdmins = !!info.canEditAdmins;
    state.canEditMode = !!info.canEditMode;
    addInputs.clear();
    register("users");
    if (state.canEditAdmins) register("admins");
  }

  // An address typed and not yet added is part of a save: see save().
  function register(list) {
    const commit = (flushing) => {
      const text = state.typed[list];
      if (text.trim() === "") return true;
      const res = addEmails(state.draft, list, text, state.owner);
      const bad = res.rejected.map((r) => ({ r, key: rejectionKey(r, state.owner) }));
      const invalid = bad.filter((b) => b.key === "not-an-address");
      // Flushing a save: an address already there is dropped quietly; one that is no address stops the save.
      const blocking = flushing ? invalid : bad;
      if (res.added.length) state.draft = res.draft;
      if (!blocking.length) {
        state.typed[list] = "";
        state.note[list] = "";
        redraw();
        return true;
      }
      // What did not fit stays in the box (the whole text when nothing was added), with the first reason.
      if (res.added.length) state.typed[list] = bad.map((b) => b.r.value).join(", ");
      state.note[list] = ADD_REJECTION[blocking[0].key];
      redraw();
      return false;
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
      state.message = errorText(e);
    }
    redraw();
  }

  /** The users list as the server takes it: the owner is written in by the server, not sent. */
  const sendable = (draft, list) => draft[list].filter((e) => e !== state.owner);

  async function save() {
    if (state.busy) return;
    // AN ADDRESS TYPED BUT NOT ADDED IS PART OF THE SAVE, and a bad one stops it.
    for (const { commit } of Array.from(addInputs.values())) {
      if (!commit(true)) return;
    }
    if (!isDirty(state.base, state.draft)) {
      toast("No changes to save.");
      return;
    }
    // REMOVALS GET A CONFIRMATION NAMING NAMES: a removal locks someone out on their next request.
    const gone = removals(state.base, state.draft);
    if (gone.length) {
      const ok = await confirmDialog({
        title: gone.length === 1 ? "Remove one person?" : "Remove " + gone.length + " people?",
        body: gone.join(", ") + " will lose access on their next request.",
        confirmLabel: "Remove",
        danger: true,
      });
      if (!ok) return;
    }
    const pending = pendingSaves(state.base, state.draft, state.canEditAdmins);
    const sentUsers = pending.users ? sendable(state.draft, "users") : [];
    const sentAdmins = pending.admins ? sendable(state.draft, "admins") : [];
    state.busy = true;
    redraw();
    try {
      if (pending.users) await rpc.call("saveAccess", { users: sentUsers.join(", "), base: sendable(state.base, "users").join(", ") });
      if (pending.admins) await rpc.call("saveAdmins", { admins: sentAdmins.join(", "), base: sendable(state.base, "admins").join(", ") });
      // Re-read rather than trust the local lists: the owner is written back in, and the server
      // is what decides what was kept.
      const fresh = await rpc.call("getAccess");
      const lost = notKept(sentUsers, fresh.users || []).concat(notKept(sentAdmins, fresh.admins || []));
      if (lost.length) toast("Not saved: " + lost.join(", ") + ". Reload and try again.", { kind: "err" });
      else toast("Access updated.");
      adopt(fresh);
    } catch (e) {
      toast(errorText(e), { kind: "err" });
    }
    state.busy = false;
    redraw();
  }

  async function setMode(mode) {
    if (!state.canEditMode || mode === state.mode || (mode !== "org" && mode !== "list")) { redraw(); return; }
    const info = { owner: state.owner, domain: state.domain, users: sendable(state.base, "users"), admins: sendable(state.base, "admins") };
    const ok = await confirmDialog(modeConfirm(mode, info));
    if (!ok) { redraw(); return; }
    try {
      const res = await rpc.call("saveAccessMode", { mode });
      /** @type {"list"|"org"} */
      const saved = res.mode === "org" ? "org" : "list";
      state.mode = saved;
      // The mode is saved on its own, so it moves in both drafts and never counts as an unsaved change.
      state.draft = { ...state.draft, mode: saved };
      state.base = { ...state.base, mode: saved };
      toast(state.mode === "org"
        ? "Everyone at " + state.domain + " can now open CCCP."
        : "Back to the list. " + pluralize(keepers(info).length, "person", "people") + " keep access.");
    } catch (e) {
      toast(errorText(e), { kind: "err" });
    }
    redraw();
  }

  offs.push(delegate(el, "click", "[data-act]", (ev, /** @type {any} */ b) => {
    const act = b.getAttribute("data-act");
    if (act.indexOf("a-") !== 0) return;
    const list = b.getAttribute("data-list");
    if (act === "a-save") save();
    else if (act === "a-retry") load();
    else if (act === "a-add" && addInputs.has(list)) addInputs.get(list).commit(false);
    else if (act === "a-remove" && addInputs.has(list)) {
      const res = removeEmail(state.draft, list, b.getAttribute("data-email"), state.owner);
      if (res.ok) { state.draft = res.draft; redraw(); }
    }
  }));
  offs.push(delegate(el, "input", "input[data-add]", (ev, /** @type {any} */ t) => {
    state.typed[t.getAttribute("data-add")] = t.value;
    if (state.note[t.getAttribute("data-add")]) state.note[t.getAttribute("data-add")] = "";
  }));
  offs.push(delegate(el, "keydown", "input[data-add]", (ev, /** @type {any} */ t) => {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    const a = addInputs.get(t.getAttribute("data-add"));
    if (a) a.commit(false);
  }));
  offs.push(delegate(el, "change", "input[data-mode]", (ev, /** @type {any} */ t) => setMode(t.getAttribute("data-mode"))));

  // A reload with unsaved edits, or an address still in its box, asks first. The guard drops
  // itself once el leaves the document, and dispose() drops it at once.
  offs.push(guardUnsaved(el, () => isDirty(state.base, state.draft) || typedButNotAdded()));

  return {
    state,
    ensureLoaded() { if (state.status === "idle") load(); },
    dirty: () => state.status === "ready" && (isDirty(state.base, state.draft) || typedButNotAdded()),
    dispose() { offs.forEach((f) => f()); },
  };
}
