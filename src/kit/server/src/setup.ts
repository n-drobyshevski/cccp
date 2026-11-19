// Extracted from the author's production Apps Script apps; adapted.
// Idempotent setup helpers. The app's own setup() calls them in order and then reports.

import { ACCESS_MAX_ENTRIES, ACCESS_PROP_KEYS, parseAddressList } from "./access";
import { withScriptLock } from "./lock";
import { PROP_MAX_BYTES, getProp, setProp, utf8ByteLength } from "./props";
import type { SettingsProps } from "./settings";

/** The default allow-list property: the one access.ts reads. */
export const OWNER_LIST_KEY = ACCESS_PROP_KEYS.users;

const defaultProps = (): SettingsProps => ({ get: getProp, set: setProp });

function effectiveEmail(): string {
  try {
    return String(Session.getEffectiveUser().getEmail() || "").trim();
  } catch {
    return "";
  }
}

/**
 * Put the owner (the effective user) first in the stored allow list, only when absent. The list
 * is read with access.parseAddressList (JSON array or a plain delimited value) and written back
 * as the JSON array access.ts stores. Returns a line saying what happened. A blank owner email
 * changes nothing. Throws when the result would break the entry or byte cap.
 *
 * This is an unlocked read-modify-write of the allow list. It is meant for the editor-run setup
 * function, which runs rarely and by one person; an admin saving the list at the same moment
 * could lose one of the two edits. Run setup when nobody is editing the list.
 */
export function seedOwner(
  props: SettingsProps = defaultProps(),
  opts: { key?: string; ownerEmail?: string } = {},
): string {
  const key = opts.key ?? OWNER_LIST_KEY;
  const owner = (opts.ownerEmail ?? effectiveEmail()).trim().toLowerCase();
  if (!owner) return "Owner: no email available, nothing seeded";
  const list = parseAddressList(props.get(key));
  if (list.indexOf(owner) >= 0) return "Owner: already listed";
  const next = [owner, ...list];
  if (next.length > ACCESS_MAX_ENTRIES) throw new Error("The allow list is full (" + ACCESS_MAX_ENTRIES + " entries).");
  const json = JSON.stringify(next);
  const bytes = utf8ByteLength(json);
  if (bytes > PROP_MAX_BYTES) throw new Error("The allow list is too long to store (" + bytes + " of " + PROP_MAX_BYTES + " bytes).");
  props.set(key, json);
  return "Owner: added to the allow list";
}

/**
 * Write each section's defaults where its property is unset. Never overwrites a stored value.
 * Takes the same options object as createSettingsStore (sections, optional props, optional lock).
 * Runs under the script lock, checks the byte cap and each section's validate(). It does NOT
 * bump SETTINGS_GEN: load() already returns the defaults for an unset section, so nothing a
 * client or cache holds changes meaning.
 */
export function ensureDefaults(store: {
  sections: Record<string, { key: string; defaults: unknown; validate?(v: unknown): string[] }>;
  props?: SettingsProps;
  lock?: <T>(fn: () => T) => T;
}): string[] {
  const props = store.props ?? defaultProps();
  const lock = store.lock ?? withScriptLock;
  return lock(() => {
    const written: string[] = [];
    for (const name of Object.keys(store.sections)) {
      const s = store.sections[name]!;
      if (props.get(s.key) !== null) continue;
      const errs = s.validate ? s.validate(s.defaults) : [];
      if (errs.length) throw new Error("Defaults for " + name + " are invalid: " + errs.join(" "));
      const json = JSON.stringify(s.defaults);
      const bytes = utf8ByteLength(json);
      if (bytes > PROP_MAX_BYTES) throw new Error("Defaults for " + name + " are too large (" + bytes + " of " + PROP_MAX_BYTES + " bytes).");
      props.set(s.key, json);
      written.push(name);
    }
    return written;
  });
}
