// Saved views. Personal views live in this browser's localStorage ('cccp.views.v1', at most 20),
// because under USER_DEPLOYING the user properties are the deployer's store, not the viewer's.
// Shared views come from the bootstrap core and are written by admins through the server.
// Every storage call is wrapped by lib/storage.js: on a refusal nothing is kept and the
// controls that need it hide (see canKeepPersonal).
import * as rpc from "../lib/rpc.js";
import * as storage from "../lib/storage.js";
import { store } from "./store.js";
import { stateOf } from "./url.js";
import { filterRows } from "../../domain/query";
import { MAX_PERSONAL_VIEWS, VIEW_NAME_MAX, cleanView, defaultState, savedToState, stateToSaved, toQuery, validateView } from "../../domain/viewState";

export const KEY = "views.v1";
export const MAX_PERSONAL = MAX_PERSONAL_VIEWS;
export const ALL_ID = "all";
export const ALL_VIEW = { id: ALL_ID, name: "All applications", scope: "system", state: { q: "", f: {}, sort: "n", cols: [], metric: "worst" }, sys: true };

/** True when this browser lets the page keep personal views. */
export const canKeepPersonal = () => storage.available();

/** The stored personal views, each cleaned; a damaged entry is dropped. Empty on a refusal. */
export function listPersonal() {
  const raw = storage.getJson(KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v) => validateView({ ...(v && typeof v === "object" ? v : {}), scope: "personal" }).length === 0)
    .map((v) => ({ ...cleanView(v), scope: "personal" }))
    .filter((v) => v.id !== "" && v.name !== "");
}

function write(list) {
  // A view saved on the old heatmap or landscape page keeps that page (never used to open it).
  return storage.setJson(KEY, list.map((v) => ({ id: v.id, name: v.name, scope: "personal", ...(v.route ? { route: v.route } : {}), state: v.state, at: v.at })));
}

const today = () => new Date().toISOString().slice(0, 10);
const newId = (taken) => {
  let id;
  do { id = "p" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36); } while (taken.indexOf(id) >= 0);
  return id;
};

/** The name as it will be stored, or the sentence saying what is wrong with it. */
export function checkName(name) {
  const n = String(name == null ? "" : name).trim();
  if (n === "") return { error: "Give the view a name." };
  if (n.length > VIEW_NAME_MAX) return { error: "A view name can be at most " + VIEW_NAME_MAX + " characters." };
  return { name: n };
}

/** The body of a view from a store state: the filters, sort, columns and colour metric. */
export const bodyOf = (s) => stateToSaved(stateOf(s));

/** Add a personal view. Resolves {view} or {error}. The 21st is refused. A view is a set of
 *  applications, a sort, columns and a colour metric; it is not bound to a page. */
export function addPersonal(name, state) {
  const c = checkName(name);
  if (c.error) return { error: c.error };
  if (!canKeepPersonal()) return { error: "This browser does not allow saving views." };
  const list = listPersonal();
  if (list.length >= MAX_PERSONAL) return { error: "You can keep at most " + MAX_PERSONAL + " personal views. Delete one first." };
  const view = cleanView({ id: newId(list.map((v) => v.id)), name: c.name, scope: "personal", state, at: today() });
  if (view.id === "" || validateView(view).length) return { error: "That view could not be saved." };
  if (!write(list.concat(view))) return { error: "This browser did not accept the view." };
  return { view: { ...view, scope: "personal" } };
}

/** Replace the filters of a personal view with the current ones. */
export function updatePersonal(id, state) {
  const list = listPersonal();
  const at = list.findIndex((v) => v.id === id);
  if (at < 0) return { error: "That view no longer exists." };
  const view = cleanView({ ...list[at], state, scope: "personal", at: today() });
  const next = list.map((v, i) => (i === at ? { ...view, scope: "personal" } : v));
  if (!write(next)) return { error: "This browser did not accept the view." };
  return { view: next[at] };
}

export function removePersonal(id) {
  const list = listPersonal();
  const next = list.filter((v) => v.id !== id);
  if (next.length === list.length) return false;
  return write(next);
}

/** The shared views the server sent, cleaned. */
export function listShared(core) {
  const raw = core && Array.isArray(core.sharedViews) ? core.sharedViews : [];
  return raw.map((v) => ({ ...cleanView(v), scope: "shared" })).filter((v) => v.id !== "" && v.name !== "");
}

/** What a viewer sees in the side panel: All applications, the shared views, then their own. */
export function allViews(core, personal) {
  return [ALL_VIEW, ...listShared(core), ...(personal || listPersonal())];
}

/** How many of `rows` (the register minus display-hidden applications) a view holds. */
export function countOf(view, rows) {
  const st = view && !view.sys ? view.state : { q: "", f: {} };
  return filterRows(rows, { q: st.q || "", f: st.f || {} }).length;
}

const canon = (b) => JSON.stringify({
  q: b.q || "",
  f: Object.keys(b.f || {}).sort().map((k) => [k, (b.f[k] || []).slice().sort()]),
  sort: b.sort,
  cols: b.cols || [],
  metric: b.metric,
});

/** True when the page no longer shows what the view holds. All applications only cares about filters. */
export function isModified(view, s) {
  const now = bodyOf(s);
  if (!view || view.sys) return now.q !== "" || Object.keys(now.f).length > 0;
  return canon(cleanView({ ...view, state: now }).state) !== canon(cleanView(view).state);
}

/** The store patch that shows a view. All applications clears the search and the filters. */
export function patchFor(view) {
  if (!view || view.sys) return { q: "", f: {}, view: null, currentViewId: ALL_ID, limit: 50 };
  const st = savedToState(view);
  return { q: st.q, f: st.f, sort: st.sort, desc: st.desc, cols: st.cols, metric: st.metric, view: view.scope === "shared" ? view.id : null, currentViewId: view.id, limit: 50 };
}

/** The address that opens a view: ?view=<id> for a shared one, explicit params for a personal one. */
export function linkFor(serviceUrl, view) {
  if (!serviceUrl || !view || view.sys) return "";
  const q = view.scope === "shared"
    ? toQuery(defaultState("list"), { view: view.id })
    : toQuery(savedToState(view));
  return serviceUrl + (q ? "?" + q : "");
}

/** Publish a shared view (add or replace by id). Resolves the new id; the core is refreshed. */
export function saveShared(view) {
  return rpc.call("saveSharedView", { view }).then((res) => { setShared(res.views); return res.id; });
}

export function deleteShared(id) {
  return rpc.call("deleteSharedView", { id }).then((res) => { setShared(res.views); });
}

function setShared(views) {
  const core = store.get().core;
  if (core) store.set({ core: { ...core, sharedViews: views } });
}

/** Admins and the owner may publish and delete shared views. */
export const canShare = (s) => !!(s.live && s.live.viewer && (s.live.viewer.role === "admin" || s.live.viewer.role === "owner"));
