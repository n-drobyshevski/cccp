// The one-time owner-run setup, from the Apps Script editor: setup(sheetUrl?).
//
// Owner-only and idempotent. It seeds ALLOWED_USERS with the owner, writes the default
// settings sections that are not stored yet, and optionally binds the register Sheet. Existing
// lists and sections are never overwritten, so running it twice changes nothing. It returns a
// plain-text report.

import { cleanSettings, makeDefaultSettings, SECTION_KEYS, SECTION_PROPS, sheetIdFrom } from "../domain/settings";
import type { Settings } from "../domain/types";
import * as access from "./access";
import { getJsonProp, getProp, putJsonProp, setProp, PROP_KEYS } from "./props";

export function setup(sheetUrl?: string): string {
  access.assertOwner("setup");
  const lines: string[] = [];

  // The owner is on the people list. Others already there stay.
  const users = access.currentUsers();
  const owner = access.ownerEmail().trim().toLowerCase();
  if (owner && users.indexOf(owner) < 0) {
    setProp(PROP_KEYS.allowedUsers, [owner].concat(users).join(", "));
    lines.push("Added " + owner + " to ALLOWED_USERS.");
  } else {
    lines.push("ALLOWED_USERS already names the owner.");
  }

  // Default sections, only where nothing is stored.
  const defaults = makeDefaultSettings();
  for (const key of SECTION_KEYS) {
    if (getProp(SECTION_PROPS[key]) === null) {
      putJsonProp(SECTION_PROPS[key], defaults[key]);
      lines.push("Wrote default " + SECTION_PROPS[key] + ".");
    }
  }

  if (sheetUrl !== undefined && String(sheetUrl).trim() !== "") {
    const id = sheetIdFrom(sheetUrl);
    if (!id) throw new Error("That is not a Google Sheet link or id.");
    const source = cleanSettings({ source: getJsonProp(SECTION_PROPS.source, {}) }).source;
    if (source.sheetId !== id) {
      const next: Settings["source"] = { ...source, sheetId: id };
      putJsonProp(SECTION_PROPS.source, next);
      // A new source invalidates both caches.
      const gen = (n: string): string => String((Number(getProp(n)) || 0) + 1);
      setProp(PROP_KEYS.cfgGen, gen(PROP_KEYS.cfgGen));
      setProp(PROP_KEYS.dataVersion, gen(PROP_KEYS.dataVersion));
      lines.push("Bound the register Sheet " + id + ".");
    } else {
      lines.push("The register Sheet is already " + id + ".");
    }
  }

  lines.push("Owner: " + owner + ". Access mode: " + access.accessMode() + ".");
  return lines.join("\n");
}
