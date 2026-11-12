// The sticky save bar of the Settings page: how many unsaved changes, a link to each tab that
// holds some, Discard and Save. It is absent when nothing changed. Buttons: data-act s-discard,
// s-save; the jump links are data-act s-tab with data-tab.
import { html } from "../lib/html.js";

/**
 * opts: {count, text, tabs: [{tab, label}], busy, problems: number}. With `problems` Save is
 * disabled and the bar says why.
 */
export function savebar(opts) {
  if (!opts || !opts.count) return html``;
  const blocked = opts.problems > 0;
  return html`<div class="savebar" role="status" data-region="savebar">
    <span class="sb-text">${opts.text}${opts.tabs.length ? html` <span class="sb-in">in ${opts.tabs.map((t, i) => html`${i ? ", " : ""}<button type="button" class="sb-link" data-act="s-tab" data-tab="${t.tab}" data-k="sb-${t.tab}">${t.label}</button>`)}</span>` : ""}${blocked ? html` <span class="sb-warn">Fix ${opts.problems} ${opts.problems === 1 ? "problem" : "problems"} to save.</span>` : ""}</span>
    <div class="sb-act">
      <button type="button" class="btn" data-act="s-discard" data-k="sb-discard"${opts.busy ? html` disabled` : ""}>Discard</button>
      <button type="button" class="btn pri" data-act="s-save" data-k="sb-save"${opts.busy || blocked ? html` disabled` : ""}>${opts.busy ? "Saving…" : "Save changes"}</button>
    </div>
  </div>`;
}
