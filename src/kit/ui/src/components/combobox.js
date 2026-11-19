// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
// A combobox (shadcn Combobox = Popover + Command): an outline gk-btn trigger with role
// combobox and popovertarget, and a popover="auto" panel holding a command menu over the
// options. comboboxIsland (mounted with mountIslands(root, { combobox: comboboxIsland })) places
// the panel, keeps aria-expanded in step, mounts the inner commandIsland itself, closes the panel
// on a pick or Tab and hands focus back to the trigger. The app handles combobox:pick with
// delegate (data-id, data-v) and re-renders with the new value.
//
// Long lists: up to `cap` options every option is rendered and filtered in place. Above it the
// view renders a capped first page (capMatches, never dropping a whole group, and keeping the
// chosen option) and puts the full option list in the panel's data-props; on each input the
// island filters that full list (filterCommand), caps the matches again and re-renders the list
// body, so every option can still be found by typing.
import { html, attrs, styleDecls } from "@gas-kit/client/html.js";
import { quote, renderRegion } from "@gas-kit/client/dom.js";
import { icon } from "@gas-kit/client/icons.js";
import { tipPlacement } from "@gas-kit/client/tipPlace.js";
import { capMatches, command, commandFilterDom, commandIsland, commandList, commandStatus, commandSync, filterCommand } from "./command.js";

const CURRENT = "Current choice";
const CHEVRON = icon("chevron", 16);
// The chosen option's mark: a drawn check and sr-only text, so the choice is never colour alone.
const MARK = html`<span class="gk-combobox__mark">${icon("check", 16)}<span class="sr-only">${CURRENT}: </span></span>`;
const WIDTH = /^\d{1,4}(?:\.\d{1,3})?(?:px|rem|%)$/;

/**
 * @typedef {{ value: string, label: string, group?: string, disabled?: boolean, keywords?: string[] }} ComboboxOption
 * @typedef {import("./command.js").CommandGroup} ComboboxGroup
 */

/**
 * Clean options: a value is required (any string, "" included), the label defaults to the
 * value, keywords become a list of strings. Only the fields the panel needs are kept, so the
 * result can travel in data-props.
 * @param {unknown} options
 * @returns {ComboboxOption[]}
 */
function cleanOptions(options) {
  /** @type {ComboboxOption[]} */
  const out = [];
  for (const o of Array.isArray(options) ? options : []) {
    if (!o || typeof o !== "object" || o.value == null) continue;
    const value = String(o.value);
    /** @type {ComboboxOption} */
    const c = { value, label: o.label != null && o.label !== "" ? String(o.label) : value };
    if (o.group != null && o.group !== "") c.group = String(o.group);
    if (o.disabled === true) c.disabled = true;
    const kw = (Array.isArray(o.keywords) ? o.keywords : o.keywords != null && o.keywords !== "" ? [o.keywords] : []).filter((/** @type {unknown} */ x) => x != null && x !== "").map(String);
    if (kw.length) c.keywords = kw;
    out.push(c);
  }
  return out;
}

/**
 * The command groups for a combobox: ungrouped options first with no heading, then one group per
 * `group` in order of first appearance. Every item emits combobox:pick with data-id; the chosen
 * one carries the check mark.
 * @param {ComboboxOption[]} options
 * @param {string|null} value
 * @param {string} id
 * @returns {ComboboxGroup[]}
 */
function groupsOf(options, value, id) {
  /** @type {ComboboxGroup} */
  const loose = { items: [] };
  /** @type {Map<string, ComboboxGroup>} */
  const named = new Map();
  for (const o of options) {
    const item = {
      value: o.value, label: o.label, act: "combobox:pick", data: { id }, disabled: o.disabled === true,
      keywords: o.keywords, icon: value !== null && o.value === value ? MARK : null,
    };
    if (o.group === undefined) { loose.items.push(item); continue; }
    let g = named.get(o.group);
    if (!g) { g = { label: o.group, items: [] }; named.set(o.group, g); }
    g.items.push(item);
  }
  return (loose.items.length ? [loose] : []).concat(Array.from(named.values()));
}

/**
 * capMatches, but the chosen option is never capped away: when it is among `groups` and the cap
 * dropped it, one row less is capped and the chosen one is put back in its place.
 * @param {ComboboxGroup[]} groups
 * @param {number} cap
 * @param {string|null} value
 * @returns {{ groups: ComboboxGroup[], shown: number, total: number }}
 */
function capKeeping(groups, cap, value) {
  const c = capMatches(groups, cap);
  if (value === null || c.shown >= c.total || cap < 1) return c;
  const has = (/** @type {ComboboxGroup[]} */ gs) => gs.some((g) => g.items.some((it) => it.value === value));
  if (has(c.groups) || !has(groups)) return c;
  /** @type {Set<unknown>} */
  const keep = new Set();
  for (const g of capMatches(groups, cap - 1).groups) for (const it of g.items) keep.add(it);
  const out = groups.map((g) => ({ ...g, items: g.items.filter((it) => keep.has(it) || it.value === value) })).filter((g) => g.items.length);
  return { groups: out, shown: keep.size + 1, total: c.total };
}

/** @param {number} shown @param {number} total */
const noteOf = (shown, total) => "Showing " + shown + " of " + total + ". Type to narrow.";

/** @param {unknown} cap */
function capOf(cap) {
  const n = Number(cap);
  return cap != null && cap !== "" && Number.isFinite(n) && n >= 1 ? Math.floor(n) : 100;
}

/**
 * @component combobox
 * @title Combobox
 * @category Forms
 * @summary A button that opens a searchable list of options to pick one, grouped and capped for long lists.
 * @param {{id: string, label: string, options: Array<{value: string, label: string, group?: string, disabled?: boolean, keywords?: string[]}>, value?: string, placeholder?: string, searchPlaceholder?: string, emptyText?: string, width?: string, cap?: number, k?: string}} p
 * `id` prefixes every part: the trigger "<id>-trigger", the panel "<id>-panel" and the inner command "<id>-cmd" (its field "<id>-cmd-input", listbox "<id>-cmd-list", options "<id>-cmd-opt-<n>"). `label` names the trigger (with the shown text after it, as in "Framework, Remix") and the listbox. Each option has a `value` (data-v) and a `label` (default the value), an optional `group` heading (ungrouped options come first with no heading, then each group in order of first appearance), `keywords` that also match, and `disabled` (listed, dimmed, aria-disabled, no act). `value` is the chosen option: the trigger shows its label and the list marks it with a check; with none the trigger shows `placeholder` (default "Select...") in muted text. `searchPlaceholder` (default "Search...") and `emptyText` (default "No results found.") are the command's. `width` is a CSS length in px, rem or % (anything else is dropped) set on the root as --gk-combobox-w, and the trigger fills it. Up to `cap` options (default 100) are all rendered and filtered in place; above it the list shows a capped first page (no group dropped, the chosen option kept) with the note "Showing n of m. Type to narrow.", and the island filters the full list on each input and re-renders the list body. `k` prefixes the data-k values (default `id`): "<k>-trigger" and "<k>-search". The app listens for click on combobox:pick (data-id is the combobox id, data-v the value) and re-renders with the new `value`.
 * @emits combobox:pick (click or Enter on an option; data-id is the combobox id, data-v the value)
 * @states default, with-value, grouped, disabled-option, long-list
 * @a11y The trigger is a native button with role="combobox", aria-haspopup="listbox", aria-controls the panel and aria-expanded kept in step by the island; its aria-label is the label and the shown text. ArrowDown or ArrowUp on it opens the panel. The panel holds the command: a search field (a combobox with aria-activedescendant naming the active option) over a role="listbox" of role="option" rows in role="group" groups; focus stays in the field, Arrow Down and Up move, Home and End jump, Enter picks. The chosen option shows a drawn check and sr-only "Current choice" text, never colour alone; the active row is aria-selected. Escape and an outside click close the panel natively (popover light dismiss); a pick or Tab closes it too, and focus returns to the trigger unless it moved elsewhere. A polite status gives the number of results. When the app tears the island down and re-renders the combobox in the same task, an open panel opens again with the same query and focus in the field; when nothing re-mounts it in that task (a navigation), the open panel is hidden, never left floating. Motion: the panel fades and scales in over --dur-2 with the scale multiplied by --motion-scale.
 * @example default: combobox({ id: "cb-framework", label: "Framework", options: [{ value: "next", label: "Next.js" }, { value: "svelte", label: "SvelteKit" }, { value: "nuxt", label: "Nuxt.js" }, { value: "remix", label: "Remix" }, { value: "astro", label: "Astro" }] })
 * @example with-value: combobox({ id: "cb-chosen", label: "Framework", value: "remix", width: "200px", options: [{ value: "next", label: "Next.js" }, { value: "svelte", label: "SvelteKit" }, { value: "remix", label: "Remix" }, { value: "astro", label: "Astro" }] })
 * @example grouped: combobox({ id: "cb-zone", label: "Time zone", placeholder: "Select a time zone", searchPlaceholder: "Search time zones...", value: "utc", options: [{ value: "utc", label: "UTC" }, { value: "london", label: "London", group: "Europe" }, { value: "paris", label: "Paris", group: "Europe", keywords: ["france"] }, { value: "new-york", label: "New York", group: "Americas" }, { value: "lisbon", label: "Lisbon", group: "Europe" }] })
 * @example disabled-option: combobox({ id: "cb-plan", label: "Plan", options: [{ value: "free", label: "Free" }, { value: "team", label: "Team" }, { value: "enterprise", label: "Enterprise", disabled: true }] })
 * @example long-list: combobox({ id: "cb-site", label: "Site", cap: 10, value: "site-30", options: Array.from({ length: 40 }, (_, i) => ({ value: "site-" + (i + 1), label: "Acme site " + (i + 1), group: i < 20 ? "North" : "South" })) })
 */
export function combobox(p) {
  const q = p || { id: "combobox", label: "", options: [] };
  const id = q.id != null && q.id !== "" ? String(q.id) : "combobox";
  const k = q.k != null && q.k !== "" ? String(q.k) : id;
  const label = q.label != null && q.label !== "" ? String(q.label) : "Options";
  const placeholder = q.placeholder != null && q.placeholder !== "" ? String(q.placeholder) : "Select...";
  const search = q.searchPlaceholder != null && q.searchPlaceholder !== "" ? String(q.searchPlaceholder) : "Search...";
  const emptyText = q.emptyText != null && q.emptyText !== "" ? String(q.emptyText) : "No results found.";
  const width = q.width != null && WIDTH.test(String(q.width)) ? String(q.width) : null;
  const cap = capOf(q.cap);
  const options = cleanOptions(q.options);
  const value = q.value != null ? String(q.value) : null;
  const chosen = value === null ? null : options.find((o) => o.value === value) || null;
  const groups = groupsOf(options, value, id);
  const capped = options.length > cap;
  const view = capped ? capKeeping(groups, cap, value) : { groups, shown: options.length, total: options.length };
  const props = capped ? { id, cap, value, label, emptyText, options } : { id };
  const shownText = chosen ? chosen.label : placeholder;
  // command's @param spells an item icon as a name; its CommandItem type and iconOf also take
  // SafeHtml, which the chosen option's mark is, hence the cast below.
  return html`<div ${attrs({ class: "gk-combobox", style: width ? styleDecls({ "--gk-combobox-w": width }) : null })}><button ${attrs({
    type: "button", id: id + "-trigger", class: "gk-btn gk-combobox__trigger", "data-variant": "outline", role: "combobox",
    "aria-haspopup": "listbox", "aria-expanded": "false", "aria-controls": id + "-panel", popovertarget: id + "-panel",
    "aria-label": label + ", " + shownText, "data-k": k + "-trigger",
  })}><span class="${chosen ? "gk-combobox__value" : "gk-combobox__value is-placeholder"}">${shownText}</span>${CHEVRON}</button><div ${attrs({
    id: id + "-panel", popover: "auto", class: "gk-combobox__panel", "data-mount": "combobox", "data-props": JSON.stringify(props),
  })}>${command({
    id: id + "-cmd", label, placeholder: search, emptyText, filter: capped ? "app" : "island", groups: /** @type {any} */ (view.groups),
    selected: value === null ? undefined : value, note: capped ? noteOf(view.shown, view.total) : undefined, k: k + "-search",
  })}</div></div>`;
}

/**
 * Panels open at the moment their island was torn down, by combobox id, with the query typed.
 * A mount in the same task opens the re-rendered panel again; after that task an entry nobody
 * took hides its panel, so a navigation never leaves one floating. Only DOM state.
 * @type {Map<string, {query: string}>}
 */
const reopen = new Map();

/** Whether a popover panel is showing; false where :popover-open is not known. @param {any} pn */
const shownNow = (pn) => { try { return !!(pn.matches && pn.matches(":popover-open")); } catch (e) { return false; } };

/** @param {Element} el @returns {any} */
function propsOf(el) {
  try { const v = JSON.parse(el.getAttribute("data-props") || "{}"); return v == null ? {} : v; } catch (e) { return {}; }
}

/**
 * Placement, state and the inner command for a combobox, mounted on the popover panel. On open
 * it places the panel under the trigger with tipPlacement (flipping above when there is no
 * room, at least as wide as the trigger), sets aria-expanded and focuses the search field; on
 * close it clears the query and returns focus to the trigger unless focus moved elsewhere. A
 * pick or Tab hides the panel and focuses the trigger; the pick's click still reaches the app.
 * ArrowDown or ArrowUp on the trigger opens it. It mounts commandIsland on the inner command
 * (and marks it mounted, so registering command too does no harm) and, for a capped list,
 * re-renders the list body from the full options on each input. Returns a teardown; tearing
 * down an open panel lets a re-render in the same task reopen it, else the panel is hidden.
 * @type {import("@gas-kit/client/islands.js").Island}
 */
export const comboboxIsland = {
  mount(el, data) {
    const pn = /** @type {any} */ (el);
    const props = data || {};
    const panelId = el.getAttribute("id") || String(props.id || "") + "-panel";
    const id = String(props.id || panelId.replace(/-panel$/, ""));
    const doc = el.ownerDocument;
    const trigger = () => /** @type {any} */ (doc.querySelector('[popovertarget="' + quote(panelId) + '"]'));
    const cmd = /** @type {any} */ (el.querySelector(".gk-command"));
    const input = () => /** @type {any} */ (el.querySelector(".gk-command__input"));
    /** @type {null | (() => void)} */
    let stopCmd = null;
    let ownCmd = false;
    if (cmd && cmd.getAttribute("data-mounted") !== "1") {
      cmd.setAttribute("data-mounted", "1");
      ownCmd = true;
      try {
        const d = commandIsland.mount(cmd, propsOf(cmd));
        if (typeof d === "function") stopCmd = d;
      } catch (e) { /* the panel still opens and closes without the keys */ }
    }
    const full = Array.isArray(props.options) ? cleanOptions(props.options) : null;
    const cap = capOf(props.cap);
    const value = props.value != null ? String(props.value) : null;
    const all = full ? groupsOf(full, value, id) : [];
    const label = props.label != null && props.label !== "" ? String(props.label) : "Options";
    const emptyText = props.emptyText != null && props.emptyText !== "" ? String(props.emptyText) : undefined;

    /** @param {string} query */
    const refilter = (query) => {
      if (!cmd) return;
      if (!full) { commandFilterDom(cmd, query); return; }
      const blank = !String(query || "").trim();
      const c = capKeeping(filterCommand(all, query), cap, value);
      const body = cmd.querySelector(".gk-command__body");
      if (body) renderRegion(body, commandList({ id: id + "-cmd", label, groups: c.groups, emptyText, selected: blank && value !== null ? value : undefined }), { keepScroll: false });
      commandSync(cmd);
      const status = cmd.querySelector('[role="status"]');
      if (status) status.textContent = commandStatus(c.total);
      const note = cmd.querySelector(".gk-command__note");
      if (note) {
        if (c.shown < c.total) { note.textContent = noteOf(c.shown, c.total); note.removeAttribute("hidden"); } else note.setAttribute("hidden", "");
      }
    };
    // With a blank query the chosen option (the one with the mark) is the active one again.
    const activateChosen = () => {
      if (!cmd) return;
      const mark = cmd.querySelector(".gk-combobox__mark");
      const opt = mark && mark.closest ? mark.closest('[role="option"]') : null;
      if (!opt || opt.getAttribute("aria-disabled") === "true" || opt.hasAttribute("hidden")) return;
      for (const o of Array.prototype.slice.call(cmd.querySelectorAll('[role="option"]'))) o.setAttribute("aria-selected", o === opt ? "true" : "false");
      commandSync(cmd);
    };
    let open = false;
    const isOpen = () => {
      try { return !!(pn.matches && pn.matches(":popover-open")); } catch (e) { return open; }
    };
    const hide = () => {
      open = false;
      if (typeof pn.hidePopover === "function") {
        try { pn.hidePopover(); } catch (e) { /* already hidden */ }
      }
    };
    const place = () => {
      const t = trigger();
      if (!t || typeof t.getBoundingClientRect !== "function") return;
      const a = t.getBoundingClientRect();
      const minW = Math.max(0, Math.round(a.width != null ? a.width : a.right - a.left) || 0);
      el.setAttribute("style", "min-width:" + minW + "px");
      const s = pn.getBoundingClientRect();
      const w = /** @type {any} */ (doc.defaultView || globalThis);
      const vw = w.innerWidth || 1024;
      const width = Math.max(s.width || 0, minW);
      const r = tipPlacement(a, { width, height: s.height || 0 }, { width: vw, height: w.innerHeight || 768 }, { gap: 4, margin: 8 });
      const left = Math.max(8, Math.min(a.left, vw - width - 8));
      el.setAttribute("style", "min-width:" + minW + "px;left:" + Math.round(left) + "px;top:" + Math.round(r.top) + "px");
    };
    /** @param {any} ev */
    const onToggle = (ev) => {
      // A panel a redraw removed reports its close a task later; the trigger is the new one then.
      if (!el.isConnected) return;
      open = ev && ev.newState ? ev.newState === "open" : isOpen();
      const t = trigger();
      if (t) t.setAttribute("aria-expanded", open ? "true" : "false");
      const i = input();
      if (open) {
        place();
        if (i && !String(i.value || "").trim()) activateChosen();
        if (i && typeof i.focus === "function") i.focus();
        return;
      }
      if (i && i.value) { i.value = ""; refilter(""); }
      activateChosen();
      if (t && (doc.activeElement === doc.body || el.contains(doc.activeElement))) t.focus();
    };
    /** @param {any} ev */
    const onInput = (ev) => {
      const i = input();
      if (full && i && ev.target === i) refilter(String(i.value || ""));
    };
    /** @param {any} ev */
    const onClick = (ev) => {
      const o = ev.target && ev.target.closest ? ev.target.closest('[data-act="combobox:pick"]') : null;
      if (!o || !el.contains(o)) return;
      hide();
      const t = trigger();
      if (t) t.focus();
    };
    /** @param {any} ev */
    const onKey = (ev) => {
      if (ev.key !== "Tab" || ev.altKey || ev.ctrlKey || ev.metaKey) return;
      // Focus the trigger before the default action, so Tab moves on from the combobox.
      hide();
      const t = trigger();
      if (t) t.focus();
    };
    /** @param {any} ev */
    const onTriggerKey = (ev) => {
      if ((ev.key !== "ArrowDown" && ev.key !== "ArrowUp") || ev.ctrlKey || ev.metaKey) return;
      if (typeof pn.showPopover !== "function") return;
      ev.preventDefault();
      try { pn.showPopover(); open = true; } catch (e) { /* already open */ }
    };
    const t0 = trigger();
    el.addEventListener("toggle", onToggle);
    el.addEventListener("input", onInput);
    el.addEventListener("click", onClick);
    el.addEventListener("keydown", onKey);
    if (t0) t0.addEventListener("keydown", onTriggerKey);
    const back = reopen.get(id);
    if (back) {
      reopen.delete(id);
      const i = input();
      if (i && back.query) { i.value = back.query; refilter(back.query); }
      if (typeof pn.showPopover === "function") {
        try { pn.showPopover(); open = true; } catch (e) { open = isOpen(); }
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
      el.removeEventListener("toggle", onToggle);
      el.removeEventListener("input", onInput);
      el.removeEventListener("click", onClick);
      el.removeEventListener("keydown", onKey);
      if (t0) t0.removeEventListener("keydown", onTriggerKey);
      if (stopCmd) stopCmd();
      if (ownCmd && cmd) cmd.removeAttribute("data-mounted");
      if (!isOpen() || !el.isConnected) return;
      const i = input();
      const entry = { query: i ? String(i.value || "") : "" };
      reopen.set(id, entry);
      setTimeout(() => {
        if (reopen.get(id) !== entry) return;
        reopen.delete(id);
        if (!el.isConnected || !isOpen()) return;
        hide();
        const t = trigger();
        if (t) t.setAttribute("aria-expanded", "false");
      }, 0);
    };
  },
};
