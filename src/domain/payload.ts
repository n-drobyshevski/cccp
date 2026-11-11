import { decodeRows, encodeRows } from "../vendor/gas_shared/domain/snapshotCodec";
import type { EncodedTable } from "../vendor/gas_shared/domain/snapshotCodec";
import { FIELDS } from "./fields";
import type { AppRecord, DisplaySettings, FieldKey, Issues, RulesSettings, SavedView, Settings, TabKey } from "./types";

// The RPC payload shapes, and the register codec. Nothing viewer-specific lives in a type that is
// cached: BootstrapCore and RegisterPayload are viewer-free; BootstrapLive carries the viewer.

export const SCHEMA_VERSION = 1;
export const REGISTER_FORMAT = 1;
/** The register is inlined in the page only when it is warm in the cache and at most this big. */
export const REGISTER_INLINE_MAX_BYTES = 600_000;
/** Diagnostics warn above these. */
export const REGISTER_WARN_BYTES = 2_000_000;
export const REGISTER_WARN_ROWS = 10_000;

export interface SourceTabMeta {
  key: TabKey;
  name: string;
  gid: number | null;
  rows: number;
  /** Mapped headers that this tab lacks. */
  missingHeaders: string[];
  /** Rows whose key matches no application. */
  unmatched: number;
}

export interface SourceMeta {
  title: string;
  url: string;
  tz: string;
  loadedAt: string;
  dataVersion: number;
  tabs: SourceTabMeta[];
  issues: Issues;
}

/** The part of Settings every viewer needs: rules and display, field labels and what is mapped. */
export interface PublicSettings {
  rules: RulesSettings;
  display: DisplaySettings;
  fieldLabels: Record<FieldKey, string>;
  /** true when the field has a column that exists in the Sheet. */
  mapped: Record<FieldKey, boolean>;
}

/** Cached, identical for every viewer. */
export interface BootstrapCore {
  schemaVersion: number;
  sourceMeta: SourceMeta;
  publicSettings: PublicSettings;
  sharedViews: SavedView[];
}

export type Role = "viewer" | "admin" | "owner";

export interface Viewer {
  email: string;
  role: Role;
  canEditSettings: boolean;
  canEditAdmins: boolean;
  canEditSource: boolean;
  canEditMode: boolean;
}

/** Computed per request, never cached. */
export interface BootstrapLive {
  viewer: Viewer;
  serviceUrl: string;
  buildId: string;
  /** yyyy-MM-dd in the Sheet's time zone. */
  today: string;
  cfgGen: number;
}

/** The whole register as the client receives it. */
export interface RegisterPayload {
  v: number;
  loadedAt: string;
  dataVersion: number;
  codec: EncodedTable;
  strings: string[];
}

export interface BootstrapResponse {
  core: BootstrapCore;
  live: BootstrapLive;
  /** Present only when the register was warm in the cache and small enough. */
  register?: RegisterPayload;
}

export interface SettingsResponse {
  settings: Settings;
  headers: Partial<Record<TabKey, string[]>>;
  examples: Partial<Record<TabKey, Record<string, string>>>;
  cfgGen: number;
}

export interface SaveSettingsResponse {
  settings: Settings;
  cfgGen: number;
  clamped: string[];
}

export function buildPublicSettings(settings: Settings, mapped: Record<FieldKey, boolean>): PublicSettings {
  const fieldLabels = {} as Record<FieldKey, string>;
  for (const d of FIELDS) fieldLabels[d.key] = d.label;
  return { rules: settings.rules, display: settings.display, fieldLabels, mapped };
}

// ------------------------------------------------------------------------------------ codec

type Row = Record<string, unknown>;

/** Columnar, dictionary-encoded register. Records are plain JSON, so the round trip is exact. */
export function encodeRegister(apps: readonly AppRecord[], meta: { loadedAt: string; dataVersion: number }): RegisterPayload {
  const strings: string[] = [];
  const codec = encodeRows(apps as unknown as Row[], strings, new Map());
  return { v: REGISTER_FORMAT, loadedAt: meta.loadedAt, dataVersion: meta.dataVersion, codec, strings };
}

export function decodeRegister(p: RegisterPayload): AppRecord[] {
  if (!p || p.v !== REGISTER_FORMAT) throw new Error("Unsupported register format");
  return decodeRows(p.codec, p.strings) as unknown as AppRecord[];
}

/** UTF-8 bytes of the JSON a payload would take on the wire. */
export function payloadBytes(p: unknown): number {
  const s = JSON.stringify(p) ?? "";
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
