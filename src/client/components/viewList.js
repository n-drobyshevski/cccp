// Saved views at the top of the Inventory's left panel (identity G, mockup option 3): "Shared views"
// (with Manage for admins, who publish and delete them) and "My views" (with + Save; personal views
// live in this browser). Each row carries the live number of applications the view holds; the open
// view has an accent bar on its left. When the filters, sort, columns or colour metric no longer
// match the open view it says "changed" with Save and Save as new. A view is a set of applications,
// a sort, columns and a colour metric, never a page: it opens in the lens the viewer is on.
// Personal views are kept in this browser, so when storage is refused + Save hides (an admin can
// still publish a shared view). viewListView is pure; mountViewList wires it to the store.
import { delegate, qs, renderRegion } from "../lib/dom.js";
import { confirmDialog } from "../lib/confirm.js";
import { copyText } from "../lib/clipboard.js";
import { html } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { num } from "../lib/format.js";
import { toast } from "../lib/toast.js";
import * as register from "../state/register.js";
import { store } from "../state/store.js";
import { replace } from "../state/url.js";
import * as views from "../state/views.js";
import { VIEW_NAME_MAX } from "../../domain/viewState";

/** What the list draws, from the store state, the local form state and the environment
 *  ({storage, personal, rows}). Pure. */
export function modelOf(s, local, env) {
  const personal = env.personal;
  const shared = views.listShared(s.core);
  const all = [views.ALL_VIEW, ...shared, ...personal];
  const cur = all.find((v) => v.id === s.currentViewId) || views.ALL_VIEW;
  const admin = views.canShare(s);
  const sharedCur = cur.scope === "shared";
  const canSave = env.storage || admin;
  const canUpdate = !cur.sys && (sharedCur ? admin : true);
  const count = (v) => views.countOf(v, env.rows || []);
  const row = (v) => ({ ...v, count: count(v) });
  return {
    sharedRows: [row(views.ALL_VIEW), ...shared.map(row)],
    personalRows: personal.map(row),
    current: cur.id,
    currentView: cur,
    // A cue with nothing to offer (refused storage, a viewer on a shared view) would only nag.
    modified: views.isModified(cur, s) && (canUpdate || canSave),
    canSave,
    canShare: admin,
    shareOnly: !env.storage && admin,
    canUpdate,
    canDelete: !cur.sys && (sharedCur ? admin : true),
    canLink: !cur.sys,
    manage: admin && !!local.manage,
    saving: !!local.saving,
    name: local.name || "",
    share: !!local.share || (!env.storage && admin),
    error: local.error || "",
  };
}

function rowView(m, v) {
  const on = v.id === m.current;
  const del = m.manage && v.scope === "shared"
    ? html`<button type="button" class="vdelb" data-act="vrm" data-id="${v.id}" data-k="vrm-${v.id}" aria-label="Delete the shared view ${v.name}" data-tip="Delete ${v.name}">${icon("trash")}</button>`
    : "";
  const state = on ? stateView(m) : "";
  return html`<li class="vi${on ? " on" : ""}" data-view="${v.id}"><div class="vr"><button type="button" class="vrow" data-act="view" data-id="${v.id}" data-k="vt-${v.id}" aria-current="${on ? "true" : "false"}"><span class="vn">${v.scope === "shared" ? icon("share") : ""}<span>${v.name}</span></span><span class="vc mono" data-vcount>${num(v.count)}</span></button>${del}</div>${state}</li>`;
}

/** Under the open view: the "changed" cue with Save and Save as new, and Copy link and Delete. */
function stateView(m) {
  const cur = m.currentView;
  const cue = m.modified
    ? html`<span class="vmod" data-cue><span class="vchg">changed</span>${m.canUpdate && !cur.sys ? html`<button type="button" data-act="vupdate" data-k="vupdate">Save</button>` : ""}${m.canSave ? html`<button type="button" data-act="vnew" data-k="vsaveas">Save as new</button>` : ""}</span>`
    : "";
  const acts = !cur.sys && (m.canLink || m.canDelete)
    ? html`<span class="vact">${m.canLink ? html`<button type="button" data-act="vlink" data-k="vlink" aria-label="Copy link to ${cur.name}">${icon("link")}<span>Copy link</span></button>` : ""}${m.canDelete ? html`<button type="button" data-act="vdel" data-k="vdel" aria-label="Delete ${cur.name}">${icon("trash")}<span>Delete</span></button>` : ""}</span>`
    : "";
  return cue || acts ? html`<div class="vstate">${cue}${acts}</div>` : "";
}

function formView(m) {
  return html`<div class="vform"><input class="inp" type="text" data-k="vname" maxlength="${VIEW_NAME_MAX}" placeholder="View name" aria-label="View name" value="${m.name}" autocomplete="off">${m.canShare ? (m.shareOnly ? html`<span class="vshare">Shared with everyone</span>` : html`<label class="vshare"><input type="checkbox" data-act="vshare" data-k="vshare"${m.share ? html` checked` : ""}><span>Share with everyone</span></label>`) : ""}<span class="vfb"><button type="button" class="btn primary sm" data-act="vsave" data-k="vsave">Save</button><button type="button" class="btn sm" data-act="vcancel" data-k="vcancel">Cancel</button></span>${m.error ? html`<span class="vfail" role="alert">${m.error}</span>` : ""}</div>`;
}

export function viewListView(m) {
  const manage = m.canShare
    ? html`<button type="button" class="tlink" data-act="vmanage" data-k="vmanage" aria-pressed="${m.manage ? "true" : "false"}">${m.manage ? "Done" : "Manage"}</button>`
    : "";
  const add = m.canSave && !m.saving ? html`<button type="button" class="tlink" data-act="vnew" data-k="vnew">+ Save</button>` : "";
  const mine = m.personalRows.length
    ? html`<ul class="vl">${m.personalRows.map((v) => rowView(m, v))}</ul>`
    : html`<p class="vnone">${m.canSave ? "None yet. Save the current filters as a view." : "Personal views cannot be kept in this browser."}</p>`;
  return html`<section class="fg vg" data-views="shared" aria-labelledby="vh-shared"><h4 class="fh"><span id="vh-shared">Shared views</span><span class="fact">${manage}</span></h4><ul class="vl">${m.sharedRows.map((v) => rowView(m, v))}</ul></section><section class="fg vg" data-views="mine" aria-labelledby="vh-mine"><h4 class="fh"><span id="vh-mine">My views</span><span class="fact">${add}</span></h4>${m.saving ? formView(m) : ""}${mine}</section>`;
}

/** Wire the list into `slot`. Returns a teardown. */
export function mountViewList(slot) {
  if (!slot) return () => {};
  const local = { saving: false, name: "", share: false, error: "", manage: false };
  const env = { storage: views.canKeepPersonal(), personal: [], rows: [] };
  let focusName = false;

  const model = () => { env.personal = views.listPersonal(); env.rows = register.visibleRows(); return modelOf(store.get(), local, env); };
  const draw = () => {
    renderRegion(slot, viewListView(model()));
    if (focusName) {
      focusName = false;
      const i = qs(slot, "[data-k=vname]");
      if (i) i.focus();
    }
  };

  const endForm = () => { local.saving = false; local.name = ""; local.share = false; local.error = ""; };
  const show = (view) => replace(views.patchFor(view));

  async function publish(view, name, verb) {
    const s = store.get();
    try {
      const id = await views.saveShared({ id: view ? view.id : "", name, scope: "shared", ...(view && view.route ? { route: view.route } : {}), state: views.bodyOf(s) });
      const saved = views.listShared(store.get().core).find((v) => v.id === id);
      endForm();
      if (saved) show(saved);
      else draw();
      toast("View “" + name + "” " + verb);
    } catch (e) {
      local.error = e.message || "The view could not be shared.";
      draw();
    }
  }

  function save() {
    const s = store.get();
    const c = views.checkName(local.name);
    if (c.error) { local.error = c.error; draw(); return; }
    if (local.share || (!env.storage && views.canShare(s))) { publish(null, c.name, "shared"); return; }
    const r = views.addPersonal(c.name, views.bodyOf(s));
    if (r.error) { local.error = r.error; draw(); return; }
    endForm();
    show(r.view);
    toast("View “" + r.view.name + "” saved");
  }

  function update(cur) {
    const s = store.get();
    if (cur.sys || (cur.scope === "shared" && !views.canShare(s))) { local.saving = true; focusName = true; draw(); return; }
    if (cur.scope === "shared") { publish(cur, cur.name, "updated"); return; }
    const r = views.updatePersonal(cur.id, views.bodyOf(s));
    if (r.error) { toast(r.error, { kind: "err" }); return; }
    draw();
    toast("View “" + cur.name + "” updated");
  }

  async function remove(cur) {
    const ok = await confirmDialog({ title: "Delete “" + cur.name + "”?", body: cur.scope === "shared" ? "It disappears for everyone who uses this register." : "It is removed from this browser.", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      if (cur.scope === "shared") await views.deleteShared(cur.id);
      else if (!views.removePersonal(cur.id)) throw new Error("The view could not be deleted.");
    } catch (e) { toast(e.message || "The view could not be deleted.", { kind: "err" }); return; }
    if (store.get().currentViewId === cur.id) show(views.ALL_VIEW);
    else draw();
    toast("View “" + cur.name + "” deleted");
  }

  function link(cur) {
    const s = store.get();
    const href = views.linkFor(s.live && s.live.serviceUrl, cur);
    if (!href) { toast("The link is not available here.", { kind: "err" }); return; }
    copyText(href).then((ok) => {
      if (ok) toast("Link to “" + cur.name + "” copied. Anyone who opens it sees the same filters.");
      else toast("The link could not be copied.", { kind: "err" });
    });
  }

  const find = (id) => views.allViews(store.get().core, views.listPersonal()).find((v) => v.id === id);

  const offs = [];
  offs.push(delegate(slot, "click", "[data-act]", (ev, b) => {
    const act = b.getAttribute("data-act");
    const m = model();
    if (act === "view") {
      const v = find(b.getAttribute("data-id"));
      endForm();
      if (v) show(v);
    } else if (act === "vnew") { local.saving = true; local.error = ""; focusName = true; draw(); }
    else if (act === "vcancel") { endForm(); draw(); }
    else if (act === "vsave") save();
    else if (act === "vupdate") update(m.currentView);
    else if (act === "vlink") link(m.currentView);
    else if (act === "vdel") remove(m.currentView);
    else if (act === "vrm") { const v = find(b.getAttribute("data-id")); if (v) remove(v); }
    else if (act === "vmanage") { local.manage = !local.manage; draw(); }
  }));
  offs.push(delegate(slot, "input", "[data-k=vname]", (ev, el) => { local.name = el.value; if (local.error) { local.error = ""; draw(); } }));
  offs.push(delegate(slot, "change", "[data-act=vshare]", (ev, el) => { local.share = el.checked; }));
  offs.push(delegate(slot, "keydown", "[data-k=vname]", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); save(); }
    else if (ev.key === "Escape") { ev.preventDefault(); endForm(); draw(); }
  }));

  // A link with ?view=<id> opens that shared view. Explicit filters in the same address win.
  const s0 = store.get();
  if (s0.view && !s0.currentViewId) {
    const hit = views.listShared(s0.core).find((v) => v.id === s0.view);
    if (!hit) toast("That view no longer exists.", { kind: "err" });
    else if (s0.q === "" && Object.keys(s0.f).length === 0) show(hit);
    else store.set({ currentViewId: hit.id });
  }

  const offStore = store.subscribe((s, p) => {
    // Clearing every filter of an opened view goes back to All applications.
    const cv = s.currentViewId && s.currentViewId !== views.ALL_ID ? views.allViews(s.core, views.listPersonal()).find((v) => v.id === s.currentViewId) : null;
    if (cv && s.q === "" && Object.keys(s.f).length === 0 && (cv.state.q !== "" || Object.keys(cv.state.f).length > 0)) { replace(views.patchFor(views.ALL_VIEW)); return; }
    if (s.q !== p.q || s.f !== p.f || s.sort !== p.sort || s.desc !== p.desc || s.cols !== p.cols || s.metric !== p.metric
      || s.currentViewId !== p.currentViewId || s.core !== p.core || s.live !== p.live) draw();
  });
  const offReg = register.subscribe(draw);
  draw();
  return () => { offStore(); offReg(); offs.forEach((f) => f()); };
}
