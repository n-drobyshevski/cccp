// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
// An input with addons before or after it: text, an icon, a key hint or a button. The group
// draws the input box and the focus ring; the inner gk-input is borderless. The shared class
// gk-inputGroup works on raw markup (see inputGroup.css for the parts).
import { html, attrs, isSafe } from "@gas-kit/client/html.js";
import { icon } from "@gas-kit/client/icons.js";
import { button } from "./button.js";
import { kbdGroup } from "./kbd.js";

const TYPES = ["text", "search", "email", "url", "number"];

/** @param {unknown} x */
const has = (x) => x != null && x !== "";

/**
 * One addon, or "" when there is nothing to draw. Text and key hints get an id so the input
 * can point at them with aria-describedby.
 * @param {unknown} a @param {"start" | "end"} side @param {string | null} id
 * @returns {{ out: unknown, describe: string | null }}
 */
function addon(a, side, id) {
  const box = (/** @type {string} */ kind, /** @type {unknown} */ body, /** @type {string | null} */ aid) =>
    html`<div ${attrs({ class: "gk-inputGroup__addon", "data-side": side, "data-kind": kind, id: aid })}>${body}</div>`;
  if (!has(a)) return { out: "", describe: null };
  if (isSafe(a)) return { out: box("custom", a, null), describe: null };
  if (typeof a === "string" || typeof a === "number") {
    const aid = id ? id + "-" + side : null;
    return { out: box("text", a, aid), describe: aid };
  }
  const o = /** @type {Record<string, unknown>} */ (a);
  if (typeof o === "object" && has(o.icon)) return { out: box("icon", icon(String(o.icon), 16), null), describe: null };
  if (typeof o === "object" && Array.isArray(o.kbd) && o.kbd.length > 0) {
    const aid = id ? id + "-" + side : null;
    return { out: box("kbd", kbdGroup({ keys: /** @type {string[]} */ (o.kbd) }), aid), describe: aid };
  }
  if (typeof o === "object" && o.button != null && typeof o.button === "object") {
    const b = /** @type {Record<string, any>} */ (o.button);
    return { out: box("button", button({ ...b, variant: b.variant != null ? b.variant : "ghost", size: b.size != null ? b.size : "sm" }), null), describe: null };
  }
  return { out: "", describe: null };
}

/**
 * @component inputGroup
 * @title Input Group
 * @category Forms
 * @summary An input with text, an icon, a key hint or a button attached at either end.
 * @param {{id: string, label: string, value?: string|number, placeholder?: string, type?: "text"|"search"|"email"|"url"|"number", start?: string|{icon: string}|{kbd: string[]}|{button: object}|object, end?: string|{icon: string}|{kbd: string[]}|{button: object}|object, act?: string, k?: string, labelVisible?: boolean}} p
 * `id` is the input id and is required: the label points at it, and text addons take the ids `<id>-start` and `<id>-end`. `label` is the accessible name, sr-only unless `labelVisible` (then it sits above the group). `type` is text, search, email, url or number; anything else is text. `start` and `end` are each a string (plain text, escaped), `{ icon: name }` (a name from the client icon set), `{ kbd: ["Ctrl", "K"] }` (a key hint), `{ button: props }` (a `button`, ghost and sm unless the props say otherwise) or SafeHtml (your own markup). `act` and `k` go to the input's `data-act` and `data-k`. The shared class: write div class="gk-inputGroup" around div class="gk-inputGroup__addon" data-side="start" (or "end"), and an input class="gk-input gk-inputGroup__input"; data-kind="icon" on an addon sizes its svg.
 * @emits inputGroup:change (the act you pass, on the input; data-k)
 * @states default, url-prefix, kbd-hint, with-button
 * @a11y A native input with a real label (sr-only by default). Text and key-hint addons are tied to the input with aria-describedby, so a prefix such as the scheme is read after the name; icon addons are aria-hidden. A button addon is its own control with its own name. The focus ring (2px var(--accent) plus the soft ring) is drawn on the group while the input has focus; a focused addon button draws its own.
 * @example default: inputGroup({ id: "ig-search", label: "Search", type: "search", placeholder: "Search...", start: { icon: "search" }, act: "list:search", k: "ig-search" })
 * @example url-prefix: inputGroup({ id: "ig-site", label: "Website", start: ["https:", "", ""].join("/"), placeholder: "example", end: ".org", labelVisible: true, k: "ig-site" })
 * @example kbd-hint: inputGroup({ id: "ig-find", label: "Find a page", placeholder: "Find a page", start: { icon: "search" }, end: { kbd: ["Ctrl", "K"] }, k: "ig-find" })
 * @example with-button: inputGroup({ id: "ig-share", label: "Share link", value: "example.org/acme", end: { button: { label: "Copy", act: "share:copy", k: "ig-share-copy" } }, k: "ig-share" })
 */
export function inputGroup(p) {
  const q = p || { id: "", label: "" };
  const id = has(q.id) ? String(q.id) : null;
  const start = addon(q.start, "start", id);
  const end = addon(q.end, "end", id);
  const described = [start.describe, end.describe].filter(Boolean).join(" ");
  const visible = q.labelVisible === true;
  const label = has(q.label) ? html`<label ${attrs({ class: visible ? "gk-inputGroup__label" : "sr-only", for: id })}>${q.label}</label>` : "";
  const field = html`<input ${attrs({
    class: "gk-input gk-inputGroup__input",
    type: TYPES.indexOf(String(q.type)) >= 0 ? q.type : "text",
    id,
    value: q.value != null ? q.value : null,
    placeholder: has(q.placeholder) ? q.placeholder : null,
    "aria-describedby": described || null,
    "data-act": has(q.act) ? q.act : null,
    "data-k": has(q.k) ? q.k : null,
  })}>`;
  if (visible) return html`<div class="gk-inputGroup__field">${label}<div class="gk-inputGroup">${start.out}${field}${end.out}</div></div>`;
  return html`<div class="gk-inputGroup">${start.out}${label}${field}${end.out}</div>`;
}
