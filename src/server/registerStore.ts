// The register: read the source (sourceSheet.ts), assemble it, encode it, cache it.
//
// One cache entry per DATA_VERSION holds the encoded register AND the source facts derived
// from the same read (title, tabs, issues), so the bootstrap core never needs a second read.
// Both parts are viewer-free. The entry lives for `cacheMinutes`; an admin reload and any
// source or fields save make it unreachable by bumping DATA_VERSION.

import { assemble, type TabData, type TabsInput } from "../domain/assemble";
import { REGISTER_FORMAT, encodeRegister, type RegisterPayload, type SourceMeta, type SourceTabMeta } from "../domain/payload";
import { FIELDS } from "../domain/fields";
import type { Issues } from "../domain/types";
import { TAB_KEYS } from "../domain/types";
import { markRecorded, recordError } from "./errors";
import { withScriptLock } from "./locks";
import { cached, dataVersion, bumpDataVersion, peekCached, primeCached } from "./serverCache";
import { loadSettings } from "./settingsStore";
import { readTabs } from "./sourceSheet";

export interface RegisterEntry {
  register: RegisterPayload;
  meta: SourceMeta;
}

const NAME = "register";
export const UNREACHABLE = "Data source unreachable";

const noIssues = (): Issues => ({ missingHeaders: [], missingTabs: [], unmatched: [], duplicateIds: [], unparseable: [], unmapped: [] });

function nowIso(): string {
  return new Date().toISOString();
}

function build(): { entry: RegisterEntry; ttlSec: number } {
  const settings = loadSettings();
  const ttlSec = settings.source.cacheMinutes * 60;
  const loadedAt = nowIso();
  const dv = dataVersion();
  if (settings.source.sheetId === "") {
    const meta: SourceMeta = { title: "", url: "", tz: safeTz(), loadedAt, dataVersion: dv, tabs: [], issues: noIssues() };
    return { entry: { register: encodeRegister([], { loadedAt, dataVersion: dv }), meta }, ttlSec };
  }
  let read;
  try {
    read = readTabs(settings.source, { idHeader: settings.fields.id.header });
  } catch (e) {
    recordError("register", e);
    const err = new Error(UNREACHABLE);
    markRecorded(err);
    throw err;
  }
  const input: TabsInput = {};
  const tabs: SourceTabMeta[] = [];
  const result = (() => {
    for (const k of TAB_KEYS) {
      const t = read.tabs[k];
      input[k] = t && t.found ? ({ name: t.name, headers: t.headers, rows: t.rows } as TabData) : null;
    }
    return assemble(input, settings);
  })();
  const countRows = (t: { rows: Array<Array<string | number | boolean | null>> }): number =>
    t.rows.filter((r) => r.some((c) => c !== null && String(c).trim() !== "")).length;
  for (const k of TAB_KEYS) {
    const same = k !== "apps" && settings.source.tabs[k].sameTab;
    const t = same ? read.tabs.apps : read.tabs[k];
    if (!t) continue;
    const entry: SourceTabMeta = {
      key: k,
      name: t.name,
      gid: t.gid,
      rows: countRows(t),
      missingHeaders: result.issues.missingHeaders.filter((m) => m.tab === k).map((m) => m.header),
      unmatched: result.issues.unmatched.filter((u) => u.tab === k).reduce((n, u) => n + u.count, 0),
    };
    if (k === "apps" && t.detected) entry.detected = true;
    if (same) {
      const mapped = FIELDS.filter((d) => settings.fields[d.key].binding === k && settings.fields[d.key].header !== "");
      const absent = mapped.filter((d) => result.issues.unmapped.some((u) => u.field === d.key && u.reason === "not provided yet")).length;
      entry.sameTab = true;
      entry.columnsMapped = mapped.length;
      entry.columnsFound = mapped.length - absent;
    }
    tabs.push(entry);
  }
  const meta: SourceMeta = { title: read.title, url: read.url, tz: read.tz, loadedAt, dataVersion: dv, tabs, issues: result.issues };
  return { entry: { register: encodeRegister(result.apps, { loadedAt, dataVersion: dv }), meta }, ttlSec };
}

function safeTz(): string {
  try {
    return Session.getScriptTimeZone() || "Etc/GMT";
  } catch (_e) {
    return "Etc/GMT";
  }
}

/** The register entry: from the cache within the TTL, else read, assemble, encode and cache. */
export function registerEntry(): RegisterEntry {
  let ttl = 600;
  return cached<RegisterEntry>(NAME, undefined, () => {
    const b = build();
    ttl = b.ttlSec;
    return b.entry;
  }, () => ttl);
}

/** The entry only when it is warm; never reads the Sheet. */
export function peekRegisterEntry(): RegisterEntry | undefined {
  const hit = peekCached(NAME, undefined) as RegisterEntry | undefined;
  return hit && hit.register && hit.register.v === REGISTER_FORMAT ? hit : undefined;
}

/** api_getRegister: the whole register, encoded. */
export function getRegisterPayload(): RegisterPayload {
  return registerEntry().register;
}

/**
 * Admin reload: under the lock, bump DATA_VERSION so every older entry is unreachable, read
 * the Sheet again and prime the cache. Returns the fresh source facts.
 */
export function reloadRegister(): SourceMeta {
  return withScriptLock(() => {
    bumpDataVersion();
    const { entry, ttlSec } = build();
    primeCached(NAME, undefined, entry, ttlSec);
    return entry.meta;
  });
}

