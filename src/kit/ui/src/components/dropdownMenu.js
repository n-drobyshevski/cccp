// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
// A dropdown menu: a gk-btn trigger with popovertarget and a popover="auto" panel, so the
// browser does light dismiss and Escape. dropdownMenuIsland (mounted with
// mountIslands(root, { dropdownMenu: dropdownMenuIsland })) adds placement, roving focus and
// typeahead.
import { html, attrs } from "@gas-kit/client/html.js";
import { quote } from "@gas-kit/client/dom.js";
import { tipPlacement } from "@gas-kit/client/tipPlace.js";
import { kbd } from "./kbd.js";

const CHECK = html`<svg class="gk-menu__mark" aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>`;
const DOT = html`<svg class="gk-menu__mark" aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="12" cy="12" r="5"></circle></svg>`;
const CARET = html`<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"></path></svg>`;

/**
 * @component dropdownMenu
 * @title Dropdown Menu
 * @category Overlays
 * @summary A button that opens a menu of actions, checkable items and radio items, on a native popover.
 * @param {{id: string, label: unknown, items: Array<{type?: "item"|"checkbox"|"radio"|"separator"|"label", text?: unknown, act?: string, v?: string, k?: string, checked?: boolean, shortcut?: string, disabled?: boolean, destructive?: boolean}>, variant?: "default"|"secondary"|"outline"|"ghost", align?: "start"|"end", ariaLabel?: string}} p
 * `id` is the panel id (the trigger is "<id>-trigger"). An item defaults to type "item": `text`, `act` (data-act), `v` (data-v), `k` (data-k; it is also how focus finds the same item after a redraw), an optional `shortcut` (a kbd cap) and `disabled`; `destructive` styles a dangerous action in the destructive tone; its text must name the action (for example "Delete document"), since the tone is never the only signal. "checkbox" and "radio" items take `checked` and show a drawn check or dot, and carry role menuitemcheckbox or menuitemradio with aria-checked. "separator" draws a rule; "label" is a heading that is not focusable. `variant` is the trigger's gk-btn variant (default "outline"); `align` is where the panel lines up with the trigger (default "start"). Choosing an item closes the menu and its act reaches the app's delegate; the app re-renders checked state.
 * @emits the act of the chosen item (data-v, data-k)
 * @states closed, with-shortcuts, checkboxes, radios, disabled-item
 * @a11y The trigger is a native button with popovertarget, aria-haspopup="menu" and aria-expanded kept in step by the island. The panel is role="menu" labelled by the trigger; items are buttons with role menuitem, menuitemcheckbox or menuitemradio and tabindex -1. The island focuses the first item on open, moves with Arrow Down and Up (wrapping), Home and End, jumps by typed letters, closes on Tab, and returns focus to the trigger on close; ArrowDown on the trigger opens the menu. Escape and an outside click close it natively. An open menu survives a redraw of the region around it: renderRegion shows the new panel with the same `id` again and puts focus back on the item with the same `k` (an item without one gives the first item), the island sets aria-expanded on the new trigger as it mounts, Arrow keys, typeahead and Escape go on working, and Escape returns focus to the new trigger; the removed panel moves no focus. A redraw whose markup has no panel with that id leaves nothing open. Checked items show a drawn mark, not colour alone. Motion: the panel fades and scales in over --dur-2 with the scale multiplied by --motion-scale.
 * @example with-shortcuts: dropdownMenu({ id: "m-file", label: "File", items: [{ type: "label", text: "Document" }, { text: "New", act: "menu:go", v: "new", shortcut: "N" }, { text: "Save", act: "menu:go", v: "save", shortcut: "S" }, { type: "separator" }, { text: "Delete document", act: "menu:go", v: "delete", destructive: true }] })
 * @example closed: dropdownMenu({ id: "m-account", label: "Account", items: [{ text: "Profile", act: "menu:go", v: "profile" }, { text: "Settings", act: "menu:go", v: "settings" }, { type: "separator" }, { text: "Sign out", act: "menu:go", v: "signout" }] })
 * @example checkboxes: dropdownMenu({ id: "m-view", label: "View", items: [{ type: "checkbox", text: "Show archived", act: "menu:toggle", v: "archived", checked: true }, { type: "checkbox", text: "Show owners", act: "menu:toggle", v: "owners" }] })
 * @example radios: dropdownMenu({ id: "m-sort", label: "Sort by", items: [{ type: "radio", text: "Name", act: "menu:sort", v: "name", checked: true }, { type: "radio", text: "Updated", act: "menu:sort", v: "updated" }] })
 * @example disabled-item: dropdownMenu({ id: "m-more", label: "More", items: [{ text: "Export", act: "menu:go", v: "export" }, { text: "Archive", act: "menu:go", v: "archive", disabled: true }] })
 */
export function dropdownMenu(p) {
  const q = p || { id: "menu", label: "", items: [] };
  const id = q.id != null && q.id !== "" ? String(q.id) : "menu";
  const items = Array.isArray(q.items) ? q.items : [];
  const variant = ["default", "secondary", "outline", "ghost"].indexOf(String(q.variant)) >= 0 ? q.variant : "outline";
  return html`<span class="gk-menu"><button ${attrs({
    type: "button", id: id + "-trigger", class: "gk-btn gk-menu__trigger", "data-variant": variant, "data-size": "default",
    popovertarget: id, "aria-haspopup": "menu", "aria-expanded": "false", "aria-label": q.ariaLabel || null, "data-k": id + "-trigger",
  })}>${q.label}${CARET}</button><div ${attrs({
    id, popover: "auto", role: "menu", class: "gk-menu__panel", "aria-labelledby": id + "-trigger", "data-align": q.align === "end" ? "end" : "start",
    "data-mount": "dropdownMenu", "data-props": JSON.stringify({ id, align: q.align === "end" ? "end" : "start" }),
  })}>${menuItems(items)}</div></span>`;
}

/**
 * The markup of a menu's items (item, checkbox, radio, separator, label), shared by dropdownMenu
 * and contextMenu. `inset` adds data-inset to align an unmarked item with marked ones. When
 * `renderSub` is given, an item of type "sub" is drawn by it.
 * @internal
 * @param {any[]} items
 * @param {((it: any) => any)=} renderSub
 * @returns {any}
 */
export function menuItems(items, renderSub) {
  return html`${items.map((it) => {
    const type = it.type || "item";
    if (type === "sub" && renderSub) return renderSub(it);
    if (type === "separator") return html`<div class="gk-menu__sep" role="separator"></div>`;
    if (type === "label") return html`<div ${attrs({ class: "gk-menu__label", role: "presentation", "data-inset": it.inset === true ? "1" : null })}>${it.text != null ? it.text : ""}</div>`;
    const role = type === "checkbox" ? "menuitemcheckbox" : type === "radio" ? "menuitemradio" : "menuitem";
    const checked = type === "checkbox" || type === "radio" ? it.checked === true : null;
    return html`<button ${attrs({
      type: "button", role, class: "gk-menu__item", tabindex: "-1", "aria-checked": checked == null ? null : checked ? "true" : "false",
      "data-act": it.act || null, "data-v": it.v != null ? it.v : null, "data-k": it.k || null, disabled: it.disabled === true,
      "data-destructive": it.destructive === true ? "1" : null, "data-inset": it.inset === true ? "1" : null,
    })}>${checked ? (type === "radio" ? DOT : CHECK) : type === "item" ? "" : html`<span class="gk-menu__mark"></span>`}<span class="gk-menu__text">${it.text != null ? it.text : ""}</span>${it.shortcut ? html`<span class="gk-menu__shortcut">${kbd({ text: it.shortcut })}</span>` : ""}</button>`;
  })}`;
}

/**
 * Typeahead: the index of the next label that starts with `buffer`, searching after `from`
 * and wrapping; a one-letter buffer that repeats cycles through the items with that letter.
 * Returns -1 when nothing matches.
 * @internal
 * @param {string[]} labels
 * @param {number} from index of the current item, or -1
 * @param {string} buffer typed letters so far
 * @returns {number}
 */
export function menuTypeahead(labels, from, buffer) {
  const b = String(buffer || "").toLowerCase();
  if (!b || !labels.length) return -1;
  const same = b.split("").every((c) => c === b[0]);
  const key = same ? b[0] : b;
  const start = same ? from + 1 : Math.max(from, 0);
  for (let n = 0; n < labels.length; n++) {
    const i = (start + n) % labels.length;
    if (String(labels[i]).trim().toLowerCase().indexOf(key) === 0) return i;
  }
  return -1;
}

/**
 * Roving focus and placement for the dropdown menu, mounted on the popover panel. On open it
 * places the panel under the trigger with tipPlacement (flipping above when there is no room),
 * focuses the first enabled item (unless focus is already on one) and sets aria-expanded on the
 * trigger; on close it returns focus to the trigger. A chosen item closes the menu; its click
 * still reaches the app. Mounted on a panel that is already open (renderRegion reopened it after
 * a redraw) it sets aria-expanded and places the panel at once; a removed panel's late close
 * event changes nothing.
 * @type {import("@gas-kit/client/islands.js").Island}
 */
export const dropdownMenuIsland = {
  mount(el, data) {
    const pn = /** @type {any} */ (el);
    const id = (data && data.id) || el.getAttribute("id") || "";
    const doc = el.ownerDocument;
    const trigger = () => /** @type {any} */ (doc.querySelector('[popovertarget="' + quote(String(id)) + '"]'));
    /** @returns {any[]} */
    const enabled = () => Array.prototype.slice.call(el.querySelectorAll('.gk-menu__item')).filter((x) => !x.hasAttribute("disabled"));
    /** @param {number} i */
    const focusAt = (i) => {
      const list = enabled();
      if (!list.length) return;
      const n = list[(i + list.length) % list.length];
      for (const x of list) x.setAttribute("tabindex", "-1");
      n.setAttribute("tabindex", "0");
      n.focus();
    };
    const place = () => {
      const t = trigger();
      if (!t || typeof t.getBoundingClientRect !== "function") return;
      const a = t.getBoundingClientRect();
      const s = pn.getBoundingClientRect();
      const w = /** @type {any} */ (doc.defaultView || globalThis);
      const r = tipPlacement(a, { width: s.width || 0, height: s.height || 0 }, { width: w.innerWidth || 1024, height: w.innerHeight || 768 }, { gap: 4, margin: 8 });
      const vw = w.innerWidth || 1024;
      const width = s.width || 0;
      const left = (data && data.align) === "end" ? a.right - width : a.left;
      const clamped = Math.max(8, Math.min(left, vw - width - 8));
      el.setAttribute("style", "left:" + Math.round(clamped) + "px;top:" + Math.round(r.top) + "px");
    };
    const isOpen = () => {
      try { return !!(pn.matches && pn.matches(":popover-open")); } catch (e) { return false; }
    };
    /** @param {any} ev */
    const onToggle = (ev) => {
      // A panel a redraw removed reports its close a task later: the trigger found by id is the
      // new one then, and its menu is not this one's to close or to pull focus from.
      if (!el.isConnected) return;
      const open = ev && ev.newState ? ev.newState === "open" : isOpen();
      const t = trigger();
      if (t) t.setAttribute("aria-expanded", open ? "true" : "false");
      // renderRegion shows a redrawn menu again and puts focus back on the same item first.
      if (open) { place(); if (!el.contains(doc.activeElement)) focusAt(0); } else if (t && (doc.activeElement === doc.body || el.contains(doc.activeElement))) t.focus();
    };
    let buf = "";
    /** @type {any} */
    let timer = null;
    /** @param {any} ev */
    const onKey = (ev) => {
      if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
      const list = enabled();
      const cur = list.indexOf(ev.target && ev.target.closest ? ev.target.closest('.gk-menu__item') : null);
      const k = ev.key;
      if (k === "ArrowDown") { ev.preventDefault(); focusAt(cur < 0 ? 0 : cur + 1); }
      else if (k === "ArrowUp") { ev.preventDefault(); focusAt(cur < 0 ? -1 : cur - 1); }
      else if (k === "Home") { ev.preventDefault(); focusAt(0); }
      else if (k === "End") { ev.preventDefault(); focusAt(-1); }
      else if (k === "Tab") { if (typeof pn.hidePopover === "function") pn.hidePopover(); }
      else if (k.length === 1 && k !== " ") {
        buf += k;
        clearTimeout(timer);
        timer = setTimeout(() => { buf = ""; }, 500);
        const at = menuTypeahead(list.map((x) => x.textContent || ""), cur, buf);
        if (at >= 0) { ev.preventDefault(); focusAt(at); }
      }
    };
    /** @param {any} ev */
    const onClick = (ev) => {
      const it = ev.target && ev.target.closest ? ev.target.closest('.gk-menu__item') : null;
      if (it && !it.hasAttribute("disabled") && typeof pn.hidePopover === "function") pn.hidePopover();
    };
    /** @param {any} ev */
    const onTriggerKey = (ev) => {
      if ((ev.key === "ArrowDown" || ev.key === "ArrowUp") && typeof pn.showPopover === "function") { ev.preventDefault(); pn.showPopover(); }
    };
    const t0 = trigger();
    el.addEventListener("toggle", onToggle);
    el.addEventListener("keydown", onKey);
    el.addEventListener("click", onClick);
    if (t0) t0.addEventListener("keydown", onTriggerKey);
    // Already open: renderRegion showed this redrawn panel again. The new trigger says so now,
    // the panel sits under it, and the focused item keeps its place in the roving tab order.
    if (isOpen()) {
      if (t0) t0.setAttribute("aria-expanded", "true");
      place();
      const a = doc.activeElement;
      const list = enabled();
      if (list.indexOf(a) >= 0) { for (const x of list) x.setAttribute("tabindex", x === a ? "0" : "-1"); }
    }
    return () => {
      clearTimeout(timer);
      el.removeEventListener("toggle", onToggle);
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("click", onClick);
      if (t0) t0.removeEventListener("keydown", onTriggerKey);
    };
  },
};
