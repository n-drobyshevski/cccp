// View state <-> URL params, and the saved-view schema. The URL is the shareable form of a
// view: only known params survive, every value is validated, and the whole query is capped at
// 2,000 characters. Saved views drop unknown keys and cap strings at 200 characters.

import type { FacetKey, SavedView, ViewState } from "./types";
import { FACET_KEYS, isFacetKey } from "./facets";
import { DEFAULT_SORT, choiceOf, isColumnKey, signedKeys } from "./columns";

export const URL_MAX = 2000;
export const STRING_MAX = 200;
export const MAX_FACET_VALUES = 50;
export const MAX_PERSONAL_VIEWS = 20;
export const MAX_SHARED_VIEWS = 40;
export const MAX_SHARED_BYTES = 8000;
export const VIEW_NAME_MAX = 60;

export const ROUTES: readonly string[] = ["overview", "list", "heatmap", "landscape", "app", "settings"];
/** Routes a saved view can belong to. */
export const VIEW_ROUTES: readonly string[] = ["list", "heatmap", "landscape"];
export const METRICS: readonly string[] = ["worst", "c0", "c1", "c2", "c3", "tier", "q"];
export const DEFAULT_METRIC = "worst";

/** Every param the URL may carry. Anything else is dropped. */
export const PARAM_KEYS: readonly string[] = ["r", "app", "view", "tab", "q", ...FACET_KEYS, "sort", "desc", "cols", "metric"];

/** Params that are not part of the filter state. */
export interface LinkTarget { app?: string; view?: string; tab?: string }
export interface ParsedLink extends LinkTarget { state: ViewState }

export function defaultState(route = ""): ViewState {
  return { route, q: "", f: {}, sort: DEFAULT_SORT, desc: false, cols: [], metric: DEFAULT_METRIC };
}

const cap = (s: string, n = STRING_MAX): string => (s.length > n ? s.slice(0, n) : s);
/** An application id is free sheet text: any printable text up to 200 characters is a lookup key. */
const APP_ID_RE = /^[^\u0000-\u001f\u007f]{1,200}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const TAB_RE = /^[a-z]{1,20}$/;

function cleanF(raw: unknown): Partial<Record<FacetKey, string[]>> {
  const out: Partial<Record<FacetKey, string[]>> = {};
  if (!raw || typeof raw !== "object") return out;
  const src = raw as Record<string, unknown>;
  for (const k of FACET_KEYS) {
    const v = src[k];
    if (!Array.isArray(v)) continue;
    const vals: string[] = [];
    for (const x of v) {
      if (typeof x !== "string" || x === "") continue;
      const t = cap(x);
      if (!vals.includes(t)) vals.push(t);
      if (vals.length >= MAX_FACET_VALUES) break;
    }
    if (vals.length) out[k] = vals;
  }
  return out;
}

/** Clean a state of any origin into a valid one. */
export function cleanState(raw: unknown): ViewState {
  const s = defaultState();
  if (!raw || typeof raw !== "object") return s;
  const r = raw as Record<string, unknown>;
  if (typeof r.route === "string" && ROUTES.includes(r.route)) s.route = r.route;
  if (typeof r.q === "string") s.q = cap(r.q);
  s.f = cleanF(r.f);
  if (typeof r.sort === "string" && isColumnKey(r.sort)) s.sort = r.sort;
  s.desc = r.desc === true;
  if (Array.isArray(r.cols)) s.cols = signedKeys(choiceOf(r.cols.filter((x): x is string => typeof x === "string")));
  if (typeof r.metric === "string" && METRICS.includes(r.metric)) s.metric = r.metric;
  return s;
}

// ---------------------------------------------------------------------------------- URL params

export type ParamMap = Record<string, string | string[] | undefined | null>;

function one(v: string | string[] | undefined | null): string | undefined {
  if (Array.isArray(v)) return v.length ? v[0] : undefined;
  return v == null ? undefined : v;
}

function decode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** 'a,b' with each value percent-encoded, so a comma inside a value survives. */
const listEncode = (vals: readonly string[]): string => vals.map(encodeURIComponent).join(",");
const listDecode = (text: string): string[] => text.split(",").filter((x) => x !== "").map(decode);

/** Params in priority order: what must survive the length cap comes first. */
export function toParams(state: ViewState, link: LinkTarget = {}): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (state.route) out.push(["r", state.route]);
  if (link.app) out.push(["app", link.app]);
  if (link.view) out.push(["view", link.view]);
  if (link.tab) out.push(["tab", link.tab]);
  if (state.sort && state.sort !== DEFAULT_SORT) out.push(["sort", state.sort]);
  if (state.desc) out.push(["desc", "1"]);
  if (state.metric && state.metric !== DEFAULT_METRIC) out.push(["metric", state.metric]);
  if (state.cols.length) out.push(["cols", state.cols.join(",")]);
  if (state.q) out.push(["q", state.q]);
  for (const k of FACET_KEYS) {
    const v = state.f[k];
    if (v && v.length) out.push([k, listEncode(v)]);
  }
  return out;
}

/** The query string (no leading '?'), never longer than URL_MAX characters. */
export function toQuery(state: ViewState, link: LinkTarget = {}): string {
  const s = cleanState(state);
  const parts: string[] = [];
  let len = 0;
  const add = (k: string, v: string): boolean => {
    const piece = k + "=" + encodeURIComponent(v);
    const cost = piece.length + (parts.length ? 1 : 0);
    if (len + cost > URL_MAX) return false;
    parts.push(piece);
    len += cost;
    return true;
  };
  for (const [k, v] of toParams(s, link)) {
    if (add(k, v)) continue;
    // A list that does not fit keeps as many leading values as will.
    if (isFacetKey(k) && s.f[k]) {
      const vals = s.f[k]!.slice();
      while (vals.length > 1) { vals.pop(); if (add(k, listEncode(vals))) break; }
    }
  }
  return parts.join("&");
}

/** Parse 'a=1&b=2' (a leading '?' is allowed) into a map; the first occurrence of a key wins. */
export function parseQuery(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const t = text.charAt(0) === "?" ? text.slice(1) : text;
  for (const piece of t.split("&")) {
    if (!piece) continue;
    const i = piece.indexOf("=");
    const k = decode((i < 0 ? piece : piece.slice(0, i)));
    const v = i < 0 ? "" : decode(piece.slice(i + 1));
    if (!Object.prototype.hasOwnProperty.call(out, k)) out[k] = v;
  }
  return out;
}

/**
 * The link params to a state plus link target. Unknown keys are dropped; invalid values fall
 * back to the default. Facet values arrive percent-encoded inside the list (see toParams), but a
 * plain 'dom=Finance,Legal' typed by hand works too.
 */
export function fromParams(params: ParamMap): ParsedLink {
  const state = defaultState();
  const r = one(params.r);
  if (r && ROUTES.includes(r)) state.route = r;
  const q = one(params.q);
  if (q) state.q = cap(q);
  for (const k of FACET_KEYS) {
    const v = one(params[k]);
    if (!v) continue;
    const vals = cleanF({ [k]: listDecode(v) })[k];
    if (vals) state.f[k] = vals;
  }
  const sort = one(params.sort);
  if (sort && isColumnKey(sort)) state.sort = sort;
  const desc = one(params.desc);
  state.desc = desc === "1" || desc === "true";
  const cols = one(params.cols);
  if (cols) state.cols = signedKeys(choiceOf(cols.split(",")));
  const metric = one(params.metric);
  if (metric && METRICS.includes(metric)) state.metric = metric;
  const out: ParsedLink = { state };
  const app = one(params.app);
  if (app && APP_ID_RE.test(app)) out.app = app;
  const view = one(params.view);
  if (view && ID_RE.test(view)) out.view = view;
  const tab = one(params.tab);
  if (tab && TAB_RE.test(tab)) out.tab = tab;
  return out;
}

export function fromQuery(text: string): ParsedLink {
  return fromParams(parseQuery(text.slice(0, URL_MAX * 3)));
}

// ---------------------------------------------------------------------------------- saved views

/** A state as the saved-view body. Descending is held as a '-' prefix on the sort key. */
export function stateToSaved(s: ViewState): SavedView["state"] {
  return { q: s.q, f: s.f, sort: (s.desc ? "-" : "") + s.sort, cols: s.cols, metric: s.metric };
}

/** A saved view back to a full state for its route. */
export function savedToState(v: SavedView): ViewState {
  const desc = v.state.sort.charAt(0) === "-";
  return cleanState({ route: v.route, q: v.state.q, f: v.state.f, sort: desc ? v.state.sort.slice(1) : v.state.sort, desc, cols: v.state.cols, metric: v.state.metric });
}

/** A saved view of any origin, cleaned: unknown keys dropped, strings capped, bad parts defaulted. */
export function cleanView(raw: unknown): SavedView {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const st = (r.state && typeof r.state === "object" ? r.state : {}) as Record<string, unknown>;
  const sortRaw = typeof st.sort === "string" ? st.sort : DEFAULT_SORT;
  const desc = sortRaw.charAt(0) === "-";
  const clean = cleanState({ q: st.q, f: st.f, sort: desc ? sortRaw.slice(1) : sortRaw, desc, cols: st.cols, metric: st.metric });
  const v: SavedView = {
    id: typeof r.id === "string" && ID_RE.test(r.id) ? r.id : "",
    name: typeof r.name === "string" ? cap(r.name.trim()) : "",
    scope: r.scope === "shared" ? "shared" : "personal",
    route: typeof r.route === "string" && VIEW_ROUTES.includes(r.route) ? r.route : "list",
    state: { q: clean.q, f: clean.f, sort: (desc ? "-" : "") + clean.sort, cols: clean.cols, metric: clean.metric },
  };
  if (typeof r.by === "string" && r.by) v.by = cap(r.by);
  if (typeof r.at === "string" && r.at) v.at = cap(r.at);
  return v;
}

/** Sentences describing what is wrong with a saved view; empty when it is valid. */
export function validateView(raw: unknown): string[] {
  const errs: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return ["A view must be an object."];
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== "string" || r.name.trim() === "") errs.push("A view needs a name.");
  else if (r.name.trim().length > VIEW_NAME_MAX) errs.push("A view name can be at most " + VIEW_NAME_MAX + " characters.");
  if (r.scope !== "shared" && r.scope !== "personal") errs.push("A view's scope must be shared or personal.");
  if (typeof r.route !== "string" || !VIEW_ROUTES.includes(r.route)) errs.push("A view must belong to the list, heatmap or landscape page.");
  if (!r.state || typeof r.state !== "object" || Array.isArray(r.state)) {
    errs.push("A view needs its filters, sort and columns.");
    return errs;
  }
  const st = r.state as Record<string, unknown>;
  if (st.q != null && typeof st.q !== "string") errs.push("The search text of a view must be text.");
  if (st.f != null) {
    if (typeof st.f !== "object" || Array.isArray(st.f)) errs.push("The filters of a view must be lists of values per filter.");
    else {
      for (const [k, v] of Object.entries(st.f as Record<string, unknown>)) {
        if (!isFacetKey(k)) errs.push("The filter " + cap(k, 30) + " is not one a view can hold.");
        else if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) errs.push("The " + k + " filter must be a list of text values.");
        else if (v.length > MAX_FACET_VALUES) errs.push("The " + k + " filter can hold at most " + MAX_FACET_VALUES + " values.");
      }
    }
  }
  if (st.sort != null) {
    const s = typeof st.sort === "string" ? (st.sort.charAt(0) === "-" ? st.sort.slice(1) : st.sort) : "";
    if (!isColumnKey(s)) errs.push("A view can only sort by a column of the list.");
  }
  if (st.cols != null) {
    if (!Array.isArray(st.cols) || st.cols.some((x) => typeof x !== "string")) errs.push("The columns of a view must be a list of column keys.");
    else if (st.cols.some((x) => !isColumnKey((x as string).replace(/^[-+]/, "")))) errs.push("A view names a column that does not exist.");
  }
  if (st.metric != null && (typeof st.metric !== "string" || !METRICS.includes(st.metric))) errs.push("A view's colour metric is not one of the known choices.");
  return errs;
}

/** Checks a whole list of shared views: each view, the count and the stored size. */
export function validateSharedViews(list: unknown): string[] {
  if (!Array.isArray(list)) return ["Shared views must be a list."];
  const errs: string[] = [];
  if (list.length > MAX_SHARED_VIEWS) errs.push("At most " + MAX_SHARED_VIEWS + " shared views can be kept.");
  list.forEach((v, i) => { for (const e of validateView(v)) errs.push("View " + (i + 1) + ": " + e); });
  let bytes = 0;
  try { bytes = JSON.stringify(list).length; } catch { bytes = 0; }
  if (bytes > MAX_SHARED_BYTES) errs.push("The shared views are too large to store; delete one first.");
  return errs;
}
