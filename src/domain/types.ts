// Shared types of the pure domain tree. Everything here is plain data: no classes, no GAS or DOM
// types, so the same module compiles into the server bundle and the client bundle.

/** The five source tabs a field can be bound to. */
export type TabKey = "apps" | "ciat" | "aud" | "drp" | "plat";
export const TAB_KEYS: readonly TabKey[] = ["apps", "ciat", "aud", "drp", "plat"];

export type Pillar = "cyber" | "compliance" | "continuity" | "platform";
export const PILLARS: readonly Pillar[] = ["cyber", "compliance", "continuity", "platform"];

/** bad = a gap, warn = needs attention, ok = fine, none = no data. */
export type Status = "bad" | "warn" | "ok" | "none";

export type FieldKey =
  | "id" | "name" | "domain" | "subdomain" | "supportGroup" | "owner" | "backupOwner"
  | "securityOfficer" | "lifecycle" | "typology" | "tier"
  | "exposed" | "hosting" | "sso" | "internalUsers" | "externalUsers"
  | "ciatC" | "ciatI" | "ciatA" | "ciatT" | "personalData" | "personalSensitive"
  | "companySensitive" | "securityCheck"
  | "lastPentest" | "findingsText" | "lastAudit" | "auditResult"
  | "mtd" | "rto" | "rpo" | "lastDrpTest" | "drpResult";

export type Level = 1 | 2 | 3 | 4;
export type DrpResult = "passed" | "failed";

/** One application. null means unknown and is never coerced to a default. */
export interface AppRecord {
  id: string;
  name: string;
  /** 'NO DOMAIN' when the cell is blank. */
  domain: string;
  subdomain: string | null;
  supportGroup: string | null;
  /** People are the names from the '... Name' columns. */
  owner: string | null;
  backupOwner: string | null;
  securityOfficer: string | null;
  lifecycle: string | null;
  typology: string | null;
  tier: Level | null;
  exposed: boolean | null;
  lastPentest: string | null;
  findingsText: string | null;
  findingsCritical: number | null;
  findingsHigh: number | null;
  ciat: { c: Level | null; i: Level | null; a: Level | null; t: Level | null };
  personalData: boolean | null;
  personalSensitive: boolean | null;
  companySensitive: boolean | null;
  securityCheck: string | null;
  lastAudit: string | null;
  auditResult: string | null;
  auditMajor: number | null;
  mtd: number | null;
  rto: number | null;
  rpo: number | null;
  lastDrpTest: string | null;
  drpResult: DrpResult | null;
  hosting: string | null;
  sso: boolean | null;
  internalUsers: string | null;
  externalUsers: string | null;
  /** Sheet row (1-based, the header is row 1, so the first data row is 2) per bound tab. */
  _row: Partial<Record<TabKey, number>>;
}

// ------------------------------------------------------------------------------------ settings

export type JoinOn = "id" | "name";
export type PickMode = "first" | "latest";

export interface TabBinding {
  /**
   * The Sheet tab this binding reads. '' means the tab is unused and its fields are null. Not read
   * while `sameTab` is true (kept so switching back remembers the last separate tab).
   */
  name: string;
  /**
   * Pillar bindings only (ciat, aud, drp, plat): the data is columns of the Applications tab, so
   * each application row joins to itself. Always false on the Applications binding. A missing
   * column is then "not provided yet", not an error.
   */
  sameTab: boolean;
  joinColumn: string;
  joinOn: JoinOn;
  pick: PickMode;
}

export interface SourceSettings {
  sheetId: string;
  cacheMinutes: number;
  tabs: Record<TabKey, TabBinding>;
}

export interface FieldMapping {
  binding: TabKey;
  /** '' means unmapped. */
  header: string;
}
export type FieldsSettings = Record<FieldKey, FieldMapping>;

export interface RuleParams {
  on?: boolean;
  months?: number;
  tiers?: number[];
}
export interface RulesSettings {
  version: 1;
  rules: Record<string, RuleParams>;
}

export type OpensOn = "overview" | "list" | "heatmap" | "landscape";
export type ThemeChoice = "system" | "light" | "dark";
export interface DisplaySettings {
  opensOn: OpensOn;
  theme: ThemeChoice;
  hidePrefix: string;
  hideEol: boolean;
}

export interface Settings {
  source: SourceSettings;
  fields: FieldsSettings;
  rules: RulesSettings;
  display: DisplaySettings;
}
export type SectionKey = keyof Settings;

/** A partial update: sections merge by key, objects deep-merge, everything else is replaced. */
export type SettingsPatch = { [K in SectionKey]?: Record<string, unknown> };

// ------------------------------------------------------------------------------------ issues

export interface MissingHeader { tab: TabKey; header: string; fields: FieldKey[] }
export interface UnmatchedRows { tab: TabKey; count: number; examples: string[] }
export interface DuplicateId { tab: TabKey; id: string; rows: number[] }
export interface Unparseable { tab: TabKey; field: FieldKey; count: number; examples: string[] }
export interface UnmappedField { field: FieldKey; reason: "no column chosen" | "tab not used" | "tab not found" | "column missing" | "not provided yet" }

/** What assemble found wrong with the source. Shown in Data source, Field mapping and diagnostics. */
export interface Issues {
  /** A mapped header that is not in its tab: the field is null. */
  missingHeaders: MissingHeader[];
  /** Configured tabs that were not in the workbook. */
  missingTabs: TabKey[];
  /** Rows of a side tab whose key matches no application. */
  unmatched: UnmatchedRows[];
  /** Repeated ids on the Apps tab, and on side tabs that pick the first row. */
  duplicateIds: DuplicateId[];
  /** Non-blank cells that could not be read as the field's type. */
  unparseable: Unparseable[];
  /** Every field that ends up null for every application because of the mapping. */
  unmapped: UnmappedField[];
}

// ------------------------------------------------------------------------------------ views

export type FacetKey = "dom" | "sd" | "tier" | "lc" | "so" | "gap" | "ty" | "h";

/** The list/heatmap/landscape view state. viewState.ts owns the URL and saved-view encoding. */
export interface ViewState {
  route: string;
  q: string;
  f: Partial<Record<FacetKey, string[]>>;
  sort: string;
  desc: boolean;
  cols: string[];
  metric: string;
}

export type SharedViewScope = "shared" | "personal";
export interface SavedView {
  id: string;
  name: string;
  scope: SharedViewScope;
  route: string;
  state: { q: string; f: Partial<Record<FacetKey, string[]>>; sort: string; cols: string[]; metric: string };
  by?: string;
  at?: string;
}
