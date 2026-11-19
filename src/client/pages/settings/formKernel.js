// The settings draft kernel: which knobs the page-level save bar owns, which tab owns each,
// what changed between the saved state and the draft, and the per-tab dirty and invalid state a
// tablist reads without a reader opening a hidden tab first.
//
// Derived from the upstream shared settingsForm (commit 77bcf22; formerly vendored here
// verbatim, see KIT.md). Changes: the leaf comparison is the kit's `sameValue`
// (array order does not matter, NaN equals NaN, NaN is not null; it also copes with arrays of
// objects), the long history comment is dropped, and the module is app-owned so it may change.
// Pure: no DOM. The kit's settingsForm and settingsShell cannot stand in for it: the kit form is a
// flat field schema with no tab ownership, no change summary and no per-tab marks.
//
// `tabStatus` reads `errors` BY KEY PRESENCE, never by truthiness: a caller deletes the key when a
// field clears, so an empty-string error is still an error.
import { sameValue } from "@gas-kit/ui/components/settingsForm.js";

export { sameValue };

/**
 * @param {{tabs: {key: string, label: string}[], fields: Record<string, {tab: string, label: string}>, defaultTab?: string}} spec
 *   `tabs` is the tablist in order; `fields` is {draftKey: {tab, label}}, the ONE place that says
 *   which tab owns a key, read by both the save bar (changeSummary) and the tablist (tabStatus).
 */
export function settingsForm(spec) {
  const s = spec || /** @type {any} */ ({});
  const tabs = Array.isArray(s.tabs) ? s.tabs : [];
  const tabKeys = tabs.map((t) => t.key);
  const fields = s.fields || {};
  const keys = Object.keys(fields);
  const DEFAULT_TAB = s.defaultTab === undefined ? (tabs[0] && tabs[0].key) : s.defaultTab;
  if (!DEFAULT_TAB || !tabKeys.includes(DEFAULT_TAB)) {
    throw new Error("settingsForm(): defaultTab " + JSON.stringify(s.defaultTab) + " is missing or names no tab in 'tabs' (" + JSON.stringify(tabKeys) + ")");
  }
  for (const k of keys) {
    if (!tabKeys.includes(fields[k] && fields[k].tab)) {
      throw new Error("settingsForm(): field " + JSON.stringify(k) + " names tab " + JSON.stringify(fields[k] && fields[k].tab) + ", which is not in 'tabs' (" + JSON.stringify(tabKeys) + ")");
    }
  }
  const TAB_FIELDS = Object.fromEntries(keys.map((k) => [k, fields[k].tab]));
  const TAB_LABEL = Object.fromEntries(tabs.map((t) => [t.key, t.label]));

  /** A tab key the URL may name; `available` is the tabs built this render (default: all). */
  function normalizeTab(key, available) {
    const list = available && available.length ? available : tabKeys;
    if (list.indexOf(key) >= 0) return key;
    return list.indexOf(DEFAULT_TAB) >= 0 ? DEFAULT_TAB : list[0];
  }

  /** The field keys whose draft value differs from the saved one, in registry order. */
  function changedFields(saved, draft) {
    const sv = saved || {};
    const dv = draft || {};
    return keys.filter((k) => !sameValue(sv[k], dv[k]));
  }

  /** Only the changed fields, ready to send as one atomic patch. */
  function settingsPatch(saved, draft) {
    const out = {};
    for (const k of changedFields(saved, draft)) out[k] = draft[k];
    return out;
  }

  /** What the save bar says: each change with the tab that owns it (the bar links to that tab). */
  function changeSummary(changed) {
    return (changed || [])
      .filter((k) => Object.prototype.hasOwnProperty.call(fields, k))
      .map((k) => ({ field: k, label: fields[k].label, tab: fields[k].tab, tabLabel: TAB_LABEL[fields[k].tab] }));
  }

  function changeCountText(changed) {
    const n = (changed || []).length;
    return n + " unsaved change" + (n === 1 ? "" : "s");
  }

  /**
   * Per-tab {dirty, invalid}. `saved` must be the last SAVED snapshot. One entry per tab that
   * owns a field in `tabFields` (pass TAB_FIELDS); a tab that owns none never appears.
   */
  function tabStatus(draft, saved, errors, tabFields) {
    const tf = tabFields || {};
    const d = draft || {};
    const sv = saved || {};
    const errs = errors || {};
    const out = {};
    for (const tab of new Set(Object.values(tf))) out[tab] = { dirty: false, invalid: false };
    for (const [field, tab] of Object.entries(tf)) {
      if (!sameValue(sv[field], d[field])) out[tab].dirty = true;
      if (Object.prototype.hasOwnProperty.call(errs, field)) out[tab].invalid = true;
    }
    return out;
  }

  return { normalizeTab, changedFields, settingsPatch, changeSummary, changeCountText, tabStatus, sameValue, TAB_FIELDS, keys, DEFAULT_TAB };
}
