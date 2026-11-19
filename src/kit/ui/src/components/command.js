// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
// A command menu: a search field over a listbox of grouped options. Focus stays in the field;
// the active option is aria-selected and named by aria-activedescendant. commandIsland (mounted
// with mountIslands(root, { command: commandIsland })) moves the active option with the keys and
// the pointer, clicks it on Enter so the app's delegated data-act runs, and, with filter "island",
// hides the options that do not match the query. commandDialog puts it in a kit dialog;
// commandHotkey binds Ctrl or Cmd K. filterCommand and capMatches are the pure model for an app
// that filters itself (filter "app") and re-renders the list with commandList.
import { html, attrs, isSafe } from "@gas-kit/client/html.js";
import { icon } from "@gas-kit/client/icons.js";
import { overlayMarkup } from "./dialog.js";
import { kbdGroup } from "./kbd.js";
import { fold } from "./tableModel.js";

const RESERVED = ["act", "v", "k", "keywords", "mount", "mounted", "props"];

/**
 * @typedef {{ value: string, label: string, sub?: string, icon?: unknown, shortcut?: string[]|string, disabled?: boolean, act?: string, keywords?: string[], data?: Record<string, unknown> }} CommandItem
 * @typedef {{ label?: string, items: CommandItem[] }} CommandGroup
 */

/**
 * How well a query matches an item: 0 exact label, 1 label prefix, 2 label substring, 3 a
 * keyword substring (the keywords joined by spaces), -1 no match. Case and accents are folded.
 * @internal
 * @param {string} q the folded, trimmed query
 * @param {unknown} label
 * @param {unknown} keywords a string or an array of strings
 * @returns {number}
 */
export function commandRank(q, label, keywords) {
  if (!q) return 0;
  const l = fold(label).trim();
  if (l === q) return 0;
  if (l.indexOf(q) === 0) return 1;
  if (l.indexOf(q) > 0) return 2;
  const kw = fold(Array.isArray(keywords) ? keywords.join(" ") : keywords);
  return kw && kw.indexOf(q) >= 0 ? 3 : -1;
}

/**
 * The groups that match a query: within each group the matching items, ranked exact, prefix,
 * label substring, then keyword substring (stable inside a rank). Disabled items are still
 * listed; groups left empty are dropped. A blank query returns `groups` unchanged.
 * @internal
 * @param {CommandGroup[]} groups
 * @param {string} query
 * @returns {CommandGroup[]}
 */
export function filterCommand(groups, query) {
  const list = Array.isArray(groups) ? groups : [];
  const q = fold(query).trim();
  if (!q) return list;
  /** @type {CommandGroup[]} */
  const out = [];
  for (const g of list) {
    const items = Array.isArray(g && g.items) ? g.items : [];
    const ranked = items
      .map((it, i) => ({ it, i, r: it ? commandRank(q, it.label, it.keywords) : -1 }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => x.it);
    if (ranked.length) out.push({ ...g, items: ranked });
  }
  return out;
}

/**
 * Cap the rows shown without dropping a whole group: every group with items gets a floor share,
 * floor(cap / groups) (or all its items if it has fewer), then the rest of the cap goes one row
 * at a time, in list order and round after round, to the groups that still have rows. Order is
 * kept. One group is a plain slice. With fewer rows of cap than groups, the first groups win.
 * @internal
 * @param {CommandGroup[]} groups
 * @param {number} [cap] default 100
 * @returns {{ groups: CommandGroup[], shown: number, total: number }}
 */
export function capMatches(groups, cap) {
  const n = cap === undefined || cap === null || !Number.isFinite(Number(cap)) ? 100 : Math.max(0, Math.floor(Number(cap)));
  const list = (Array.isArray(groups) ? groups : []).filter((g) => g && Array.isArray(g.items) && g.items.length);
  const total = list.reduce((a, g) => a + g.items.length, 0);
  if (total <= n) return { groups: list, shown: total, total };
  const take = list.map((g) => Math.min(g.items.length, Math.floor(n / list.length)));
  let left = n - take.reduce((a, b) => a + b, 0);
  while (left > 0) {
    let gave = false;
    for (let i = 0; i < list.length && left > 0; i++) {
      if (take[i] < list[i].items.length) { take[i]++; left--; gave = true; }
    }
    if (!gave) break;
  }
  const out = list.map((g, i) => ({ ...g, items: g.items.slice(0, take[i]) })).filter((g) => g.items.length);
  return { groups: out, shown: take.reduce((a, b) => a + b, 0), total };
}

/**
 * The status line read to screen readers: "No results", "1 result", "3 results".
 * @internal
 * @param {number} count
 * @returns {string}
 */
export function commandStatus(count) {
  return count === 0 ? "No results" : count === 1 ? "1 result" : count + " results";
}

/** @param {any} q */
const idOf = (q) => (q && q.id != null && q.id !== "" ? String(q.id) : "command");
/** @param {any} q @returns {CommandGroup[]} */
const groupsOf = (q) => (q && Array.isArray(q.groups) ? q.groups : []).filter((/** @type {any} */ g) => g && Array.isArray(g.items));

/**
 * The flat index of the option that starts active: `selected` as an index or a value, when it
 * names an enabled option, else the first enabled option; -1 when none is enabled.
 * @param {CommandGroup[]} groups
 * @param {unknown} selected
 */
function activeIndex(groups, selected) {
  /** @type {CommandItem[]} */
  const flat = groups.reduce((a, g) => a.concat(g.items), /** @type {CommandItem[]} */ ([]));
  const ok = (/** @type {number} */ i) => i >= 0 && i < flat.length && !!flat[i] && flat[i].disabled !== true;
  if (typeof selected === "number" && ok(selected)) return selected;
  if (typeof selected === "string") {
    const i = flat.findIndex((it) => it && String(it.value) === selected);
    if (ok(i)) return i;
  }
  return flat.findIndex((it, i) => ok(i));
}

/**
 * The data-* attributes of an item's `data` map; keys must be [a-z0-9-] and not one the
 * component writes itself.
 * @param {unknown} data
 * @returns {Record<string, unknown>}
 */
function dataAttrs(data) {
  /** @type {Record<string, unknown>} */
  const out = {};
  if (!data || typeof data !== "object") return out;
  for (const [key, v] of Object.entries(data)) {
    if (!/^[a-z0-9-]+$/.test(key) || RESERVED.indexOf(key) >= 0 || v == null) continue;
    out["data-" + key] = String(v);
  }
  return out;
}

/** @param {unknown} ic */
const iconOf = (ic) => (ic == null || ic === "" ? "" : isSafe(ic) ? ic : icon(String(ic), 16));

/**
 * The list part of a command: the listbox of groups and options and the empty line (hidden while
 * there are options). An app that filters itself re-renders the element "<id>-body" with this,
 * then calls commandSync on the command so the field's aria-activedescendant follows.
 * @internal
 * @param {{id?: string, label?: string, groups?: CommandGroup[], selected?: number|string, emptyText?: string}} p
 */
export function commandList(p) {
  const q = p || {};
  const id = idOf(q);
  const groups = groupsOf(q);
  const active = activeIndex(groups, q.selected);
  const count = groups.reduce((a, g) => a + g.items.length, 0);
  const empty = q.emptyText != null && q.emptyText !== "" ? q.emptyText : "No results found.";
  let n = -1;
  const body = groups.map((g, gi) => {
    const hasLabel = g.label != null && g.label !== "";
    const head = id + "-g-" + gi;
    return html`<div ${attrs({ class: "gk-command__group", role: "group", "aria-labelledby": hasLabel ? head : null })}>${hasLabel ? html`<div class="gk-command__heading" id="${head}" aria-hidden="true">${g.label}</div>` : ""}${g.items.map((it) => {
      n++;
      const off = it.disabled === true;
      const kw = Array.isArray(it.keywords) ? it.keywords.join(" ") : it.keywords;
      const keys = Array.isArray(it.shortcut) ? it.shortcut : it.shortcut != null && it.shortcut !== "" ? [String(it.shortcut)] : [];
      return html`<div ${attrs({
        class: "gk-command__item", role: "option", id: id + "-opt-" + n, "aria-selected": n === active ? "true" : "false",
        "aria-disabled": off ? "true" : null, "data-act": off ? null : it.act || "command:pick", "data-v": it.value != null ? String(it.value) : "",
        "data-k": id + "-opt-" + n, "data-keywords": kw ? String(kw) : null, ...dataAttrs(it.data),
      })}>${iconOf(it.icon)}<span class="gk-command__label">${it.label != null ? it.label : ""}</span>${it.sub != null && it.sub !== "" ? html`<span class="gk-command__sub">${it.sub}</span>` : ""}${keys.length ? html`<span class="gk-command__shortcut">${kbdGroup({ keys })}</span>` : ""}</div>`;
    })}</div>`;
  });
  return html`<div ${attrs({ class: "gk-command__list", id: id + "-list", role: "listbox", "aria-label": q.label || "Commands", "data-keep-scroll": true })}>${body}</div><div ${attrs({ class: "gk-command__empty", hidden: count > 0 })}>${empty}</div>`;
}

/**
 * @component command
 * @title Command
 * @category Overlays
 * @summary A search field over grouped options that filter as you type, with keyboard and pointer selection.
 * @param {{id: string, label: string, placeholder?: string, groups: Array<{label?: string, items: Array<{value: string, label: string, sub?: string, icon?: string, shortcut?: string[], disabled?: boolean, act?: string, keywords?: string[], data?: Record<string, string>}>}>, query?: string, selected?: number|string, emptyText?: string, filter?: "island"|"app", status?: string, note?: string, k?: string}} p
 * `id` prefixes every part: the field "<id>-input", the listbox "<id>-list", options "<id>-opt-<n>" (n counts across groups), the list region "<id>-body" and the status "<id>-status". `label` names the field and the listbox. Each item has a `value` (data-v), a `label`, an optional muted `sub`, an `icon` name, a `shortcut` shown as key caps, `keywords` that also match, and `act` (default "command:pick"). `data` adds data-* attributes (keys of a-z, 0-9 and "-"), such as `{ to: "settings" }` for data-to. A `disabled` item is listed, dimmed and aria-disabled, carries no data-act and is skipped by the keys. `query` is the field's value; `selected` (an index or a value) is the option that starts active, else the first enabled one. `emptyText` replaces "No results found." `filter` "island" (the default) lets commandIsland hide what does not match; "app" leaves filtering to the app, which listens for "input" on data-act "command:input", filters with filterCommand (and capMatches), re-renders "<id>-body" with commandList and sets `status`. `note` is a muted line under the list, such as "Showing 100 of 437". `k` is the field's data-k (default "<id>-input").
 * @emits command:pick (Enter or a click on an option; data-v is the value; or the item's own act)
 * @emits command:input (input event on the field; the app filters when filter is "app")
 * @states default, empty, disabled-item
 * @a11y The field is a combobox (aria-expanded, aria-controls the listbox, aria-autocomplete list) and keeps focus; aria-activedescendant names the active option, which is aria-selected. Arrow Down and Up move (wrapping, skipping disabled and hidden options), Home and End jump, Enter picks; the pointer makes the option under it active. Groups are role="group" named by their heading. A polite status says how many results there are; the empty line is visible text. The active row is shown by background, and a disabled row is dimmed and aria-disabled. Motion: none.
 * @example default: command({ id: "cmd-demo", label: "Commands", placeholder: "Type a command or search...", groups: [{ label: "Suggestions", items: [{ value: "calendar", label: "Calendar", icon: "grid" }, { value: "emoji", label: "Search emoji", icon: "search", keywords: ["smiley"] }, { value: "calculator", label: "Calculator", icon: "chart" }] }, { label: "Settings", items: [{ value: "profile", label: "Profile", icon: "users", shortcut: ["Ctrl", "P"] }, { value: "settings", label: "Settings", icon: "gear", shortcut: ["Ctrl", "S"] }] }] })
 * @example empty: command({ id: "cmd-empty", label: "Commands", query: "zebra", groups: [] })
 * @example disabled-item: command({ id: "cmd-off", label: "Commands", groups: [{ label: "Acme", items: [{ value: "export", label: "Export register", sub: "CSV" }, { value: "archive", label: "Archive register", disabled: true }, { value: "share", label: "Share", sub: "example.org" }] }] })
 */
export function command(p) {
  const q = p || { id: "command", label: "", groups: [] };
  const id = idOf(q);
  const groups = groupsOf(q);
  const label = q.label != null && q.label !== "" ? String(q.label) : "Commands";
  const filter = q.filter === "app" ? "app" : "island";
  const active = activeIndex(groups, q.selected);
  const count = groups.reduce((a, g) => a + g.items.length, 0);
  const status = q.status != null && q.status !== "" ? q.status : commandStatus(count);
  return html`<div ${attrs({ class: "gk-command", "data-mount": "command", "data-props": JSON.stringify({ id, filter }) })}><div class="gk-command__field">${icon("search", 16)}<input ${attrs({
    class: "gk-command__input", id: id + "-input", type: "text", role: "combobox", "aria-expanded": "true", "aria-controls": id + "-list",
    "aria-autocomplete": "list", "aria-activedescendant": active >= 0 ? id + "-opt-" + active : null, autocomplete: "off", spellcheck: "false",
    "aria-label": label, placeholder: q.placeholder || null, value: q.query != null && q.query !== "" ? String(q.query) : null,
    "data-act": "command:input", "data-k": q.k != null && q.k !== "" ? String(q.k) : id + "-input",
  })}></div><div class="gk-command__body" id="${id + "-body"}">${commandList({ id, label, groups, selected: active, emptyText: q.emptyText })}</div><p class="sr-only" id="${id + "-status"}" role="status" aria-live="polite">${status}</p>${q.note != null && q.note !== "" ? html`<p class="gk-command__note">${q.note}</p>` : ""}</div>`;
}

/**
 * @component commandDialog
 * @title Command Dialog
 * @category Overlays
 * @summary The command menu in a modal dialog, with a row of key hints: the Ctrl K search box.
 * @param {{id: string, open?: boolean, label: string, returnK?: string, footer?: boolean, selectLabel?: string, closeAct?: string, closeLabel?: string, placeholder?: string, groups: Array<{label?: string, items: Array<{value: string, label: string, sub?: string, icon?: string, shortcut?: string[], disabled?: boolean, act?: string, keywords?: string[], data?: Record<string, string>}>}>, query?: string, selected?: number|string, emptyText?: string, filter?: "island"|"app", status?: string, note?: string, k?: string}} p
 * A kit dialog with no header, id "<id>-dialog", holding command with the same `id` and the command props. `label` names the dialog and the command. `open`, `returnK` and `closeLabel` are the dialog's; `closeAct` defaults to "command:close". `footer` false drops the key hints (Enter `selectLabel`, default "Select"; arrows Move; Esc Close). Mount with mountIslands(root, { dialog: dialogIsland, command: commandIsland }); the native dialog moves focus into the field.
 * @emits command:close (Escape, a backdrop click or the close button; or the closeAct you pass)
 * @emits command:pick (as command)
 * @emits command:input (as command)
 * @states open, closed
 * @a11y A native modal dialog (focus trapped, Escape closes, focus returns to the opener by returnK) named by `label`, around the command combobox and listbox. The key hints are aria-hidden: the keys are announced by the combobox role. Motion: the dialog's fade and scale, multiplied by --motion-scale.
 * @example open: commandDialog({ id: "cmdd-demo", open: true, label: "Search Acme", placeholder: "Search...", groups: [{ label: "Pages", items: [{ value: "home", label: "Home", icon: "list" }, { value: "settings", label: "Settings", icon: "gear", shortcut: ["Ctrl", ","] }] }] })
 * @example closed: commandDialog({ id: "cmdd-closed", label: "Search Acme", groups: [{ items: [{ value: "calendar", label: "Calendar" }] }] })
 */
export function commandDialog(p) {
  const q = p || { id: "command", label: "", groups: [] };
  const id = idOf(q);
  const label = q.label != null && q.label !== "" ? String(q.label) : "Commands";
  const sel = q.selectLabel != null && q.selectLabel !== "" ? q.selectLabel : "Select";
  const hints = q.footer === false ? "" : html`<div class="gk-command-dialog__hints" aria-hidden="true"><span>${kbdGroup({ keys: ["↵"] })} ${sel}</span><span>${kbdGroup({ keys: ["↑", "↓"] })} Move</span><span>${kbdGroup({ keys: ["Esc"] })} Close</span></div>`;
  const content = html`${command({ ...q, id, label })}${hints}`;
  return overlayMarkup("dialog", {
    id: id + "-dialog", open: q.open === true, label, content, returnK: q.returnK, closeAct: q.closeAct || "command:close", closeLabel: q.closeLabel,
  }, { class: "gk-dialog gk-command-dialog" });
}

/** @param {any} el */
const shown = (el) => !el.hasAttribute("hidden") && !(el.closest && el.closest(".gk-command__group[hidden]"));
/** @param {any} el */
const enabled = (el) => el.getAttribute("aria-disabled") !== "true";

/**
 * Bring the field and the options of a command in step after the app re-rendered its list: the
 * active option is the visible enabled one marked aria-selected, else the first visible enabled
 * one; the field's aria-activedescendant names it (or is removed when there is none).
 * @internal
 * @param {Element} el the .gk-command element
 * @returns {Element | null} the active option
 */
export function commandSync(el) {
  /** @type {any[]} */
  const opts = Array.prototype.slice.call(el.querySelectorAll('[role="option"]'));
  const live = opts.filter((o) => shown(o) && enabled(o));
  const cur = live.find((o) => o.getAttribute("aria-selected") === "true") || live[0] || null;
  setActive(el, cur, false);
  return cur;
}

/**
 * @param {Element} el
 * @param {any} cur
 * @param {boolean} scroll
 */
function setActive(el, cur, scroll) {
  for (const o of Array.prototype.slice.call(el.querySelectorAll('[role="option"]'))) o.setAttribute("aria-selected", o === cur ? "true" : "false");
  const input = el.querySelector(".gk-command__input");
  if (input) {
    if (cur && cur.id) input.setAttribute("aria-activedescendant", cur.id);
    else input.removeAttribute("aria-activedescendant");
  }
  if (scroll && cur && typeof cur.scrollIntoView === "function") cur.scrollIntoView({ block: "nearest" });
}

/**
 * Filter the rendered options in place: hide the options whose label and keywords do not match
 * (commandRank), hide groups left with no visible option, show the empty line when nothing is
 * left, write the count to the status and make the first visible enabled option active.
 * @internal
 * @param {Element} el the .gk-command element
 * @param {string} query
 */
export function commandFilterDom(el, query) {
  const q = fold(query).trim();
  let count = 0;
  for (const g of Array.prototype.slice.call(el.querySelectorAll(".gk-command__group"))) {
    let any = false;
    for (const o of Array.prototype.slice.call(g.querySelectorAll('[role="option"]'))) {
      const lab = o.querySelector(".gk-command__label");
      const ok = commandRank(q, lab ? lab.textContent : "", o.getAttribute("data-keywords") || "") >= 0;
      if (ok) { o.removeAttribute("hidden"); any = true; count++; } else o.setAttribute("hidden", "");
    }
    if (any) g.removeAttribute("hidden"); else g.setAttribute("hidden", "");
  }
  const empty = el.querySelector(".gk-command__empty");
  if (empty) { if (count) empty.setAttribute("hidden", ""); else empty.removeAttribute("hidden"); }
  const status = el.querySelector('[role="status"]');
  if (status) status.textContent = commandStatus(count);
  for (const o of Array.prototype.slice.call(el.querySelectorAll('[role="option"]'))) o.setAttribute("aria-selected", "false");
  commandSync(el);
}

/**
 * The keys and the pointer for a command, mounted on the .gk-command element. Arrow Down and
 * Up move the active option (wrapping, skipping disabled and hidden ones), Home and End jump,
 * Enter clicks the active option so its delegated data-act runs; moving the pointer over an
 * option makes it active, and pressing on one keeps focus in the field. With filter "island"
 * each input filters in place (commandFilterDom); with "app" the island only re-syncs after the
 * app's input handler has re-rendered the list.
 * @type {import("@gas-kit/client/islands.js").Island}
 */
export const commandIsland = {
  mount(el, data) {
    const props = data || {};
    const mode = props.filter === "app" ? "app" : "island";
    const input = /** @type {any} */ (el.querySelector(".gk-command__input"));
    /** @returns {any[]} */
    const live = () => Array.prototype.slice.call(el.querySelectorAll('[role="option"]')).filter((o) => shown(o) && enabled(o));
    /** @param {any} ev */
    const onKey = (ev) => {
      if (!input || ev.target !== input || ev.isComposing || ev.altKey || ev.ctrlKey || ev.metaKey) return;
      const k = ev.key;
      if (k !== "ArrowDown" && k !== "ArrowUp" && k !== "Home" && k !== "End" && k !== "Enter") return;
      const list = live();
      const cur = list.find((o) => o.getAttribute("aria-selected") === "true") || null;
      const i = list.indexOf(cur);
      if (k === "Enter") {
        if (!cur) return;
        ev.preventDefault();
        cur.click();
        return;
      }
      ev.preventDefault();
      if (!list.length) return;
      const n = list.length;
      const next = k === "Home" ? 0 : k === "End" ? n - 1 : k === "ArrowDown" ? (i < 0 ? 0 : (i + 1) % n) : i < 0 ? n - 1 : (i - 1 + n) % n;
      setActive(el, list[next], true);
    };
    /** @param {any} ev */
    const onMove = (ev) => {
      const o = ev.target && ev.target.closest ? ev.target.closest('[role="option"]') : null;
      if (o && el.contains(o) && enabled(o) && o.getAttribute("aria-selected") !== "true") setActive(el, o, false);
    };
    /** @param {any} ev */
    const onDown = (ev) => {
      const o = ev.target && ev.target.closest ? ev.target.closest('[role="option"]') : null;
      if (o && el.contains(o)) ev.preventDefault();
    };
    let alive = true;
    /** @param {any} ev */
    const onInput = (ev) => {
      if (!input || ev.target !== input) return;
      if (mode === "island") commandFilterDom(el, String(input.value || ""));
      // The app's delegated handler runs later in this dispatch; sync once it has re-rendered.
      else Promise.resolve().then(() => { if (alive) commandSync(el); });
    };
    el.addEventListener("keydown", onKey);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("mousedown", onDown);
    el.addEventListener("input", onInput);
    if (mode === "island" && input && String(input.value || "").trim()) commandFilterDom(el, String(input.value));
    return () => {
      alive = false;
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("mousedown", onDown);
      el.removeEventListener("input", onInput);
    };
  },
};

/** @param {any} t */
function isEditable(t) {
  if (!t || typeof t.getAttribute !== "function") return false;
  const tag = String(t.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (t.isContentEditable) return true;
  return typeof t.closest === "function" && !!t.closest("[contenteditable]") && t.closest("[contenteditable]").getAttribute("contenteditable") !== "false";
}

/**
 * Bind Ctrl or Cmd + `key` (default "k", any case) on a document to open a command menu:
 * onOpen(event.target) runs and the browser default is prevented. A press inside another
 * editable field (input, textarea, select, contenteditable) is left alone; one in a command's
 * own field still runs, so the app can toggle. Returns the teardown.
 * @internal
 * @param {Document} doc
 * @param {(target: any) => void} onOpen
 * @param {{key?: string}} [opts]
 * @returns {() => void}
 */
export function commandHotkey(doc, onOpen, opts) {
  const key = String((opts && opts.key) || "k").toLowerCase();
  /** @param {any} ev */
  const onKey = (ev) => {
    if (!ev || !(ev.ctrlKey || ev.metaKey) || ev.altKey || String(ev.key || "").toLowerCase() !== key) return;
    const t = ev.target;
    if (isEditable(t) && !(t.classList && t.classList.contains("gk-command__input"))) return;
    ev.preventDefault();
    onOpen(t);
  };
  doc.addEventListener("keydown", onKey);
  return () => doc.removeEventListener("keydown", onKey);
}
