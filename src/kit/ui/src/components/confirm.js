// Extracted from the author's production Apps Script apps; adapted.
// A modal confirm: a pure view plus an island that traps Tab, closes on Escape and returns
// focus to where it was. The view emits confirm:ok and confirm:cancel; the app decides what
// they mean (and removes the dialog). Mount with mountIslands(root, { confirm: confirmIsland }).
// askConfirm(slot, props) does all of that for one question and answers it as a promise.
import { delegate, renderRegion } from "@gas-kit/client/dom.js";
import { html } from "@gas-kit/client/html.js";
import { mountIslands } from "@gas-kit/client/islands.js";
import { focusables, trapTab as clientTrapTab } from "@gas-kit/client/tabKeys.js";

/**
 * @component confirmDialog
 * @title Confirm Dialog
 * @category Overlays
 * @summary A modal yes/no dialog with a labelled title, optional body and a destructive variant.
 * @param {{id?: string, title: string, body?: string|null, confirmLabel?: string, cancelLabel?: string, destructive?: boolean}} p
 * @emits confirm:ok, confirm:cancel (the button, the scrim and Escape all emit cancel)
 * @states default, destructive
 * @a11y Motion: the scrim fades in and the dialog fades and scales from 0.96 to 1 over --dur-4; exit is instant, because the app re-render removes the node (reduced motion drops the scale and keeps the fade). A re-render while it is open replays the short entrance. role=dialog (role=alertdialog when destructive), aria-modal=true, aria-labelledby the title, aria-describedby the body. The dialog itself is focusable (tabindex=-1), so a click on its text keeps keydown, Escape and the Tab trap working. The island moves focus in (Cancel when destructive, so Enter is never the harmful key), traps Tab, closes on Escape and restores focus. When the app re-renders the region while the dialog is open, the island keeps the user's place: focus returns to the control that had it (by data-k) instead of the default button, and the opener to restore to is remembered. The buttons' data-k values are "<id>-cancel" and "<id>-ok".
 * @example default: confirmDialog({ title: "Discard changes?", body: "Your edits will be lost.", confirmLabel: "Discard" })
 * @example destructive: confirmDialog({ title: "Delete 3 items?", body: "This cannot be undone.", confirmLabel: "Delete", destructive: true })
 */
export function confirmDialog(p) {
  const id = p.id || "confirm";
  const destructive = !!p.destructive;
  const role = destructive ? "alertdialog" : "dialog";
  return html`<div class="gk-confirm${destructive ? " is-destructive" : ""}"><div class="gk-confirm__scrim" data-act="confirm:cancel" aria-hidden="true"></div><div class="gk-confirm__dialog" role="${role}" data-k="${id}-dialog" tabindex="-1" aria-modal="true" aria-labelledby="${id}-title"${p.body ? html` aria-describedby="${id}-body"` : null} data-mount="confirm"><h2 class="gk-confirm__title" id="${id}-title">${p.title}</h2>${
    p.body ? html`<p class="gk-confirm__body" id="${id}-body">${p.body}</p>` : null
  }<div class="gk-confirm__actions"><button type="button" class="gk-confirm__btn gk-btn" data-variant="outline" data-act="confirm:cancel" data-k="${id}-cancel"${destructive ? html` data-autofocus` : ""}>${p.cancelLabel || "Cancel"}</button><button type="button" class="gk-confirm__btn gk-btn is-primary${destructive ? " is-danger" : ""}" data-variant="${destructive ? "destructive" : "default"}" data-act="confirm:ok" data-k="${id}-ok"${destructive ? "" : html` data-autofocus`}>${p.confirmLabel || "Confirm"}</button></div></div></div>`;
}

/**
 * Keep Tab inside `container`; the client's trapTab (tabKeys.js), kept here for callers that
 * import it from the confirm module.
 * @internal
 * @param {Element} container
 * @param {{key: string, shiftKey?: boolean, preventDefault: () => void}} ev
 * @returns {boolean}
 */
export function trapTab(container, ev) {
  return clientTrapTab(container, ev);
}

/** Per dialog (its data-k): the opener and focused control of an island just torn down. @type {Map<string, any>} */
const carry = new Map();

/**
 * The confirm island: mounted on the dialog element. Focuses [data-autofocus], traps Tab,
 * turns Escape into a click on the cancel button (so the app sees confirm:cancel), and on
 * teardown returns focus to the element that had it before.
 * @type {import("@gas-kit/client/islands.js").Island}
 */
export const confirmIsland = {
  mount(el) {
    const doc = el.ownerDocument;
    const dkey = el.getAttribute("data-k") || "";
    // A re-render tears the island down and mounts it again in the same tick: carry the opener and
    // the focused control across, so the user's place is not lost.
    // Only an entry whose restored focus is still where the user is counts: a stale entry (a
    // dialog really closed and another opened) is ignored.
    const act0 = /** @type {any} */ (doc.activeElement);
    const c0 = carry.get(dkey) || null;
    carry.delete(dkey);
    const carried = c0 && act0 && (el.contains(act0) || act0 === c0.back ||
      (c0.beforeKey && typeof act0.getAttribute === "function" && act0.getAttribute("data-k") === c0.beforeKey)) ? c0 : null;
    const before = carried ? carried.before : act0;
    // The opener usually sits in a region the app re-renders when the dialog closes, so keep its
    // data-k too and look it up again if the node is gone.
    const beforeKey = carried ? carried.beforeKey : before && typeof before.getAttribute === "function" ? before.getAttribute("data-k") : null;
    /** @param {any} ev */
    const onKey = (ev) => {
      if (ev.key === "Escape") {
        ev.stopPropagation();
        const cancel = /** @type {any} */ (el.querySelector('[data-act="confirm:cancel"]'));
        if (cancel) cancel.click();
        return;
      }
      trapTab(el, ev);
    };
    el.addEventListener("keydown", onKey);
    const kept = carried && carried.focusK ? Array.from(el.querySelectorAll("[data-k]")).find((e) => e.getAttribute("data-k") === carried.focusK) : null;
    if (!el.contains(doc.activeElement)) {
      const start = /** @type {any} */ (kept || el.querySelector("[data-autofocus]") || focusables(el)[0]);
      if (start) start.focus();
    }
    return () => {
      el.removeEventListener("keydown", onKey);
      const at = /** @type {any} */ (doc.activeElement);
      const focusK = at && el.contains(at) ? at.getAttribute("data-k") : null;
      let back = before && before.isConnected ? before : null;
      if (!back && beforeKey) {
        for (const c of Array.from(doc.querySelectorAll("[data-k]"))) {
          if (c.getAttribute("data-k") === beforeKey) { back = c; break; }
        }
      }
      const entry = { before, beforeKey, back, focusK };
      carry.set(dkey, entry);
      setTimeout(() => { if (carry.get(dkey) === entry) carry.delete(dkey); }, 0);
      if (back && typeof back.focus === "function") back.focus();
    };
  },
};

/** Per slot: how to answer the question it shows now. @type {WeakMap<Element, (ok: boolean) => void>} */
const pending = new WeakMap();

/**
 * Ask a yes/no question and answer it as a promise: draws `confirmDialog(p)` into `slot`, mounts
 * `confirmIsland` on it, and resolves true on OK and false on Cancel, the scrim or Escape. Either
 * way it removes its two delegated click listeners, tears the island down (focus returns to the
 * opener) and empties the slot. A second ask on the same slot answers the first one false. `slot`
 * is an element the page owns and renders nothing else into; keep page-level handlers off the
 * confirm acts inside it, since the clicks still bubble. Like createToaster it is a controller that
 * adds listeners itself, only `delegate` on the slot and only while a question is open.
 * @internal
 * @param {Element} slot
 * @param {{id?: string, title: string, body?: string|null, confirmLabel?: string, cancelLabel?: string, destructive?: boolean}} p
 * @returns {Promise<boolean>} for example `if (await askConfirm(slot, { title: "Delete 3 items?", confirmLabel: "Delete", destructive: true })) remove()`
 */
export function askConfirm(slot, p) {
  const prev = pending.get(slot);
  if (prev) prev(false);
  // A new question is never a re-render of the last one: drop what the island carries across a
  // re-render, so focus starts on the default button (Cancel when destructive), not on a key left
  // by an earlier dialog with the same id.
  const dkey = ((p && p.id) || "confirm") + "-dialog";
  carry.delete(dkey);
  return new Promise((resolve) => {
    /** @type {Array<() => void>} */
    let offs = [];
    /** @type {() => void} */
    let unmount = () => {};
    let settled = false;
    /** @param {boolean} ok */
    const done = (ok) => {
      if (settled) return;
      settled = true;
      for (const off of offs) off();
      offs = [];
      if (pending.get(slot) === done) pending.delete(slot);
      unmount();
      carry.delete(dkey);
      renderRegion(/** @type {HTMLElement} */ (slot), html``, { keepFocus: false, keepScroll: false });
      resolve(ok);
    };
    pending.set(slot, done);
    renderRegion(/** @type {HTMLElement} */ (slot), confirmDialog(p), { keepFocus: false, keepScroll: false });
    offs = [
      delegate(slot, "click", '[data-act="confirm:ok"]', () => done(true)),
      delegate(slot, "click", '[data-act="confirm:cancel"]', () => done(false)),
    ];
    unmount = mountIslands(slot, { confirm: confirmIsland });
  });
}
