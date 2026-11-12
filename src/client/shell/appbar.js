// The app bar: four-dot logo, 'CCCP' with its subline, the minimal view switcher, the gear
// (owner and admin only) and the light/dark toggle. No global search, no quick views.
import { delegate, renderRegion } from "../lib/dom.js";
import { html, raw } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { store } from "../state/store.js";
import { navigate } from "../state/url.js";
import * as theme from "./theme.js";

export const VIEWS = [
  { route: "overview", label: "Overview", icon: "overview" },
  { route: "list", label: "List", icon: "list" },
  { route: "heatmap", label: "Heatmap", icon: "heatmap" },
  { route: "landscape", label: "Landscape", icon: "landscape" },
];

function current(route, appRoute, v) {
  if (route === v.route) return raw(' aria-current="page"');
  if (route === "app" && v.route === appRoute) return raw(' aria-current="true"');
  return "";
}

/** The bar as SafeHtml, for a store state. */
export function appbarView(s, mode) {
  const ready = s.boot.status === "ready" || s.boot.status === "nosource";
  const canSettings = !!(s.live && s.live.viewer && s.live.viewer.canEditSettings);
  const dark = mode === "dark";
  const next = dark ? "light" : "dark";
  const label = "Switch to " + next + " theme";
  const nav = ready
    ? html`<nav class="navb" aria-label="View">${VIEWS.map((v) => html`<button type="button" data-act="go" data-route="${v.route}" data-k="nav-${v.route}"${current(s.route, "list", v)}>${icon(v.icon)}<span>${v.label}</span></button>`)}</nav>`
    : "";
  const gear = ready && canSettings
    ? html`<button type="button" class="icon-btn gear" data-act="settings" data-k="gear" aria-label="Settings" data-tip="Settings"${s.route === "settings" ? raw(' aria-current="page"') : ""}>${icon("gear")}</button>`
    : "";
  return html`<div class="abin">
    <button type="button" class="brand" data-act="home" data-k="brand" aria-label="CCCP home">
      <span class="logo" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      <span class="brand-txt"><b>CCCP</b><small>Cyber · Compliance · Continuity · Platform</small></span>
    </button>
    ${nav}
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
  const draw = () => renderRegion(el, appbarView(store.get(), theme.effective()));
  draw();
  const offStore = store.subscribe((s, prev) => {
    if (s.route !== prev.route || s.live !== prev.live || s.boot !== prev.boot || s.core !== prev.core || s.refreshing !== prev.refreshing) draw();
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
  return () => { offStore(); offTheme(); offClick(); };
}
