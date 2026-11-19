// Extracted from the author's production Apps Script apps; adapted.
// The access editor: who may open the app. An access mode (listed people or the owner's
// domain), a users list and an admins list with add and remove, and a summary of what a save
// would change. It renders a draft held by the app (see accessModel); the owner row has no
// remove button. Owner-only parts render read-only for an admin.
import { attrs, html } from "@gas-kit/client/html.js";
import { pluralize } from "@gas-kit/client/format.js";
import { accessDiff, domainOf, foreignAddresses, normEmail } from "./accessModel.js";

/**
 * @param {{key: "users"|"admins", title: string, hint: string, entries: string[], owner: string, editable: boolean, base: string[]|null, input: string, message?: string|null, outside: string[], id: string, noun: string}} o
 */
function listBlock(o) {
  const msgId = o.id + "-" + o.key + "-msg";
  const inId = o.id + "-" + o.key + "-in";
  const rows = o.entries.map((e) => {
    const isOwner = o.key === "users" && normEmail(e) === o.owner;
    const isNew = !!o.base && o.base.indexOf(e) < 0;
    const foreign = o.outside.indexOf(e) >= 0;
    return html`<li class="gk-accessEditor__row${isNew ? " is-new" : ""}"><span class="gk-accessEditor__email">${e}</span>${
      isOwner ? html`<span class="gk-accessEditor__tag">Owner</span>` : null
    }${isNew ? html`<span class="gk-accessEditor__tag is-new">New</span>` : null}${
      foreign ? html`<span class="gk-accessEditor__tag is-outside">Other domain</span>` : null
    }${
      !o.editable ? null : isOwner
        ? html`<span class="gk-accessEditor__fixed">Cannot be removed</span>`
        : html`<button type="button" class="gk-accessEditor__x gk-btn" data-variant="outline" data-size="sm" ${attrs({
          "data-act": "accessEditor:remove", "data-list": o.key, "data-email": e, "data-k": "rm-" + o.key + "-" + e, "aria-label": "Remove " + e + " from " + o.key,
        })}>Remove</button>`
    }</li>`;
  });
  const adder = o.editable ? html`<div class="gk-accessEditor__add"><label class="gk-accessEditor__label" for="${inId}">Add ${o.noun}</label><div class="gk-accessEditor__addrow"><input type="text" class="gk-accessEditor__input gk-input" autocomplete="off" ${attrs({
    id: inId, value: o.input, placeholder: "name@example.org", "data-act": "accessEditor:input", "data-list": o.key, "data-k": "in-" + o.key,
    "aria-invalid": o.message ? "true" : null, "aria-describedby": o.message ? msgId : null,
  })}><button type="button" class="gk-accessEditor__btn gk-btn" data-variant="default" data-act="accessEditor:add" data-list="${o.key}" data-k="${"add-" + o.key}">Add</button></div>${
    o.message ? html`<span class="gk-accessEditor__error" id="${msgId}" role="alert"><strong>Error:</strong> ${o.message}</span>` : null
  }<span class="gk-accessEditor__hint">Paste several addresses separated by commas, spaces or new lines.</span></div>` : html`<p class="gk-accessEditor__note">Only the owner can change this list.</p>`;
  return html`<section class="gk-accessEditor__block" aria-labelledby="${o.id}-${o.key}-h"><h3 class="gk-accessEditor__h" id="${o.id}-${o.key}-h">${o.title} <span class="gk-accessEditor__n">(${o.entries.length})</span></h3><p class="gk-accessEditor__hint">${o.hint}</p>${
    rows.length ? html`<ul class="gk-accessEditor__list">${rows}</ul>` : html`<p class="gk-accessEditor__none">Nobody is listed.</p>`
  }${adder}</section>`;
}

/**
 * @component accessEditor
 * @title Access Editor
 * @category Domain
 * @summary An owner and admin editor for who may open the app: access mode, users, admins and a summary of unsaved changes.
 * @param {{owner: string, draft: {users: string[], admins: string[], mode: "list"|"org"}, base?: {users: string[], admins: string[], mode: "list"|"org"}|null, canEditUsers?: boolean, canEditAdmins?: boolean, canEditMode?: boolean, input?: {users?: string, admins?: string}, messages?: {users?: string|null, admins?: string|null, mode?: string|null}, id?: string}} p
 * `draft` is the working copy; `base` is the saved copy and turns on the New marks and the change summary. `canEditUsers` defaults to true; admins and mode are owner-only and default to false.
 * The view renders no form, so Enter in an Add input does nothing by itself: the app should delegate a keydown on Enter from [data-act="accessEditor:input"] to the same handler as accessEditor:add for that data-list.
 * @emits accessEditor:mode (data-mode), accessEditor:add (data-list), accessEditor:remove (data-list, data-email), accessEditor:input (data-list; read the value)
 * @states default, ownerView, orgMode, changed, error
 * @a11y The mode is a radio group in a fieldset with a legend. Each list is a section with a heading and a list; Remove buttons say who and from which list. The owner row says "Owner" and "Cannot be removed" in words. New and Other domain are text tags, not colour alone. Errors are role=alert and linked to the input with aria-describedby.
 * @example default: accessEditor({ owner: "owner@example.org", draft: { users: ["owner@example.org", "ana@example.org"], admins: [], mode: "list" }, canEditUsers: true })
 * @example ownerView: accessEditor({ owner: "owner@example.org", draft: { users: ["owner@example.org", "ana@example.org"], admins: ["bo@example.org"], mode: "list" }, canEditUsers: true, canEditAdmins: true, canEditMode: true })
 * @example orgMode: accessEditor({ owner: "owner@example.org", draft: { users: ["owner@example.org"], admins: [], mode: "org" }, canEditUsers: true, canEditMode: true })
 * @example changed: accessEditor({ owner: "owner@example.org", draft: { users: ["owner@example.org", "ana@example.org", "guest@other.test"], admins: [], mode: "list" }, base: { users: ["owner@example.org", "cy@example.org"], admins: [], mode: "list" }, canEditUsers: true })
 * @example error: accessEditor({ owner: "owner@example.org", draft: { users: ["owner@example.org"], admins: [], mode: "list" }, canEditUsers: true, input: { users: "not-an-email" }, messages: { users: "not-an-email is not a valid email address" } })
 */
export function accessEditor(p) {
  const id = p.id || "ae";
  const owner = normEmail(p.owner);
  const d = p.draft || { users: [], admins: [], mode: "list" };
  const base = p.base || null;
  const canUsers = p.canEditUsers !== false;
  const input = p.input || {};
  const msg = p.messages || {};
  const domain = domainOf(owner);
  const modes = [
    { value: "list", label: "Only people on the lists", hint: "Users and admins listed below, plus the owner." },
    { value: "org", label: domain ? "Anyone at " + domain : "Anyone in the owner's organization", hint: "Everyone with an address at the owner's domain, plus the lists below." },
  ];
  const modeGroup = html`<fieldset class="gk-accessEditor__mode"${p.canEditMode ? null : html` disabled`}><legend class="gk-accessEditor__h">Who can open the app</legend>${modes.map((m) => html`<label class="gk-accessEditor__opt"><input type="radio" ${attrs({
    name: id + "-mode", value: m.value, checked: d.mode === m.value, "data-act": "accessEditor:mode", "data-mode": m.value, "data-k": "mode-" + m.value,
    disabled: !p.canEditMode, "aria-describedby": id + "-mode-" + m.value + (msg.mode ? " " + id + "-mode-msg" : ""),
  })}><span><span class="gk-accessEditor__optLabel">${m.label}</span><span class="gk-accessEditor__hint" id="${id}-mode-${m.value}">${m.hint}</span></span></label>`)}${
    p.canEditMode ? null : html`<p class="gk-accessEditor__note">Only the owner can change the access mode.</p>`
  }${msg.mode ? html`<span class="gk-accessEditor__error" id="${id}-mode-msg" role="alert"><strong>Error:</strong> ${msg.mode}</span>` : null}</fieldset>`;
  const diff = base ? accessDiff(base, d) : null;
  const sum = diff && diff.count > 0 ? (() => {
    const parts = [];
    for (const k of /** @type {const} */ (["users", "admins"])) {
      if (diff[k].added.length) parts.push(diff[k].added.length + " added to " + k);
      if (diff[k].removed.length) parts.push(diff[k].removed.length + " removed from " + k);
    }
    if (diff.mode) parts.push("mode changes from " + diff.mode.from + " to " + diff.mode.to);
    return html`<p class="gk-accessEditor__summary" role="status"><strong>${pluralize(diff.count, "unsaved change")}:</strong> ${parts.join(", ")}.</p>`;
  })() : null;
  const common = { id, owner, input: "", outside: /** @type {string[]} */ ([]), base: null };
  const users = listBlock(Object.assign({}, common, {
    key: /** @type {const} */ ("users"), title: "Users", noun: "a user", hint: "People who can open the app.", entries: d.users, editable: canUsers,
    base: base ? base.users : null, input: input.users || "", message: msg.users, outside: foreignAddresses(d.users, owner),
  }));
  const admins = listBlock(Object.assign({}, common, {
    key: /** @type {const} */ ("admins"), title: "Admins", noun: "an admin", hint: "People who can also edit settings and the users list.", entries: d.admins, editable: !!p.canEditAdmins,
    base: base ? base.admins : null, input: input.admins || "", message: msg.admins, outside: foreignAddresses(d.admins, owner),
  }));
  return html`<div class="gk-accessEditor">${sum}${modeGroup}${users}${admins}</div>`;
}
