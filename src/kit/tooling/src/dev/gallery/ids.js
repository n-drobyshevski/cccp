/* Extracted from the author's production Apps Script apps; adapted.
   The gallery shows each example twice on one page, so ids, label targets and radio groups would
   repeat. This gives every id in a card a per-card suffix and rewrites the references to them, and
   suffixes radio and checkbox names so each card keeps its own group. Safe to run twice on a card
   (names and ids that already carry the suffix are left alone). */

const REF_ATTRS = ["for", "popovertarget", "data-sidebar-trigger", "aria-labelledby", "aria-describedby", "aria-controls", "aria-owns", "aria-activedescendant", "aria-details", "aria-errormessage", "list", "form"];

/** Attributes that can hold a url(#id) paint or reference (gradients, patterns, clips, masks). */
const URL_ATTRS = ["style", "fill", "stroke", "filter", "clip-path", "mask", "marker-start", "marker-mid", "marker-end"];

/**
 * @param {Element} card
 * @param {string} suffix for example "--g12"
 */
export function uniquifyIds(card, suffix) {
  /** @type {Set<string>} */
  const renamed = new Set();
  Array.prototype.forEach.call(card.querySelectorAll("[id]"), (/** @type {Element} */ el) => {
    const id = el.getAttribute("id") || "";
    if (id && !id.endsWith(suffix)) {
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
        for (const k of Object.keys(o)) if (typeof o[k] === "string" && renamed.has(o[k])) { o[k] = o[k] + suffix; changed = true; }
        if (changed) el.setAttribute("data-props", JSON.stringify(o));
      } catch (_e) { /* not JSON: leave it */ }
    }
    const href = el.getAttribute("href");
    if (href && href.charAt(0) === "#" && renamed.has(href.slice(1))) el.setAttribute("href", href + suffix);
    if (el.tagName === "INPUT") {
      const type = (el.getAttribute("type") || "").toLowerCase();
      const name = el.getAttribute("name");
      if ((type === "radio" || type === "checkbox") && name && !name.endsWith(suffix)) el.setAttribute("name", name + suffix);
    }
  });
}
