// The diagnostics report. It NEVER throws: every section is gathered on its own, a section that
// fails is reported by name in `failures` and the rest still comes back. It is what the admin
// Settings page shows, what api_getDiagnostics returns and what deploymentDiagnostic() prints.

import { payloadBytes, REGISTER_WARN_BYTES, REGISTER_WARN_ROWS } from "../domain/payload";
import { SECTION_PROPS } from "../domain/settings";
import { BUILD_ID } from "../vendor/gas_shared/server/buildInfo";
import * as access from "./access";
import { recentErrors, utf8ByteLength } from "./errors";
import { getProp, PROP_KEYS } from "./props";
import { peekRegisterEntry, registerEntry } from "./registerStore";
import { cacheKey, cfgGen, dataVersion } from "./serverCache";
import { loadSettings } from "./settingsStore";

export interface DiagnosticsReport {
  generatedAt: string;
  buildId: string;
  owner: string;
  mode: string;
  listSizes: { users: number | null; admins: number | null };
  source: {
    sheetId: string;
    title: string;
    tz: string;
    tabs: Array<{ key: string; name: string; rows: number; found: boolean; missingHeaders: string[]; unmatched: number; detected: boolean; sameTab: boolean; columnsFound: number | null; columnsMapped: number | null }>;
  } | null;
  issues: Record<string, number> | null;
  versions: { dataVersion: number | null; cfgGen: number | null };
  cache: { registerWarm: boolean | null; keys: { register: string | null; core: string | null } };
  register: { bytes: number | null; rows: number | null; warnings: string[] };
  propertyBytes: Record<string, number | null>;
  recentErrors: Array<{ ts: string; op: string; kind: string; message: string }>;
  failures: string[];
}

export function diagnosticsReport(): DiagnosticsReport {
  const failures: string[] = [];
  const safe = <T>(section: string, fn: () => T, fallback: T): T => {
    try {
      return fn();
    } catch (e) {
      try {
        failures.push(section + ": " + String(e instanceof Error ? e.message : e).slice(0, 200));
      } catch (_e2) {
        failures.push(section);
      }
      return fallback;
    }
  };

  const generatedAt = safe("clock", () => new Date().toISOString(), "");
  const owner = safe("owner", () => access.ownerEmail(), "");
  const mode = safe("mode", () => access.accessMode(), "unknown");
  const listSizes = {
    users: safe("users", () => access.currentUsers().length, null as number | null),
    admins: safe("admins", () => access.currentAdmins().length, null as number | null),
  };

  const settings = safe("settings", () => loadSettings(), null);
  const entry = safe("register", () => (settings && settings.source.sheetId !== "" ? registerEntry() : null), null);

  const source: DiagnosticsReport["source"] = settings
    ? {
        sheetId: settings.source.sheetId,
        title: entry ? entry.meta.title : "",
        tz: entry ? entry.meta.tz : "",
        tabs: entry
          ? entry.meta.tabs.map((t) => ({ key: t.key, name: t.name, rows: t.rows, found: t.gid !== null, missingHeaders: t.missingHeaders, unmatched: t.unmatched, detected: t.detected === true, sameTab: t.sameTab === true, columnsFound: t.columnsFound ?? null, columnsMapped: t.columnsMapped ?? null }))
          : [],
      }
    : null;
  const issues = entry
    ? {
        missingHeaders: entry.meta.issues.missingHeaders.length,
        missingTabs: entry.meta.issues.missingTabs.length,
        unmatched: entry.meta.issues.unmatched.length,
        duplicateIds: entry.meta.issues.duplicateIds.length,
        unparseable: entry.meta.issues.unparseable.length,
        unmapped: entry.meta.issues.unmapped.filter((u) => u.reason !== "not provided yet").length,
        notProvidedYet: entry.meta.issues.unmapped.filter((u) => u.reason === "not provided yet").length,
      }
    : null;

  const registerBytes = entry ? safe("registerBytes", () => payloadBytes(entry.register), null as number | null) : null;
  const registerRows = entry ? safe("registerRows", () => entry.register.codec.rows.length, null as number | null) : null;
  const warnings: string[] = [];
  if (registerBytes !== null && registerBytes > REGISTER_WARN_BYTES) warnings.push("The register is " + registerBytes + " bytes: above " + REGISTER_WARN_BYTES + ".");
  if (registerRows !== null && registerRows > REGISTER_WARN_ROWS) warnings.push("The register has " + registerRows + " rows: above " + REGISTER_WARN_ROWS + ".");

  const propertyBytes: Record<string, number | null> = {};
  const keys = [PROP_KEYS.allowedUsers, PROP_KEYS.allowedAdmins, ...Object.values(SECTION_PROPS), PROP_KEYS.sharedViews, "RECENT_ERRORS"];
  for (const k of keys) propertyBytes[k] = safe("prop " + k, () => utf8ByteLength(getProp(k) ?? ""), null as number | null);

  return {
    generatedAt, buildId: BUILD_ID, owner, mode, listSizes, source, issues,
    versions: { dataVersion: safe("dataVersion", () => dataVersion(), null as number | null), cfgGen: safe("cfgGen", () => cfgGen(), null as number | null) },
    cache: {
      registerWarm: safe("cache", () => peekRegisterEntry() !== undefined, null as boolean | null),
      keys: {
        register: safe("registerKey", () => cacheKey("register", undefined), null as string | null),
        core: safe("coreKey", () => cacheKey("core", undefined, "cfg"), null as string | null),
      },
    },
    register: { bytes: registerBytes, rows: registerRows, warnings },
    propertyBytes,
    recentErrors: safe("errors", () => recentErrors().slice(0, 10), []),
    failures,
  };
}

/** The report as plain text, for the editor's execution log. */
export function diagnosticsText(): string {
  let r: DiagnosticsReport;
  try {
    r = diagnosticsReport();
  } catch (e) {
    return "Diagnostics failed: " + String(e);
  }
  const lines = [
    "CCCP diagnostics " + r.generatedAt + " (build " + r.buildId + ")",
    "Owner " + r.owner + ", access mode " + r.mode + ", " + r.listSizes.users + " listed, " + r.listSizes.admins + " admins.",
    r.source ? "Sheet " + (r.source.title || "(not configured)") + " " + r.source.tz : "Sheet unknown",
  ];
  for (const t of r.source ? r.source.tabs : []) {
    const tail = t.sameTab
      ? " (" + t.key + ": same tab, " + t.columnsFound + " of " + t.columnsMapped + " columns provided yet)"
      : (t.detected ? " (detected)" : "") + (t.missingHeaders.length ? ", missing " + t.missingHeaders.join(", ") : "");
    lines.push("  " + t.name + ": " + (t.found ? t.rows + " rows" : "NOT FOUND") + tail);
  }
  lines.push("Versions data " + r.versions.dataVersion + ", settings " + r.versions.cfgGen + ". Register " + r.register.bytes + " bytes.");
  for (const w of r.register.warnings) lines.push("WARNING " + w);
  for (const f of r.failures) lines.push("FAILED " + f);
  for (const e of r.recentErrors) lines.push("error " + e.ts + " " + e.op + ": " + e.message);
  return lines.join("\n");
}
