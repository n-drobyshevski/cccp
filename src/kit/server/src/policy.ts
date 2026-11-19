// The data policy: one switch, dataClass, decides how strictly an app treats its data, and every
// other piece (access, boot, exports, audit, error detail) reads the frozen policy it returns.
//
//   export const POLICY = dataPolicy(DATA_CLASS);                       // src/server/config.ts
//   export const POLICY = dataPolicy("confidential", { auditReads: false }); // a named override
//
// FAIL CLOSED. Anything other than exactly "internal" reads as "confidential". An override key
// that is not a policy field, or a value of the wrong kind, throws when the policy is built, so a
// typo cannot ship as a silent weakening. `overridden` lists the keys whose value differs from the
// class default, and weakenedKeys() names those that are less strict than it, for a contract test
// that requires each one to be explained.
//
// What the browser may know goes through publicPolicy(): the class, whether it may persist data,
// and whether this caller may export. Nothing else of the policy is sent.

import { roleAllows, type Role } from "./roles";

export type DataClass = "internal" | "confidential";
/** Who may export: any allowed caller, admins and the owner, or nobody. */
export type ExportAudience = "viewer" | "admin" | "off";

export interface DataPolicy {
  dataClass: DataClass;
  /** The access mode "org" (anyone in the domain) may be chosen. */
  allowOrg: boolean;
  /** Deny everyone until the owner address is pinned by editor-run setup. */
  requireOwnerPin: boolean;
  /** The data may be inlined in the served page (else it comes by RPC after the access check). */
  inlineData: boolean;
  /** The browser may keep data in localStorage. */
  clientPersist: boolean;
  /** Who may export to a new Google Sheet. */
  exportSheet: ExportAudience;
  /** Who may download a CSV or XLSX file. */
  exportFile: ExportAudience;
  /** The role an exported Sheet is shared with. */
  exportShare: "writer" | "reader";
  /** Readers of an exported Sheet cannot copy, print or download it. */
  exportNoCopy: boolean;
  /** Where audit entries go: console lines only, or console lines and the audit sheet. */
  audit: "console" | "sheet";
  /** Reads of the data are audited too (rate-limited per viewer). */
  auditReads: boolean;
  /** The lowest role that sees the detail of an unexpected error. */
  errorDetail: "admin" | "owner";
  /** The keys an override changed from the class default. */
  overridden: string[];
}

export type PolicyFields = Omit<DataPolicy, "dataClass" | "overridden">;
export type PolicyOverrides = Partial<PolicyFields>;

const DEFAULTS: Readonly<Record<DataClass, Readonly<PolicyFields>>> = Object.freeze({
  internal: Object.freeze({
    allowOrg: true,
    requireOwnerPin: false,
    inlineData: true,
    clientPersist: true,
    exportSheet: "viewer",
    exportFile: "viewer",
    exportShare: "writer",
    exportNoCopy: false,
    audit: "console",
    auditReads: false,
    errorDetail: "admin",
  }),
  confidential: Object.freeze({
    allowOrg: false,
    requireOwnerPin: true,
    inlineData: false,
    clientPersist: false,
    exportSheet: "admin",
    exportFile: "admin",
    exportShare: "reader",
    exportNoCopy: true,
    audit: "sheet",
    auditReads: true,
    errorDetail: "owner",
  }),
});

/**
 * Strictness of every allowed value, per field: a higher number is stricter. A boolean field is
 * keyed by "true" and "false".
 */
const STRICTNESS: Readonly<Record<keyof PolicyFields, Readonly<Record<string, number>>>> = Object.freeze({
  allowOrg: { false: 1, true: 0 },
  requireOwnerPin: { false: 0, true: 1 },
  inlineData: { false: 1, true: 0 },
  clientPersist: { false: 1, true: 0 },
  exportSheet: { viewer: 0, admin: 1, off: 2 },
  exportFile: { viewer: 0, admin: 1, off: 2 },
  exportShare: { writer: 0, reader: 1 },
  exportNoCopy: { false: 0, true: 1 },
  audit: { console: 0, sheet: 1 },
  auditReads: { false: 0, true: 1 },
  errorDetail: { admin: 0, owner: 1 },
});

const FIELDS = Object.keys(STRICTNESS) as (keyof PolicyFields)[];
const BOOLEAN_FIELDS = new Set<keyof PolicyFields>(["allowOrg", "requireOwnerPin", "inlineData", "clientPersist", "exportNoCopy", "auditReads"]);

/** "internal" for exactly that string, else "confidential". */
export function dataClassOf(v: unknown): DataClass {
  return v === "internal" ? "internal" : "confidential";
}

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** The frozen policy for a class, with optional overrides. Throws on an unknown key or value. */
export function dataPolicy(dataClass: unknown, overrides: PolicyOverrides = {}): Readonly<DataPolicy> {
  const cls = dataClassOf(dataClass);
  const base = DEFAULTS[cls];
  const out: Record<string, unknown> = { dataClass: cls };
  for (const f of FIELDS) out[f] = base[f];
  const overridden: string[] = [];
  if (overrides !== undefined && overrides !== null) {
    if (typeof overrides !== "object" || Array.isArray(overrides)) throw new Error("dataPolicy: overrides must be an object.");
    for (const k of Object.keys(overrides)) {
      if (!has(STRICTNESS, k)) throw new Error("dataPolicy: unknown policy field " + JSON.stringify(k) + ".");
      const f = k as keyof PolicyFields;
      const v = (overrides as Record<string, unknown>)[k];
      if (v === undefined) continue;
      const okValue = BOOLEAN_FIELDS.has(f) ? typeof v === "boolean" : typeof v === "string" && has(STRICTNESS[f], v);
      if (!okValue) throw new Error("dataPolicy: " + JSON.stringify(v) + " is not a value of " + f + ".");
      out[f] = v;
      if (v !== base[f]) overridden.push(f);
    }
  }
  out.overridden = Object.freeze(overridden);
  return Object.freeze(out) as unknown as Readonly<DataPolicy>;
}

/** The overridden keys whose value is less strict than the class default. */
export function weakenedKeys(policy: Readonly<DataPolicy>): string[] {
  const base = DEFAULTS[dataClassOf(policy.dataClass)];
  return FIELDS.filter((f) => {
    const scale = STRICTNESS[f];
    const have = scale[String(policy[f])];
    const want = scale[String(base[f])]!;
    // An unknown value is never stricter than the default.
    return have === undefined || have < want;
  });
}

/** True when any field is less strict than the class default. */
export function isWeaker(policy: Readonly<DataPolicy>): boolean {
  return weakenedKeys(policy).length > 0;
}

/** Whether a caller of this role may use an export the policy sets to `audience`. */
export function exportAllowed(audience: ExportAudience, role: Role | null): boolean {
  if (audience === "viewer") return roleAllows(role, "viewer");
  if (audience === "admin") return roleAllows(role, "admin");
  return false;
}

export interface PublicPolicy {
  dataClass: DataClass;
  clientPersist: boolean;
  canExportSheet: boolean;
  canExportFile: boolean;
}

/** The subset of the policy the browser needs, for this caller. Goes in the live boot part. */
export function publicPolicy(policy: Readonly<DataPolicy>, role: Role | null): PublicPolicy {
  return {
    dataClass: dataClassOf(policy.dataClass),
    clientPersist: policy.clientPersist === true,
    canExportSheet: exportAllowed(policy.exportSheet, role),
    canExportFile: exportAllowed(policy.exportFile, role),
  };
}
