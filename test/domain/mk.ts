import type { AppRecord } from "../../src/domain/types";

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
