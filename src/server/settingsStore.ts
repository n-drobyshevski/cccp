// Settings: four sections, one Script Property each (CFG_SOURCE, CFG_FIELDS, CFG_RULES,
// CFG_DISPLAY), cleaned on every read, saved by ONE call under the script lock with an
// optimistic-concurrency check on CFG_GEN.
//
// A save: lock; compare baseGen with CFG_GEN (a mismatch is a `conflict`); merge and clean the
// patch; validate (sentences); an owner check when the source sheet id changes; write only
// the sections that changed (each refused above 8000 bytes before anything is written); bump
// CFG_GEN, and DATA_VERSION too when source or fields changed (the register must be re-read).
// Rules and display saves bump only CFG_GEN, so the register stays cached.
//
// Not memoised across calls: in Apps Script every RPC is a fresh execution, and a module-level
// memo would outlive a test.

import { applyPatch, changedSections, cleanSettings, SECTION_PROPS, validateSettings } from "../domain/settings";
import type { SaveSettingsResponse, SettingsResponse } from "../domain/payload";
import type { SectionKey, Settings, SettingsPatch, TabKey } from "../domain/types";
import { TAB_KEYS } from "../domain/types";
import { ApiError } from "./errors";
import { withScriptLock } from "./locks";
import { getJsonProp, putJsonProp } from "./props";
import { bumpCfgGen, bumpDataVersion, cached, cfgGen } from "./serverCache";
import { sampleTabs } from "./sourceSheet";

/** A patch larger than this is refused before it is even merged. */
export const PATCH_MAX_BYTES = 40_000;
const HEADERS_TTL_SEC = 600;

export function loadSettings(): Settings {
  const raw: Record<string, unknown> = {};
  (Object.keys(SECTION_PROPS) as SectionKey[]).forEach((k) => { raw[k] = getJsonProp<unknown>(SECTION_PROPS[k], {}); });
  return cleanSettings(raw);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Dotted paths of the patch values that the cleaning changed or dropped. */
function clampedPaths(patch: unknown, cleaned: unknown, path: string[] = [], out: string[] = []): string[] {
  if (isObj(patch)) {
    for (const k of Object.keys(patch).sort()) {
      const c = isObj(cleaned) && Object.prototype.hasOwnProperty.call(cleaned, k) ? cleaned[k] : undefined;
      clampedPaths(patch[k], c, path.concat(k), out);
    }
  } else if (JSON.stringify(patch) !== JSON.stringify(cleaned)) {
    out.push(path.join("."));
  }
  return out;
}

export interface SaveContext {
  actor: string;
  isOwner: boolean;
}

/** Save a partial settings update. See the header for the order of checks. */
export function saveSettings(patch: unknown, baseGen: unknown, who: SaveContext): SaveSettingsResponse {
  if (!isObj(patch)) throw new ApiError("error", "There is nothing to save.");
  if (JSON.stringify(patch).length > PATCH_MAX_BYTES) throw new ApiError("error", "That change is too large to save.");
  const base = typeof baseGen === "number" ? baseGen : typeof baseGen === "string" && baseGen.trim() !== "" ? Number(baseGen) : NaN;
  if (!Number.isInteger(base)) throw new ApiError("error", "Reload the settings before saving: the change has no starting point.");

  return withScriptLock(() => {
    if (base !== cfgGen()) {
      throw new ApiError("conflict", "Someone else changed the settings since you opened them. Reload to see their changes, then save again.");
    }
    const before = loadSettings();
    const after = applyPatch(before, patch as SettingsPatch);
    const clamped = clampedPaths(patch, after);

    const errors = validateSettings(after);
    if (errors.length) throw new ApiError("error", errors.join(" "));

    if (after.source.sheetId !== before.source.sheetId && !who.isOwner) {
      throw new Error("Only the owner can change the source Sheet.");
    }

    const changed = changedSections(before, after);
    if (changed.length === 0) return { settings: after, cfgGen: cfgGen(), clamped };
    for (const k of changed) putJsonProp(SECTION_PROPS[k], after[k]);
    if (changed.indexOf("source") >= 0 || changed.indexOf("fields") >= 0) bumpDataVersion();
    const gen = bumpCfgGen();
    console.log(JSON.stringify({ settings: "saved", actor: who.actor, sections: changed, clamped, cfgGen: gen }));
    return { settings: after, cfgGen: gen, clamped };
  });
}

/** Settings plus the headers of each configured tab and one example value per header. */
export function getSettingsView(): SettingsResponse {
  const settings = loadSettings();
  const headers: SettingsResponse["headers"] = {};
  const examples: SettingsResponse["examples"] = {};
  if (settings.source.sheetId !== "") {
    try {
      const names = TAB_KEYS.map((k) => settings.source.tabs[k].name);
      const sample = cached("headers", { id: settings.source.sheetId, names }, () => sampleTabs(settings.source), HEADERS_TTL_SEC);
      for (const k of Object.keys(sample) as TabKey[]) {
        const s = sample[k];
        if (s && s.found) {
          headers[k] = s.headers;
          examples[k] = s.examples;
        }
      }
    } catch (e) {
      console.warn("Headers could not be read: " + e);
    }
  }
  return { settings, headers, examples, cfgGen: cfgGen() };
}
