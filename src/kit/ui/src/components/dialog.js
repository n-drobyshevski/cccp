// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
// A modal dialog on the native dialog element. The view is pure; dialogIsland (mounted with
// mountIslands(root, { dialog: dialogIsland })) calls showModal() and reports every close through
// the close button's data-act, so the app has one place to flip its state. The sheet shares it.
import { html, attrs } from "@gas-kit/client/html.js";
import { quote } from "@gas-kit/client/dom.js";
import { trapTab } from "@gas-kit/client/tabKeys.js";

const X = html`<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>`;

/**
 * The markup shared by dialog and sheet.
 * @internal
 * @param {"dialog"|"sheet"} kind
 * @param {any} q
 * @param {Record<string, unknown>} [extra] attributes for the dialog element
 * @param {{rail?: boolean, nav?: any[], grip?: any, style?: any, width?: number | null, attrs?: Record<string, unknown>}} [opt] a sheet's pieces, built by sheet(): rail places the close button and the nav buttons (SafeHtml) in a rail outside the panel, else the nav buttons share a tools row with it; grip is the resize separator, style its width declarations, width the width the app passed
 */
export function overlayMarkup(kind, q, extra, opt) {
  const id = q.id != null && q.id !== "" ? String(q.id) : kind;
  const act = q.closeAct || kind + ":close";
  const hasTitle = q.title != null && q.title !== "";
  const hasDesc = q.description != null && q.description !== "";
  const cls = "gk-" + kind;
  const o = opt || {};
  const props = q.returnK ? { open: q.open === true, returnK: String(q.returnK) } : { open: q.open === true };
  if (o.width != null) /** @type {any} */ (props).width = o.width;
  const more = { ...(o.attrs || {}) };
  const showClose = q.showClose !== false;
  const nav = o.nav || [];
  const hasNav = nav.length > 0;
  if (o.style) /** @type {any} */ (more).style = o.style;
  if (hasNav && !o.rail) /** @type {any} */ (more)["data-tools"] = String(nav.length + (showClose ? 1 : 0));
  const closeBtn = showClose ? html`<button ${attrs({ type: "button", class: "gk-btn " + cls + "__close", "data-variant": "ghost", "data-size": "icon", "aria-label": q.closeLabel || "Close", "data-act": act, "data-k": id + "-close", "data-dialog-close": "" })}>${X}</button>` : "";
  // The close button sits in the panel (as always), in a tools row with the nav buttons, or in the rail outside the panel.
  const inPanel = o.rail ? "" : hasNav ? html`<div class="${cls}__tools">${nav}${closeBtn}</div>` : closeBtn;
  const rail = o.rail ? html`<div class="${cls}__rail">${closeBtn}${nav}</div>` : "";
  return html`<dialog ${attrs({
    class: cls, id, "aria-labelledby": hasTitle ? id + "-title" : null, "aria-label": hasTitle ? null : q.label || "Dialog",
    "aria-describedby": hasDesc ? id + "-desc" : null, "data-mount": "dialog",
    "data-props": JSON.stringify(props), ...(extra || {}), ...more,
  })}><div class="${cls}__panel"><div class="${cls}__header">${hasTitle ? html`<h2 class="${cls}__title" id="${id}-title">${q.title}</h2>` : ""}${hasDesc ? html`<p class="${cls}__description" id="${id}-desc">${q.description}</p>` : ""}</div>${q.content != null ? html`<div class="${cls}__body">${q.content}</div>` : ""}${q.footer != null ? html`<div class="${cls}__footer">${q.footer}</div>` : ""}${inPanel}</div>${o.grip || ""}${rail}</dialog>`;
}

/**
 * @component dialog
 * @title Dialog
 * @category Overlays
 * @summary A modal dialog with a header, body, footer and close button, on the native dialog element.
 * @param {{id: string, open?: boolean, title?: string, description?: string, content?: unknown, footer?: unknown, label?: string, closeLabel?: string, closeAct?: string, showClose?: boolean, returnK?: string}} p
 * `open` is the app's state: when true, dialogIsland calls showModal() on mount; when false the dialog is rendered closed (or leave it out). `title` and `description` name and describe it (aria-labelledby, aria-describedby); without a title `label` is the name. `content` and `footer` are SafeHtml or text; put gk-btn buttons in the footer with their own data-act. `closeAct` defaults to "dialog:close". `returnK` is the data-k of the opener: focus returns to it when the dialog closes, also after the app re-renders. Mount dialogIsland after every render. The existing confirm component is separate.
 * @emits dialog:close (the close button, Escape and a click on the backdrop all click the close button, so the app handles one act; or the closeAct you pass)
 * @states closed, open, no-footer
 * @a11y A native dialog opened with showModal(): focus moves inside, the page behind is inert, Tab and Shift+Tab wrap between its first and last controls (the island, since the browser alone lets Tab out to its own toolbar), Escape closes it. A backdrop click closes it. The close button has an aria-label and a drawn cross. On close focus goes back to the opener found by data-k. Motion: fades and scales in over --dur-3, the scale and travel multiplied by --motion-scale, so reduced motion is a fade only.
 * @example open: dialog({ id: "dlg-open", open: true, title: "Edit profile", description: "Change how others see you.", content: "Fields go here.", footer: "Buttons go here.", returnK: "btn-edit" })
 * @example closed: dialog({ id: "dlg-edit", title: "Edit profile", description: "Change how others see you.", content: "Fields go here.", footer: "Buttons go here." })
 * @example no-footer: dialog({ id: "dlg-info", open: true, title: "About", content: "Acme register, version one.", closeLabel: "Dismiss" })
 */
export function dialog(p) {
  return overlayMarkup("dialog", p || { id: "dialog" });
}

/**
 * The width each resizable sheet was last given, by id: what the person dragged to, and the width
 * the app passed when it was last told. A redraw that passes the same width again (or none) keeps
 * the dragged width; a different width from the app replaces it.
 * @type {Map<string, {passed: number, w: number | null}>}
 */
const WIDTHS = new Map();
const RAIL_ROOM = 64;

/**
 * The resize grip of a sheet: pointer drag, arrow keys, Home and End. It reports the final width
 * by setting data-v on the grip and clicking it, so the app's delegated click handler on the
 * grip's data-act (default sheet:resize) reads data-v.
 * @param {Element} el the dialog element
 * @param {any} props
 * @returns {(() => void) | null}
 */
function mountResize(el, props) {
  const grip = /** @type {any} */ (el.querySelector('[role="separator"][data-var]'));
  if (!grip) return null;
  const doc = el.ownerDocument;
  const view = /** @type {any} */ (doc.defaultView || null);
  const left = el.getAttribute("data-side") === "left";
  const prop = grip.getAttribute("data-var");
  const min = Number(grip.getAttribute("aria-valuemin")) || 0;
  const cap = Number(grip.getAttribute("aria-valuemax")) || Infinity;
  const vw = () => (doc.documentElement && doc.documentElement.clientWidth) || 1024;
  const room = () => Math.max(1, vw() - RAIL_ROOM);
  /** @param {number} v */
  const clamp = (v) => Math.round(Math.min(Math.max(v, min), cap, room()));
  let w = Number(grip.getAttribute("aria-valuenow")) || min;
  let m = WIDTHS.get(el.id);
  if (typeof props.width === "number" && (!m || m.passed !== props.width)) {
    m = { passed: props.width, w: props.width };
    WIDTHS.set(el.id, m);
  }
  /** @param {number} v */
  const show = (v) => {
    w = v;
    /** @type {any} */ (el).style.setProperty(prop, String(v));
    grip.setAttribute("aria-valuenow", String(v));
    grip.setAttribute("aria-valuemax", String(Math.round(Math.min(cap, room()))));
    grip.setAttribute("aria-valuemin", String(Math.round(Math.min(min, room()))));
    grip.setAttribute("data-v", String(v));
  };
  /** @param {number} v */
  const remember = (v) => {
    const cur = WIDTHS.get(el.id);
    if (cur) cur.w = v;
    else WIDTHS.set(el.id, { passed: /** @type {any} */ (null), w: v });
  };
  let reporting = false;
  const report = () => { reporting = true; try { grip.click(); } finally { reporting = false; } };
  show(clamp(m && m.w != null ? m.w : w));
  /** @param {number} v */
  const set = (v) => {
    const n = clamp(v);
    if (n === w) return false;
    show(n);
    remember(n);
    return true;
  };
  let drag = false;
  let from = w;
  const end = () => {
    if (!drag) return;
    drag = false;
    el.removeAttribute("data-resizing");
    if (w !== from) report();
  };
  /** @param {any} ev */
  const onDown = (ev) => {
    if (ev.button != null && ev.button !== 0) return;
    ev.preventDefault();
    drag = true;
    from = w;
    el.setAttribute("data-resizing", "");
    if (typeof grip.setPointerCapture === "function" && ev.pointerId != null) { try { grip.setPointerCapture(ev.pointerId); } catch (e) { /* the pointer is gone: the drag still ends on pointerup */ } }
  };
  /** @param {any} ev */
  const onMove = (ev) => {
    if (!drag) return;
    set(left ? ev.clientX : vw() - ev.clientX);
  };
  /** @param {any} ev */
  const onKey = (ev) => {
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const k = ev.key;
    const step = ev.shiftKey ? 64 : 16;
    const widen = left ? "ArrowRight" : "ArrowLeft";
    const narrow = left ? "ArrowLeft" : "ArrowRight";
    let next = null;
    if (k === widen) next = w + step;
    else if (k === narrow) next = w - step;
    else if (k === "Home") next = Math.min(min, room());
    else if (k === "End") next = Math.min(cap, room());
    if (next == null) return;
    ev.preventDefault();
    if (set(next)) report();
  };
  // A click that is not our own report (a real one after a drag) must not reach the app's delegate.
  /** @param {any} ev */
  const onClick = (ev) => { if (!reporting) ev.stopPropagation(); };
  const onWin = () => show(clamp(w));
  grip.addEventListener("pointerdown", onDown);
  grip.addEventListener("pointermove", onMove);
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
  grip.addEventListener("lostpointercapture", end);
  grip.addEventListener("keydown", onKey);
  grip.addEventListener("click", onClick);
  if (view && typeof view.addEventListener === "function") view.addEventListener("resize", onWin);
  return () => {
    grip.removeEventListener("pointerdown", onDown);
    grip.removeEventListener("pointermove", onMove);
    grip.removeEventListener("pointerup", end);
    grip.removeEventListener("pointercancel", end);
    grip.removeEventListener("lostpointercapture", end);
    grip.removeEventListener("keydown", onKey);
    grip.removeEventListener("click", onClick);
    if (view && typeof view.removeEventListener === "function") view.removeEventListener("resize", onWin);
    el.removeAttribute("data-resizing");
  };
}

/**
 * The island for a dialog or a sheet, mounted on the dialog element. It opens the dialog modally
 * when data-props.open is true and, while it is open, wraps Tab and Shift+Tab between its first
 * and last controls (trapTab). Escape and a backdrop click close it and click the close button
 * once, so the delegated close act runs as for a pointer. On teardown (the app re-rendered or
 * removed it) an open dialog is closed quietly. Focus returns to the element with data-k
 * returnK. A sheet with a resize grip also gets the drag and key handling of mountResize.
 * @type {import("@gas-kit/client/islands.js").Island}
 */
export const dialogIsland = {
  mount(el, data) {
    const d = /** @type {any} */ (el);
    const props = data || {};
    let told = false;
    const focusOpener = () => {
      if (!props.returnK) return;
      const doc = el.ownerDocument;
      const o = /** @type {any} */ (doc.querySelector('[data-k="' + quote(String(props.returnK)) + '"]'));
      if (o && typeof o.focus === "function") o.focus();
    };
    const tell = () => {
      if (told) return;
      told = true;
      const b = /** @type {any} */ (el.querySelector("[data-dialog-close]"));
      if (b) b.click();
    };
    /** @param {any} ev */
    const onClick = (ev) => {
      const t = ev.target;
      if (t === el) { if (typeof d.close === "function") d.close(); return; }
      if (t && t.closest && t.closest("[data-dialog-close]")) { told = true; if (typeof d.close === "function") d.close(); }
    };
    const onClose = () => { tell(); told = false; focusOpener(); };
    // A modal dialog makes the page inert, but the browser still lets Tab leave the last control
    // for its own toolbar: wrap it inside while the dialog is open.
    /** @param {any} ev */
    const onKey = (ev) => {
      if (!d.open || ev.altKey || ev.ctrlKey || ev.metaKey || ev.defaultPrevented) return;
      trapTab(el, ev);
    };
    el.addEventListener("click", onClick);
    el.addEventListener("close", onClose);
    el.addEventListener("keydown", onKey);
    const offResize = mountResize(el, props);
    if (props.open === true && !d.open && typeof d.showModal === "function") d.showModal();
    return () => {
      if (offResize) offResize();
      el.removeEventListener("click", onClick);
      el.removeEventListener("close", onClose);
      el.removeEventListener("keydown", onKey);
      if (d.open && typeof d.close === "function") { told = true; d.close(); }
      focusOpener();
    };
  },
};
