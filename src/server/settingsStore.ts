// Settings: four sections, one Script Property each (CFG_SOURCE, CFG_FIELDS, CFG_RULES,
// CFG_DISPLAY), cleaned on every read, saved by ONE call under the script lock with an
// optimistic-concurrency check on CFG_GEN. The store is the kit's createSettingsStore; what stays
// here is what is CCCP's: the section cleaning and sentences (src/domain/settings.ts), the deep
// patch merge, the owner-only source sheet id and the DATA_VERSION bump.
//
// Not memoised across calls: in Apps Script every RPC is a fresh execution, and a module-level
// memo would outlive a test.

import { applyPatch, changedSections, cleanSettings, DEFAULT_SETTINGS, SECTION_PROPS, validateSettings } from "../domain/settings";
import type { SaveSettingsResponse, SettingsResponse } from "../domain/payload";
import type { SectionKey, Settings, SettingsPatch, TabKey } from "../domain/types";
import { TAB_KEYS } from "../domain/types";
import { ApiError, createSettingsStore, PATCH_MAX_BYTES, utf8ByteLength, withScriptLock } from "@gas-kit/server";
import { PROP_KEYS } from "./config";
import { bumpDataVersion, cache, cfgGen, paramsKey } from "./serverCache";
import { sampleWorkbook } from "./sourceSheet";

export { PATCH_MAX_BYTES };
const HEADERS_TTL_SEC = 600;

const SECTIONS = ["source", "fields", "rules", "display"] as const satisfies readonly SectionKey[];

/**
 * One section as the kit store sees it. `clean` is the app's cleaning of that section (clamp,
 * default, drop unknown keys), run by the kit on every load and before every save. `validate`
 * is empty on purpose: the sentences depend on several sections at once (a field's tab, the
 * source sheet id), so they are checked in `authorize`, which sees the whole result.
 */
function section(k: SectionKey) {
  return {
    key: SECTION_PROPS[k],
    defaults: DEFAULT_SETTINGS[k],
    validate: (): string[] => [],
    clean: (v: unknown): unknown => cleanSettings({ [k]: v })[k],
  };
}

export const sections: Record<string, ReturnType<typeof section>> = Object.fromEntries(SECTIONS.map((k) => [k, section(k)]));

/** Refuse a save that is not the owner's when it changes the source sheet; fail closed without a saver. */
function makeStore(who: SaveContext | null) {
  return createSettingsStore({
    sections,
    // The generation counter is CFG_GEN, as before, so the core cache key keeps following saves.
    genKey: PROP_KEYS.cfgGen,
    // cleanSettings drops unknown keys and reports them in `clamped`; the kit would refuse them.
    allowExtraKeys: true,
    // saveSettings holds the script lock around the kit save and the DATA_VERSION bump.
    lock: (fn) => fn(),
    authorize({ before, after }) {
      const next = cleanSettings(after);
      const errors = validateSettings(next);
      if (errors.length) return errors;
      if (cleanSettings(before).source.sheetId !== next.source.sheetId && !(who && who.isOwner)) {
        throw new ApiError("forbidden", "Only the owner can change the source Sheet.");
      }
    },
  });
}

const reader = makeStore(null);

export function loadSettings(): Settings {
  return cleanSettings(reader.load());
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

/**
 * Save a partial settings update: ONE kit save under the script lock.
 *
 * The patch is deep (source.tabs.apps.name) and the kit merges a section shallowly, so the app
 * first merges and cleans the patch over the stored settings (applyPatch) and hands the kit the
 * whole of each section that differs. The merge needs no lock of its own: the kit refuses the
 * save as a conflict when the generation moved since the client's baseGen, and a stored value
 * can only be older than that base if the generation has moved.
 *
 * Inside the kit save, in order: the baseGen conflict, the sections' cleaning, authorize (the
 * sentences, then the owner-only source sheet id), the 8000-byte section cap, then the writes
 * and the CFG_GEN bump. DATA_VERSION is bumped under the same lock when source or fields
 * changed (the register must be re-read); rules and display saves leave the register cached.
 */
export function saveSettings(patch: unknown, baseGen: unknown, who: SaveContext): SaveSettingsResponse {
  if (!isObj(patch)) throw new ApiError("error", "There is nothing to save.");
  if (utf8ByteLength(JSON.stringify(patch)) > PATCH_MAX_BYTES) throw new ApiError("error", "That change is too large to save.");
  const before = loadSettings();
  const after = applyPatch(before, patch as SettingsPatch);
  const clamped = clampedPaths(patch, after);
  const whole: Record<string, unknown> = {};
  for (const k of changedSections(before, after)) whole[k] = after[k];

  const store = makeStore(who);
  return withScriptLock(() => {
    const res = store.save({ patch: whole, baseGen });
    const next = cleanSettings(res.values);
    if (res.changed.length === 0) return { settings: next, cfgGen: res.gen, clamped };
    if (res.changed.indexOf("source") >= 0 || res.changed.indexOf("fields") >= 0) bumpDataVersion();
    console.log(JSON.stringify({ settings: "saved", actor: who.actor, sections: res.changed, clamped, cfgGen: res.gen }));
    return { settings: next, cfgGen: res.gen, clamped };
  });
}

/** Settings plus the headers of each configured tab and one example value per header. */
export function getSettingsView(): SettingsResponse {
  const settings = loadSettings();
  const headers: SettingsResponse["headers"] = {};
  const examples: SettingsResponse["examples"] = {};
  let tabNames: string[] | undefined;
  if (settings.source.sheetId !== "") {
    try {
      const names = TAB_KEYS.map((k) => settings.source.tabs[k].name + (settings.source.tabs[k].sameTab ? "\u0001same" : ""));
      const sample = cache.getOrCompute("headers1", paramsKey({ id: settings.source.sheetId, names, idHeader: settings.fields.id.header }), HEADERS_TTL_SEC, () => sampleWorkbook(settings.source, { idHeader: settings.fields.id.header }));
      tabNames = sample.tabNames;
      for (const k of Object.keys(sample.tabs) as TabKey[]) {
        const s = sample.tabs[k];
        if (s && s.found) {
          headers[k] = s.headers;
          examples[k] = s.examples;
        }
      }
    } catch (e) {
      console.warn("Headers could not be read: " + e);
    }
  }
  return { settings, headers, examples, ...(tabNames ? { tabNames } : {}), cfgGen: cfgGen() };
}
