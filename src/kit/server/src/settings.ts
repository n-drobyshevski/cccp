// Extracted from the author's production Apps Script apps; adapted.
// Settings: named sections, each one Script Property under the size cap, plus a generation
// counter. A save is one patch under the script lock; a stale baseGen is a conflict.

import { ApiError } from "./envelope";
import { withScriptLock } from "./lock";
import { PROP_MAX_BYTES, getProp, setProp, utf8ByteLength } from "./props";

export const SETTINGS_GEN_KEY = "SETTINGS_GEN";
export const PATCH_MAX_BYTES = 40_000;

export interface SectionSpec {
  /** The Script Property that holds this section as JSON. */
  key: string;
  defaults: unknown;
  /** Error messages for a candidate section value; empty means valid. */
  validate(v: unknown): string[];
  /**
   * Normalise or clamp a value before validate sees it. Runs on the stored value when a section is
   * loaded (after the merge over defaults) and on the merged candidate when a patch is saved. It
   * returns the value to use. A throw fails closed: a save is refused, a load falls back to the
   * section defaults (which are not cleaned).
   */
  clean?(v: unknown): unknown;
}

export interface SettingsProps {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export interface SettingsOptions {
  sections: Record<string, SectionSpec>;
  props?: SettingsProps;
  /**
   * The Script Property that holds the generation counter. Default SETTINGS_GEN_KEY. A blank or
   * non-string value, or one that is also a section key, throws at construction.
   */
  genKey?: string;
  /**
   * Wraps each save. Default: withScriptLock, so settings saves take the script lock themselves.
   * Note the opposite default in createAccessStore, whose saves take no lock: the app wraps those
   * in withScriptLock itself. The lock is not re-entrant, so never nest the two.
   */
  lock?: <T>(fn: () => T) => T;
  /**
   * Runs inside the lock after validation and before any write, so an app can gate owner-only
   * fields on the real before/after values. Return refusal messages (empty allows the save).
   */
  authorize?(change: { before: Record<string, unknown>; after: Record<string, unknown>; changed: string[] }): string[] | void;
  /**
   * Keep a patch key that the section's defaults do not have. Default false: when a section's
   * defaults is a plain object, a save naming any other key is refused before the lock.
   */
  allowExtraKeys?: boolean;
  /**
   * Called inside the lock once per changed section, after authorize and the size check and
   * before the first write, with the names of the keys whose value changed (never the values;
   * empty for a section that is not an object). A throw refuses the whole save: this is where an
   * app makes its audit record mandatory.
   */
  onSave?(e: { section: string; keys: string[] }): void;
}

/** Names that are never a section or a key: they reach the prototype chain in a careless merge. */
export const RESERVED_SETTING_NAMES: readonly string[] = ["__proto__", "constructor", "prototype"];

function reserved(name: string): boolean {
  return RESERVED_SETTING_NAMES.indexOf(name) >= 0;
}

function shortName(n: string): string {
  return n.length > 60 ? n.slice(0, 60) + "…" : n;
}

export interface SettingsView { gen: number; values: Record<string, unknown> }
export interface SaveResult extends SettingsView { changed: string[] }

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

export function createSettingsStore(opts: SettingsOptions) {
  const names = Object.keys(opts.sections);
  const badName = names.find(reserved);
  if (badName !== undefined) throw new Error("createSettingsStore: " + badName + " is not a section name.");
  const genKey = opts.genKey === undefined ? SETTINGS_GEN_KEY : opts.genKey;
  if (typeof genKey !== "string" || genKey.trim() === "") {
    throw new Error("createSettingsStore: genKey must be a non-blank string.");
  }
  if (names.some((n) => opts.sections[n]!.key === genKey)) {
    throw new Error("createSettingsStore: genKey " + shortName(genKey) + " is also a section key.");
  }
  const allowExtra = opts.allowExtraKeys === true;
  const props: SettingsProps = opts.props ?? { get: getProp, set: setProp };
  const lock = opts.lock ?? (<T>(fn: () => T): T => withScriptLock(fn));

  function gen(): number {
    const n = Number(props.get(genKey));
    return Number.isInteger(n) && n >= 0 ? n : 0;
  }

  /**
   * The stored section laid over its defaults. The merge is shallow ({...defaults, ...stored}):
   * a stored key that is no longer in defaults (a removed field) is kept and reaches validate and
   * the view, so validate or the app should drop such keys. A corrupt or non-object value falls
   * back to the defaults (or is returned as-is when the defaults are not an object).
   */
  function readSection(name: string): unknown {
    const spec = opts.sections[name]!;
    const defaults = clone(spec.defaults);
    const raw = props.get(spec.key);
    if (!raw) return defaults;
    let stored: unknown;
    try {
      stored = JSON.parse(raw);
    } catch {
      return defaults;
    }
    const merged =
      isPlain(defaults) && isPlain(stored) ? { ...defaults, ...stored } : stored === undefined || stored === null ? defaults : stored;
    if (!spec.clean) return merged;
    try {
      return spec.clean(merged);
    } catch {
      return defaults;
    }
  }

  function load(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const n of names) out[n] = readSection(n);
    return out;
  }

  function view(): SettingsView {
    return { gen: gen(), values: load() };
  }

  function parseBaseGen(v: unknown): number | null {
    const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
    return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : null;
  }

  function save(req: { patch: unknown; baseGen: unknown }): SaveResult {
    const patch = req ? req.patch : undefined;
    if (!isPlain(patch)) throw new ApiError("error", "There is nothing to save.");
    if (utf8ByteLength(JSON.stringify(patch)) > PATCH_MAX_BYTES) {
      throw new ApiError("error", "That change is too large to save.");
    }
    const base = parseBaseGen(req.baseGen);
    if (base === null) {
      throw new ApiError("error", "Reload the settings before saving: the change has no starting point.");
    }
    for (const n of Object.keys(patch)) {
      if (reserved(n) || !Object.prototype.hasOwnProperty.call(opts.sections, n)) {
        throw new ApiError("error", "Unknown settings section: " + shortName(n) + ".");
      }
      const defaults = opts.sections[n]!.defaults;
      const p = patch[n];
      if (isPlain(defaults) && !isPlain(p)) {
        throw new ApiError("error", "Settings section " + n + " must be an object.");
      }
      if (isPlain(p)) {
        for (const k of Object.keys(p)) {
          const known = isPlain(defaults) && Object.prototype.hasOwnProperty.call(defaults, k);
          if (reserved(k) || (isPlain(defaults) && !allowExtra && !known)) {
            throw new ApiError("error", "Unknown setting: " + shortName(k) + ".");
          }
        }
      }
    }
    return lock(() => {
      if (base !== gen()) {
        throw new ApiError(
          "conflict",
          "Someone else changed the settings since you opened them. Reload to see their changes, then save again.",
        );
      }
      const current = load();
      const next: Record<string, unknown> = { ...current };
      const errors: string[] = [];
      const changed: string[] = [];
      for (const n of Object.keys(patch)) {
        const p = patch[n];
        const cur = current[n];
        let cand = isPlain(cur) && isPlain(p) ? { ...cur, ...p } : clone(p);
        const clean = opts.sections[n]!.clean;
        if (clean) {
          try {
            cand = clean(cand);
          } catch {
            errors.push("Settings section " + n + " could not be cleaned.");
            continue;
          }
        }
        const raw = opts.sections[n]!.validate(cand);
        const msgs = Array.isArray(raw) ? raw : ["Settings section " + n + " could not be validated."];
        if (msgs.length) { errors.push(...msgs); continue; }
        next[n] = cand;
        if (JSON.stringify(cand) !== JSON.stringify(cur)) changed.push(n);
      }
      if (errors.length) throw new ApiError("error", errors.join(" "));
      if (!changed.length) return { gen: gen(), values: current, changed };
      if (opts.authorize) {
        const refused = opts.authorize({ before: current, after: next, changed });
        if (Array.isArray(refused) && refused.length) throw new ApiError("error", refused.join(" "));
      }
      // Size-check every changed section before the first write: no partial save.
      const json: Record<string, string> = {};
      for (const n of changed) {
        const s = JSON.stringify(next[n]);
        const bytes = utf8ByteLength(s);
        if (bytes > PROP_MAX_BYTES) {
          throw new ApiError(
            "error",
            "That is too large to store (" + bytes + " of " + PROP_MAX_BYTES + " bytes in " + opts.sections[n]!.key + ").",
          );
        }
        json[n] = s;
      }
      if (opts.onSave) {
        for (const n of changed) {
          const before = current[n];
          const after = next[n];
          const keys =
            isPlain(before) && isPlain(after)
              ? Object.keys(after).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]))
              : [];
          opts.onSave({ section: n, keys });
        }
      }
      // Once any section has landed the gen must move, even if a later write throws, so caches
      // keyed by the gen and clients holding the old baseGen both see the change. A failure of
      // the gen write never hides the section-write error that caused the bump.
      const g = gen() + 1;
      let wrote = false;
      let failure: unknown;
      let failed = false;
      try {
        for (const n of changed) {
          props.set(opts.sections[n]!.key, json[n]!);
          wrote = true;
        }
      } catch (e) {
        failed = true;
        failure = e;
      }
      if (wrote || !failed) {
        try {
          props.set(genKey, String(g));
        } catch (e) {
          if (!failed) throw e;
        }
      }
      if (failed) throw failure;
      return { gen: g, values: next, changed };
    });
  }

  return { load, view, save };
}

export type SettingsStore = ReturnType<typeof createSettingsStore>;
