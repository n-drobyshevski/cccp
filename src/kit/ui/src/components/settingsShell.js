// Extracted from the author's production Apps Script apps; adapted.
// The frame of a settings page: a title, a section nav (a tablist with roving tabindex, so
// tabKeys from the client kit gives the arrow keys), the active section's content in a slot,
// and an optional save bar slot. Section dirty and invalid marks carry words, not only colour.
import { attrs, html, isSafe } from "@gas-kit/client/html.js";
import { pluralize } from "@gas-kit/client/format.js";

/**
 * Pick the section to show: the wanted one when it exists, else the first.
 * @param {string|null|undefined} want
 * @param {Array<{key: string}>} sections
 * @returns {string|null}
 * @internal
 */
export function normalizeSection(want, sections) {
  const list = sections || [];
  if (want && list.some((s) => s.key === want)) return want;
  return list.length ? list[0].key : null;
}

/**
 * Per-section marks from the field state: which sections have unsaved changes and which have
 * errors. `fieldSection` maps a field name to its section key; error presence is read by KEY,
 * never by truthiness.
 * @param {Record<string, string>} fieldSection
 * @param {string[]} dirtyFields
 * @param {Record<string, string>} errors
 * @returns {Record<string, {dirty: number, invalid: number}>}
 * @internal
 */
export function sectionMarks(fieldSection, dirtyFields, errors) {
  /** @type {Record<string, {dirty: number, invalid: number}>} */
  const out = {};
  const at = (/** @type {string} */ k) => (out[k] || (out[k] = { dirty: 0, invalid: 0 }));
  for (const n of dirtyFields || []) if (fieldSection[n] != null) at(fieldSection[n]).dirty++;
  for (const n of Object.keys(errors || {})) if (fieldSection[n] != null) at(fieldSection[n]).invalid++;
  return out;
}

/**
 * @component settingsShell
 * @title Settings Shell
 * @category Domain
 * @summary A settings page frame with a section tab list, the active section's form slot and a save bar slot.
 * @param {{title: string, sections: Array<{key: string, label: string, dirty?: number, invalid?: number}>, active?: string|null, body?: any|null, saveBar?: any|null, intro?: string, id?: string, loading?: boolean}} p
 * `body` and `saveBar` are SafeHtml built by the caller (for example settingsForm and savebar).
 * @emits settingsShell:tab (data-section)
 * @states default, dirty, invalid, loading, noSections
 * @a11y The nav is a tablist with aria-label, tabs have aria-selected, aria-controls and roving tabindex (wire tabKeys for arrows, Home and End); the body is a tabpanel labelled by its tab. Unsaved and error marks are words for screen readers and a symbol plus a short word ("Error", "Unsaved") on screen, not colour alone.
 * @example default: settingsShell({ title: "Settings", sections: [{ key: "display", label: "Display" }, { key: "access", label: "Access" }], active: "display", intro: "Changes apply to everyone who opens the app." })
 * @example dirty: settingsShell({ title: "Settings", sections: [{ key: "display", label: "Display", dirty: 2 }, { key: "access", label: "Access" }], active: "display" })
 * @example invalid: settingsShell({ title: "Settings", sections: [{ key: "display", label: "Display", invalid: 1 }, { key: "access", label: "Access" }], active: "access" })
 * @example loading: settingsShell({ title: "Settings", sections: [], loading: true })
 * @example noSections: settingsShell({ title: "Settings", sections: [] })
 */
export function settingsShell(p) {
  const id = p.id || "ss";
  const sections = p.sections || [];
  const active = normalizeSection(p.active, sections);
  const intro = p.intro ? html`<p class="gk-settingsShell__intro">${p.intro}</p>` : null;
  const head = html`<header class="gk-settingsShell__head"><h1 class="gk-settingsShell__title">${p.title}</h1>${intro}</header>`;
  if (p.loading) {
    return html`<section class="gk-settingsShell is-loading" aria-busy="true">${head}<p class="gk-settingsShell__empty" role="status">Loading settings…</p></section>`;
  }
  if (!sections.length) {
    return html`<section class="gk-settingsShell is-empty">${head}<p class="gk-settingsShell__empty" role="status">There are no settings to show.</p></section>`;
  }
  const tabs = sections.map((s) => {
    const on = s.key === active;
    const dirty = s.dirty && s.dirty > 0 ? s.dirty : 0;
    const bad = s.invalid && s.invalid > 0 ? s.invalid : 0;
    return html`<button type="button" role="tab" class="gk-settingsShell__tab${on ? " is-active" : ""}${bad ? " is-invalid" : ""}" ${attrs({
      id: id + "-tab-" + s.key, "aria-selected": on ? "true" : "false", "aria-controls": id + "-panel", tabindex: on ? "0" : "-1",
      "data-act": "settingsShell:tab", "data-section": s.key, "data-k": "tab-" + s.key,
    })}>${s.label}${bad ? html`<span class="gk-settingsShell__mark is-bad"><span aria-hidden="true"> ⚠</span><span class="gk-settingsShell__word" aria-hidden="true"> Error</span><span class="sr-only">, ${pluralize(bad, "problem")}</span></span>` : null}${
      dirty ? html`<span class="gk-settingsShell__mark is-dirty"><span aria-hidden="true"> ●</span><span class="gk-settingsShell__word" aria-hidden="true"> Unsaved</span><span class="sr-only">, ${pluralize(dirty, "unsaved change")}</span></span>` : null
    }</button>`;
  });
  const body = isSafe(p.body) ? p.body : null;
  const bar = isSafe(p.saveBar) ? html`<div class="gk-settingsShell__bar">${p.saveBar}</div>` : null;
  return html`<section class="gk-settingsShell">${head}<div class="gk-settingsShell__tabs" role="tablist" aria-label="${p.title} sections">${tabs}</div><div class="gk-settingsShell__panel" role="tabpanel" id="${id}-panel" aria-labelledby="${id}-tab-${active}" tabindex="-1" data-keep-scroll="settings">${body}</div>${bar}</section>`;
}
