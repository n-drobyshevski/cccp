import type { AppRecord, Settings } from "../../src/domain/types";

export function mk(over: Partial<AppRecord> = {}): AppRecord {
  return {
    id: "x", name: "X", domain: "NO DOMAIN", subdomain: null, supportGroup: null, owner: null, backupOwner: null,
    securityOfficer: null, lifecycle: null, typology: null, tier: null, exposed: null, lastPentest: null,
    findingsText: null, findingsCritical: null, findingsHigh: null, ciat: { c: null, i: null, a: null, t: null },
    personalData: null, personalSensitive: null, companySensitive: null, securityCheck: null, lastAudit: null,
    auditResult: null, auditMajor: null, mtd: null, rto: null, rpo: null, lastDrpTest: null, drpResult: null,
    hosting: null, sso: null, internalUsers: null, externalUsers: null, _row: {}, ...over,
  };
}

/** The pre-same-tab defaults: every pillar reads from its own tab (CIAT, Audits, DRP, Platform). */
export function separateTabs(s: Settings): Settings {
  const names = { ciat: "CIAT", aud: "Audits", drp: "DRP", plat: "Platform" } as const;
  for (const k of ["ciat", "aud", "drp", "plat"] as const) s.source.tabs[k] = { ...s.source.tabs[k], name: names[k], sameTab: false };
  return s;
}
