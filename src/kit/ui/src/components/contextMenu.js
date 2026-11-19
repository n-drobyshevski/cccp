// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
// A context menu: an area that opens a popover="auto" menu at the pointer on right click, or at
// its top-left on Shift+F10 and the ContextMenu key. The items are dropdownMenu's (menuItems)
// plus inset items and "sub" items, whose panel is a nested popover that is a DOM descendant of
// the parent panel, so opening it keeps the parent open. contextMenuIsland (mounted with
// mountIslands(root, { contextMenu: contextMenuIsland })) adds placement, roving focus and
// typeahead.
import { html, attrs } from "@gas-kit/client/html.js";
import { menuItems, menuTypeahead } from "./dropdownMenu.js";

const CHEVRON = html`<svg class="gk-ctx__chev" aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"></path></svg>`;

/**
 * @component contextMenu
 * @title Context Menu
 * @category Overlays
 * @summary An area that opens a menu of actions, checkable items, radio items and a sub-menu at the pointer on right click, on a native popover.
 * @param {{id: string, content: unknown, items: Array<{type?: "item"|"checkbox"|"radio"|"separator"|"label"|"sub", text?: unknown, act?: string, v?: string, k?: string, checked?: boolean, shortcut?: string, disabled?: boolean, destructive?: boolean, inset?: boolean, items?: any[]}>, label?: string, k?: string}} p
 * `id` is the panel id (the area is "<id>-area"). `content` is what the area shows. `label` is the area's aria-label (default "Context menu"). Items are dropdownMenu's (item, checkbox, radio, separator, label; `shortcut`, `disabled`, `destructive`, `act`, `v`, `k`) plus `inset: true` (pads an unmarked item or label to line up with marked ones) and type "sub" (`text`, `items`, `disabled`), which draws an item with a chevron that opens a nested menu. Choosing an item closes the whole menu and its act reaches the app's delegate; the app re-renders checked state.
 * @emits the act of the chosen item (data-v, data-k)
 * @states default, checkboxes, radios, disabled-item
 * @a11y A context menu is a shortcut: every action it offers must also be reachable another way in the app. The area is focusable with aria-haspopup="menu"; Shift+F10 or the ContextMenu key opens the menu at its top-left, a right click at the pointer, always clamped to the viewport. The panel is role="menu"; items are buttons with role menuitem, menuitemcheckbox or menuitemradio and tabindex -1. The island focuses the menu on open (the first item when opened from the keyboard), moves with Arrow Down and Up (wrapping), Home and End, jumps by typed letters, closes on Tab and returns focus to the area on close. On a sub item aria-expanded is kept in step; Arrow Right, Enter or hover opens it and Arrow Left or Escape closes it back to its item. An open menu survives a redraw of the region around it: renderRegion shows the new panel (and an open sub menu) with the same id again at the same place and puts focus back on the item with the same `k`, and the island sets aria-expanded as it mounts; the removed panel moves no focus. Checked items show a drawn mark, not colour alone. Motion: the panel fades and scales in over --dur-2 with the scale multiplied by --motion-scale.
 * @example default: contextMenu({ id: "cm-demo", content: "Right click here", label: "Browser actions, right click or press Shift and F10", items: [{ text: "Back", act: "ctx:go", v: "back", shortcut: "Alt+Left", inset: true }, { text: "Forward", act: "ctx:go", v: "forward", shortcut: "Alt+Right", inset: true, disabled: true }, { text: "Reload", act: "ctx:go", v: "reload", shortcut: "Ctrl+R", inset: true }, { type: "sub", text: "More Tools", inset: true, items: [{ text: "Save Page...", act: "ctx:go", v: "save" }, { text: "Create Shortcut...", act: "ctx:go", v: "shortcut" }, { text: "Name Window...", act: "ctx:go", v: "name" }, { type: "separator" }, { text: "Developer Tools", act: "ctx:go", v: "devtools" }, { type: "separator" }, { text: "Delete everything", act: "ctx:go", v: "delete", destructive: true }] }, { type: "separator" }, { type: "checkbox", text: "Show Bookmarks", act: "ctx:toggle", v: "bookmarks", checked: true }, { type: "checkbox", text: "Show Full URLs", act: "ctx:toggle", v: "urls" }, { type: "separator" }, { type: "label", text: "People", inset: true }, { type: "radio", text: "Dana Reyes", act: "ctx:person", v: "dana", checked: true }, { type: "radio", text: "Sam Okafor", act: "ctx:person", v: "sam" }] })
 * @example checkboxes: contextMenu({ id: "cm-view", content: "Right click for view options", items: [{ type: "checkbox", text: "Show archived", act: "ctx:toggle", v: "archived", checked: true }, { type: "checkbox", text: "Show owners", act: "ctx:toggle", v: "owners" }] })
 * @example radios: contextMenu({ id: "cm-sort", content: "Right click to sort", items: [{ type: "label", text: "Sort by" }, { type: "radio", text: "Name", act: "ctx:sort", v: "name", checked: true }, { type: "radio", text: "Updated", act: "ctx:sort", v: "updated" }] })
 * @example disabled-item: contextMenu({ id: "cm-more", content: "Right click for actions", items: [{ text: "Export", act: "ctx:go", v: "export" }, { text: "Archive", act: "ctx:go", v: "archive", disabled: true }] })
 */
export function contextMenu(p) {
  const q = p || { id: "ctx", content: "", items: [] };
  const id = q.id != null && q.id !== "" ? String(q.id) : "ctx";
  const items = Array.isArray(q.items) ? q.items : [];
  let n = 0;
  /** @param {any} it */
  const sub = (it) => {
    const sid = id + "-sub-" + (n++);
    return html`<button ${attrs({
      type: "button", role: "menuitem", id: sid + "-trigger", class: "gk-menu__item gk-ctx__subtrigger", tabindex: "-1",
      "aria-haspopup": "menu", "aria-expanded": "false", "data-k": it.k || sid + "-trigger", disabled: it.disabled === true,
      "data-inset": it.inset === true ? "1" : null,
    })}><span class="gk-menu__text">${it.text != null ? it.text : ""}</span>${CHEVRON}</button><div ${attrs({
      id: sid, popover: "auto", role: "menu", class: "gk-menu__panel gk-ctx__sub", tabindex: "-1", "aria-labelledby": sid + "-trigger",
    })}>${menuItems(Array.isArray(it.items) ? it.items : [], sub)}</div>`;
  };
  return html`<div class="gk-ctx"><div ${attrs({
    id: id + "-area", class: "gk-ctx__area", tabindex: "0", "aria-haspopup": "menu", "aria-controls": id, "aria-label": q.label || "Context menu",
    "data-k": q.k || id + "-area",
  })}>${q.content != null ? q.content : ""}</div><div ${attrs({
    id, popover: "auto", role: "menu", class: "gk-menu__panel gk-ctx__panel", tabindex: "-1", "aria-labelledby": id + "-area",
    "data-mount": "contextMenu", "data-props": JSON.stringify({ id }),
  })}>${menuItems(items, sub)}</div></div>`;
}

/**
 * Pointer placement: the panel's top-left at the point, moved back inside the viewport.
 * @internal
 * @param {number} x @param {number} y
 * @param {{width: number, height: number}} size
 * @param {{width: number, height: number}} vp
 * @param {number=} margin
 * @returns {{left: number, top: number}}
 */
export function contextPlacement(x, y, size, vp, margin) {
  const m = margin == null ? 8 : margin;
  const left = Math.max(m, Math.min(x, vp.width - size.width - m));
  const top = Math.max(m, Math.min(y, vp.height - size.height - m));
  return { left: Math.round(left), top: Math.round(top) };
}

/**
 * Pointer placement, roving focus, typeahead and sub-menus for the context menu, mounted on the
 * root popover panel. A right click on the area, or Shift+F10 or the ContextMenu key on it,
 * opens the menu; on close focus returns to the area. A chosen item closes the whole menu; its
 * click still reaches the app.
 * @type {import("@gas-kit/client/islands.js").Island}
 */
export const contextMenuIsland = {
  mount(el, data) {
    const pn = /** @type {any} */ (el);
    const id = (data && data.id) || el.getAttribute("id") || "";
    const doc = el.ownerDocument;
    const win = /** @type {any} */ (doc.defaultView || globalThis);
    // The area is this panel's sibling in the same .gk-ctx wrapper; looking it up there (not by
    // id) keeps working when a host rewrites ids, as the docs gallery does per example.
    const wrap = typeof el.closest === "function" ? el.closest(".gk-ctx") : null;
    const area = /** @type {any} */ ((wrap && wrap.querySelector(".gk-ctx__area")) || doc.getElementById(String(id) + "-area"));
    const vp = () => ({ width: win.innerWidth || 1024, height: win.innerHeight || 768 });
    /** @param {any} x @returns {{width: number, height: number}} */
    const sizeOf = (x) => {
      const r = x.getBoundingClientRect();
      return { width: x.offsetWidth || r.width || 0, height: x.offsetHeight || r.height || 0 };
    };
    /** @param {any} menu @returns {any[]} */
    const enabled = (menu) => Array.prototype.slice.call(menu.querySelectorAll(".gk-menu__item")).filter((x) => !x.hasAttribute("disabled") && x.closest('[role="menu"]') === menu);
    /** @param {any} menu @param {number} i */
    const focusAt = (menu, i) => {
      const list = enabled(menu);
      if (!list.length) return;
      const t = list[(i + list.length) % list.length];
      for (const x of list) x.setAttribute("tabindex", "-1");
      t.setAttribute("tabindex", "0");
      t.focus();
    };
    /** @param {any} x */
    const isOpen = (x) => !!(x.matches && x.matches(":popover-open"));
    /** @param {any} x */
    const isOpenSafe = (x) => { try { return isOpen(x); } catch (e) { return false; } };
    /** @param {any} x */
    const subOf = (x) => (x.classList.contains("gk-ctx__subtrigger") ? /** @type {any} */ (x.nextElementSibling) : null);
    /** @param {any} trigger @param {boolean} first */
    const openSub = (trigger, first) => {
      const s = subOf(trigger);
      if (!s || trigger.hasAttribute("disabled") || typeof s.showPopover !== "function") return;
      if (!isOpen(s)) s.showPopover();
      if (first) focusAt(s, 0);
    };
    /** @param {any} s */
    const placeSub = (s) => {
      const t = s.previousElementSibling;
      if (!t) return;
      const a = t.getBoundingClientRect();
      const z = sizeOf(s);
      const v = vp();
      let left = a.right + 2;
      if (left + z.width > v.width - 8) left = a.left - z.width - 2;
      const p = contextPlacement(left, a.top - 4, z, v);
      s.setAttribute("style", "left:" + Math.max(8, p.left) + "px;top:" + p.top + "px");
    };
    /** @param {number} x @param {number} y */
    const place = (x, y) => {
      const p = contextPlacement(x, y, sizeOf(pn), vp());
      el.setAttribute("style", "left:" + p.left + "px;top:" + p.top + "px");
    };
    /** @param {number} x @param {number} y @param {boolean} fromKey */
    const openAt = (x, y, fromKey) => {
      if (typeof pn.showPopover !== "function") return;
      if (!isOpen(pn)) pn.showPopover();
      place(x, y);
      if (fromKey) focusAt(pn, 0); else if (typeof pn.focus === "function") pn.focus({ preventScroll: true });
    };
    /** @type {any} */
    let pending = null;
    /** @param {any} ev */
    const onContext = (ev) => {
      ev.preventDefault();
      const fromKey = !ev.clientX && !ev.clientY;
      if (fromKey && area) { const r = area.getBoundingClientRect(); openAt(r.left, r.top, true); return; }
      const x = ev.clientX || 0;
      const y = ev.clientY || 0;
      if (!ev.buttons) { openAt(x, y, false); return; }
      // Where contextmenu fires on mousedown, the button is still down: the popover would be light
      // dismissed by the coming pointerup, so the menu opens just after it.
      if (pending) pending.cancel();
      let done = false;
      const go = () => {
        if (done) return;
        done = true;
        doc.removeEventListener("pointerup", onUp, true);
        clearTimeout(fallback);
        pending = null;
        setTimeout(() => openAt(x, y, false), 0);
      };
      const onUp = () => go();
      const fallback = setTimeout(go, 700);
      pending = { cancel: () => { done = true; doc.removeEventListener("pointerup", onUp, true); clearTimeout(fallback); } };
      doc.addEventListener("pointerup", onUp, true);
    };
    /** @param {any} ev */
    const onAreaKey = (ev) => {
      if (ev.key === "ContextMenu" || (ev.key === "F10" && ev.shiftKey)) {
        ev.preventDefault();
        const r = area.getBoundingClientRect();
        openAt(r.left, r.top, true);
      }
    };
    /** @param {any} ev */
    const onToggle = (ev) => {
      // A panel a redraw removed reports its close a task later; it moves no focus then.
      if (!el.isConnected) return;
      const open = ev && ev.newState ? ev.newState === "open" : isOpen(pn);
      if (area) area.setAttribute("aria-expanded", open ? "true" : "false");
      if (!open && area && (doc.activeElement === doc.body || el.contains(doc.activeElement))) area.focus();
    };
    /** @param {any} ev */
    const onSubToggle = (ev) => {
      const s = ev.currentTarget;
      if (!s.isConnected) return;
      const t = s.previousElementSibling;
      const open = ev && ev.newState ? ev.newState === "open" : isOpen(s);
      if (t) t.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) placeSub(s);
      else if (t && isOpen(pn) && (doc.activeElement === doc.body || s.contains(doc.activeElement))) t.focus();
    };
    let buf = "";
    /** @type {any} */
    let timer = null;
    /** @param {any} ev */
    const onKey = (ev) => {
      if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
      const menu = ev.target && ev.target.closest ? ev.target.closest('[role="menu"]') : null;
      if (!menu) return;
      const list = enabled(menu);
      const item = ev.target.closest(".gk-menu__item");
      const cur = list.indexOf(item);
      const k = ev.key;
      if (k === "ArrowDown") { ev.preventDefault(); focusAt(menu, cur < 0 ? 0 : cur + 1); }
      else if (k === "ArrowUp") { ev.preventDefault(); focusAt(menu, cur < 0 ? -1 : cur - 1); }
      else if (k === "Home") { ev.preventDefault(); focusAt(menu, 0); }
      else if (k === "End") { ev.preventDefault(); focusAt(menu, -1); }
      else if (k === "ArrowRight") { if (item && subOf(item)) { ev.preventDefault(); openSub(item, true); } }
      else if (k === "ArrowLeft") { if (menu !== el && typeof menu.hidePopover === "function") { ev.preventDefault(); menu.hidePopover(); } }
      else if (k === "Tab") { if (typeof pn.hidePopover === "function") pn.hidePopover(); }
      else if (k.length === 1 && k !== " ") {
        buf += k;
        clearTimeout(timer);
        timer = setTimeout(() => { buf = ""; }, 500);
        const at = menuTypeahead(list.map((x) => x.textContent || ""), cur, buf);
        if (at >= 0) { ev.preventDefault(); focusAt(menu, at); }
      }
    };
    /** @param {any} ev */
    const onClick = (ev) => {
      const it = ev.target && ev.target.closest ? ev.target.closest(".gk-menu__item") : null;
      if (!it || it.hasAttribute("disabled")) return;
      if (subOf(it)) { openSub(it, true); return; }
      if (typeof pn.hidePopover === "function") pn.hidePopover();
    };
    /** @param {any} ev */
    const onOver = (ev) => {
      const it = ev.target && ev.target.closest ? ev.target.closest(".gk-menu__item") : null;
      if (!it) return;
      const menu = it.closest('[role="menu"]');
      if (subOf(it)) { openSub(it, false); return; }
      if (!menu) return;
      for (const t of menu.querySelectorAll(".gk-ctx__subtrigger")) {
        const s = subOf(t);
        if (s && t.closest('[role="menu"]') === menu && isOpen(s)) s.hidePopover();
      }
    };
    /** @param {any} ev */
    const noNative = (ev) => ev.preventDefault();
    const subs = Array.prototype.slice.call(el.querySelectorAll(".gk-ctx__sub"));
    if (area) { area.addEventListener("contextmenu", onContext); area.addEventListener("keydown", onAreaKey); }
    el.addEventListener("contextmenu", noNative);
    el.addEventListener("toggle", onToggle);
    el.addEventListener("keydown", onKey);
    el.addEventListener("click", onClick);
    el.addEventListener("mouseover", onOver);
    for (const s of subs) s.addEventListener("toggle", onSubToggle);
    // Already open: renderRegion showed this redrawn menu again where it was (its old position
    // carried over), so only aria-expanded is set, at once.
    if (isOpenSafe(pn) && area) area.setAttribute("aria-expanded", "true");
    for (const s of subs) {
      const t = s.previousElementSibling;
      if (t && isOpenSafe(s)) t.setAttribute("aria-expanded", "true");
    }
    return () => {
      clearTimeout(timer);
      if (pending) pending.cancel();
      if (area) { area.removeEventListener("contextmenu", onContext); area.removeEventListener("keydown", onAreaKey); }
      el.removeEventListener("contextmenu", noNative);
      el.removeEventListener("toggle", onToggle);
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("click", onClick);
      el.removeEventListener("mouseover", onOver);
      for (const s of subs) s.removeEventListener("toggle", onSubToggle);
    };
  },
};
