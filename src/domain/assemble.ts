import { compareDays } from "./dates";
import { FIELDS, PICK_DATE } from "./fields";
import type { FieldDef, PickGroup } from "./fields";
import * as N from "./normalize";
import type {
  AppRecord, DuplicateId, FieldKey, Issues, MissingHeader, Settings, TabKey, UnmappedField,
  UnmatchedRows, Unparseable,
} from "./types";
import { TAB_KEYS } from "./types";

// Tab arrays plus settings in, AppRecord[] and issues out. Pure: the server reads the Sheet into
// plain arrays (sourceSheet.ts) and calls this; the client never needs it.

/** One tab as sourceSheet.ts returns it: row 1 as headers, the data rows below it. */
export interface TabData {
  name?: string;
  headers: readonly string[];
  /** Data rows, header row excluded: rows[0] is sheet row 2. Dates are 'yyyy-MM-dd' text. */
  rows: readonly (readonly unknown[])[];
}
export type TabsInput = Partial<Record<TabKey, TabData | null | undefined>>;

export interface AssembleResult {
  apps: AppRecord[];
  issues: Issues;
}

export const NO_DOMAIN = "NO DOMAIN";
const EXAMPLES = 3;

type Col = number | null;

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");

function headerIndex(headers: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  headers.forEach((h, i) => {
    const k = norm(String(h ?? ""));
    if (k !== "" && !m.has(k)) m.set(k, i);
  });
  return m;
}

function rowIsBlank(r: readonly unknown[]): boolean {
  for (const v of r) if (!N.isBlank(v)) return false;
  return true;
}

function readValue(def: FieldDef, raw: unknown): { v: unknown; bad: boolean } {
  let v: unknown;
  switch (def.type) {
    case "bool": v = N.bool(raw); break;
    case "date": v = N.day(raw); break;
    case "tier": v = N.tier(raw); break;
    case "level": v = N.level(raw); break;
    case "hours": v = N.hours(raw); break;
    case "result": v = N.drpResult(raw); break;
    default: v = N.text(raw);
  }
  return { v, bad: v === null && !N.isBlank(raw) };
}

export function assemble(tabs: TabsInput, settings: Settings): AssembleResult {
  const src = settings.source.tabs;
  const issues: Issues = { missingHeaders: [], missingTabs: [], unmatched: [], duplicateIds: [], unparseable: [], unmapped: [] };

  // ---- tab state
  type State = "unused" | "missing" | "ok";
  const state = {} as Record<TabKey, State>;
  const data = {} as Record<TabKey, TabData | null>;
  const hIdx = {} as Record<TabKey, Map<string, number>>;
  // A pillar bound to the Applications tab shares its state, data and headers (apps comes first).
  const same = {} as Record<TabKey, boolean>;
  for (const k of TAB_KEYS) {
    same[k] = k !== "apps" && src[k].sameTab;
    if (same[k]) {
      state[k] = state.apps;
      data[k] = data.apps;
      hIdx[k] = hIdx.apps;
      continue;
    }
    const d = tabs[k] ?? null;
    state[k] = src[k].name === "" ? "unused" : d ? "ok" : "missing";
    data[k] = state[k] === "ok" ? d : null;
    hIdx[k] = headerIndex(d ? d.headers : []);
    if (state[k] === "missing") issues.missingTabs.push(k);
  }

  // ---- field resolution
  const col = {} as Record<FieldKey, Col>;
  const missing = new Map<string, MissingHeader>();
  const addMissing = (tab: TabKey, header: string, field: FieldKey | null) => {
    const key = tab + "\u0000" + header;
    let e = missing.get(key);
    if (!e) missing.set(key, (e = { tab, header, fields: [] }));
    if (field && !e.fields.includes(field)) e.fields.push(field);
  };
  const unmapped: UnmappedField[] = [];
  for (const def of FIELDS) {
    const m = settings.fields[def.key];
    col[def.key] = null;
    if (m.header === "") unmapped.push({ field: def.key, reason: "no column chosen" });
    else if (state[m.binding] === "unused") unmapped.push({ field: def.key, reason: "tab not used" });
    else if (state[m.binding] === "missing") unmapped.push({ field: def.key, reason: "tab not found" });
    else {
      const at = hIdx[m.binding].get(norm(m.header));
      if (at === undefined) {
        // A pillar column that the Applications tab does not have yet is not an error.
        if (same[m.binding]) unmapped.push({ field: def.key, reason: "not provided yet" });
        else {
          addMissing(m.binding, m.header, def.key);
          unmapped.push({ field: def.key, reason: "column missing" });
        }
      } else col[def.key] = at;
    }
  }

  // ---- side-tab join columns
  const joinCol = {} as Record<TabKey, Col>;
  for (const k of TAB_KEYS) {
    joinCol[k] = null;
    if (state[k] !== "ok" || same[k]) continue;
    const at = hIdx[k].get(norm(src[k].joinColumn));
    if (at === undefined) {
      if (k !== "apps") addMissing(k, src[k].joinColumn, null);
    } else joinCol[k] = at;
  }

  // ---- unparseable bookkeeping
  const bad = new Map<string, Unparseable>();
  const noteBad = (tab: TabKey, field: FieldKey, raw: unknown) => {
    const key = tab + "\u0000" + field;
    let e = bad.get(key);
    if (!e) bad.set(key, (e = { tab, field, count: 0, examples: [] }));
    e.count++;
    const ex = String(raw).trim().slice(0, 40);
    if (e.examples.length < EXAMPLES && !e.examples.includes(ex)) e.examples.push(ex);
  };

  // ---- the Apps tab
  const apps: AppRecord[] = [];
  const appRows: (readonly unknown[])[] = [];
  const seen = new Map<string, number>();
  const dupRows = new Map<string, number[]>();
  const appsData = data.apps;
  if (appsData) {
    const cell = (r: readonly unknown[], key: FieldKey): unknown => (col[key] === null ? null : r[col[key]!]);
    appsData.rows.forEach((r, i) => {
      if (rowIsBlank(r)) return;
      const sheetRow = i + 2;
      const id = N.text(cell(r, "id")) ?? "row-" + sheetRow;
      const first = seen.get(id);
      if (first !== undefined) {
        const list = dupRows.get(id) ?? [first];
        list.push(sheetRow);
        dupRows.set(id, list);
        return;
      }
      seen.set(id, sheetRow);
      const rec = blankRecord(id);
      rec._row.apps = sheetRow;
      for (const def of FIELDS) {
        if (def.binding !== "apps" || def.key === "id") continue;
        const { v, bad: b } = readValue(def, cell(r, def.key));
        if (b) noteBad("apps", def.key, cell(r, def.key));
        setField(rec, def.key, v);
      }
      apps.push(rec);
      appRows.push(r);
    });
  }
  for (const [id, rows] of dupRows) issues.duplicateIds.push({ tab: "apps", id, rows } satisfies DuplicateId);

  // ---- pillars in the Applications tab: each application row joins to itself
  for (const k of TAB_KEYS) {
    if (!same[k] || state[k] !== "ok") continue;
    const defs = FIELDS.filter((d) => settings.fields[d.key].binding === k && col[d.key] !== null);
    apps.forEach((rec, i) => {
      const r = appRows[i]!;
      rec._row[k] = rec._row.apps!;
      for (const def of defs) {
        const raw = r[col[def.key]!];
        const { v, bad: b } = readValue(def, raw);
        if (b) noteBad(k, def.key, raw);
        setField(rec, def.key, v);
      }
    });
  }

  // ---- side tabs
  for (const k of TAB_KEYS) {
    if (k === "apps" || same[k] || state[k] !== "ok" || joinCol[k] === null) continue;
    const t = data[k]!;
    const jc = joinCol[k]!;
    const byName = src[k].joinOn === "name";
    const index = new Map<string, number[]>();
    const original = new Map<string, string>();
    t.rows.forEach((r, i) => {
      const raw = N.text(r[jc]);
      if (raw === null) return;
      const key = norm(raw);
      const list = index.get(key);
      if (list) list.push(i);
      else {
        index.set(key, [i]);
        original.set(key, raw);
      }
    });
    const appKeys = new Set(apps.map((a) => norm(byName ? a.name : a.id)));
    const um: UnmatchedRows = { tab: k, count: 0, examples: [] };
    for (const [key, rows] of index) {
      if (appKeys.has(key)) continue;
      um.count += rows.length;
      if (um.examples.length < 5) um.examples.push(original.get(key)!);
    }
    if (um.count > 0) issues.unmatched.push(um);
    if (src[k].pick === "first") {
      for (const [key, rows] of index) {
        if (rows.length > 1 && appKeys.has(key)) issues.duplicateIds.push({ tab: k, id: original.get(key)!, rows: rows.map((i) => i + 2) });
      }
    }

    const defs = FIELDS.filter((d) => settings.fields[d.key].binding === k && col[d.key] !== null);
    const latest = src[k].pick === "latest";
    const dateCol = (g: PickGroup): Col => {
      const dk = PICK_DATE[g];
      return settings.fields[dk].binding === k ? col[dk] : null;
    };
    const pickRow = (cands: number[], group: PickGroup | undefined): number => {
      if (!latest || !group || cands.length === 1) return cands[0]!;
      const dc = dateCol(group);
      if (dc === null) return cands[0]!;
      let best = cands[0]!;
      let bestDay = N.day(t.rows[best]![dc]);
      for (let c = 1; c < cands.length; c++) {
        const d = N.day(t.rows[cands[c]!]![dc]);
        if (d !== null && (bestDay === null || compareDays(d, bestDay) > 0)) {
          best = cands[c]!;
          bestDay = d;
        }
      }
      return best;
    };
    apps.forEach((rec) => {
      const cands = index.get(norm(byName ? rec.name : rec.id));
      if (!cands) return;
      rec._row[k] = cands[0]! + 2;
      for (const def of defs) {
        const row = t.rows[pickRow(cands, def.pickGroup)]!;
        const raw = row[col[def.key]!];
        const { v, bad: b } = readValue(def, raw);
        if (b) noteBad(k, def.key, raw);
        setField(rec, def.key, v);
      }
    });
  }

  // ---- derived counts
  for (const a of apps) {
    a.findingsCritical = N.findingCount(a.findingsText, "critical");
    a.findingsHigh = N.findingCount(a.findingsText, "high");
    a.auditMajor = N.findingCount(a.auditResult, "major");
  }

  issues.missingHeaders = [...missing.values()];
  issues.unparseable = [...bad.values()];
  issues.unmapped = unmapped;
  return { apps, issues };
}

function blankRecord(id: string): AppRecord {
  return {
    id, name: "(no name)", domain: NO_DOMAIN, subdomain: null, supportGroup: null, owner: null,
    backupOwner: null, securityOfficer: null, lifecycle: null, typology: null, tier: null,
    exposed: null, lastPentest: null, findingsText: null, findingsCritical: null, findingsHigh: null,
    ciat: { c: null, i: null, a: null, t: null }, personalData: null, personalSensitive: null,
    companySensitive: null, securityCheck: null, lastAudit: null, auditResult: null, auditMajor: null,
    mtd: null, rto: null, rpo: null, lastDrpTest: null, drpResult: null, hosting: null, sso: null,
    internalUsers: null, externalUsers: null, _row: {},
  };
}

function setField(rec: AppRecord, key: FieldKey, v: unknown): void {
  const r = rec as unknown as Record<string, unknown>;
  switch (key) {
    case "id": return;
    case "name": rec.name = (v as string | null) ?? "(no name)"; return;
    case "domain": rec.domain = (v as string | null) ?? NO_DOMAIN; return;
    case "ciatC": rec.ciat.c = v as AppRecord["ciat"]["c"]; return;
    case "ciatI": rec.ciat.i = v as AppRecord["ciat"]["i"]; return;
    case "ciatA": rec.ciat.a = v as AppRecord["ciat"]["a"]; return;
    case "ciatT": rec.ciat.t = v as AppRecord["ciat"]["t"]; return;
    default: r[key] = v;
  }
}
