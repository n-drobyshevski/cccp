// Extracted from the author's production Apps Script apps; adapted.
// Two paging styles. "more": a status line and a Show more button. "numbered": Previous, page
// numbers with ellipses and Next. Pages are 1-based. Acts: pager:more and pager:page (the
// target page is in data-page). The app owns the page state and re-renders.
import { html } from "@gas-kit/client/html.js";
import { fmtCount as fmt } from "@gas-kit/client/format.js";

/**
 * The page numbers to show: first, last, the current page and one on each side, with null
 * standing for a gap of two or more pages (a single hidden page is shown instead). Pure, and constant time in the page count.
 * @internal
 * @param {number} page 1-based
 * @param {number} pageCount
 * @returns {Array<number|null>}
 */
export function pagerWindow(page, pageCount) {
  const out = /** @type {Array<number|null>} */ ([]);
  const keep = Array.from(new Set([1, pageCount, page - 1, page, page + 1]))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= pageCount)
    .sort((x, y) => x - y);
  let prev = 0;
  for (const i of keep) {
    if (i - prev > 2) out.push(null);
    else if (i - prev === 2) out.push(prev + 1);
    out.push(i);
    prev = i;
  }
  return out;
}

/**
 * @component pager
 * @title Pager
 * @category Navigation
 * @summary Paging for a long list: a Show more button, or Previous, numbered pages and Next.
 * @param {{variant?: "more"|"numbered", total: number, shown?: number, page?: number, pageSize?: number, noun?: string}} p
 * @emits pager:more, pager:page (data-page is the target page)
 * @states more, moreDone, numbered, singlePage
 * @a11y Motion: hover and current-page colours ease over --dur-2; the press scale comes from base.css. Reduced motion drops the press scale only. A nav labelled Pagination. The current page is aria-current=page; Previous and Next use aria-disabled (and drop their data-act) at the ends, so focus is never lost to the body; page buttons are labelled "Page N". The status line says the counts in words and is role=status, but renderRegion replaces it on each page change so it may not be announced: keep it outside the re-rendered region if announcements matter; when Show more is done the status line takes its data-k and tabindex=-1, so focus lands on it.
 * @example numbered: pager({ variant: "numbered", total: 1234, page: 5, pageSize: 50 })
 * @example more: pager({ variant: "more", total: 1234, shown: 50 })
 * @example moreDone: pager({ variant: "more", total: 40, shown: 40 })
 * @example singlePage: pager({ variant: "numbered", total: 12, page: 1, pageSize: 50 })
 */
export function pager(p) {
  const noun = p.noun || "rows";
  const total = Math.max(0, p.total || 0);
  if (p.variant === "numbered") {
    const size = Math.max(1, p.pageSize || 50);
    const count = Math.max(1, Math.ceil(total / size));
    const page = Math.min(count, Math.max(1, Math.round(Number(p.page)) || 1));
    if (count === 1) {
      return html`<nav class="gk-pager is-single" aria-label="Pagination"><span class="gk-pager__status">${fmt(total)} ${noun}</span></nav>`;
    }
    const btn = (/** @type {number} */ n) => html`<button type="button" class="gk-pager__btn gk-btn${n === page ? " is-current" : ""}" data-variant="${n === page ? "outline" : "ghost"}" data-size="icon" data-act="pager:page" data-page="${n}" data-k="pager-p${n}" aria-label="Page ${n}"${n === page ? html` aria-current="page"` : null}>${n}</button>`;
    const step = (/** @type {string} */ k, /** @type {number} */ to, /** @type {string} */ text, /** @type {string} */ label, /** @type {boolean} */ off) => off
      ? html`<button type="button" class="gk-pager__btn gk-btn is-disabled" data-variant="ghost" data-k="pager-${k}" aria-label="${label}" aria-disabled="true">${text}</button>`
      : html`<button type="button" class="gk-pager__btn gk-btn" data-variant="ghost" data-act="pager:page" data-page="${to}" data-k="pager-${k}" aria-label="${label}">${text}</button>`;
    return html`<nav class="gk-pager is-numbered" aria-label="Pagination">${step("prev", page - 1, "Previous", "Previous page", page <= 1)}${
      pagerWindow(page, count).map((n) => (n === null ? html`<span class="gk-pager__gap" aria-hidden="true">${"…"}</span>` : btn(n)))
    }${step("next", page + 1, "Next", "Next page", page >= count)}<span class="gk-pager__status" role="status">Page ${page} of ${count}, ${fmt(total)} ${noun}</span></nav>`;
  }
  const sn = Number(p.shown);
  const shown = Math.min(total, Math.max(0, p.shown == null || !Number.isFinite(sn) ? 0 : sn));
  const done = shown >= total;
  return html`<nav class="gk-pager is-more" aria-label="Pagination"><span class="gk-pager__status" role="status"${done ? html` data-k="pager-more" tabindex="-1"` : null}>${done ? "All " + fmt(total) + " " + noun + " shown" : "Showing " + fmt(shown) + " of " + fmt(total) + " " + noun}</span>${
    done ? null : html`<button type="button" class="gk-pager__btn gk-btn" data-variant="outline" data-act="pager:more" data-k="pager-more">Show more</button>`
  }</nav>`;
}
