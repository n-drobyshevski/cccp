// Extracted from the author's production Apps Script apps; adapted.
// Two paging styles. "more": a status line and a Show more button. "numbered": Previous, page
// numbers with ellipses and Next, with an optional rows-per-page select. Pages are 1-based. Acts:
// pager:more, pager:page (the target page is in data-page) and pager:size (a change on the select).
// The app owns the page state and re-renders.
import { attrs, html } from "@gas-kit/client/html.js";
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
 * The rows-per-page choices: positive integers, deduplicated and sorted, with the current size
 * added when it is missing, so the select always shows the size in use.
 * @internal
 * @param {unknown} sizes
 * @param {number} size
 * @returns {number[]}
 */
export function pagerSizes(sizes, size) {
  const list = Array.isArray(sizes) ? sizes.map((n) => Math.round(Number(n))).filter((n) => Number.isFinite(n) && n >= 1) : [];
  if (!list.length) return [];
  return Array.from(new Set(list.concat([size]))).sort((x, y) => x - y);
}

/**
 * @component pager
 * @title Pager
 * @category Navigation
 * @summary Paging for a long list: a Show more button, or Previous, numbered pages and Next, with an optional rows-per-page choice.
 * @param {{variant?: "more"|"numbered", total: number, shown?: number, page?: number, pageSize?: number, sizes?: number[], noun?: string, k?: string}} p
 * `k` prefixes every data-k (default "pager": "pager-p5", "pager-prev", "pager-next", "pager-more", "pager-size"), so two pagers on one page keep their focus apart. `sizes` (numbered only) adds a rows-per-page select after the status line, also on a single page; `pageSize` is its selected value and is added to the choices when missing. Its label is "<Noun> per page".
 * @emits pager:more, pager:page (data-page is the target page)
 * @emits pager:size (a change event on the rows-per-page select; read its value)
 * @states more, moreDone, numbered, singlePage, sizes
 * @a11y Motion: hover and current-page colours ease over --dur-2; the press scale comes from base.css. Reduced motion drops the press scale only. A nav labelled Pagination. The current page is aria-current=page; Previous and Next use aria-disabled (and drop their data-act) at the ends, so focus is never lost to the body; page buttons are labelled "Page N". The status line says the counts in words and is role=status, but renderRegion replaces it on each page change so it may not be announced: keep it outside the re-rendered region if announcements matter; when Show more is done the status line takes its data-k and tabindex=-1, so focus lands on it. The rows-per-page select is a native select with a visible label; wire it with delegate(root, "change", '[data-act="pager:size"]', fn).
 * @example numbered: pager({ variant: "numbered", total: 1234, page: 5, pageSize: 50 })
 * @example more: pager({ variant: "more", total: 1234, shown: 50 })
 * @example moreDone: pager({ variant: "more", total: 40, shown: 40 })
 * @example singlePage: pager({ variant: "numbered", total: 12, page: 1, pageSize: 50 })
 * @example sizes: pager({ variant: "numbered", total: 240, page: 2, pageSize: 25, sizes: [10, 25, 50, 100], k: "invoices" })
 */
export function pager(p) {
  const noun = p.noun || "rows";
  const total = Math.max(0, p.total || 0);
  const k = p.k != null && p.k !== "" ? String(p.k) : "pager";
  if (p.variant === "numbered") {
    const size = Math.max(1, p.pageSize || 50);
    const count = Math.max(1, Math.ceil(total / size));
    const page = Math.min(count, Math.max(1, Math.round(Number(p.page)) || 1));
    const choices = pagerSizes(p.sizes, size);
    const sizer = choices.length
      ? html`<label class="gk-pager__size"><span class="gk-pager__sizeLabel">${noun.charAt(0).toUpperCase() + noun.slice(1)} per page</span><select class="gk-pager__select gk-input" data-act="pager:size" data-k="${k}-size">${choices.map((n) => html`<option ${attrs({ value: String(n), selected: n === size })}>${n}</option>`)}</select></label>`
      : null;
    if (count === 1) {
      return html`<nav class="gk-pager is-single" aria-label="Pagination"><span class="gk-pager__status">${fmt(total)} ${noun}</span>${sizer}</nav>`;
    }
    const btn = (/** @type {number} */ n) => html`<button type="button" class="gk-pager__btn gk-btn${n === page ? " is-current" : ""}" data-variant="${n === page ? "outline" : "ghost"}" data-size="icon" data-act="pager:page" data-page="${n}" data-k="${k}-p${n}" aria-label="Page ${n}"${n === page ? html` aria-current="page"` : null}>${n}</button>`;
    const step = (/** @type {string} */ part, /** @type {number} */ to, /** @type {string} */ text, /** @type {string} */ label, /** @type {boolean} */ off) => off
      ? html`<button type="button" class="gk-pager__btn gk-btn is-disabled" data-variant="ghost" data-k="${k}-${part}" aria-label="${label}" aria-disabled="true">${text}</button>`
      : html`<button type="button" class="gk-pager__btn gk-btn" data-variant="ghost" data-act="pager:page" data-page="${to}" data-k="${k}-${part}" aria-label="${label}">${text}</button>`;
    return html`<nav class="gk-pager is-numbered" aria-label="Pagination">${step("prev", page - 1, "Previous", "Previous page", page <= 1)}${
      pagerWindow(page, count).map((n) => (n === null ? html`<span class="gk-pager__gap" aria-hidden="true">${"…"}</span>` : btn(n)))
    }${step("next", page + 1, "Next", "Next page", page >= count)}<span class="gk-pager__status" role="status">Page ${page} of ${count}, ${fmt(total)} ${noun}</span>${sizer}</nav>`;
  }
  const sn = Number(p.shown);
  const shown = Math.min(total, Math.max(0, p.shown == null || !Number.isFinite(sn) ? 0 : sn));
  const done = shown >= total;
  return html`<nav class="gk-pager is-more" aria-label="Pagination"><span class="gk-pager__status" role="status"${done ? html` data-k="${k}-more" tabindex="-1"` : null}>${done ? "All " + fmt(total) + " " + noun + " shown" : "Showing " + fmt(shown) + " of " + fmt(total) + " " + noun}</span>${
    done ? null : html`<button type="button" class="gk-pager__btn gk-btn" data-variant="outline" data-act="pager:more" data-k="${k}-more">Show more</button>`
  }</nav>`;
}
