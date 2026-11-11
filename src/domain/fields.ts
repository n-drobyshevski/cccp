import type { FieldKey, TabKey } from "./types";

// The field catalogue: every value CCCP reads from the Sheet, where it lives and how it is read.
// The Apps defaults are the headers of the real register export. The other defaults are the
// header strings of the approved Settings mockup, completed with the headers of the dev workbook
// where the mockup left them blank (so a fresh install maps what the mockup describes).

export type FieldType = "text" | "bool" | "date" | "tier" | "level" | "hours" | "result";
export type FieldGroup = "Identity" | "Cyber" | "Compliance" | "Continuity" | "Platform";
/**
 * Fields of one pickGroup are taken together from one row of a tab that has several rows per
 * application. With pick 'latest' that row is the one with the greatest date of the group.
 */
export type PickGroup = "pentest" | "audit" | "drp";

export interface FieldDef {
  key: FieldKey;
  label: string;
  group: FieldGroup;
  binding: TabKey;
  type: FieldType;
  /** Counts towards the completeness percentage (the lx.ext.html QF groups). */
  mandatory: boolean;
  defaultHeader: string;
  pickGroup?: PickGroup;
}

const f = (
  key: FieldKey, label: string, group: FieldGroup, binding: TabKey, type: FieldType,
  defaultHeader: string, mandatory = false, pickGroup?: PickGroup,
): FieldDef => (pickGroup ? { key, label, group, binding, type, mandatory, defaultHeader, pickGroup } : { key, label, group, binding, type, mandatory, defaultHeader });

/** In display order: the Field mapping page groups by `group` in this order. */
export const FIELDS: readonly FieldDef[] = [
  f("id", "Application id", "Identity", "apps", "text", "UUID"),
  f("name", "Name", "Identity", "apps", "text", "Name"),
  f("domain", "Domain", "Identity", "apps", "text", "Domain"),
  f("subdomain", "Subdomain", "Identity", "apps", "text", "Subdomain"),
  f("supportGroup", "Support group", "Identity", "apps", "text", "Support Group"),
  f("owner", "Owner", "Identity", "apps", "text", "Owner Name", true),
  f("backupOwner", "Backup owner", "Identity", "apps", "text", "Backup Owner Name", true),
  f("lifecycle", "Lifecycle", "Identity", "apps", "text", "Lifecycle"),
  f("tier", "Tier", "Identity", "apps", "tier", "Tiering", true),

  f("exposed", "Front exposed on internet", "Cyber", "plat", "bool", "Application Front Is Exposed on Internet", true),
  f("lastPentest", "Last pentest", "Cyber", "aud", "date", "Last Pentest", true, "pentest"),
  f("findingsText", "Open findings", "Cyber", "aud", "text", "Pentest Findings", false, "pentest"),
  f("securityOfficer", "Security officer", "Cyber", "apps", "text", "Security Officer Name", true),

  f("ciatC", "Confidentiality", "Compliance", "ciat", "level", "Confidentiality level", true),
  f("ciatI", "Integrity", "Compliance", "ciat", "level", "Integrity Level"),
  f("ciatA", "Availability", "Compliance", "ciat", "level", "Availability Level"),
  f("ciatT", "Traceability", "Compliance", "ciat", "level", "Traceability Level"),
  f("personalData", "Personal data", "Compliance", "ciat", "bool", "Personal Data", true),
  f("personalSensitive", "Personal sensitive data", "Compliance", "ciat", "bool", "Personal Sensitive Data"),
  f("companySensitive", "Company sensitive data", "Compliance", "ciat", "bool", "Company Sensitive Data"),
  f("securityCheck", "Date of security check", "Compliance", "ciat", "date", "Date of Security Check", true),
  f("lastAudit", "Last audit", "Compliance", "aud", "date", "Last Audit", true, "audit"),
  f("auditResult", "Audit result", "Compliance", "aud", "text", "Audit Result", false, "audit"),

  f("mtd", "Max tolerable downtime", "Continuity", "drp", "hours", "Maximum Tolerable Downtime", true, "drp"),
  f("rto", "Recovery time objective", "Continuity", "drp", "hours", "Recovery Time Objectives", true, "drp"),
  f("rpo", "Recovery point objective", "Continuity", "drp", "hours", "Recovery Point Objectives", true, "drp"),
  f("lastDrpTest", "Last DRP test", "Continuity", "drp", "date", "Last DRP Test", true, "drp"),
  f("drpResult", "DRP test result", "Continuity", "drp", "result", "DRP Test Result", false, "drp"),

  f("hosting", "Hosting type", "Platform", "plat", "text", "Hosting Type", true),
  f("typology", "Typology", "Platform", "apps", "text", "Typology", true),
  f("sso", "Single sign-on", "Platform", "plat", "bool", "Single Sign-On - Availability", true),
  f("internalUsers", "Internal users", "Platform", "plat", "text", "How many internal users"),
  f("externalUsers", "External users", "Platform", "plat", "text", "How many external users"),
];

export const FIELD_BY_KEY: Readonly<Record<FieldKey, FieldDef>> = Object.fromEntries(FIELDS.map((d) => [d.key, d])) as Record<FieldKey, FieldDef>;
export const FIELD_KEYS: readonly FieldKey[] = FIELDS.map((d) => d.key);
export const GROUPS: readonly FieldGroup[] = ["Identity", "Cyber", "Compliance", "Continuity", "Platform"];

/** The date field that orders the rows of each pick group. */
export const PICK_DATE: Readonly<Record<PickGroup, FieldKey>> = { pentest: "lastPentest", audit: "lastAudit", drp: "lastDrpTest" };

export function fieldsOfTab(tab: TabKey): FieldDef[] {
  return FIELDS.filter((d) => d.binding === tab);
}

export function isFieldKey(k: unknown): k is FieldKey {
  return typeof k === "string" && Object.prototype.hasOwnProperty.call(FIELD_BY_KEY, k);
}
