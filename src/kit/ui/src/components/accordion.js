// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
// An accordion of native details elements. The browser owns the open state: no island, no JS.
import { html, attrs } from "@gas-kit/client/html.js";

/** The chevron shared by accordion and collapsible. @internal */
export const CHEVRON = html`<svg class="gk-accordion__chevron" aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"></path></svg>`;

/**
 * @component accordion
 * @title Accordion
 * @category Layout
 * @summary A stack of native disclosures; single mode opens one at a time, multiple lets any number stay open.
 * @param {{items: Array<{value: string, title: string, content?: unknown, open?: boolean}>, type?: "single"|"multiple", k?: string}} p
 * `type` is "single" (default: items share a name attribute, so the browser closes the others) or "multiple" (no name). `content` is SafeHtml or text. `open` opens an item at render; in single mode only the first open item is honoured. `k` prefixes the shared name and each summary's data-k ("<k>-<value>", default "acc"; give every accordion on a page its own). The open state lives in the browser, so re-rendering the accordion resets it to the `open` props: keep it out of regions that redraw often, or pass the state back in.
 * @emits none
 * @states default, multiple, open, empty
 * @a11y Native details and summary: Enter and Space toggle, the summary is focusable and announced as expanded or collapsed with no ARIA. The chevron is a drawn shape that turns when open, so the state is not colour alone. Motion: where the browser supports ::details-content and interpolate-size the panel animates its height over --dur-3 times --motion-scale (zero under reduced motion); elsewhere it snaps.
 * @example default: accordion({ k: "faq", items: [{ value: "a", title: "Is it accessible?", content: "Yes. It uses native disclosure." }, { value: "b", title: "Is it styled?", content: "Yes, with kit tokens." }, { value: "c", title: "Is it animated?", content: "Where the browser can." }] })
 * @example multiple: accordion({ k: "faq-m", type: "multiple", items: [{ value: "a", title: "Shipping", content: "Ships from Acme in two days." }, { value: "b", title: "Returns", content: "Thirty day returns." }] })
 * @example open: accordion({ k: "faq-o", items: [{ value: "a", title: "Is it accessible?", content: "Yes.", open: true }, { value: "b", title: "Is it styled?", content: "Yes." }] })
 * @example empty: accordion({ k: "faq-e", items: [] })
 */
export function accordion(p) {
  const q = p || { items: [] };
  const items = Array.isArray(q.items) ? q.items : [];
  const kk = q.k != null && q.k !== "" ? String(q.k) : "acc";
  const single = q.type !== "multiple";
  const firstOpen = items.findIndex((i) => i.open === true);
  return html`<div class="gk-accordion">${items.map((it, i) => {
    const open = single ? i === firstOpen : it.open === true;
    return html`<details ${attrs({ class: "gk-accordion__item", name: single ? kk + "-group" : null, open })}><summary ${attrs({ class: "gk-accordion__trigger", "data-k": kk + "-" + it.value })}><span>${it.title}</span>${CHEVRON}</summary><div class="gk-accordion__content">${it.content != null ? it.content : ""}</div></details>`;
  })}</div>`;
}
