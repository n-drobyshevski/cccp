// The app bar (identity G): four thin pillar bars and 'CCCP', Overview and Inventory (the Heatmap and
// Landscape are lenses of the Inventory) with a 3px accent
// underline on the active view, the shell search on the right, the gear (owner and admin only)
// and the light/dark toggle. The search drives the list query (q): on the Inventory page it
// filters live (debounced); on any other page Enter opens the Inventory with that query.
import { delegate, renderRegion } from "../lib/dom.js";
import { html, raw } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { store } from "../state/store.js";
import { navigate, replace } from "../state/url.js";
import { QUERY_ROUTES, createSearch } from "./search.js";
import * as theme from "./theme.js";

export const SEARCH_PLACEHOLDER = "Search applications, people";

export const VIEWS = [
  { route: "overview", label: "Overview", icon: "overview" },
  { route: "list", label: "Inventory", icon: "list" },
];

function current(route, appRoute, v) {
  if (route === v.route) return raw(' aria-current="page"');
  if (route === "app" && v.route === appRoute) return raw(' aria-current="true"');
  return "";
}

/** The bar as SafeHtml, for a store state. */
export function appbarView(s, mode, searchText) {
  // A reload (Retry) keeps the bar usable when the core from the last bootstrap is known; the
  // first boot and the denied and error cards still show no nav.
  const st = s.boot.status;
  const ready = st === "ready" || st === "nosource" || (st === "loading" && !!s.core && !!s.live && !!s.booted);
  const canSettings = !!(s.live && s.live.viewer && s.live.viewer.canEditSettings);
  const dark = mode === "dark";
  const next = dark ? "light" : "dark";
  const label = "Switch to " + next + " theme";
  const nav = ready
    ? html`<nav class="navb" aria-label="View">${VIEWS.map((v) => html`<button type="button" data-act="go" data-route="${v.route}" data-k="nav-${v.route}"${current(s.route, "list", v)}><span>${v.label}</span></button>`)}</nav>`
    : "";
  const q = searchText != null ? searchText : QUERY_ROUTES.indexOf(s.route) >= 0 ? s.q : "";
  const search = ready
    ? html`<label class="gs">${icon("search")}<input type="search" data-k="q" placeholder="${SEARCH_PLACEHOLDER}" value="${q}" aria-label="Search applications and people" autocomplete="off"></label>`
    : "";
  const gear = ready && canSettings
    ? html`<button type="button" class="icon-btn gear" data-act="settings" data-k="gear" aria-label="Settings" data-tip="Settings"${s.route === "settings" ? raw(' aria-current="page"') : ""}>${icon("gear")}</button>`
    : "";
  return html`<div class="abin">
    <button type="button" class="brand" data-act="home" data-k="brand" aria-label="CCCP home">
      <span class="logo" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      <b>CCCP</b>
    </button>
    ${nav}
    ${search}
    ${gear}
    <button type="button" class="icon-btn" data-act="theme" data-k="theme" aria-label="${label}" data-tip="${label}">${icon(dark ? "sun" : "moon")}</button>
  </div>${s.refreshing ? html`<div class="refresh-bar" role="progressbar" aria-label="Reloading data"></div>` : ""}`;
}

/** Where the brand goes: the Display default view. */
export function homeRoute(s) {
  const o = s.core && s.core.publicSettings && s.core.publicSettings.display && s.core.publicSettings.display.opensOn;
  return o || "list";
}

/** Render the bar into `el` and keep it in step with the store and the theme. */
export function mountAppbar(el) {
  const search = createSearch({ state: () => store.get(), replace, navigate });
  const input = () => el.querySelector("input[data-k=q]");
  const draw = () => renderRegion(el, appbarView(store.get(), theme.effective(), search.value(store.get())));
  draw();
  const offStore = store.subscribe((s, prev) => {
    if (s.route !== prev.route) search.reset();
    if (s.route !== prev.route || s.live !== prev.live || s.boot !== prev.boot || s.core !== prev.core || s.refreshing !== prev.refreshing) draw();
    else if (s.q !== prev.q) {
      const i = input();
      if (i && search.draft === null && i.value !== search.value(s)) i.value = search.value(s);
    }
  });
  const offType = delegate(el, "input", "input[data-k=q]", (ev, i) => search.type(i.value));
  const offKey = delegate(el, "keydown", "input[data-k=q]", (ev, i) => {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    search.enter(i.value);
  });
  const offTheme = theme.onChange(draw);
  const offClick = delegate(el, "click", "[data-act]", (ev, b) => {
    const act = b.getAttribute("data-act");
    const s = store.get();
    if (act === "go") navigate({ route: b.getAttribute("data-route"), app: null, tab: null, view: null }, "push");
    else if (act === "home") navigate({ route: homeRoute(s), app: null, tab: null, view: null }, "push");
    else if (act === "settings") navigate({ route: "settings", app: null, tab: s.tab || null, view: null }, "push");
    else if (act === "theme") theme.toggle();
  });
  return () => { search.reset(); offStore(); offTheme(); offClick(); offType(); offKey(); };
}
