/* Extracted from the author's production Apps Script apps; adapted.
   The gallery shows each example twice on one page, so ids, label targets and radio groups would
   repeat. This gives every id in a card a per-card suffix and rewrites the references to them, and
   suffixes radio and checkbox names so each card keeps its own group. Safe to run twice on a card
   (names and ids that already carry the suffix are left alone, also when an island built them from
   a suffixed id, such as "cb--g3-list"). An island may redraw its markup after mount (chartFitIsland
   redraws at the measured width, from the same k): watchIds runs the suffixing again after every
   such redraw. */

const REF_ATTRS = ["for", "popovertarget", "data-sidebar-trigger", "aria-labelledby", "aria-describedby", "aria-controls", "aria-owns", "aria-activedescendant", "aria-details", "aria-errormessage", "list", "form"];

/** Attributes that can hold a url(#id) paint or reference (gradients, patterns, clips, masks). */
const URL_ATTRS = ["style", "fill", "stroke", "filter", "clip-path", "mask", "marker-start", "marker-mid", "marker-end"];

/**
 * Whether a name already carries the card suffix: "--g1" is in "x--g1" and "x--g1-list", not in
 * "x--g12".
 * @param {string} name
 * @param {string} suffix
 */
function carries(name, suffix) {
  for (let i = name.indexOf(suffix); i >= 0; i = name.indexOf(suffix, i + 1)) {
    const next = name.charAt(i + suffix.length);
    if (!(next >= "0" && next <= "9")) return true;
  }
  return false;
}

/**
 * @param {Element} card
 * @param {string} suffix for example "--g12"
 */
export function uniquifyIds(card, suffix) {
  /** @type {Set<string>} */
  const renamed = new Set();
  Array.prototype.forEach.call(card.querySelectorAll("[id]"), (/** @type {Element} */ el) => {
    const id = el.getAttribute("id") || "";
    if (id && !carries(id, suffix)) {
      renamed.add(id);
      el.setAttribute("id", id + suffix);
    }
  });
  const fix = (/** @type {string} */ v) => v.split(/\s+/).filter(Boolean).map((t) => (renamed.has(t) ? t + suffix : t)).join(" ");
  Array.prototype.forEach.call(card.querySelectorAll("*"), (/** @type {Element} */ el) => {
    REF_ATTRS.forEach((a) => {
      const v = el.getAttribute(a);
      if (v) el.setAttribute(a, fix(v));
    });
    URL_ATTRS.forEach((a) => {
      const v = el.getAttribute(a);
      if (v && v.indexOf("url(") >= 0) {
        el.setAttribute(a, v.replace(/url\(\s*(["']?)#([^)"'\s]+)\1\s*\)/g, (m, q, id) => (renamed.has(id) ? "url(" + q + "#" + id + suffix + q + ")" : m)));
      }
    });
    // Islands read the id of their panel from data-props (dropdownMenu, columnChooser): follow it.
    const props = el.getAttribute("data-props");
    if (props && props.charAt(0) === "{") {
      try {
        const o = JSON.parse(props);
        let changed = false;
        // A chart island (chartFit) draws its figure again from data-props, and its gradient and
        // pattern ids come from props.k: give each card its own k so a redraw keeps ids unique.
        if (o.props && typeof o.props === "object" && typeof o.props.k === "string" && !o.props.k.endsWith(suffix)) { o.props.k = o.props.k + suffix; changed = true; }
        for (const k of Object.keys(o)) if (typeof o[k] === "string" && renamed.has(o[k])) { o[k] = o[k] + suffix; changed = true; }
        if (changed) el.setAttribute("data-props", JSON.stringify(o));
      } catch (_e) { /* not JSON: leave it */ }
    }
    const href = el.getAttribute("href");
    if (href && href.charAt(0) === "#" && renamed.has(href.slice(1))) el.setAttribute("href", href + suffix);
    if (el.tagName === "INPUT") {
      const type = (el.getAttribute("type") || "").toLowerCase();
      const name = el.getAttribute("name");
      if ((type === "radio" || type === "checkbox") && name && !carries(name, suffix)) el.setAttribute("name", name + suffix);
    }
  });
}

/**
 * Suffix the card's ids now and again after every later change to its markup (an island redraw).
 * Only child-list changes are watched, so the attribute writes of the suffixing do not retrigger
 * it. Returns a function that stops watching; without MutationObserver it only suffixes once.
 * @param {Element} card
 * @param {string} suffix
 * @param {typeof MutationObserver} [MO] the observer class (tests pass a fake)
 * @returns {() => void}
 */
export function watchIds(card, suffix, MO = typeof MutationObserver === "function" ? MutationObserver : undefined) {
  uniquifyIds(card, suffix);
  if (!MO) return () => {};
  const mo = new MO(() => uniquifyIds(card, suffix));
  mo.observe(card, { childList: true, subtree: true });
  return () => mo.disconnect();
}
