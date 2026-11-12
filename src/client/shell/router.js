// Route to a page. A page is {mount(el, ctx) -> optional teardown}; later work packages add
// theirs with registerPage(). Until then every route has a placeholder. A sequence number
// guards async work: a page that resolved after the viewer moved on sees ctx.current() false.
// Popovers, tips and the previous page's teardown run on every navigation.
import { renderRegion, delegate } from "../lib/dom.js";
import { html } from "../lib/html.js";
import { count } from "../lib/format.js";
import { filtersShell, mountFilters } from "../components/toolbar.js";
import { runQuery } from "../../domain/query";
import { closePopovers } from "../lib/popover.js";
import { closeTips } from "../lib/tip.js";
import * as register from "../state/register.js";
import { store } from "../state/store.js";
import { navigate } from "../state/url.js";
import { homeRoute } from "./appbar.js";
import { accessCard, errorState, noSource, notFound, onlyAdmins, skeleton } from "./states.js";

const pages = new Map();
let seq = 0;
let teardown = null;
let hooks = {};

export function registerPage(route, page) {
  pages.set(route, page);
}

export const hasPage = (route) => pages.has(route);

const TITLES = { overview: "Overview", list: "List", heatmap: "Heatmap", landscape: "Landscape", settings: "Settings", app: "Application" };

const FILTERED = ["list", "heatmap", "landscape"];

// Until each page ships: a heading and the counts. The filtered routes already carry the real
// toolbar and filter panel; their page replaces only the content region.
function placeholder(route) {
  return {
    mount(el, ctx) {
      const s = ctx.state;
      const row = route === "app" ? register.byId(s.app) : null;
      if (route === "app" && !row) { renderRegion(el, notFound("That application")); return null; }
      const filtered = FILTERED.indexOf(route) >= 0;
      let into = el;
      let offFilters = null;
      const draw = () => {
        const st = store.get();
        const all = register.visibleRows();
        const vis = filtered ? runQuery(all, st).length : all.length;
        const hid = register.hiddenCount();
        const body = route === "app"
          ? html`<p class="mut">${row.app.name}</p>`
          : html`<p class="mut"><span data-count="visible">${count(vis, "application")}</span> in view${vis !== all.length ? html`<span data-count="of"> of ${count(all.length, "application")}</span>` : ""}${hid ? html`<span data-count="hidden"> and ${count(hid, "application")} hidden by the display settings</span>` : ""}.</p>`;
        renderRegion(into, html`<section class="ph" data-page="${route}">
          ${route === "app" ? html`<button type="button" class="btn" data-act="back" data-k="back">Back to the list</button>` : ""}
          <h1>${TITLES[route] || route}</h1>
          ${route === "app" ? html`<p class="mut" data-app-id>${s.app}</p>` : ""}
          ${body}
          <p class="mut">This page arrives in a later step.</p>
        </section>`);
      };
      if (filtered) {
        renderRegion(el, filtersShell(html``), { keepFocus: false, keepScroll: false });
        into = el.querySelector('[data-region="content"]');
        offFilters = mountFilters(el);
      }
      draw();
      const offReg = register.subscribe(draw);
      const offStore = filtered ? store.subscribe((n, p) => { if (n.q !== p.q || n.f !== p.f) draw(); }) : null;
      return () => { offReg(); if (offStore) offStore(); if (offFilters) offFilters(); };
    },
  };
}

function runTeardown() {
  const t = teardown;
  teardown = null;
  if (typeof t === "function") {
    try { t(); } catch (e) { console.error("page teardown failed", e); }
  }
}

function show(el, safe) {
  runTeardown();
  renderRegion(el, safe, { keepFocus: false, keepScroll: false });
}

function render(el) {
  const mine = ++seq;
  closePopovers(false);
  closeTips();
  const s = store.get();
  const b = s.boot;
  if (b.status === "idle" || b.status === "loading") { show(el, skeleton()); return; }
  if (b.status === "denied") { show(el, accessCard(b)); return; }
  if (b.status === "error") { show(el, errorState({ message: b.message })); return; }
  const canSettings = !!(s.live && s.live.viewer && s.live.viewer.canEditSettings);
  if (s.route === "settings" && !canSettings) { show(el, onlyAdmins()); return; }
  if (b.status === "nosource" && s.route !== "settings") {
    show(el, noSource({ owner: !!(s.live && s.live.viewer && s.live.viewer.canEditSource) }));
    return;
  }
  runTeardown();
  renderRegion(el, html``, { keepFocus: false, keepScroll: false });
  const page = pages.get(s.route) || placeholder(s.route);
  const ctx = { state: s, current: () => seq === mine };
  teardown = page.mount(el, ctx) || null;
}

// The settings page switches its own tabs, so a tab change there is not a new page.
const keyOf = (s) => [s.route, s.app, s.route === "settings" ? "" : s.tab, s.boot.status, s.boot.message].join("|");

/** Mount the router in `el`. hooks: {retry}. Returns a stop function. */
export function startRouter(el, h) {
  hooks = h || {};
  let last = keyOf(store.get());
  render(el);
  const off = store.subscribe((s) => {
    const k = keyOf(s);
    if (k === last) return;
    const routeChanged = k.split("|")[0] !== last.split("|")[0];
    last = k;
    render(el);
    if (routeChanged && typeof window !== "undefined" && window.scrollTo) window.scrollTo(0, 0);
  });
  const offClick = delegate(el, "click", "[data-act]", (ev, b) => {
    const act = b.getAttribute("data-act");
    if (act === "retry" && hooks.retry) hooks.retry();
    else if (act === "connect") navigate({ route: "settings", app: null, tab: "source", view: null }, "push");
    else if (act === "home") navigate({ route: homeRoute(store.get()), app: null, tab: null, view: null }, "push");
    else if (act === "back") navigate({ route: "list", app: null, tab: null, view: null }, "push");
  });
  return () => { off(); offClick(); runTeardown(); };
}

/** Test seam: the pages that were registered. */
export function __resetRouterForTest() {
  pages.clear();
  seq = 0;
  teardown = null;
  hooks = {};
}
