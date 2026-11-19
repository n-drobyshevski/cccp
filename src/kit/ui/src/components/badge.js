// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
import { html } from "@gas-kit/client/html.js";

const VARIANTS = ["default", "secondary", "outline", "destructive", "ok", "warn", "bad", "info"];
/** @type {Record<string, string>} */
const WORDS = { ok: "OK", warn: "Warning", bad: "Problem", info: "Info" };

/** An id-safe slug of a badge's text, for its default data-k. @param {unknown} s */
const slug = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "x";

/**
 * @component badge
 * @title Badge
 * @category Data display
 * @summary A small pill label, with status variants that carry a word and a shape.
 * @param {{text?: string, variant?: "default"|"secondary"|"outline"|"destructive"|"ok"|"warn"|"bad"|"info", tip?: string, k?: string, focusable?: boolean}} p
 * `text` is the label. The status variants ok, warn, bad and info show a leading shape (circle, triangle, square, diamond) before the text, and without `text` they show a default word (OK, Warning, Problem, Info), so status is never colour alone. Unknown variants fall back to default.
 * A badge with a `tip` is a tab stop (tabindex 0, role=note), so the tip shows on keyboard focus as on hover; its data-k is `k`, else `badge-` and a slug of the text, so pass a `k` when the same badge repeats on a page (a table column). `focusable: false` keeps a tipped badge out of the tab order (many identical badges): the tip is then hover-only, still read as text. A badge without a tip is plain text, as before. For a tip on a control, use `tooltip`.
 * @emits none
 * @states default, secondary, outline, destructive, ok, warn, bad, info
 * @a11y Plain text in a span. The status shape is aria-hidden and the word carries the meaning. A tip is `data-tip` with the same text as sr-only text in the badge, and a tipped badge is focusable (role=note) with a 2px accent focus ring.
 * @example default: badge({ text: "Beta" })
 * @example secondary: badge({ text: "Draft", variant: "secondary" })
 * @example outline: badge({ text: "v1.2", variant: "outline" })
 * @example destructive: badge({ text: "Removed", variant: "destructive" })
 * @example ok: badge({ variant: "ok" })
 * @example warn: badge({ text: "Review due", variant: "warn", tip: "Due in 3 days" })
 * @example bad: badge({ text: "Overdue", variant: "bad" })
 * @example info: badge({ variant: "info" })
 */
export function badge(p) {
  const q = p || {};
  const v = VARIANTS.indexOf(String(q.variant)) >= 0 ? String(q.variant) : "default";
  const status = WORDS[v] != null;
  const text = q.text != null && q.text !== "" ? q.text : status ? WORDS[v] : "";
  const tip = q.tip != null && q.tip !== "" ? q.tip : null;
  const focus = !!tip && q.focusable !== false;
  const k = q.k != null && q.k !== "" ? String(q.k) : focus ? "badge-" + slug(text) : null;
  return html`<span class="gk-badge is-${v}" data-variant="${v}"${tip ? html` data-tip="${tip}"` : ""}${focus ? html` tabindex="0" role="note"` : ""}${k ? html` data-k="${k}"` : ""}>${status ? html`<span class="gk-badge__shape" aria-hidden="true"></span>` : ""}${text}${tip ? html`<span class="sr-only">. ${tip}</span>` : ""}</span>`;
}
