// The saved-views tab row at the top of the toolbar (lx3 "tab row"): All applications, then the
// shared views, then the viewer's own; Save view; the "Filters changed · Update view" cue; and
// Copy link and Delete on the open view. Personal views are kept in this browser, so when
// storage is refused the Save control hides (an admin can still publish a shared view). The
// view of the row is pure (viewTabsView); mountViewTabs wires it to the store.
import { delegate, qs, renderRegion } from "../lib/dom.js";
import { tabKeys } from "../lib/tabKeys.js";
import { confirmDialog } from "../lib/confirm.js";
import { copyText } from "../lib/clipboard.js";
import { html } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { toast } from "../lib/toast.js";
import { store } from "../state/store.js";
import { navigate, replace } from "../state/url.js";
import * as views from "../state/views.js";
import { VIEW_NAME_MAX } from "../../domain/viewState";

/** What the row draws, from the store state and the local form state. Pure. */
export function modelOf(s, local, env) {
  const personal = env.personal;
  const tabs = views.tabsFor(s.route, s.core, personal);
  const cur = tabs.find((v) => v.id === s.currentViewId) || tabs[0];
  const admin = views.canShare(s);
  const sharedCur = cur.scope === "shared";
  const canSave = env.storage || admin;
  const canUpdate = !cur.sys && (sharedCur ? admin : true);
  return {
    tabs,
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
    saving: !!local.saving,
    name: local.name || "",
    share: !!local.share || (!env.storage && admin),
    error: local.error || "",
  };
}

export function viewTabsView(m) {
  const tab = (v) => html`<button type="button" role="tab" class="vt" tabindex="${v.id === m.current ? "0" : "-1"}" data-act="view" data-id="${v.id}" data-k="vt-${v.id}" aria-selected="${v.id === m.current ? "true" : "false"}">${v.scope === "shared" ? icon("share") : ""}<span>${v.name}</span></button>`;
  const form = html`<span class="vform"><input class="inp" type="text" data-k="vname" maxlength="${VIEW_NAME_MAX}" placeholder="View name" aria-label="View name" value="${m.name}" autocomplete="off">${m.canShare ? (m.shareOnly ? html`<span class="vshare">Shared with everyone</span>` : html`<label class="vshare"><input type="checkbox" data-act="vshare" data-k="vshare"${m.share ? html` checked` : ""}><span>Share with everyone</span></label>`) : ""}<button type="button" class="btn primary sm" data-act="vsave" data-k="vsave">Save</button><button type="button" class="btn sm" data-act="vcancel" data-k="vcancel">Cancel</button>${m.error ? html`<span class="vfail" role="alert">${m.error}</span>` : ""}</span>`;
  const add = m.saving ? form : m.canSave ? html`<button type="button" class="add" data-act="vnew" data-k="vnew">${icon("plus")}<span>Save view</span></button>` : "";
  const cue = m.modified
    ? html`<span class="modnote" data-cue>Filters changed<span class="dotsep" aria-hidden="true"> · </span><button type="button" data-act="vupdate" data-k="vupdate">${m.canUpdate ? "Update view" : "Save as view"}</button></span>`
    : "";
  const cur = m.currentView;
  const acts = html`${m.canLink ? html`<button type="button" data-act="vlink" data-k="vlink" aria-label="Copy link to ${cur.name}">${icon("link")}<span>Copy link</span></button>` : ""}${m.canDelete ? html`<button type="button" data-act="vdel" data-k="vdel" aria-label="Delete ${cur.name}">${icon("trash")}<span>Delete</span></button>` : ""}`;
  return html`<div class="vtabs"><div class="vlist" role="tablist" aria-label="Saved views">${m.tabs.map(tab)}</div>${add}<span class="vact">${cue}${acts}</span></div>`;
}

/** Wire the row into `slot`. Returns a teardown. */
export function mountViewTabs(slot) {
  if (!slot) return () => {};
  const local = { saving: false, name: "", share: false, error: "" };
  const env = { storage: views.canKeepPersonal(), personal: [] };
  let focusName = false;

  const model = () => { env.personal = views.listPersonal(); return modelOf(store.get(), local, env); };
  const draw = () => {
    renderRegion(slot, viewTabsView(model()));
    if (focusName) {
      focusName = false;
      const i = qs(slot, "[data-k=vname]");
      if (i) i.focus();
    }
  };

  const endForm = () => { local.saving = false; local.name = ""; local.share = false; local.error = ""; };
  const show = (view) => {
    const patch = views.patchFor(view);
    if (view && !view.sys && view.route !== store.get().route) navigate({ ...patch, route: view.route }, "push");
    else replace(patch);
  };

  async function publish(view, name, verb) {
    const s = store.get();
    try {
      const id = await views.saveShared({ id: view ? view.id : "", name, scope: "shared", route: view ? view.route : s.route, state: views.bodyOf(s) });
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
    const r = views.addPersonal(c.name, s.route, views.bodyOf(s));
    if (r.error) { local.error = r.error; draw(); return; }
    endForm();
    show(r.view);
    toast("View “" + r.view.name + "” saved");
  }

  function update(cur) {
    const s = store.get();
    if (cur.sys || (cur.scope === "shared" && !views.canShare(s))) { local.saving = true; focusName = true; draw(); return; }
    if (cur.scope === "shared") { publish(cur, cur.name, "updated"); return; }
    const r = views.updatePersonal(cur.id, cur.route, views.bodyOf(s));
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
    show(views.ALL_VIEW);
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

  const offs = [];
  offs.push(tabKeys(slot));
  offs.push(delegate(slot, "click", "[data-act]", (ev, b) => {
    const act = b.getAttribute("data-act");
    const m = model();
    if (act === "view") {
      const v = m.tabs.find((x) => x.id === b.getAttribute("data-id"));
      endForm();
      if (v) show(v);
    } else if (act === "vnew") { local.saving = true; local.error = ""; focusName = true; draw(); }
    else if (act === "vcancel") { endForm(); draw(); }
    else if (act === "vsave") save();
    else if (act === "vupdate") update(m.currentView);
    else if (act === "vlink") link(m.currentView);
    else if (act === "vdel") remove(m.currentView);
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
    const cv = s.currentViewId && s.currentViewId !== views.ALL_ID ? views.tabsFor(s.route, s.core, env.personal).find((v) => v.id === s.currentViewId) : null;
    if (cv && s.q === "" && Object.keys(s.f).length === 0 && (cv.state.q !== "" || Object.keys(cv.state.f).length > 0)) { replace(views.patchFor(views.ALL_VIEW)); return; }
    if (s.q !== p.q || s.f !== p.f || s.sort !== p.sort || s.desc !== p.desc || s.cols !== p.cols || s.metric !== p.metric
      || s.currentViewId !== p.currentViewId || s.core !== p.core || s.live !== p.live || s.route !== p.route) draw();
  });
  draw();
  return () => { offStore(); offs.forEach((f) => f()); };
}
