import { FIELDS, FIELD_BY_KEY, FIELD_KEYS } from "./fields";
import type {
  DisplaySettings, FieldKey, FieldsSettings, JoinOn, OpensOn, PickMode, RuleParams, RulesSettings,
  SectionKey, Settings, SettingsPatch, SourceSettings, TabBinding, TabKey, ThemeChoice,
} from "./types";
import { TAB_KEYS } from "./types";

// The Settings schema, its defaults and the three pure operations on it:
//   cleanSettings    never throws, drops unknown keys, clamps numbers, repairs enums
//   validateSettings returns sentences for what is wrong but cannot be silently repaired
//   applyPatch       merges a partial update; the result does not depend on key order
// Each section is stored as one Script Property and refused above SECTION_MAX_BYTES.

export const SECTION_MAX_BYTES = 8000;
export const SECTION_KEYS: readonly SectionKey[] = ["source", "fields", "rules", "display"];
/** The Script Property that holds each section. */
export const SECTION_PROPS: Readonly<Record<SectionKey, string>> = {
  source: "CFG_SOURCE", fields: "CFG_FIELDS", rules: "CFG_RULES", display: "CFG_DISPLAY",
};

export const CACHE_MINUTES_DEFAULT = 10;
export const CACHE_MINUTES_MIN = 1;
export const CACHE_MINUTES_MAX = 360;
export const MONTHS_MIN = 1;
export const MONTHS_MAX = 120;

const NAME_MAX = 100;
const HEADER_MAX = 120;
const PREFIX_MAX = 100;
const SHEET_ID_MAX = 100;

/**
 * The tunable parameters of each status rule: which of on / months / tiers it takes, and the
 * default. rules.ts builds its catalogue on these ids. Fixed rules (cy.high, ct.drpNeverTested,
 * pl.decommissioning) have no entry: they have no switch and no parameter.
 */
// `on` is stored only for rules that have a switch (toggle:true in the rules catalogue); the others are always on.
export const RULE_PARAMS: Readonly<Record<string, RuleParams>> = {
  "cy.noOfficer": { on: true },
  "cy.exposedUntested": { on: true },
  "cy.critical": { on: true },
  "cy.pentestAge": { months: 18 },
  "co.majorAudit": { on: true },
  "co.review": { months: 12 },
  "ct.drpMissing": { tiers: [1, 2] },
  "ct.drpFailed": { on: true },
  "ct.drpAge": { months: 24 },
  "pl.eol": { on: true },
  "pl.noSso": { on: true },
};

function defaultTabs(): Record<TabKey, TabBinding> {
  const t = (name: string, pick: PickMode): TabBinding => ({ name, joinColumn: "UUID", joinOn: "id", pick });
  return { apps: t("Apps", "first"), ciat: t("CIAT", "first"), aud: t("Audits", "latest"), drp: t("DRP", "latest"), plat: t("Platform", "first") };
}

function defaultFields(): FieldsSettings {
  const o = {} as FieldsSettings;
  for (const d of FIELDS) o[d.key] = { binding: d.binding, header: d.defaultHeader };
  return o;
}

function defaultRules(): RulesSettings {
  const rules: Record<string, RuleParams> = {};
  for (const [id, p] of Object.entries(RULE_PARAMS)) rules[id] = { ...p, ...(p.tiers ? { tiers: [...p.tiers] } : {}) };
  return { version: 1, rules };
}

export function makeDefaultSettings(): Settings {
  return {
    source: { sheetId: "", cacheMinutes: CACHE_MINUTES_DEFAULT, tabs: defaultTabs() },
    fields: defaultFields(),
    rules: defaultRules(),
    display: { opensOn: "overview", theme: "system", hidePrefix: "", hideEol: false },
  };
}

/** A fresh deep copy of the defaults on every call; the constant below is for reading only. */
export const DEFAULT_SETTINGS: Settings = deepFreeze(makeDefaultSettings());

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    for (const v of Object.values(o as object)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

// ------------------------------------------------------------------------------------ clean

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const own = (o: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

function str(v: unknown, max: number, fallback: string): string {
  if (typeof v !== "string") return fallback;
  const t = v.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return t.length > max ? t.slice(0, max).trim() : t;
}

function num(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** Accepts a bare Sheet id or a full docs.google.com link and keeps the id. */
export function sheetIdFrom(v: unknown): string {
  const s = str(v, 400, "");
  const m = /\/d\/([A-Za-z0-9_-]{10,})/.exec(s);
  const id = m ? m[1]! : s;
  return /^[A-Za-z0-9_-]*$/.test(id) ? id.slice(0, SHEET_ID_MAX) : "";
}

function cleanSource(raw: unknown, base: SourceSettings): SourceSettings {
  const r = isObj(raw) ? raw : {};
  const tabsRaw = isObj(own(r, "tabs")) ? (own(r, "tabs") as Record<string, unknown>) : {};
  const tabs = {} as Record<TabKey, TabBinding>;
  for (const k of TAB_KEYS) {
    const t = isObj(own(tabsRaw, k)) ? (own(tabsRaw, k) as Record<string, unknown>) : {};
    const b = base.tabs[k];
    tabs[k] = {
      name: str(own(t, "name"), NAME_MAX, b.name),
      joinColumn: str(own(t, "joinColumn"), HEADER_MAX, b.joinColumn),
      joinOn: oneOf<JoinOn>(own(t, "joinOn"), ["id", "name"], b.joinOn),
      pick: oneOf<PickMode>(own(t, "pick"), ["first", "latest"], b.pick),
    };
  }
  return {
    sheetId: own(r, "sheetId") === undefined ? base.sheetId : sheetIdFrom(own(r, "sheetId")),
    cacheMinutes: num(own(r, "cacheMinutes"), CACHE_MINUTES_MIN, CACHE_MINUTES_MAX, base.cacheMinutes),
    tabs,
  };
}

function cleanFields(raw: unknown, base: FieldsSettings): FieldsSettings {
  const r = isObj(raw) ? raw : {};
  const out = {} as FieldsSettings;
  for (const k of FIELD_KEYS) {
    const m = isObj(own(r, k)) ? (own(r, k) as Record<string, unknown>) : {};
    out[k] = {
      binding: oneOf<TabKey>(own(m, "binding"), TAB_KEYS, base[k].binding),
      header: own(m, "header") === undefined ? base[k].header : str(own(m, "header"), HEADER_MAX, ""),
    };
  }
  return out;
}

function cleanRuleParams(raw: unknown, base: RuleParams): RuleParams {
  const r = isObj(raw) ? raw : {};
  const out: RuleParams = {};
  if (base.on !== undefined) out.on = typeof own(r, "on") === "boolean" ? (own(r, "on") as boolean) : base.on;
  if (base.months !== undefined) out.months = num(own(r, "months"), MONTHS_MIN, MONTHS_MAX, base.months);
  if (base.tiers !== undefined) {
    const t = own(r, "tiers");
    if (Array.isArray(t)) {
      const set = new Set<number>();
      for (const x of t) {
        const n = typeof x === "number" ? x : Number(x);
        if (Number.isFinite(n)) set.add(Math.min(4, Math.max(1, Math.round(n))));
      }
      out.tiers = [...set].sort((a, b) => a - b);
    } else out.tiers = [...base.tiers];
  }
  return out;
}

/** Unknown rule ids are dropped; every known id is present in the result. */
export function cleanRulesSection(raw: unknown, base: RulesSettings = DEFAULT_SETTINGS.rules): RulesSettings {
  const r = isObj(raw) ? raw : {};
  const rulesRaw = isObj(own(r, "rules")) ? (own(r, "rules") as Record<string, unknown>) : {};
  const rules: Record<string, RuleParams> = {};
  for (const id of Object.keys(RULE_PARAMS)) rules[id] = cleanRuleParams(own(rulesRaw, id), base.rules[id] ?? RULE_PARAMS[id]!);
  return { version: 1, rules };
}

function cleanDisplay(raw: unknown, base: DisplaySettings): DisplaySettings {
  const r = isObj(raw) ? raw : {};
  return {
    opensOn: oneOf<OpensOn>(own(r, "opensOn"), ["overview", "list", "heatmap", "landscape"], base.opensOn),
    theme: oneOf<ThemeChoice>(own(r, "theme"), ["system", "light", "dark"], base.theme),
    hidePrefix: own(r, "hidePrefix") === undefined ? base.hidePrefix : str(own(r, "hidePrefix"), PREFIX_MAX, ""),
    hideEol: typeof own(r, "hideEol") === "boolean" ? (own(r, "hideEol") as boolean) : base.hideEol,
  };
}

/**
 * Turn anything (stored JSON, a patch result, garbage) into valid Settings. Never throws: a
 * value that is missing or wrong falls back to the default, numbers are clamped, unknown keys
 * are dropped. Idempotent: cleaning a clean value returns an equal value.
 */
export function cleanSettings(raw: unknown): Settings {
  try {
    const r = isObj(raw) ? raw : {};
    const d = DEFAULT_SETTINGS;
    return {
      source: cleanSource(own(r, "source"), d.source),
      fields: cleanFields(own(r, "fields"), d.fields),
      rules: cleanRulesSection(own(r, "rules"), d.rules),
      display: cleanDisplay(own(r, "display"), d.display),
    };
  } catch {
    return makeDefaultSettings();
  }
}

// ------------------------------------------------------------------------------------ bytes

/** UTF-8 size of a section's JSON, as the Script Property stores it. */
export function sectionBytes(section: unknown): number {
  const s = JSON.stringify(section) ?? "";
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

// ------------------------------------------------------------------------------------ validate

/** Sentences for what is wrong. Empty means the settings can be saved. */
export function validateSettings(s: Settings): string[] {
  const errors: string[] = [];
  const tabs = s.source.tabs;
  if (tabs.apps.name === "") errors.push("The Applications tab needs a name: it holds the list of applications.");
  for (const k of TAB_KEYS) {
    if (tabs[k].name !== "" && tabs[k].joinOn === "id" && k !== "apps" && tabs[k].joinColumn === "")
      errors.push("The " + k + " tab joins on the application id, so it needs the name of its id column.");
  }
  if (s.fields.id.header === "" && tabs.apps.name !== "") errors.push("The Application id field needs a column: applications are identified by it.");
  if (s.fields.name.header === "" && tabs.apps.name !== "") errors.push("The Name field needs a column: every application is shown by its name.");
  for (const k of FIELD_KEYS) {
    const m = s.fields[k];
    if (m.header !== "" && tabs[m.binding].name === "")
      errors.push("“" + FIELD_BY_KEY[k].label + "” is mapped to a column of a tab that is not used. Choose a tab for it or clear the column.");
  }
  if (s.source.sheetId !== "" && !/^[A-Za-z0-9_-]{10,}$/.test(s.source.sheetId)) errors.push("The Google Sheet link is not valid: it should contain the sheet id.");
  if (s.display.hidePrefix.length > PREFIX_MAX) errors.push("The hidden-name prefix is too long.");
  for (const k of SECTION_KEYS) {
    const b = sectionBytes(s[k]);
    if (b > SECTION_MAX_BYTES) errors.push("The " + k + " settings are too large to save (" + b + " of " + SECTION_MAX_BYTES + " bytes). Shorten the column or tab names.");
  }
  return errors;
}

// ------------------------------------------------------------------------------------ patch

const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

function mergeInto(target: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const k of Object.keys(patch).sort()) {
    if (FORBIDDEN.has(k)) continue;
    const pv = patch[k];
    const tv = target[k];
    if (isObj(pv) && isObj(tv)) mergeInto(tv, pv);
    else if (isObj(pv)) {
      const fresh: Record<string, unknown> = {};
      mergeInto(fresh, pv);
      target[k] = fresh;
    } else target[k] = Array.isArray(pv) ? pv.slice() : pv;
  }
}

/**
 * Merge a partial update into settings and clean the result. The keys of each object are visited
 * in sorted order and arrays replace, so the same patch gives the same settings however its keys
 * are ordered. Never throws; the input is not changed.
 */
export function applyPatch(base: Settings, patch: SettingsPatch | unknown): Settings {
  try {
    const merged = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    if (isObj(patch)) mergeInto(merged, patch);
    return cleanSettings(merged);
  } catch {
    return cleanSettings(base);
  }
}

/** Which sections differ between two settings. */
export function changedSections(a: Settings, b: Settings): SectionKey[] {
  return SECTION_KEYS.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

/** True when the patch touches the source sheet id (an owner-only change). */
export function patchTouchesSheetId(patch: unknown): boolean {
  if (!isObj(patch)) return false;
  const src = own(patch, "source");
  return isObj(src) && own(src, "sheetId") !== undefined;
}
