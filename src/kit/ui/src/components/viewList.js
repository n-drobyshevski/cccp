// Saved views: a pure list of shared and personal views for a filtered list or table.
import { html } from "@gas-kit/client/html.js";
import { button } from "./button.js";
import { badge } from "./badge.js";

/** @param {any} v @param {string} activeId @param {boolean} manage @param {boolean} [shared] */
function row(v, activeId, manage, shared) {
  const on = v.id === activeId;
  const id = String(v.id);
  return html`<li class="gk-viewlist__item${on ? " is-active" : ""}"><button type="button" class="gk-viewlist__open" data-act="view:open" data-v="${id}" data-k="vl-open-${id}"${on ? html` aria-current="true"` : ""}><span class="gk-viewlist__name">${v.name}</span>${v.count != null ? html`<span class="gk-viewlist__count">${v.count}</span>` : ""}</button>${manage ? html`<span class="gk-viewlist__acts">${button({ label: "Rename", variant: "ghost", size: "sm", act: "view:rename", k: "vl-rename-" + id, v: id, ariaLabel: "Rename " + v.name })}${button({ label: "Delete", variant: "ghost", size: "sm", act: "view:delete", k: "vl-delete-" + id, v: id, ariaLabel: "Delete " + v.name })}</span>` : shared ? html`<span class="gk-viewlist__acts">${button({ label: "Delete", variant: "ghost", size: "sm", act: "view:delete-shared", k: "vl-delsh-" + id, v: id, ariaLabel: "Delete shared view " + v.name })}</span>` : ""}</li>`;
}

/**
 * @component viewList
 * @title View List
 * @category Data display
 * @summary Shared and personal saved views, with the open one marked and Save actions when it has changed.
 * @param {{shared?: Array<{id: string, name: string, count?: number}>, personal?: Array<{id: string, name: string, count?: number}>, activeId?: string, changed?: boolean, canSave?: boolean, canUpdate?: boolean, canShare?: boolean, k?: string}} p
 * `shared` are published by admins and are read-only unless `canShare` is true, which adds Delete on shared rows and Share with everyone for the open personal view. `personal` get Rename and Delete. `activeId` marks the open view. With `changed` true the open view shows a "changed" badge, plus Save when `canUpdate` and the open view is personal (or shared with `canShare`), and Save as new when `canSave`. A "Save view" button is always shown under My views when `canSave` is not false. `canSave` false (storage refused) hides every personal control. `count` is an optional number of matching rows.
 * @emits view:open (data-v is the view id), view:update, view:save-new, view:rename (data-v), view:delete (data-v), view:delete-shared (data-v, canShare), view:publish (data-v, canShare)
 * @states default, changed, empty, shared-only, admin
 * @a11y Two labelled lists. The open view has aria-current and is-active styling, and the changed state is a text badge, never colour alone. Every button is native and carries a name that includes the view.
 * @example default: viewList({ k: "vl-a", activeId: "p1", shared: [{ id: "s1", name: "Open reviews", count: 42 }], personal: [{ id: "p1", name: "My team", count: 7 }, { id: "p2", name: "Due this month", count: 12 }], canSave: true, canUpdate: true })
 * @example changed: viewList({ k: "vl-b", activeId: "p1", changed: true, shared: [{ id: "s1", name: "Open reviews" }], personal: [{ id: "p1", name: "My team" }], canSave: true, canUpdate: true })
 * @example empty: viewList({ k: "vl-c", shared: [], personal: [], canSave: true })
 * @example shared-only: viewList({ k: "vl-d", activeId: "s1", shared: [{ id: "s1", name: "Open reviews", count: 42 }], personal: [], canSave: false })
 * @example admin: viewList({ k: "vl-e", activeId: "p1", changed: true, shared: [{ id: "s1", name: "Open reviews" }], personal: [{ id: "p1", name: "My team" }], canSave: true, canUpdate: true, canShare: true })
 */
export function viewList(p) {
  const q = p || {};
  const shared = Array.isArray(q.shared) ? q.shared : [];
  const personal = q.canSave === false ? [] : Array.isArray(q.personal) ? q.personal : [];
  const active = q.activeId != null ? String(q.activeId) : "";
  const k = q.k != null && q.k !== "" ? String(q.k) : "view-list";
  const isPersonal = personal.some((v) => String(v.id) === active);
  const isShared = shared.some((v) => String(v.id) === active);
  const canShare = q.canShare === true;
  const showUpdate = q.canUpdate === true && (isPersonal || (canShare && isShared));
  const cue = q.changed === true && active !== ""
    ? html`<div class="gk-viewlist__changed">${badge({ text: "changed", variant: "warn" })}${showUpdate ? button({ label: "Save", size: "sm", act: "view:update", k: k + "-update", ariaLabel: "Save changes to the open view" }) : ""}${q.canSave !== false ? button({ label: "Save as new", variant: "outline", size: "sm", act: "view:save-new", k: k + "-new" }) : ""}</div>`
    : "";
  const publish = canShare && isPersonal ? button({ label: "Share with everyone", variant: "outline", size: "sm", act: "view:publish", k: k + "-publish", v: active, ariaLabel: "Share the open view with everyone" }) : "";
  const saveNew = q.canSave === false || q.changed === true && active !== "" ? "" : button({ label: "Save view", variant: "outline", size: "sm", act: "view:save-new", k: k + "-save" });
  const sharedList = shared.length ? html`<ul class="gk-viewlist__list">${shared.map((v) => row(v, active, false, canShare))}</ul>` : "";
  const mine = personal.length
    ? html`<ul class="gk-viewlist__list">${personal.map((v) => row(v, active, true))}</ul>`
    : q.canSave === false ? "" : html`<p class="gk-viewlist__none">None yet. Save the current filters as a view.</p>`;
  return html`<div class="gk-viewlist" data-k="${k}">${shared.length ? html`<section aria-labelledby="${k}-sh"><h4 class="gk-viewlist__h" id="${k}-sh">Shared views</h4>${sharedList}</section>` : ""}${q.canSave === false ? "" : html`<section aria-labelledby="${k}-me"><h4 class="gk-viewlist__h" id="${k}-me">My views</h4>${mine}${saveNew}${publish}</section>`}${cue}</div>`;
}
