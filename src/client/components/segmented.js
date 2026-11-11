// A segmented group of toggle buttons (the tier toggles T1-T4). Each button is aria-pressed;
// the viewer's selection is the `selected` list. Labels may differ from values: the 'No tier'
// value shows a dash with its tip and an aria-label, so it is never mute for a screen reader.
import { html } from "../lib/html.js";

/**
 * opts: {label, act, options: [{value, text?, tip?}], selected: string[], k}.
 * Each button carries data-act, data-v and data-k ('<k>-<value>').
 */
export function segmented(opts) {
  const sel = opts.selected || [];
  return html`<div class="tg" role="group" aria-label="${opts.label}">${opts.options.map((o) => {
    const on = sel.indexOf(o.value) >= 0;
    const name = o.tip || o.text || o.value;
    return html`<button type="button" data-act="${opts.act}" data-v="${o.value}" data-k="${opts.k}-${o.value}" aria-pressed="${on ? "true" : "false"}" aria-label="${name}"${o.tip ? html` data-tip="${o.tip}"` : ""}>${o.text || o.value}</button>`;
  })}</div>`;
}
