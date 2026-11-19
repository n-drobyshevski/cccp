// One state object for the whole client, and subscribe(): the kit's createStore (shallow merges into
// a fresh object; a set that changes nothing does not notify; subscribers get (state, prev)).
import { createStore } from "@gas-kit/client/store.js";
import { DEFAULT_LENS, DEFAULT_METRIC, defaultState } from "../../domain/viewState";

export function initialState() {
  const v = defaultState("");
  return {
    // Where the viewer is: overview, list, app or settings, plus the
    // fact sheet id, the settings tab and the saved view that was opened.
    route: "",
    app: null,
    tab: null,
    view: null,
    // The filter state shared by the three lenses of the Inventory (the shareable part of the URL).
    q: v.q,
    f: v.f,
    sort: v.sort,
    desc: v.desc,
    cols: v.cols,
    metric: DEFAULT_METRIC,
    // How the Inventory shows the filtered set: table, heatmap or landscape.
    lens: DEFAULT_LENS,
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

// The state is untyped here, as it was before the kit store: the pages read it by key.
export const store = createStore(/** @type {() => any} */ (initialState));
