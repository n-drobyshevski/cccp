// An on/off switch: a real checkbox drawn as a track and a knob, so it is keyboard and screen
// reader operable. The draft key rides in data-key; page.js reads the change.
import { html } from "../lib/html.js";

/** opts: {key, on, label, k}. `label` is the accessible name. */
export function switchView(opts) {
  return html`<label class="sw"><input type="checkbox" data-key="${opts.key}" data-type="bool" data-k="${opts.k || "sw-" + opts.key}"${opts.on ? html` checked` : ""} aria-label="${opts.label}"><span aria-hidden="true"></span></label>`;
}
