// The one-time owner-run setup, from the Apps Script editor: setup(sheetUrl?).
//
// Owner-only and idempotent. It seeds ALLOWED_USERS with the owner, writes the default
// settings sections that are not stored yet, and optionally binds the register Sheet. Existing
// lists and sections are never overwritten, so running it twice changes nothing. It returns its
// seeding summary followed by the diagnostics text.

import { cleanSettings, SECTION_PROPS, sheetIdFrom } from "../domain/settings";
import type { Settings } from "../domain/types";
import { access } from "./access";
import { diagnosticsText } from "./diagnostics";
import { ensureDefaults, getJsonProp, getProp, putJsonProp, seedOwner, setProp } from "@gas-kit/server";
import { PROP_KEYS } from "./config";
import { sections } from "./settingsStore";

export function setup(sheetUrl?: string): string {
  access.assertOwner("setup");
  const lines: string[] = [];

  // The owner is on the people list (first, only when absent; others stay), and each settings
  // section is written with its defaults only where nothing is stored (never overwritten).
  const owner = access.ownerEmail().trim().toLowerCase();
  lines.push(seedOwner({ get: getProp, set: setProp }, { key: PROP_KEYS.allowedUsers, ownerEmail: owner }));
  const written = ensureDefaults({ sections });
  lines.push("Settings: " + (written.length ? "defaults written for " + written.join(", ") : "already set"));

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

  lines.push("Owner: " + owner + ". Access mode: " + access.mode() + ".");
  return lines.join("\n") + "\n\n" + diagnosticsText();
}
