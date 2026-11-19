// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
import { html } from "@gas-kit/client/html.js";

/**
 * @component kbd
 * @title Kbd
 * @category Data display
 * @summary A key cap for one keyboard key.
 * @param {{text: string}} p
 * `text` is the key name as people say it: "Ctrl", "K", "Esc".
 * @emits none
 * @states default
 * @a11y A native kbd element, read as its text. Use `kbdGroup` for a combination.
 * @example default: kbd({ text: "Esc" })
 */
export function kbd(p) {
  const q = p || { text: "" };
  return html`<kbd class="gk-kbd">${q.text != null ? q.text : ""}</kbd>`;
}

/**
 * @component kbdGroup
 * @title Kbd Group
 * @category Data display
 * @summary Several key caps for one shortcut, in order.
 * @param {{keys: string[], join?: string}} p
 * `keys` lists the keys in press order. `join` is the sr-only word read between keys (default "plus"); sighted users see the caps side by side.
 * @emits none
 * @states default, empty
 * @a11y A span of kbd elements with a spoken "plus" between them, so "Ctrl K" reads as "Ctrl plus K".
 * @example default: kbdGroup({ keys: ["Ctrl", "K"] })
 * @example empty: kbdGroup({ keys: [] })
 */
export function kbdGroup(p) {
  const q = p || { keys: [] };
  const keys = Array.isArray(q.keys) ? q.keys : [];
  const sep = q.join != null && q.join !== "" ? q.join : "plus";
  return html`<span class="gk-kbdGroup">${keys.map((key, i) => html`${i > 0 ? html`<span class="sr-only"> ${sep} </span>` : ""}<kbd class="gk-kbd">${key}</kbd>`)}</span>`;
}
