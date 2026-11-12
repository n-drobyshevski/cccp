// One state object for the whole client, and subscribe(). Updates are shallow merges into a
// fresh object; a set that changes nothing does not notify. Subscribers get (state, prev).
import { DEFAULT_METRIC, defaultState } from "../../domain/viewState";

export function initialState() {
  const v = defaultState("");
  return {
    // Where the viewer is: overview, list, heatmap, landscape, app or settings, plus the
    // fact sheet id, the settings tab and the saved view that was opened.
    route: "",
    app: null,
    tab: null,
    view: null,
    // The filter state shared by list, heatmap and landscape (the shareable part of the URL).
    q: v.q,
    f: v.f,
    sort: v.sort,
    desc: v.desc,
    cols: v.cols,
    metric: DEFAULT_METRIC,
    // Page state that is not in the URL.
    limit: 50,
    side: false,
    currentViewId: null,
    fs: { tab: "sheet", find: "" },
    settingsDraft: null,
    // Boot: idle, loading (step: access, apps or status), ready, denied, nosource or error.
    boot: { status: "idle", message: "" },
    // True once the first boot has ended, however it ended: later waits get a page skeleton, not
    // the splash. refreshing: data is reloading under a page that keeps showing the old data.
    booted: false,
    refreshing: false,
    // What the server says about the viewer and the source, set once at boot.
    core: null,
    live: null,
  };
}

export function createStore(make) {
  let state = (make || initialState)();
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      const prev = state;
      let changed = false;
      for (const k of Object.keys(patch)) if (!Object.is(prev[k], patch[k])) { changed = true; break; }
      if (!changed) return state;
      state = { ...prev, ...patch };
      for (const fn of Array.from(subs)) fn(state, prev);
      return state;
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    reset() {
      const prev = state;
      state = (make || initialState)();
      for (const fn of Array.from(subs)) fn(state, prev);
    },
  };
}

export const store = createStore();
