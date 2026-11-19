// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
// Tabs: a tablist of buttons and the selected panel. The view is pure: the app keeps the
// selected value and re-renders on data-act="tabs:select". Arrow keys need a small island
// (tabsIsland), which the app mounts with mountIslands(root, { tabs: tabsIsland }).
import { html, attrs } from "@gas-kit/client/html.js";

/**
 * @component tabs
 * @title Tabs
 * @category Navigation
 * @summary A tablist with one selected tab and its panel, in a pill style or a line style.
 * @param {{label: string, tabs: Array<{value: string, text?: string, disabled?: boolean, tip?: string}>, value?: string|null, content?: unknown, panels?: Record<string, unknown>, variant?: "default"|"line", k?: string, act?: string}} p
 * `value` is the selected tab (an unknown or disabled value falls back to the first enabled tab); `content` is the SafeHtml of the selected panel, which the app builds from the selected value; only that panel is rendered. `k` prefixes ids and each tab's data-k ("<k>-<value>", default "tabs"; give every control on a page its own); `act` defaults to "tabs:select" and the tab carries data-v. A `tip` is shown on hover and focus and is also sr-only text inside the tab. `panels` (a map of tab value to SafeHtml) switches to an uncontrolled mode like shadcn: every panel is rendered (role="tabpanel", `hidden` on all but the selected one, each tab has aria-controls), `content` is ignored, and tabsIsland switches the selection on click and on the arrow keys, Home and End with no app code; tabs:select is still sent, so an app can listen. Mount tabsIsland on the root again after every render, or only the arrow keys stop working.
 * @emits tabs:select (data-v; or the act you pass)
 * @states default, line, disabled-tab, panels, empty
 * @a11y A tablist labelled by `label`; each tab is a button with role="tab" and aria-selected; only the selected tab is in the tab order (tabindex 0, the rest -1) and it carries aria-controls for the panel, which is role="tabpanel", labelled by its tab and focusable. The selected tab differs by fill and shadow (pill) or an underline (line), never colour alone. The island moves the selection with Arrow Left and Right, Home and End, skipping disabled tabs and wrapping. Motion: colours ease over --dur-2; reduced motion drops the press scale only.
 * @example default: tabs({ label: "Account", k: "acct", value: "profile", tabs: [{ value: "profile", text: "Profile" }, { value: "billing", text: "Billing" }, { value: "team", text: "Team" }], content: "Update your profile details." })
 * @example line: tabs({ label: "Account", k: "acct-line", variant: "line", value: "billing", tabs: [{ value: "profile", text: "Profile" }, { value: "billing", text: "Billing" }], content: "Manage invoices for Acme." })
 * @example disabled-tab: tabs({ label: "Report", k: "rep", value: "summary", tabs: [{ value: "summary", text: "Summary" }, { value: "export", text: "Export", disabled: true, tip: "Needs an admin" }], content: "Totals for the period." })
 * @example panels: tabs({ label: "Account", k: "acct-panels", value: "profile", tabs: [{ value: "profile", text: "Profile" }, { value: "billing", text: "Billing" }, { value: "team", text: "Team" }], panels: { profile: "Update your profile details.", billing: "Manage invoices for Acme.", team: "Invite people to Acme." } })
 * @example empty: tabs({ label: "Report", k: "rep-empty", tabs: [] })
 */
export function tabs(p) {
  const q = p || { label: "", tabs: [] };
  const list = Array.isArray(q.tabs) ? q.tabs : [];
  const kk = q.k != null && q.k !== "" ? String(q.k) : "tabs";
  const want = q.value == null ? null : String(q.value);
  let sel = list.findIndex((t) => String(t.value) === want && !t.disabled);
  if (sel < 0) sel = list.findIndex((t) => !t.disabled);
  const variant = q.variant === "line" ? "line" : "default";
  const pm = q.panels && typeof q.panels === "object" ? q.panels : null;
  const tabEl = (/** @type {any} */ t, /** @type {number} */ i) => {
    const on = i === sel;
    return html`<button ${attrs({
      type: "button", role: "tab", class: "gk-tabs__tab", id: kk + "-tab-" + t.value, "aria-selected": on ? "true" : "false",
      "aria-controls": on || pm ? kk + "-panel-" + t.value : null, tabindex: on ? "0" : "-1", disabled: t.disabled === true,
      "data-act": q.act || "tabs:select", "data-v": t.value, "data-k": kk + "-" + t.value, "data-tip": t.tip || null,
    })}>${t.text != null ? t.text : t.value}${t.tip ? html`<span class="sr-only">. ${t.tip}</span>` : ""}</button>`;
  };
  const tabList = html`<div class="gk-tabs__list" role="tablist" aria-label="${q.label}" data-mount="tabs">${list.map(tabEl)}</div>`;
  if (pm) {
    return html`<div class="gk-tabs" data-variant="${variant}" data-panels="1">${tabList}${list.map((t, i) => html`<div ${attrs({ class: "gk-tabs__panel", role: "tabpanel", id: kk + "-panel-" + t.value, "aria-labelledby": kk + "-tab-" + t.value, tabindex: "0", hidden: i !== sel })}>${pm[t.value] != null ? pm[t.value] : ""}</div>`)}</div>`;
  }
  return html`<div class="gk-tabs" data-variant="${variant}">${tabList}${sel >= 0 ? html`<div ${attrs({ class: "gk-tabs__panel", role: "tabpanel", id: kk + "-panel-" + list[sel].value, "aria-labelledby": kk + "-tab-" + list[sel].value, tabindex: "0" })}>${q.content != null ? q.content : ""}</div>` : ""}</div>`;
}

/**
 * Arrow-key roving for a tablist. Left and Right move to the previous or next enabled tab
 * (wrapping), Home and End to the first and last; the new tab takes focus and is clicked, so
 * the delegated tabs:select handler runs as for a pointer.
 * @type {import("@gas-kit/client/islands.js").Island}
 */
export const tabsIsland = {
  mount(el) {
    /** @param {any} ev */
    const onKey = (ev) => {
      const key = ev.key;
      if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
      if (["ArrowLeft", "ArrowRight", "Home", "End"].indexOf(key) < 0) return;
      /** @type {any[]} */
      const tabEls = Array.prototype.slice.call(el.querySelectorAll('[role="tab"]')).filter((r) => !r.hasAttribute("disabled"));
      if (!tabEls.length) return;
      const cur = tabEls.indexOf(ev.target && ev.target.closest ? ev.target.closest('[role="tab"]') : null);
      let next;
      if (key === "Home") next = 0;
      else if (key === "End") next = tabEls.length - 1;
      else if (key === "ArrowLeft") next = cur <= 0 ? tabEls.length - 1 : cur - 1;
      else next = cur < 0 || cur === tabEls.length - 1 ? 0 : cur + 1;
      ev.preventDefault();
      if (cur === next) return;
      for (const r of tabEls) r.setAttribute("tabindex", "-1");
      tabEls[next].setAttribute("tabindex", "0");
      tabEls[next].focus();
      tabEls[next].click();
    };
    /** @param {any} ev */
    const onClick = (ev) => {
      const root = el.parentElement;
      if (!root || !root.hasAttribute("data-panels")) return;
      const tab = ev.target && ev.target.closest ? ev.target.closest('[role="tab"]') : null;
      if (!tab || tab.hasAttribute("disabled")) return;
      for (const r of Array.prototype.slice.call(el.querySelectorAll('[role="tab"]'))) {
        const on = r === tab;
        r.setAttribute("aria-selected", on ? "true" : "false");
        r.setAttribute("tabindex", on ? "0" : "-1");
      }
      const want = tab.getAttribute("aria-controls");
      for (const pn of Array.prototype.slice.call(root.querySelectorAll('[role="tabpanel"]'))) {
        if (pn.id === want) pn.removeAttribute("hidden");
        else pn.setAttribute("hidden", "");
      }
    };
    el.addEventListener("keydown", onKey);
    el.addEventListener("click", onClick);
    return () => { el.removeEventListener("keydown", onKey); el.removeEventListener("click", onClick); };
  },
};
