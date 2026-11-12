// The Settings draft. Wraps the vendored settingsForm kernel: every knob the save bar owns is a
// flat key of the draft ('source.cacheMinutes', 'fields.owner', 'rules.cy.pentestAge',
// 'display.theme'), each owned by one tab. The kernel answers which keys changed, which tab is
// dirty or invalid and what the save bar says; this module adds the translation to and from the
// nested Settings shape, so one save is ONE patch of exactly the changed values, and the
// validation sentences of the server (the same domain code runs here) land on the right tab.
//
// Pure: no DOM, no store, no RPC. The page keeps a session object in the store and replaces it
// with the functions below. guardUnsaved is the vendored beforeunload guard.
//
// The kernel is imported by the specifier 'gas_shared/ui/settingsForm.js' (an alias of the
// vendored tree, see build/esbuild.config.mjs): the vendored contract asserts that form of path.
import { settingsForm } from "gas_shared/ui/settingsForm.js";
import { guardUnsaved } from "gas_shared/ui/accessSave.js";
import { FIELDS } from "../../../domain/fields";
import { RULE_BY_ID } from "../../../domain/rules";
import { RULE_PARAMS, TAB_NAMES, applyPatch, sheetIdFrom, validateSettings } from "../../../domain/settings";
import { TAB_KEYS } from "../../../domain/types";

export const SETTINGS_TABS = [
  { key: "source", label: "Data source", help: "Sheet and tabs CCCP reads" },
  { key: "fields", label: "Field mapping", help: "Which column feeds which field" },
  { key: "rules", label: "Status rules", help: "When each pillar shows Gap or Attention. Counts are live over the whole register" },
  { key: "access", label: "Access", help: "Who can open CCCP and edit settings" },
  { key: "display", label: "Display", help: "Defaults and hidden applications" },
];

/** What each bound Sheet tab holds, in the words of the Data source table. */
export const TAB_LABEL = {
  apps: "Applications", ciat: "CIAT classification", aud: "Audits & pentests", drp: "Disaster recovery", plat: "Platform",
};
const ATTR_LABEL = { name: "tab", sameTab: "same tab as Applications", joinColumn: "id column", joinOn: "join", pick: "row pick" };
const ATTRS = ["name", "sameTab", "joinColumn", "joinOn", "pick"];

const PATH = {};
const REGISTRY = {};

function add(key, tab, label, path) {
  REGISTRY[key] = { tab, label };
  PATH[key] = path;
}

add("source.sheetId", "source", "Google Sheet", ["source", "sheetId"]);
add("source.cacheMinutes", "source", "Keep data in memory for", ["source", "cacheMinutes"]);
for (const k of TAB_KEYS) {
  for (const a of ATTRS) add("source.tabs." + k + "." + a, "source", TAB_LABEL[k] + " " + ATTR_LABEL[a], ["source", "tabs", k, a]);
}
for (const d of FIELDS) add("fields." + d.key, "fields", d.label + " column", ["fields", d.key, "header"]);
for (const id of Object.keys(RULE_PARAMS)) {
  const rule = RULE_BY_ID[id];
  add("rules." + id, "rules", rule ? rule.sentence(rule.params || {}) : id, ["rules", "rules", id]);
}
add("display.opensOn", "display", "Opens on", ["display", "opensOn"]);
add("display.theme", "display", "Theme", ["display", "theme"]);
add("display.hidePrefix", "display", "Hide names starting with", ["display", "hidePrefix"]);
add("display.hideEol", "display", "Hide applications at end of life", ["display", "hideEol"]);

/** {draftKey: {tab, label}}: the registry the kernel closes over. */
export const SETTING_FIELDS = REGISTRY;
export const DEFAULT_TAB = "source";

/** The kernel, bound to this registry: normalizeTab, changedFields, changeSummary, tabStatus... */
export const form = settingsForm({ tabs: SETTINGS_TABS, fields: SETTING_FIELDS, defaultTab: DEFAULT_TAB });

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

function read(obj, path) {
  let o = obj;
  for (const p of path) {
    if (o === null || o === undefined) return undefined;
    o = o[p];
  }
  return o;
}

function put(obj, path, value) {
  let o = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const p = path[i];
    if (o[p] === null || typeof o[p] !== "object") o[p] = {};
    o = o[p];
  }
  o[path[path.length - 1]] = value;
}

/**
 * The flat draft of a Settings value. `sourceUrl` is the link the Sheet has (the input shows it
 * instead of the bare id as long as it names the same Sheet).
 */
export function draftFrom(settings, sourceUrl) {
  const d = {};
  for (const key of form.keys) d[key] = clone(read(settings, PATH[key]));
  const id = settings.source.sheetId;
  if (sourceUrl && sheetIdFrom(sourceUrl) === id) d["source.sheetId"] = sourceUrl;
  return d;
}

/**
 * The draft as the kernel compares it. The Sheet field holds what was typed; what counts is the
 * id in it, so pasting the link of the saved Sheet is not a change. Text with no id in it stays
 * as typed (it differs, and errorsOf names it).
 */
export function effective(draft) {
  const eff = { ...draft };
  const raw = String(draft["source.sheetId"] == null ? "" : draft["source.sheetId"]).trim();
  const id = sheetIdFrom(raw);
  eff["source.sheetId"] = id !== "" || raw === "" ? id : raw;
  return eff;
}

/** The draft keys whose value differs from the saved draft, in registry order. */
export function changedKeys(savedDraft, draft) {
  return form.changedFields(effective(savedDraft), effective(draft));
}

/** The nested partial Settings that applies the draft over the saved one: only what changed. */
export function toPatch(savedDraft, draft) {
  const flat = form.settingsPatch(effective(savedDraft), effective(draft));
  const patch = {};
  for (const key of Object.keys(flat)) put(patch, PATH[key], clone(flat[key]));
  return patch;
}

/** Which sections a patch touches. */
export const sectionsOf = (patch) => Object.keys(patch || {});

/** A new draft with one key set. */
export function setKey(draft, key, value) {
  if (!Object.prototype.hasOwnProperty.call(REGISTRY, key)) throw new Error("Unknown setting " + key);
  return { ...draft, [key]: clone(value) };
}

// ------------------------------------------------------------------------------------ session

/**
 * A settings session: the saved settings, the draft being edited and what the server said about
 * the Sheet. `baseGen` is the generation the draft was opened against.
 */
export function newSession(resp, sourceUrl) {
  const savedDraft = draftFrom(resp.settings, sourceUrl);
  return {
    saved: resp.settings,
    savedDraft,
    draft: clone(savedDraft),
    baseGen: resp.cfgGen,
    headers: resp.headers || {},
    examples: resp.examples || {},
    tabNames: resp.tabNames || [],
  };
}

export const isDirty = (session) => !!session && changedKeys(session.savedDraft, session.draft).length > 0;

export const edit = (session, key, value) => ({ ...session, draft: setKey(session.draft, key, value) });

export const discard = (session) => ({ ...session, draft: clone(session.savedDraft) });

/** After a save: the server's settings become the saved state and the draft shows them. */
export function committed(session, settings, cfgGen, sourceUrl) {
  const savedDraft = draftFrom(settings, sourceUrl);
  return { ...session, saved: settings, savedDraft, draft: clone(savedDraft), baseGen: cfgGen };
}

// ------------------------------------------------------------------------------------ problems

const BAD_LINK = "The Google Sheet link is not valid: it should contain the sheet id.";

/** The draft key a validation sentence of the domain belongs to, or null. */
export function keyForSentence(sentence) {
  let m = /^The Applications tab needs a name/.exec(sentence);
  if (m) return "source.tabs.apps.name";
  m = /^The (\w+) tab joins on/.exec(sentence);
  if (m) {
    const tk = TAB_KEYS.find((k) => TAB_NAMES[k] === m[1]);
    if (tk) return "source.tabs." + tk + ".joinColumn";
  }
  if (/^The Application id field/.test(sentence)) return "fields.id";
  if (/^The Name field/.test(sentence)) return "fields.name";
  m = /^“(.+)” is mapped to a column of a tab that is not used/.exec(sentence);
  if (m) {
    const def = FIELDS.find((d) => d.label === m[1]);
    return def ? "fields." + def.key : null;
  }
  if (/^The Google Sheet link/.test(sentence)) return "source.sheetId";
  if (/^The hidden-name prefix/.test(sentence)) return "display.hidePrefix";
  m = /^The (source|fields|rules|display) settings are too large/.exec(sentence);
  if (m) return form.keys.find((k) => REGISTRY[k].tab === m[1]) || null;
  return null;
}

/**
 * What stops a save: {errors: {draftKey: sentence}, problems: [sentence]}. The sentences are the
 * domain's own, run over the saved settings with the draft's patch applied, so the server will
 * say the same thing; `errors` is what the kernel reads to mark a tab invalid.
 */
export function errorsOf(session) {
  const errors = {};
  const problems = [];
  const raw = String(session.draft["source.sheetId"] == null ? "" : session.draft["source.sheetId"]).trim();
  if (raw !== "" && sheetIdFrom(raw) === "") {
    errors["source.sheetId"] = BAD_LINK;
    problems.push(BAD_LINK);
  }
  const merged = applyPatch(session.saved, toPatch(session.savedDraft, session.draft));
  for (const sentence of validateSettings(merged)) {
    if (problems.indexOf(sentence) < 0) problems.push(sentence);
    const key = keyForSentence(sentence);
    if (key && !Object.prototype.hasOwnProperty.call(errors, key)) errors[key] = sentence;
  }
  return { errors, problems };
}

/** The fields of the draft with no column chosen, as catalogue entries. */
/** The draft's choice for a pillar's tab picker: '@same', '' (not used) or a tab name. */
export const SAME_TAB = "@same";
export function tabChoice(draft, k) {
  if (k !== "apps" && draft["source.tabs." + k + ".sameTab"]) return SAME_TAB;
  return draft["source.tabs." + k + ".name"];
}

/** Choose a pillar's tab: the Applications tab itself, no tab, or a named tab. */
export function chooseTab(session, k, value) {
  const base = k === "apps" ? session : edit(session, "source.tabs." + k + ".sameTab", value === SAME_TAB);
  return value === SAME_TAB ? base : edit(base, "source.tabs." + k + ".name", value);
}

export const unmappedFields = (draft) => FIELDS.filter((d) => draft["fields." + d.key] === "");

/** Per tab: {dirty, invalid, warn}. Access owns no batched field, so it is never dirty here. */
export function tabMarks(session, errors) {
  const status = form.tabStatus(effective(session.draft), effective(session.savedDraft), errors || {}, form.TAB_FIELDS);
  const out = {};
  for (const t of SETTINGS_TABS) {
    const s = status[t.key] || { dirty: false, invalid: false };
    out[t.key] = { dirty: s.dirty, invalid: s.invalid, warn: t.key === "fields" && unmappedFields(session.draft).length > 0 };
  }
  return out;
}

/** The save bar's content: how many changes and which tabs hold them. */
export function barModel(session) {
  const changed = changedKeys(session.savedDraft, session.draft);
  const tabs = [];
  for (const c of form.changeSummary(changed)) {
    if (!tabs.some((t) => t.tab === c.tab)) tabs.push({ tab: c.tab, label: c.tabLabel });
  }
  return { count: changed.length, text: form.changeCountText(changed), tabs, changed };
}

/** Friendly names for the dotted paths the server clamped or dropped ('source.cacheMinutes'). */
export function clampedLabels(paths) {
  const out = [];
  for (const p of paths || []) {
    const key = form.keys.find((k) => {
      const joined = PATH[k].join(".");
      return p === joined || p.indexOf(joined + ".") === 0;
    });
    const label = key ? REGISTRY[key].label : p;
    if (out.indexOf(label) < 0) out.push(label);
  }
  return out;
}

/** The toast sentence for a save that was clamped, or '' when nothing was. */
export function clampedText(paths) {
  const labels = clampedLabels(paths);
  return labels.length ? "Saved. Adjusted to the allowed range: " + labels.join(", ") + "." : "";
}

// ------------------------------------------------------------------------------------ guard

let guarded = false;

/**
 * Ask before the page is closed or reloaded while the draft has unsaved changes. The draft
 * outlives the settings page (it is kept in the store), so the guard is installed once on the
 * document body and asks the question for the whole session.
 */
export function guardSettings(isDirtyNow) {
  if (guarded || typeof document === "undefined" || !document.body) return false;
  guarded = true;
  guardUnsaved(document.body, isDirtyNow);
  return true;
}

/** Test seam. */
export function resetGuardForTest() {
  guarded = false;
}
