// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
// A column chooser: a gk-btn trigger with popovertarget and a popover="auto" panel of real
// checkboxes, one per column, over the tableModel visibility model (signed deviations from the
// defaults). It is not a dropdownMenu: that island closes on every pick, and choosing columns
// takes several. columnChooserIsland (mounted with mountIslands(root, { columnChooser:
// columnChooserIsland })) places the panel and keeps aria-expanded in step; the app handles the
// acts with delegate and stores the deviations with writeColumns.
import { html, attrs } from "@gas-kit/client/html.js";
import { quote } from "@gas-kit/client/dom.js";
import { icon } from "@gas-kit/client/icons.js";
import { tipPlacement } from "@gas-kit/client/tipPlace.js";
import { isHideable, parseDeviations, visibleColumns } from "./tableModel.js";

const ALWAYS = "Always shown";

/**
 * @component columnChooser
 * @title Column Chooser
 * @category Data display
 * @summary A Columns button that opens a panel of checkboxes to show or hide table columns, staying open while several are picked.
 * @param {{id: string, columns: Array<{key?: string, label?: string, hidden?: boolean, pinned?: boolean}>, deviations?: string[], label?: string, k?: string}} p
 * `id` is the panel id (the trigger is "<id>-trigger"). `columns` are the table's columns in the tableModel shape: `hidden: true` makes a column hidden by default, `pinned: true` makes it always shown. A column with no key or no label (the button column) gets no checkbox. `deviations` are the signed keys from readColumns or toggleColumn ("-key" hides a default-visible column, "+key" shows a default-hidden one); a box is checked when visibleColumns would show its column. A column that cannot be hidden is checked and disabled, and its row carries data-tip "Always shown" (also sr-only text). The "Reset to default" button appears only when `deviations` is not empty. `label` names the trigger and the panel (default "Columns"). `k` prefixes the data-k values (default `id`): "<k>-trigger", "<k>-col-<key>" and "<k>-reset". The app listens for "change" on columnChooser:toggle (data-col is the key), computes toggleColumn, saves with writeColumns and re-renders; for columnChooser:reset it saves an empty list.
 * @emits columnChooser:toggle (change event; data-col is the column key)
 * @emits columnChooser:reset
 * @states default, with-deviations, pinned-column
 * @a11y The trigger is a native button with popovertarget, aria-haspopup="dialog" and aria-expanded kept in step by the island. The panel is role="dialog" labelled by `label`; inside it a role="group" labelled "Toggle columns" holds one native checkbox per column inside its label, so Tab and Space work as usual and several boxes can be changed without the panel closing. The island moves focus to the first enabled box on open and back to the trigger on close; Escape and an outside click close the panel natively. When the app tears the island down and re-renders the chooser in the same task (offIslands, renderRegion or swap, mountIslands), the new panel opens again with focus on the same box, so a re-render after each pick does not close it; a panel that began to close before the re-render (beforetoggle, as an outside click's light dismiss does) stays closed. A pinned column is a disabled checked box with "Always shown" as a tip and as sr-only text. Checked state is the native check mark, never colour alone. Motion: the panel fades and scales in over --dur-2 with the scale multiplied by --motion-scale.
 * @example default: columnChooser({ id: "cols-invoices", columns: [{ key: "id", label: "Invoice" }, { key: "customer", label: "Customer" }, { key: "status", label: "Status" }, { key: "method", label: "Method", hidden: true }, { key: "amount", label: "Amount" }] })
 * @example with-deviations: columnChooser({ id: "cols-acme", columns: [{ key: "name", label: "Name" }, { key: "owner", label: "Owner" }, { key: "region", label: "Region", hidden: true }, { key: "updated", label: "Updated" }], deviations: ["-owner", "+region"] })
 * @example pinned-column: columnChooser({ id: "cols-pinned", columns: [{ key: "name", label: "Name", pinned: true }, { key: "email", label: "Email" }, { key: "team", label: "Team" }, { key: "", label: "" }] })
 */
export function columnChooser(p) {
  const q = p || { id: "columns", columns: [] };
  const id = q.id != null && q.id !== "" ? String(q.id) : "columns";
  const k = q.k != null && q.k !== "" ? String(q.k) : id;
  const label = q.label != null && q.label !== "" ? String(q.label) : "Columns";
  const columns = Array.isArray(q.columns) ? q.columns.filter((c) => c && c.key && c.label) : [];
  // Only deviations that change something count (so a stale "-key" on a pinned column, or a
  // "+key" on a column that is visible anyway, shows no Reset).
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const deviations = parseDeviations(q.deviations, columns).filter((d) => {
    const c = byKey.get(d.slice(1));
    return !!c && isHideable(c) && (d.charAt(0) === "-") === !c.hidden;
  });
  const shown = new Set(visibleColumns(columns, deviations).map((c) => c.key));
  const items = columns.map((c) => {
    const fixed = !isHideable(c);
    return html`<label ${attrs({
      class: "gk-columnChooser__item" + (fixed ? " is-fixed" : ""), "data-tip": fixed ? ALWAYS : null,
    })}><input ${attrs({
      type: "checkbox", class: "gk-columnChooser__box", checked: fixed || shown.has(c.key), disabled: fixed,
      "data-act": fixed ? null : "columnChooser:toggle", "data-col": c.key, "data-k": k + "-col-" + c.key,
    })}><span class="gk-columnChooser__label">${c.label}</span>${fixed ? html`<span class="sr-only">. ${ALWAYS}</span>` : null}</label>`;
  });
  return html`<span class="gk-columnChooser"><button ${attrs({
    type: "button", id: id + "-trigger", class: "gk-btn gk-columnChooser__trigger", "data-variant": "outline", "data-size": "sm",
    popovertarget: id, "aria-haspopup": "dialog", "aria-expanded": "false", "data-k": k + "-trigger",
  })}>${icon("columns")}${label}</button><div ${attrs({
    id, popover: "auto", role: "dialog", "aria-label": label, class: "gk-columnChooser__panel",
    "data-mount": "columnChooser", "data-props": JSON.stringify({ id }),
  })}><div class="gk-columnChooser__heading" id="${id + "-heading"}">Toggle columns</div><div class="gk-columnChooser__list" role="group" aria-labelledby="${id + "-heading"}">${items}</div>${
    deviations.length
      ? html`<div class="gk-columnChooser__foot"><button ${attrs({
        type: "button", class: "gk-btn gk-columnChooser__reset", "data-variant": "ghost", "data-size": "sm",
        "data-act": "columnChooser:reset", "data-k": k + "-reset",
      })}>Reset to default</button></div>`
      : null
  }</div></span>`;
}

/**
 * The stored column deviations, cleaned against the current columns (unknown keys and malformed
 * items dropped). A missing store, a refused read or a missing key gives [].
 * @internal
 * @param {{get: (key: string) => any}|null|undefined} store a createStorage store
 * @param {string} key the storage key (the store adds the app prefix)
 * @param {Array<{key?: string}>} columns
 * @returns {string[]}
 */
export function readColumns(store, key, columns) {
  const v = store && typeof store.get === "function" ? store.get(key) : null;
  return parseDeviations(v == null ? [] : v, Array.isArray(columns) ? columns : []);
}

/**
 * Save column deviations: an empty list removes the key (everyone back on the defaults),
 * anything else is stored as given. Returns false when there is no store or it refused.
 * @internal
 * @param {{set: (key: string, value: unknown) => boolean, remove: (key: string) => boolean}|null|undefined} store
 * @param {string} key
 * @param {string[]|null|undefined} deviations
 * @returns {boolean}
 */
export function writeColumns(store, key, deviations) {
  if (!store) return false;
  const list = Array.isArray(deviations) ? deviations.filter((d) => typeof d === "string") : [];
  return list.length ? store.set(key, list) === true : store.remove(key) === true;
}

/**
 * Panels open at the moment their island was torn down, by panel id, with the data-k that held
 * focus. A mount in the same task opens the re-rendered panel again; the entry expires after
 * that task, so a later mount of the same id starts closed. Only DOM state, nothing personal.
 * @type {Map<string, string|null>}
 */
const reopen = new Map();

/** Whether a popover panel is showing; false where :popover-open is not known. @param {any} pn */
const shownNow = (pn) => { try { return !!(pn.matches && pn.matches(":popover-open")); } catch (e) { return false; } };

/**
 * Placement and state for the column chooser, mounted on the popover panel. On open it places
 * the panel under the trigger with tipPlacement (flipping above when there is no room), sets
 * aria-expanded on the trigger and focuses the first enabled box; on close it returns focus to
 * the trigger. It handles no picks: checking a box keeps the panel open, and the act reaches
 * the app's delegate. Returns a teardown; tearing down an open panel lets a re-render in the
 * same task reopen it.
 * @type {import("@gas-kit/client/islands.js").Island}
 */
export const columnChooserIsland = {
  mount(el, data) {
    const pn = /** @type {any} */ (el);
    const id = String((data && data.id) || el.getAttribute("id") || "");
    const doc = el.ownerDocument;
    const trigger = () => /** @type {any} */ (doc.querySelector('[popovertarget="' + quote(id) + '"]'));
    /** @returns {any[]} */
    const boxes = () => Array.prototype.slice.call(el.querySelectorAll(".gk-columnChooser__box")).filter((x) => !x.hasAttribute("disabled"));
    let open = false;
    /** @type {string|null} */
    let restoreK = null;
    const place = () => {
      const t = trigger();
      if (!t || typeof t.getBoundingClientRect !== "function") return;
      const a = t.getBoundingClientRect();
      const s = pn.getBoundingClientRect();
      const w = /** @type {any} */ (doc.defaultView || globalThis);
      const vw = w.innerWidth || 1024;
      const width = s.width || 0;
      const r = tipPlacement(a, { width, height: s.height || 0 }, { width: vw, height: w.innerHeight || 768 }, { gap: 4, margin: 8 });
      const left = Math.max(8, Math.min(a.left, vw - width - 8));
      el.setAttribute("style", "left:" + Math.round(left) + "px;top:" + Math.round(r.top) + "px");
    };
    const focusInside = () => {
      const want = restoreK;
      restoreK = null;
      // renderRegion already put focus back inside a redrawn panel: leave it there.
      if (!want && el.contains(doc.activeElement)) return;
      const all = /** @type {any[]} */ (Array.prototype.slice.call(el.querySelectorAll("[data-k]")));
      const hit = want ? all.find((x) => x.getAttribute("data-k") === want && !x.hasAttribute("disabled")) : null;
      const first = hit || boxes()[0] || all.find((x) => !x.hasAttribute("disabled"));
      if (first && typeof first.focus === "function") first.focus();
    };
    // `open` drops on beforetoggle, which runs as the panel starts to close: a light dismiss by an
    // outside click fires it on pointerup, the click's act redraws in the same task, and toggle
    // only comes a task later, so a teardown reading `open` then would reopen the panel.
    /** @param {any} ev */
    const onBefore = (ev) => {
      if (ev && ev.newState === "closed") open = false;
    };
    /** @param {any} ev */
    const onToggle = (ev) => {
      // A panel a redraw removed reports its close a task later; the trigger is the new one then.
      if (!el.isConnected) return;
      open = ev && ev.newState ? ev.newState === "open" : !!(pn.matches && pn.matches(":popover-open"));
      const t = trigger();
      if (t) t.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) { place(); focusInside(); } else if (t && (doc.activeElement === doc.body || el.contains(doc.activeElement))) t.focus();
    };
    el.addEventListener("beforetoggle", onBefore);
    el.addEventListener("toggle", onToggle);
    if (reopen.has(id)) {
      restoreK = reopen.get(id) || null;
      reopen.delete(id);
      if (typeof pn.showPopover === "function") {
        try { pn.showPopover(); } catch (e) { restoreK = null; }
      }
    }
    if (shownNow(pn)) {
      // renderRegion showed the redrawn panel again: the trigger says so at once.
      open = true;
      const t = trigger();
      if (t) t.setAttribute("aria-expanded", "true");
      place();
    }
    return () => {
      el.removeEventListener("beforetoggle", onBefore);
      el.removeEventListener("toggle", onToggle);
      let isOpen = open;
      try { if (pn.matches) isOpen = pn.matches(":popover-open") || open; } catch (e) { /* no :popover-open support */ }
      if (!isOpen || !el.isConnected) return;
      const a = /** @type {any} */ (doc.activeElement);
      reopen.set(id, a && el.contains(a) ? a.getAttribute("data-k") : null);
      setTimeout(() => { reopen.delete(id); }, 0);
    };
  },
};
