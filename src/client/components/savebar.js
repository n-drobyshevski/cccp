// The sticky save bar of the Settings page (identity G): under a 2px ink rule, how many unsaved
// changes and what they are (for the rules, 'Pentest too old: 18 \u2192 24 months (131 \u2192 74 apps)'),
// a link to each tab that holds some, Discard and Save. It is absent when nothing changed.
// Buttons: data-act s-discard, s-save; the jump links are data-act s-tab with data-tab.
import { html } from "../lib/html.js";

const SHOWN_NOTES = 2;

/**
 * opts: {count, text, tabs: [{tab, label}], notes?: string[], busy, problems: number}. With
 * `problems` Save is disabled and the bar says why.
 */
export function savebar(opts) {
  if (!opts || !opts.count) return html``;
  const blocked = opts.problems > 0;
  const notes = opts.notes || [];
  const more = notes.length - SHOWN_NOTES;
  return html`<div class="savebar" role="status" data-region="savebar">
    <span class="sb-text">${opts.text}${notes.length ? html` <span class="sb-notes">\u00b7 ${notes.slice(0, SHOWN_NOTES).join("; ")}${more > 0 ? " and " + more + " more" : ""}</span>` : ""}${opts.tabs.length ? html` <span class="sb-in">in ${opts.tabs.map((t, i) => html`${i ? ", " : ""}<button type="button" class="sb-link" data-act="s-tab" data-tab="${t.tab}" data-k="sb-${t.tab}">${t.label}</button>`)}</span>` : ""}${blocked ? html` <span class="sb-warn">Fix ${opts.problems} ${opts.problems === 1 ? "problem" : "problems"} to save.</span>` : ""}</span>
    <div class="sb-act">
      <button type="button" class="btn" data-act="s-discard" data-k="sb-discard"${opts.busy ? html` disabled` : ""}>Discard</button>
      <button type="button" class="btn pri" data-act="s-save" data-k="sb-save"${opts.busy || blocked ? html` disabled` : ""}>${opts.busy ? "Saving…" : "Save"}</button>
    </div>
  </div>`;
}
