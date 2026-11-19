// The sticky save bar of the Settings page (identity G): the kit savebar for the states (how many
// unsaved changes, Saving, Fix N problems, Discard and Save changes), under a 2px ink rule, with
// an app-owned slot beside it that the kit has none of: what the rule changes do ('Pentest too old:
// 18 → 24 months (131 → 74 apps)') and a link to each tab that holds changes. It is absent
// when nothing changed. Buttons: the kit's savebar:discard and savebar:save (page.js maps them);
// the jump links are data-act s-tab with data-tab. The kit's conflict, error and saved states are
// not used: a conflict reloads the settings and says so in a banner, an error is a banner and a
// toast, and after a save the bar goes away.
import { html } from "@gas-kit/client/html.js";
import { savebar as kitSavebar } from "@gas-kit/ui/components/savebar.js";

const SHOWN_NOTES = 2;

/**
 * opts: {count, tabs: [{tab, label}], notes?: string[], busy, problems: number}. With `problems`
 * Save is blocked and the bar says why.
 */
export function savebar(opts) {
  if (!opts || !opts.count) return html``;
  const notes = opts.notes || [];
  const more = notes.length - SHOWN_NOTES;
  const slot = notes.length || opts.tabs.length
    ? html`<div class="sb-extra">${notes.length ? html`<span class="sb-notes">${notes.slice(0, SHOWN_NOTES).join("; ")}${more > 0 ? " and " + more + " more" : ""}</span>` : ""}${opts.tabs.length ? html` <span class="sb-in">in ${opts.tabs.map((t, i) => html`${i ? ", " : ""}<button type="button" class="sb-link" data-act="s-tab" data-tab="${t.tab}" data-k="sb-${t.tab}">${t.label}</button>`)}</span>` : ""}</div>`
    : "";
  return html`<div class="savebar" data-region="savebar">${kitSavebar({ state: opts.busy ? "saving" : "dirty", count: opts.count, problems: opts.problems })}${slot}</div>`;
}
