// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
// The faceted filter of a data table toolbar: a dashed outline gk-btn trigger (a plus icon, the
// facet label and, with a selection, a divider and either the chosen labels or a count) that
// opens a native popover="auto" panel holding facetList (checkboxes with counts, a find box for
// a long list) and a Clear filter button while something is chosen. The view only renders; the
// app owns the selection and the find text. facetFilterIsland (mounted with mountIslands(root,
// { facetFilter: facetFilterIsland })) places the panel and keeps it open across the app's
// re-render after a pick, as columnChooserIsland does.
import { html, attrs } from "@gas-kit/client/html.js";
import { quote } from "@gas-kit/client/dom.js";
import { icon } from "@gas-kit/client/icons.js";
import { tipPlacement } from "@gas-kit/client/tipPlace.js";
import { badge } from "./badge.js";
import { facetList } from "./facetList.js";

/** Above this many chosen values the trigger shows a count instead of the labels. */
const MAX_LABELS = 2;

/**
 * @component facetFilter
 * @title Facet Filter
 * @category Data display
 * @summary A dashed filter button for one facet that opens a checklist of its values with counts, showing the chosen values (or how many) on the button.
 * @param {{key: string, label: string, options: Array<{value: string, label?: string, count?: number}>, selected?: string[], find?: string, big?: boolean, id?: string, k?: string, open?: boolean}} p
 * `key` is the facet key (data-facet on the checkboxes, data-key on Clear filter); `label` names the trigger, the panel and its legend. `options` and `find` go to facetList as they are; `big` shows its find box. `selected` holds the chosen values: one or two show their option labels on the trigger, more show "<n> selected"; a value with no option shows as itself. `id` is the panel id (default "filter-<key>"; the trigger is "<id>-trigger"). `k` prefixes every data-k (default `id`): "<k>-trigger", "<k>-clear", and facetList runs with scope `k`, so its option keys are "<k>-<key>:<value>" and the find box "<k>-find-<key>", apart from any other facetList of the same facet on the page. `open` opens the panel when the island mounts (the gallery's open state, or a deep link); an app keeping the panel open across its own re-render needs nothing, the island does it. The app handles facetToolbar:set (toggleFacetValue) and facetList:find as it does for facetToolbar, and facetFilter:clear by emptying that facet, then re-renders.
 * @emits facetToolbar:set (data-facet, data-v; change event)
 * @emits facetList:find (data-facet; input event, read the value)
 * @emits facetFilter:clear (data-key is the facet key)
 * @states default, selected, many, big, open
 * @a11y The trigger is a native button with popovertarget, aria-haspopup="dialog", aria-controls the panel and aria-expanded kept in step by the island. Without a selection its name is the visible label; with one, an aria-label starting with that label spells out the selection with the visible badge text ("Status, 2 selected: Done, Canceled" or "Status, 5 selected"). The divider and the plus icon are aria-hidden. The panel is role="dialog" labelled by the legend of the fieldset that holds facetList: native checkboxes with the value as label text and the count as visible text, and a search input labelled "Find <label>" when big. The island moves focus into the panel on open (the find box when big, else the first checkbox) and back to the trigger when it closes with focus inside (never when another popover closes it while focus is elsewhere); Escape and an outside click close the panel natively. When the app tears the island down and re-renders the filter in the same task (offIslands, renderRegion, mountIslands), the new panel opens again with focus, caret included, on the same control, so a pick or a keystroke in the find box does not close it; when nothing re-mounts it in that task the panel is hidden. A panel that began to close before the re-render (beforetoggle; a light dismiss by an outside click whose act redraws, such as Go to next page or Reset) stays closed and leaves focus where that act put it. Chosen state is the native check mark and the trigger text, never colour alone. Motion: the panel fades and scales in over --dur-2 with the scale multiplied by --motion-scale.
 * @example default: facetFilter({ key: "status", label: "Status", options: [{ value: "todo", label: "Todo", count: 12 }, { value: "progress", label: "In progress", count: 5 }, { value: "done", label: "Done", count: 31 }, { value: "canceled", label: "Canceled", count: 0 }] })
 * @example selected: facetFilter({ key: "status", label: "Status", id: "filter-status-sel", options: [{ value: "todo", label: "Todo", count: 12 }, { value: "progress", label: "In progress", count: 5 }, { value: "done", label: "Done", count: 31 }, { value: "canceled", label: "Canceled", count: 0 }], selected: ["done", "canceled"] })
 * @example many: facetFilter({ key: "priority", label: "Priority", options: [{ value: "low", label: "Low", count: 20 }, { value: "medium", label: "Medium", count: 14 }, { value: "high", label: "High", count: 9 }, { value: "urgent", label: "Urgent", count: 2 }], selected: ["low", "medium", "high"] })
 * @example big: facetFilter({ key: "office", label: "Office", big: true, find: "", options: [{ value: "berlin", label: "Berlin", count: 8 }, { value: "lisbon", label: "Lisbon", count: 4 }, { value: "london", label: "London", count: 15 }, { value: "madrid", label: "Madrid", count: 6 }, { value: "oslo", label: "Oslo", count: 2 }, { value: "paris", label: "Paris", count: 11 }, { value: "rome", label: "Rome", count: 3 }, { value: "zurich", label: "Zürich", count: 7 }], selected: ["london"] })
 * @example open: facetFilter({ key: "team", label: "Team", open: true, options: [{ value: "acme-ops", label: "Acme Ops", count: 4 }, { value: "acme-web", label: "Acme Web", count: 9 }, { value: "acme-data", label: "Acme Data", count: 0 }], selected: ["acme-web"] })
 */
export function facetFilter(p) {
  const q = p || { key: "facet", label: "", options: [] };
  const key = q.key != null && q.key !== "" ? String(q.key) : "facet";
  const label = q.label != null && q.label !== "" ? String(q.label) : key;
  const id = q.id != null && q.id !== "" ? String(q.id) : "filter-" + key;
  const k = q.k != null && q.k !== "" ? String(q.k) : id;
  const options = Array.isArray(q.options) ? q.options.filter((o) => o && o.value != null) : [];
  /** @type {string[]} */
  const selected = [];
  for (const v of Array.isArray(q.selected) ? q.selected : []) {
    const s = v == null ? "" : String(v);
    if (s !== "" && selected.indexOf(s) < 0) selected.push(s);
  }
  const n = selected.length;
  /** @param {string} v */
  const nameOf = (v) => {
    const o = options.find((x) => String(x.value) === v);
    return o && o.label != null && o.label !== "" ? String(o.label) : v;
  };
  const names = n > 0 && n <= MAX_LABELS ? selected.map(nameOf) : [];
  const countText = n + " selected";
  const chosen = n
    ? html`<span class="gk-facetFilter__sep" aria-hidden="true"></span><span class="gk-facetFilter__values">${
      names.length ? names.map((t) => badge({ text: t, variant: "secondary" })) : badge({ text: countText, variant: "secondary" })
    }</span>`
    : null;
  // With a selection the name is spelled out, so no browser runs the label and the badges together.
  const name = n ? label + ", " + countText + (names.length ? ": " + names.join(", ") : "") : null;
  const props = q.open ? { id, open: true } : { id };
  return html`<span class="${"gk-facetFilter" + (n ? " is-active" : "")}"><button ${attrs({
    type: "button", id: id + "-trigger", class: "gk-btn gk-facetFilter__trigger", "data-variant": "outline", "data-size": "sm",
    popovertarget: id, "aria-haspopup": "dialog", "aria-expanded": "false", "aria-controls": id, "aria-label": name, "data-k": k + "-trigger",
  })}>${icon("plus")}<span class="gk-facetFilter__label">${label}</span>${chosen}</button><div ${attrs({
    id, popover: "auto", role: "dialog", "aria-labelledby": id + "-legend", class: "gk-facetFilter__panel",
    "data-mount": "facetFilter", "data-props": JSON.stringify(props),
  })}><fieldset class="gk-facetFilter__set"><legend class="gk-facetFilter__legend" id="${id + "-legend"}">${label}</legend>${
    facetList({ key, label, options, selected, find: q.find, big: !!q.big, scope: k })
  }</fieldset>${
    n
      ? html`<div class="gk-facetFilter__foot"><button ${attrs({
        type: "button", class: "gk-btn gk-facetFilter__clear", "data-variant": "ghost", "data-size": "sm",
        "data-act": "facetFilter:clear", "data-key": key, "data-k": k + "-clear",
      })}>Clear filter</button></div>`
      : null
  }</div></span>`;
}

/**
 * Panels open at the moment their island was torn down, by panel id, with the data-k and caret
 * of the control that held focus. A mount in the same task opens the re-rendered panel again;
 * after that task an entry nobody took hides its panel, so a navigation never leaves one
 * floating. Only DOM state, nothing personal.
 * @type {Map<string, {k: string|null, start: number|null, end: number|null}>}
 */
const reopen = new Map();

/** Whether a popover panel is showing; false where :popover-open is not known. @param {any} pn */
const shownNow = (pn) => { try { return !!(pn.matches && pn.matches(":popover-open")); } catch (e) { return false; } };

/**
 * Placement and state for the facet filter, mounted on the popover panel. On open it places the
 * panel under the trigger with tipPlacement (flipping above when there is no room) and keeps it
 * there on scroll and resize while open, sets aria-expanded on the trigger and focuses the find
 * box or the first checkbox; on close it returns focus to the trigger, only when focus was in the panel. It handles no picks: a checkbox or a keystroke keeps the panel
 * open, and the act reaches the app's delegate. `open` in the props opens it on mount. Returns a
 * teardown; tearing down an open panel lets a re-render in the same task reopen it, else the
 * panel is hidden.
 * @type {import("@gas-kit/client/islands.js").Island}
 */
export const facetFilterIsland = {
  mount(el, data) {
    const pn = /** @type {any} */ (el);
    const props = data || {};
    const id = String(props.id || el.getAttribute("id") || "");
    const doc = el.ownerDocument;
    // The panel id is read when it is needed: the gallery renames ids after mounting.
    const trigger = () => /** @type {any} */ (doc.querySelector('[popovertarget="' + quote(el.getAttribute("id") || id) + '"]'));
    let open = false;
    /** @type {{k: string|null, start: number|null, end: number|null}|null} */
    let restore = null;
    const isOpen = () => {
      try { return !!(pn.matches && pn.matches(":popover-open")); } catch (e) { return open; }
    };
    const show = () => {
      if (typeof pn.showPopover !== "function") return;
      try { pn.showPopover(); open = true; } catch (e) { restore = null; }
    };
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
      const want = restore;
      restore = null;
      // renderRegion already put focus back inside a redrawn panel: leave it there.
      if (!want && el.contains(doc.activeElement)) return;
      const all = /** @type {any[]} */ (Array.prototype.slice.call(el.querySelectorAll("[data-k]"))).filter((x) => !x.hasAttribute("disabled"));
      const hit = want && want.k ? all.find((x) => x.getAttribute("data-k") === want.k) : null;
      const first = hit || all[0];
      if (!first || typeof first.focus !== "function") return;
      first.focus();
      if (hit && want && want.start != null && typeof hit.setSelectionRange === "function") {
        try { hit.setSelectionRange(want.start, want.end == null ? want.start : want.end); } catch (e) { /* not a text control */ }
      }
    };
    // While open the panel follows its trigger when the page scrolls or the window resizes.
    const win = /** @type {any} */ (doc.defaultView);
    let following = false;
    /** @param {boolean} on */
    const follow = (on) => {
      if (!win || on === following) return;
      following = on;
      const fn = on ? "addEventListener" : "removeEventListener";
      win[fn]("resize", place);
      win[fn]("scroll", place, true);
    };
    // Whether focus was in the panel as it began to close (beforetoggle runs before the hide; the
    // toggle event comes a task later, when a hidden focused control may already have left focus
    // on the body). Another auto popover closing this one while focus is elsewhere, also on the
    // body, must not pull focus to this trigger. `open` also drops here, not on toggle: a light
    // dismiss by an outside click fires beforetoggle on pointerup, then the click's act redraws in
    // the same task, and a teardown that still saw `open` would reopen the panel.
    let hadFocus = false;
    /** @param {any} ev */
    const onBefore = (ev) => {
      if (!ev || ev.newState !== "closed") return;
      hadFocus = el.contains(doc.activeElement);
      open = false;
    };
    /** @param {any} ev */
    const onToggle = (ev) => {
      // A panel a redraw removed reports its close a task later; the trigger is the new one then.
      if (!el.isConnected) return;
      open = ev && ev.newState ? ev.newState === "open" : isOpen();
      const t = trigger();
      if (t) t.setAttribute("aria-expanded", open ? "true" : "false");
      follow(open);
      const was = hadFocus;
      hadFocus = false;
      if (open) { place(); focusInside(); return; }
      const a = doc.activeElement;
      if (t && (el.contains(a) || (was && (!a || a === doc.body)))) t.focus();
    };
    el.addEventListener("beforetoggle", onBefore);
    el.addEventListener("toggle", onToggle);
    const back = reopen.get(id);
    if (back) {
      reopen.delete(id);
      restore = back;
      show();
    } else if (props.open === true) show();
    if (shownNow(pn)) {
      // renderRegion showed the redrawn panel again: the trigger says so at once.
      open = true;
      const t = trigger();
      if (t) t.setAttribute("aria-expanded", "true");
      follow(true);
      place();
    }
    return () => {
      el.removeEventListener("beforetoggle", onBefore);
      el.removeEventListener("toggle", onToggle);
      follow(false);
      if (!(isOpen() || open) || !el.isConnected) return;
      const a = /** @type {any} */ (doc.activeElement);
      const inside = !!(a && a !== el && el.contains(a));
      const entry = {
        k: inside ? a.getAttribute("data-k") : null,
        start: inside && typeof a.selectionStart === "number" ? a.selectionStart : null,
        end: inside && typeof a.selectionEnd === "number" ? a.selectionEnd : null,
      };
      reopen.set(id, entry);
      setTimeout(() => {
        if (reopen.get(id) !== entry) return;
        reopen.delete(id);
        if (!el.isConnected || !isOpen()) return;
        open = false;
        if (typeof pn.hidePopover === "function") {
          try { pn.hidePopover(); } catch (e) { /* already hidden */ }
        }
        const t = trigger();
        if (t) t.setAttribute("aria-expanded", "false");
      }, 0);
    };
  },
};
