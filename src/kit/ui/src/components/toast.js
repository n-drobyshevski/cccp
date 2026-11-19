// Extracted from the author's production Apps Script apps; adapted.
// Toasts: a visible stack plus a separate screen-reader announcer. Kinds carry a word (Info, Done,
// Warning, Error) so status is never colour alone. Dismiss is data-act="toast:dismiss" with
// the toast id in data-id; the app wires it with delegate, and calls toaster.dismiss(id).
import { renderRegion } from "@gas-kit/client/dom.js";
import { attrs, html, isSafeUrl, linkAttrs } from "@gas-kit/client/html.js";
import { animateOut, prefersReducedMotion, swap } from "@gas-kit/client/motion.js";

/** @type {Record<string, string>} */
const KIND_WORD = { info: "Info", ok: "Done", warn: "Warning", bad: "Error" };

/** @param {unknown} kind */
function normKind(kind) {
  return typeof kind === "string" && Object.prototype.hasOwnProperty.call(KIND_WORD, kind) ? kind : "info";
}

const SAFE_LINK = /^(https|mailto):/i;

/**
 * @component toast
 * @title Toast
 * @category Feedback
 * @summary One toast: a kind word, a message, an optional link and a dismiss button.
 * @param {{id: string, message: string, kind?: string, link?: {href: string, label?: string}|null, dismissible?: boolean}} p
 * @emits toast:dismiss (data-id is the toast id)
 * @states info, ok, warn, bad, link
 * @a11y Motion: a new toast fades in and rises a few pixels over the entrance tokens (the host sets data-enter; reduced motion removes the movement and keeps the fade), and a dismissed or evicted toast fades out first. Each toast carries data-key (its id) so a redraw through swap keeps the survivors in place instead of replaying their entrance. The kind is a visible word, not colour alone. The dismiss button has an aria-label. The visible stack is not a live region (redrawing it would re-announce old toasts); the newest message is announced through the host's separate status element.
 * @example link: toast({ id: "t5", kind: "ok", message: "Report ready", link: { href: "https:" + "/" + "/example.org/report", label: "Open" } })
 * @example info: toast({ id: "t1", kind: "info", message: "Saved a draft" })
 * @example ok: toast({ id: "t2", kind: "ok", message: "Export finished" })
 * @example warn: toast({ id: "t3", kind: "warn", message: "Offline, showing cached data" })
 * @example bad: toast({ id: "t4", kind: "bad", message: "Could not reach the server" })
 */
export function toast(p) {
  const kind = normKind(p.kind);
  const link = p.link && SAFE_LINK.test(String(p.link.href || "")) && isSafeUrl(p.link.href) ? p.link : null;
  const id = p.id == null ? null : String(p.id);
  return html`<div class="gk-toast is-${kind}" ${attrs({ "data-id": id, "data-key": id })}><span class="gk-toast__kind">${KIND_WORD[kind]}</span><span class="gk-toast__msg">${p.message}</span>${
    link ? html`<a class="gk-toast__link" ${attrs({ ...linkAttrs(link.href, { newTab: true }), "data-k": id == null ? null : "toast-link-" + id })}>${link.label || "Open"}</a>` : null
  }${p.dismissible === false ? null : html`<button type="button" class="gk-toast__close gk-btn" data-variant="ghost" data-size="icon" ${attrs({ "data-act": "toast:dismiss", "data-id": id, "data-k": id == null ? null : "toast-close-" + id, "aria-label": "Dismiss notification" })}>${"×"}</button>`}</div>`;
}

/**
 * @component toastHost
 * @title Toast Host
 * @category Feedback
 * @summary The toast stack plus an sr-only status element that announces the newest message.
 * @param {{toasts?: Array<{id: string, message: string, kind?: string, link?: {href: string, label?: string}|null, dismissible?: boolean}>|null, announce?: string|null}} p
 * @emits toast:dismiss
 * @states empty, filled
 * @a11y Motion as for toast: entrances and exits are short fades, and reduced motion drops the movement. The stack is aria-live=off so a redraw never re-reads old toasts. The newest message goes in `announce`, rendered in a separate role=status element (polite, atomic); announce errors through createToaster, which also drives a role=alert element.
 * @example empty: toastHost({ toasts: [] })
 * @example filled: toastHost({ toasts: [{ id: "a", kind: "ok", message: "Saved" }, { id: "b", kind: "warn", message: "Slow connection" }], announce: "Warning: Slow connection" })
 */
export function toastHost(p) {
  const list = (p && p.toasts) || [];
  return html`<div class="gk-toast-host"><div class="gk-toast-stack" aria-live="off">${list.map(toast)}</div><div class="sr-only" role="status" aria-live="polite" aria-atomic="true">${p && p.announce}</div></div>`;
}

let toasterSeq = 0;

/**
 * A toaster bound to a region element: show() renders a toast and auto-dismisses it after
 * `ms` (default 4500, 0 keeps it until dismissed; paused while the pointer or focus is on the
 * stack). The region gets a visible stack (aria-live off) and two persistent sr-only elements,
 * a polite status and an assertive alert (for kind "bad"), so only the newest message is
 * announced and existing toasts are never re-read. The stack renders through swap (data-key is the toast id), and a dismissed or evicted toast plays animateOut before it is removed (at once when motion is reduced); its id leaves ids() immediately. The pause listeners are a deliberate
 * exception to the islands-only rule (WCAG 2.2.1, timing adjustable). A repeated identical message clears the status element first, so it is announced again. Keep the region in the page for good.
 * Wire the dismiss button in the app:
 *   delegate(region, "click", '[data-act="toast:dismiss"]', (ev, el) => toaster.dismiss(el.getAttribute("data-id")))
 * @internal
 * @param {Element} region
 * @param {{ms?: number, max?: number, focusFallback?: () => any}} [opts] focusFallback returns the element to focus when the last toast is dismissed while it had focus
 */
export function createToaster(region, opts) {
  const o = opts || {};
  const defaultMs = o.ms == null ? 4500 : o.ms;
  const max = o.max == null ? 4 : o.max;
  region.classList.add("gk-toast-host");
  const doc = region.ownerDocument;
  const mk = (/** @type {string} */ cls, /** @type {Record<string,string>} */ at) => {
    const e = doc.createElement("div");
    e.setAttribute("class", cls);
    for (const k of Object.keys(at)) e.setAttribute(k, at[k]);
    region.appendChild(e);
    return e;
  };
  const stack = mk("gk-toast-stack", { "aria-live": "off" });
  const polite = mk("sr-only", { role: "status", "aria-live": "polite", "aria-atomic": "true" });
  const alert = mk("sr-only", { role: "alert", "aria-atomic": "true" });
  const prefix = "t" + ++toasterSeq + "-";
  /** @type {Array<{id: string, message: string, kind?: string, link?: {href: string, label?: string}|null, ms: number, left: number, at: number, out?: boolean}>} */
  let items = [];
  /** @type {Map<string, any>} */
  const timers = new Map();
  let seq = 0;
  let hovered = false;
  let focused = false;
  const paused = () => hovered || focused;
  // Redraw the stack. If focus was inside it and the redraw removed the focused control (a
  // dismissed or evicted toast), move focus to the first remaining close button, else to the
  // app's focusFallback, and recompute `focused` from the real active element (removing a
  // focused node fires no focusout in every engine).
  const draw = () => {
    const had = stack.contains(doc.activeElement);
    swap(stack, html`${items.map(toast)}`);
    if (had && !stack.contains(doc.activeElement)) {
      const next = /** @type {any} */ (stack.querySelector('[data-act="toast:dismiss"]'));
      const fb = typeof o.focusFallback === "function" ? o.focusFallback() : null;
      const target = next || fb;
      if (target && typeof target.focus === "function") target.focus();
    }
    focused = stack.contains(doc.activeElement);
  };
  /** @param {string} id */
  const stop = (id) => {
    const t = timers.get(id);
    if (t !== undefined) clearTimeout(t);
    timers.delete(id);
  };
  // Remove the items with these ids after their exit animation (at once when motion is reduced
  // or the element cannot animate). An item is marked `out` first, so it leaves ids() and its
  // timer is gone while it fades.
  /** @param {Array<{id: string, out?: boolean}>} gone */
  const leave = (gone) => {
    for (const it of gone) { it.out = true; stop(it.id); }
    const els = gone
      .map((it) => /** @type {any} */ (Array.from(stack.querySelectorAll("[data-key]")).find((e) => e.getAttribute("data-key") === it.id)))
      .filter((e) => e && typeof e.animate === "function");
    const finish = () => {
      items = items.filter((t) => !gone.includes(t));
      draw();
      release();
    };
    if (!els.length || prefersReducedMotion()) { finish(); return; }
    Promise.all(els.map((e) => animateOut(e))).then(finish, finish);
  };
  /** @param {string} id */
  function dismiss(id) {
    stop(id);
    const it = items.find((t) => t.id === id && !t.out);
    if (it) leave([it]);
  }
  /** @param {any} it */
  const arm = (it) => {
    if (it.out || it.ms <= 0 || paused()) return;
    stop(it.id);
    it.at = Date.now();
    timers.set(it.id, setTimeout(() => dismiss(it.id), it.left));
  };
  const hold = () => {
    for (const it of items) {
      if (!timers.has(it.id)) continue;
      stop(it.id);
      it.left = Math.max(1000, it.left - (Date.now() - it.at));
    }
  };
  const release = () => {
    if (paused()) return;
    for (const it of items) if (!timers.has(it.id)) arm(it);
  };
  stack.addEventListener("pointerenter", () => { hovered = true; hold(); });
  stack.addEventListener("pointerleave", () => { hovered = false; release(); });
  stack.addEventListener("focusin", () => { focused = true; hold(); });
  stack.addEventListener("focusout", (/** @type {any} */ ev) => {
    // Focus moving between two toast controls stays inside the stack.
    const n = ev && ev.relatedTarget;
    focused = !!(n && stack.contains(n));
    release();
  });
  return {
    /**
     * @param {string} message
     * @param {{kind?: "info"|"ok"|"warn"|"bad", ms?: number, link?: {href: string, label?: string}|null}} [more]
     * @returns {string} the toast id
     */
    show(message, more) {
      const m = more || {};
      const id = prefix + ++seq;
      const ms = m.ms == null ? (m.link ? defaultMs * 2 : defaultMs) : m.ms;
      const it = { id, message, kind: m.kind, link: m.link, ms, left: ms, at: 0 };
      items.push(it);
      draw();
      const alive = items.filter((t) => !t.out);
      if (alive.length > max) leave(alive.slice(0, alive.length - max));
      const bad = normKind(m.kind) === "bad";
      const text = KIND_WORD[normKind(m.kind)] + ": " + message;
      const live = bad ? alert : polite;
      // The same text twice in a row is not announced again: clear the element first.
      if (live.textContent === text) renderRegion(live, html``, { keepFocus: false });
      renderRegion(live, html`<span>${text}</span>`, { keepFocus: false });
      renderRegion(bad ? polite : alert, html``, { keepFocus: false });
      arm(it);
      return id;
    },
    dismiss,
    clear() {
      for (const id of Array.from(timers.keys())) stop(id);
      items = [];
      draw();
    },
    /** @returns {string[]} ids on screen, oldest first */
    ids() { return items.filter((t) => !t.out).map((t) => t.id); },
  };
}
