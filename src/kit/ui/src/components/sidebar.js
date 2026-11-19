// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
// A data-driven app sidebar: groups of menu buttons, sub-menus, an icon rail, floating and inset
// variants, either side. The view is pure; sidebarIsland (data-mount="sidebar") owns the
// expanded or collapsed state, Ctrl or Cmd plus B, the remembered state and the sheet that
// replaces the sidebar below 1024px. The sheet reuses the kit's gk-sheet look (sheet.css).
import { html, attrs, isSafe, isSafeUrl, linkAttrs } from "@gas-kit/client/html.js";
import { quote } from "@gas-kit/client/dom.js";
import { createStorage } from "@gas-kit/client/storage.js";

const SIDES = ["left", "right"];
const VARIANTS = ["sidebar", "floating", "inset"];
const COLLAPSIBLE = ["offcanvas", "icon", "none"];
const BREAKPOINT = "(max-width: 1023.98px)";

/** @param {string} d */
const path = (d) => html`<path d="${d}"></path>`;
/** @param {unknown} body */
const svg = (body) => html`<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

/** Small built-in icons by name, drawn from static path data. */
const ICONS = {
  home: [path("m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z")],
  inbox: [path("M22 12h-6l-2 3h-4l-2-3H2"), path("M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z")],
  settings: [path("M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"), path("M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z")],
  users: [path("M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"), path("M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"), path("M22 21v-2a4 4 0 0 0-3-3.87"), path("M16 3.13a4 4 0 0 1 0 7.75")],
  search: [path("M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z"), path("m21 21-4.3-4.3")],
  calendar: [path("M8 2v4"), path("M16 2v4"), path("M3 10h18"), path("M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z")],
  chart: [path("M3 3v18h18"), path("M18 17V9"), path("M13 17V5"), path("M8 17v-3")],
  file: [path("M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"), path("M14 2v6h6")],
  folder: [path("M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z")],
  bell: [path("M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"), path("M10.3 21a1.94 1.94 0 0 0 3.4 0")],
  help: [path("M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z"), path("M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"), path("M12 17h.01")],
  plus: [path("M5 12h14"), path("M12 5v14")],
};
const CHEVRON = svg([path("m9 18 6-6-6-6")]);
const CLOSE = svg([path("M18 6 6 18"), path("m6 6 12 12")]);
const PANEL = svg([html`<rect width="18" height="18" x="3" y="3" rx="2"></rect>`, path("M9 3v18")]);

/**
 * A SafeHtml icon passes through; a string is a built-in icon name (an unknown name renders nothing).
 * @param {unknown} icon
 */
function iconMarkup(icon) {
  if (icon == null || icon === "") return "";
  if (isSafe(icon)) return html`<span class="gk-sidebar__icon" aria-hidden="true">${icon}</span>`;
  const name = String(icon);
  return Object.prototype.hasOwnProperty.call(ICONS, name) ? html`<span class="gk-sidebar__icon" aria-hidden="true">${svg(/** @type {any} */ (ICONS)[name])}</span>` : "";
}

/** @param {unknown} v @param {string} d */
const text = (v, d) => (v != null && v !== "" ? String(v) : d);

/**
 * One menu button: a link when it has a safe href, a button when it has an act, plain text otherwise.
 * @param {any} it @param {string} key @param {boolean} sub @param {boolean} tipOn
 */
function menuButton(it, key, sub, tipOn) {
  const label = text(it.label, "");
  const cls = sub ? "gk-sidebar__sub-button" : "gk-sidebar__button";
  const size = !sub && (it.size === "sm" || it.size === "lg") ? it.size : null;
  const inner = html`${sub ? "" : iconMarkup(it.icon)}<span class="gk-sidebar__label">${label}</span>${it.badge != null && it.badge !== "" ? html`<span class="gk-sidebar__badge">${it.badge}</span>` : ""}`;
  const common = { class: cls, "data-size": size, "data-active": it.active === true ? "1" : null, "data-name": label, "data-tip": tipOn ? label : null, "data-k": key };
  if (isSafeUrl(it.href)) return html`<a ${attrs({ ...common, ...linkAttrs(it.href), "aria-current": it.active === true ? "page" : null, "data-act": it.act || null, "data-v": it.v != null ? it.v : null })}>${inner}</a>`;
  if (it.act) return html`<button ${attrs({ ...common, type: "button", "aria-current": it.active === true ? "true" : null, "data-act": it.act, "data-v": it.v != null ? it.v : null })}>${inner}</button>`;
  return html`<span ${attrs({ ...common, "aria-disabled": "true" })}>${inner}</span>`;
}

/**
 * @param {any} it @param {string} key @param {boolean} tipOn
 */
function menuItem(it, key, tipOn) {
  const subs = Array.isArray(it.items) ? it.items.filter((/** @type {any} */ s) => s && typeof s === "object") : [];
  if (!subs.length) return html`<li class="gk-sidebar__item">${menuButton(it, key, false, tipOn)}</li>`;
  const open = it.open != null ? it.open === true : subs.some((/** @type {any} */ s) => s.active === true);
  const label = text(it.label, "");
  const size = it.size === "sm" || it.size === "lg" ? it.size : null;
  return html`<li class="gk-sidebar__item"><button ${attrs({
    type: "button", class: "gk-sidebar__button gk-sidebar__toggle", "data-size": size, "aria-expanded": open ? "true" : "false", "aria-controls": key + "-sub",
    "data-act": "sidebar:sub", "data-v": key, "data-k": key, "data-name": label, "data-tip": tipOn ? label : null,
  })}>${iconMarkup(it.icon)}<span class="gk-sidebar__label">${label}</span>${it.badge != null && it.badge !== "" ? html`<span class="gk-sidebar__badge">${it.badge}</span>` : ""}<span class="gk-sidebar__chevron" aria-hidden="true">${CHEVRON}</span></button><ul ${attrs({ class: "gk-sidebar__sub", id: key + "-sub", role: "list", hidden: !open })}>${subs.map((/** @type {any} */ s, /** @type {number} */ j) => html`<li class="gk-sidebar__item">${menuButton(s, key + "-" + j, true, false)}</li>`)}</ul></li>`;
}

/**
 * The header, groups and footer, built twice (sidebar and sheet) with different key suffixes.
 * @param {any} q @param {string} id @param {string} kk @param {boolean} tipOn
 */
function body(q, id, kk, tipOn) {
  const groups = Array.isArray(q.groups) ? q.groups : [];
  return {
    header: q.header != null && q.header !== "" ? html`<div class="gk-sidebar__header">${q.header}</div>` : "",
    footer: q.footer != null && q.footer !== "" ? html`<div class="gk-sidebar__footer">${q.footer}</div>` : "",
    nav: html`<nav class="gk-sidebar__content" aria-label="${text(q.label, "Sidebar")}" data-keep-scroll>${groups.map((/** @type {any} */ g, /** @type {number} */ gi) => {
      if (!g || typeof g !== "object") return "";
      if (g.separator === true) return html`<div class="gk-sidebar__separator" role="none"></div>`;
      const items = Array.isArray(g.items) ? g.items.filter((/** @type {any} */ it) => it && typeof it === "object") : [];
      const hasLabel = g.label != null && g.label !== "";
      const gid = id + kk + "-g" + gi;
      const a = g.action && typeof g.action === "object" && g.action.act ? g.action : null;
      return html`<div ${attrs({ class: "gk-sidebar__group", role: "group", "aria-labelledby": hasLabel ? gid : null })}>${hasLabel ? html`<div class="gk-sidebar__group-label" id="${gid}">${g.label}</div>` : ""}${a ? html`<button ${attrs({ type: "button", class: "gk-sidebar__group-action", "data-act": a.act, "data-k": gid + "-action", "data-tip": text(a.label, "Add"), "aria-label": text(a.label, "Add") })}>${svg(ICONS.plus)}</button>` : ""}<ul class="gk-sidebar__menu" role="list">${items.map((/** @type {any} */ it, /** @type {number} */ ii) => menuItem(it, id + kk + "-" + gi + "-" + ii, tipOn))}</ul></div>`;
    })}</nav>`,
  };
}

/**
 * @component sidebar
 * @title Sidebar
 * @category Navigation
 * @summary An app sidebar of grouped menu buttons with sub-menus, badges, an icon rail, floating and inset variants and a sheet below 1024px.
 * @param {{id: string, side?: "left"|"right", variant?: "sidebar"|"floating"|"inset", collapsible?: "offcanvas"|"icon"|"none", collapsed?: boolean, label?: string, header?: unknown, footer?: unknown, groups: Array<{label?: string, separator?: boolean, action?: {label: string, act: string}, items?: Array<{label: string, href?: string, act?: string, v?: string, icon?: unknown, active?: boolean, badge?: string|number, size?: "sm"|"lg", items?: Array<{label: string, href?: string, act?: string, v?: string, active?: boolean, badge?: string|number}>, open?: boolean}>}>, k?: string, storagePrefix?: string, storageKey?: string, shortcut?: boolean, sheetLabel?: string, closeLabel?: string}} p
 * `id` is required and unique; it prefixes ids and keys, and sidebarTrigger({ controls: id }) points at it. `side` is left (default) or right; `variant` is sidebar (default, a bordered column), floating (a rounded, shadowed card) or inset (the surface sits on the sidebar colour; pair it with sidebarLayout and sidebarInset). `collapsible` is offcanvas (default: the sidebar slides away), icon (it shrinks to a 3rem rail) or none (always open, no sheet). `collapsed` is the first state; with `storagePrefix` (the app's key prefix, for example "acme.") the island remembers the choice in the wrapped client storage under `storageKey` (default "sidebar-<id>") and a refused storage just means the choice is not kept. `header` and `footer` are SafeHtml or text. Each group has an optional `label`, an optional `action` (an icon button with its own act) and `items`; a group with only `separator: true` draws a divider. An item is a link (safe `href`, aria-current="page" when `active`), a button (`act`, `v`) or plain text; `icon` is SafeHtml or a built-in name (home, inbox, settings, users, search, calendar, chart, file, folder, bell, help, plus); `size` sm or lg; `badge` is a short count or word. An item with `items` is a sub-menu toggle (aria-expanded; open when `open` or when a sub item is active). `k` prefixes data-k (default `id`); the sheet copy of the menu uses the suffix "-m". `shortcut: false` leaves Ctrl or Cmd plus B to another sidebar on the page. Mount sidebarIsland (key "sidebar") after every render; it also needs sheet.css and button.css.
 * @emits sidebar:sub (data-v; the island toggles the sub-menu itself), sidebar:close (the sheet close button; the island closes the sheet itself), plus the act of each item and group action (data-v)
 * @states expanded, collapsed-icon, collapsed-offcanvas, floating, inset, right, sub-menu, no-collapse, empty
 * @a11y A nav landmark labelled by `label` holds groups (role group, named by the group label) of lists. A link item has aria-current="page" when active, a button item aria-current="true"; the active item is also font-medium and filled, not colour alone. A sub-menu toggle is a button with aria-expanded and aria-controls. In the icon rail the labels stay as sr-only text so the accessible name is kept, and each button shows its name as data-tip on hover and focus. The trigger carries aria-expanded and aria-controls. Below 1024px the sidebar is a modal dialog (focus trapped, Escape and the backdrop close it, a choice closes it, focus returns to the trigger). Motion: the width eases over --dur-3 and is instant under reduced motion.
 * @example expanded: sidebar({ id: "sb-main", label: "Main", header: "Acme", footer: "v1.0", groups: [{ label: "Registry", items: [{ label: "Overview", href: "#overview", icon: "home", active: true }, { label: "Inbox", act: "nav:go", v: "inbox", icon: "inbox", badge: 12 }] }, { separator: true }, { items: [{ label: "Settings", href: "#settings", icon: "settings" }] }], storagePrefix: "acme." })
 * @example collapsed-icon: sidebar({ id: "sb-icon", collapsible: "icon", collapsed: true, groups: [{ label: "Registry", items: [{ label: "Overview", href: "#overview", icon: "home", active: true }, { label: "Reports", href: "#reports", icon: "chart" }] }] })
 * @example collapsed-offcanvas: sidebar({ id: "sb-off", collapsed: true, groups: [{ items: [{ label: "Overview", href: "#overview", icon: "home" }] }] })
 * @example floating: sidebar({ id: "sb-float", variant: "floating", groups: [{ label: "Registry", action: { label: "Add group", act: "nav:add" }, items: [{ label: "Overview", href: "#overview", icon: "home" }, { label: "Audit", act: "nav:go", v: "audit", icon: "file", size: "sm" }] }] })
 * @example inset: sidebar({ id: "sb-inset", variant: "inset", header: "Acme", groups: [{ items: [{ label: "Overview", href: "#overview", icon: "home" }] }] })
 * @example right: sidebar({ id: "sb-right", side: "right", groups: [{ label: "Details", items: [{ label: "Activity", href: "#activity", icon: "bell" }] }] })
 * @example sub-menu: sidebar({ id: "sb-sub", groups: [{ label: "Registry", items: [{ label: "Projects", icon: "folder", items: [{ label: "Active", href: "#active", active: true }, { label: "Archived", href: "#archived", badge: 3 }] }, { label: "Team", icon: "users", items: [{ label: "Members", href: "#members" }], open: false }] }] })
 * @example no-collapse: sidebar({ id: "sb-fixed", collapsible: "none", groups: [{ items: [{ label: "Overview", href: "#overview", icon: "home" }] }] })
 * @example empty: sidebar({ id: "sb-empty", groups: [] })
 */
export function sidebar(p) {
  const q = p || { id: "sidebar", groups: [] };
  const id = text(q.id, "sidebar");
  const side = SIDES.indexOf(String(q.side)) >= 0 ? q.side : "left";
  const variant = VARIANTS.indexOf(String(q.variant)) >= 0 ? q.variant : "sidebar";
  const coll = COLLAPSIBLE.indexOf(String(q.collapsible)) >= 0 ? q.collapsible : "offcanvas";
  const collapsed = coll !== "none" && q.collapsed === true;
  const kk = text(q.k, id);
  const tipOn = collapsed && coll === "icon";
  const main = body(q, kk, "", tipOn);
  const mobile = body(q, kk, "-m", false);
  /** @type {Record<string, unknown>} */
  const props = { id, collapsible: coll, collapsed, key: text(q.storageKey, "sidebar-" + id), shortcut: q.shortcut !== false };
  if (q.storagePrefix != null && q.storagePrefix !== "") props.prefix = String(q.storagePrefix);
  return html`<div ${attrs({ class: "gk-sidebar", id, "data-side": side, "data-variant": variant, "data-collapsible": coll, "data-state": collapsed ? "collapsed" : "expanded", "data-mount": "sidebar", "data-props": JSON.stringify(props) })}><div class="gk-sidebar__container"><div class="gk-sidebar__inner">${main.header}${main.nav}${main.footer}</div></div>${coll === "none" ? "" : html`<dialog ${attrs({ class: "gk-sheet gk-sidebar__sheet", id: id + "-sheet", "data-side": side, "aria-label": text(q.sheetLabel, text(q.label, "Sidebar")) })}><div class="gk-sidebar__sheet-panel"><div class="gk-sidebar__inner">${mobile.header}${mobile.nav}${mobile.footer}</div><button ${attrs({ type: "button", class: "gk-btn gk-sidebar__sheet-close", "data-variant": "ghost", "data-size": "icon", "aria-label": text(q.closeLabel, "Close"), "data-act": "sidebar:close", "data-k": kk + "-m-close", "data-sidebar-close": "" })}>${CLOSE}</button></div></dialog>`}</div>`;
}

/**
 * @component sidebarTrigger
 * @title Sidebar Trigger
 * @category Navigation
 * @summary The ghost icon button that toggles a sidebar (the icon rail or offcanvas on desktop, the sheet on mobile).
 * @param {{controls: string, label?: string, k?: string}} p
 * `controls` is the sidebar id. The sidebar's island finds the trigger by it, flips aria-expanded and handles the click, so the app wires nothing. `label` (default "Toggle sidebar") is the sr-only name and the data-tip.
 * @emits sidebar:toggle (handled by the island; an app may also listen)
 * @states default
 * @a11y A button with an sr-only name, aria-controls and aria-expanded (kept in step by the island). The shortcut Ctrl or Cmd plus B does the same.
 * @example sidebarTrigger({ controls: "sb-main" })
 */
export function sidebarTrigger(p) {
  const q = p || { controls: "sidebar" };
  const controls = text(q.controls, "sidebar");
  const label = text(q.label, "Toggle sidebar");
  return html`<button ${attrs({ type: "button", class: "gk-btn gk-sidebar-trigger", "data-variant": "ghost", "data-size": "icon", "aria-controls": controls, "aria-expanded": "true", "data-sidebar-trigger": controls, "data-act": "sidebar:toggle", "data-k": text(q.k, controls + "-trigger"), "data-tip": label })}>${PANEL}<span class="sr-only">${label}</span></button>`;
}

/**
 * @component sidebarInset
 * @title Sidebar Inset
 * @category Navigation
 * @summary The main area beside a sidebar: an optional header row and the page content.
 * @param {{header?: unknown, content?: unknown, label?: string}} p
 * `header` is SafeHtml (typically a sidebarTrigger, a separator and a title); `content` is the page. In the inset variant the area is a rounded, shadowed card.
 * @emits none
 * @states default, no-header
 * @a11y The content is a main landmark; the header row is a banner-free div so a page keeps one banner.
 * @example default: sidebarInset({ header: "Overview", content: "Page content." })
 * @example no-header: sidebarInset({ content: "Page content." })
 */
export function sidebarInset(p) {
  const q = p || {};
  return html`<div class="gk-sidebar-inset">${q.header != null && q.header !== "" ? html`<div class="gk-sidebar-inset__header">${q.header}</div>` : ""}<main class="gk-sidebar-inset__main" aria-label="${text(q.label, "Content")}">${q.content != null ? q.content : ""}</main></div>`;
}

/**
 * @component sidebarLayout
 * @title Sidebar Layout
 * @category Navigation
 * @summary The flex row that holds a sidebar and its inset, so the sidebar sticks and the inset fills the rest.
 * @param {{content: unknown, variant?: "sidebar"|"floating"|"inset"}} p
 * `content` is the sidebar and the sidebarInset in DOM order (put a right sidebar after the inset). `variant` should match the sidebar's; inset paints the row in the sidebar colour.
 * @emits none
 * @states default, inset
 * @a11y A plain div with no role.
 * @example default: sidebarLayout({ content: sidebar({ id: "sb-lay", groups: [] }) })
 * @example inset: sidebarLayout({ variant: "inset", content: sidebar({ id: "sb-lay-i", variant: "inset", groups: [] }) })
 */
export function sidebarLayout(p) {
  const q = p || { content: "" };
  const variant = VARIANTS.indexOf(String(q.variant)) >= 0 ? q.variant : "sidebar";
  return html`<div class="gk-sidebar-layout" data-variant="${variant}">${q.content != null ? q.content : ""}</div>`;
}

/**
 * @param {any} el
 * @returns {boolean}
 */
function isEditable(el) {
  if (!el || !el.tagName) return false;
  const t = String(el.tagName).toLowerCase();
  return t === "input" || t === "textarea" || t === "select" || el.isContentEditable === true || (el.getAttribute && el.getAttribute("contenteditable") === "true");
}

/**
 * The state of a sidebar. The trigger (anywhere in the document, found by data-sidebar-trigger)
 * and Ctrl or Cmd plus B toggle it: on desktop the icon rail or offcanvas collapses with a width
 * transition and the choice is remembered through the client storage under data-props.prefix;
 * below 1024px the same toggle opens the sheet, which closes on a choice, Escape and the
 * backdrop and returns focus to the trigger. Sub-menu toggles flip aria-expanded and hidden.
 * In the icon rail each button gets its name as data-tip. Mount it again after every render.
 * @type {import("@gas-kit/client/islands.js").Island}
 */
export const sidebarIsland = {
  mount(el, data) {
    const props = data || {};
    const doc = /** @type {any} */ (el.ownerDocument);
    const id = text(props.id, el.getAttribute("id") || "");
    const coll = COLLAPSIBLE.indexOf(String(props.collapsible)) >= 0 ? props.collapsible : "offcanvas";
    const store = props.prefix != null && props.prefix !== "" ? createStorage(String(props.prefix)) : null;
    const key = text(props.key, "sidebar-" + id);
    const sheet = /** @type {any} */ (el.querySelector("dialog"));
    let collapsed = coll !== "none" && props.collapsed === true;
    if (store && store.available && coll !== "none") {
      const saved = store.get(key);
      if (typeof saved === "boolean") collapsed = saved;
    }
    /** @type {any} */
    let opener = null;

    const triggers = () => /** @type {any[]} */ (Array.prototype.slice.call(doc.querySelectorAll('[data-sidebar-trigger="' + quote(id) + '"]')));
    const isMobile = () => {
      try { return typeof globalThis.matchMedia === "function" && globalThis.matchMedia(BREAKPOINT).matches === true; } catch (e) { return false; }
    };
    const sheetOpen = () => !!sheet && sheet.open === true;
    const paint = () => {
      el.setAttribute("data-state", collapsed ? "collapsed" : "expanded");
      const tipOn = collapsed && coll === "icon";
      for (const n of /** @type {any[]} */ (Array.prototype.slice.call(el.querySelectorAll(".gk-sidebar__container [data-name]")))) {
        if (tipOn) n.setAttribute("data-tip", n.getAttribute("data-name")); else n.removeAttribute("data-tip");
      }
      const expanded = isMobile() ? sheetOpen() : !collapsed;
      for (const t of triggers()) t.setAttribute("aria-expanded", expanded ? "true" : "false");
    };
    const openSheet = () => {
      if (!sheet || sheetOpen() || typeof sheet.showModal !== "function") return;
      sheet.showModal();
      paint();
    };
    const closeSheet = () => {
      if (sheetOpen() && typeof sheet.close === "function") sheet.close();
    };
    const toggle = () => {
      if (coll === "none") return;
      if (isMobile()) { if (sheetOpen()) closeSheet(); else openSheet(); return; }
      collapsed = !collapsed;
      paint();
      if (store && store.available) store.set(key, collapsed);
    };

    /** @param {any} ev */
    const onDocClick = (ev) => {
      const t = ev.target && ev.target.closest ? ev.target.closest('[data-sidebar-trigger="' + quote(id) + '"]') : null;
      if (!t) return;
      opener = t;
      toggle();
    };
    /** @param {any} ev */
    const onKey = (ev) => {
      if (props.shortcut === false || coll === "none") return;
      if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || ev.shiftKey || String(ev.key).toLowerCase() !== "b") return;
      if (isEditable(ev.target)) return;
      ev.preventDefault();
      opener = null;
      toggle();
    };
    /** @param {any} ev */
    const onClick = (ev) => {
      const t = ev.target;
      if (!t) return;
      if (sheet && t === sheet) { closeSheet(); return; }
      const sub = t.closest ? t.closest('[data-act="sidebar:sub"]') : null;
      if (sub) {
        const open = sub.getAttribute("aria-expanded") !== "true";
        sub.setAttribute("aria-expanded", open ? "true" : "false");
        const list = el.querySelector('[id="' + quote(String(sub.getAttribute("aria-controls"))) + '"]');
        if (list) { if (open) list.removeAttribute("hidden"); else list.setAttribute("hidden", ""); }
        return;
      }
      if (sheet && sheetOpen() && t.closest && (t.closest("[data-sidebar-close]") || (sheet.contains(t) && t.closest("a[href], button[data-act]")))) closeSheet();
    };
    const onSheetClose = () => {
      const back = opener && opener.isConnected !== false ? opener : triggers()[0];
      opener = null;
      paint();
      if (back && typeof back.focus === "function") back.focus();
    };
    /** @type {any} */
    let mq = null;
    const onMq = () => { if (!isMobile() && sheetOpen()) closeSheet(); paint(); };
    try {
      mq = typeof globalThis.matchMedia === "function" ? globalThis.matchMedia(BREAKPOINT) : null;
      if (mq && typeof mq.addEventListener === "function") mq.addEventListener("change", onMq);
    } catch (e) { mq = null; }

    doc.addEventListener("click", onDocClick);
    doc.addEventListener("keydown", onKey);
    el.addEventListener("click", onClick);
    if (sheet) sheet.addEventListener("close", onSheetClose);
    paint();
    return () => {
      doc.removeEventListener("click", onDocClick);
      doc.removeEventListener("keydown", onKey);
      el.removeEventListener("click", onClick);
      if (sheet) sheet.removeEventListener("close", onSheetClose);
      if (mq && typeof mq.removeEventListener === "function") mq.removeEventListener("change", onMq);
      if (sheetOpen() && typeof sheet.close === "function") { sheet.removeEventListener("close", onSheetClose); sheet.close(); }
    };
  },
};
