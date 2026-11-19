// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
// One native disclosure. The browser owns the open state: no island, no JS.
import { html, attrs } from "@gas-kit/client/html.js";
import { CHEVRON } from "./accordion.js";

/**
 * @component collapsible
 * @title Collapsible
 * @category Layout
 * @summary A single native disclosure: a summary line and content that shows or hides.
 * @param {{summary: unknown, content?: unknown, open?: boolean, k?: string}} p
 * `summary` is text or SafeHtml for the trigger line; `content` is SafeHtml or text; `open` opens it at render. `k` becomes the summary's data-k. The open state lives in the browser, so re-rendering resets it to `open`.
 * @emits none
 * @states closed, open
 * @a11y Native details and summary: Enter and Space toggle, focusable, announced as expanded or collapsed. The chevron turns when open, so the state is not colour alone. Motion: the height animates over --dur-3 times --motion-scale where ::details-content and interpolate-size are supported; elsewhere it snaps.
 * @example open: collapsible({ summary: "Show advanced options", content: "Retention is thirty days.", open: true, k: "adv-o" })
 * @example closed: collapsible({ summary: "Show advanced options", content: "Retention is thirty days.", k: "adv" })
 */
export function collapsible(p) {
  const q = p || { summary: "" };
  return html`<details ${attrs({ class: "gk-collapsible", open: q.open === true })}><summary ${attrs({ class: "gk-collapsible__trigger", "data-k": q.k != null && q.k !== "" ? q.k : null })}><span>${q.summary != null ? q.summary : ""}</span>${CHEVRON}</summary><div class="gk-collapsible__content">${q.content != null ? q.content : ""}</div></details>`;
}
