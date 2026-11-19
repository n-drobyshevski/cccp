import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { genWorkbook, parseCsv, REAL_CSV, SYNTHETIC_CSV } from "../../dev/genTabs.mjs";
import type { TabsInput } from "../../src/domain/assemble";
import { assemble } from "../../src/domain/assemble";
import { FIELD_KEYS } from "../../src/domain/fields";
import { decodeRegister, encodeRegister, payloadBytes } from "../../src/domain/payload";
import { applyPatch, makeDefaultSettings } from "../../src/domain/settings";
import type { Settings, TabKey } from "../../src/domain/types";
import { separateTabs } from "./mk";
import { ZONES, useZone } from "./tz";

const D = (): Settings => separateTabs(makeDefaultSettings());
const APPS_H = ["UUID", "Name", "Domain", "Subdomain", "Support Group", "Owner Name", "Backup Owner Name", "Lifecycle", "Typology", "Tiering", "Security Officer Name"];
const appRow = (id: string, name: string, extra: Partial<Record<string, unknown>> = {}) =>
  APPS_H.map((h) => (h === "UUID" ? id : h === "Name" ? name : (extra[h] ?? "")));

describe.each(ZONES)("assemble under %s", (tz) => {
  useZone(tz);

  const aud = [
    ["UUID", "Last Pentest", "Pentest Findings", "Last Audit", "Audit Result"],
    // For a1: row 2 has the newest pentest, row 3 the newest audit.
    ["a1", "2025-06-01", "1 critical, 2 high", "2024-01-01", "Passed"],
    ["a1", "2024-01-01", "None", "2026-02-03", "2 major findings"],
    ["a2", "", "", "", ""],
    ["zz", "2025-01-01", "None", "", ""],
  ];

  function base(): TabsInput {
    return {
      apps: { headers: APPS_H, rows: [
        appRow("a1", "Alpha", { Domain: "Sales", Tiering: 1, "Owner Name": "Ann" }),
        appRow("a2", "Beta", { Tiering: "" }),
        appRow("a3", "Gamma"),
      ] },
      aud: { headers: aud[0] as string[], rows: aud.slice(1) },
    };
  }

  it("builds records with null for unknown and NO DOMAIN for a blank domain", () => {
    const { apps } = assemble(base(), D());
    expect(apps.map((a) => a.id)).toEqual(["a1", "a2", "a3"]);
    expect(apps[0]).toMatchObject({ name: "Alpha", domain: "Sales", tier: 1, owner: "Ann", subdomain: null, lifecycle: null });
    expect(apps[1]).toMatchObject({ domain: "NO DOMAIN", tier: null, owner: null });
    expect(apps[2]!.ciat).toEqual({ c: null, i: null, a: null, t: null });
    expect(apps[2]!.exposed).toBeNull();
    expect(apps[2]!.mtd).toBeNull();
  });

  it("records 1-based sheet rows (header is row 1)", () => {
    const { apps } = assemble(base(), D());
    expect(apps.map((a) => a._row.apps)).toEqual([2, 3, 4]);
    expect(apps[0]!._row.aud).toBe(2);
    expect(apps[2]!._row.aud).toBeUndefined();
  });

  it("picks the latest row per pick group, independently", () => {
    const { apps } = assemble(base(), D());
    const a1 = apps[0]!;
    expect(a1.lastPentest).toBe("2025-06-01");
    expect(a1.findingsText).toBe("1 critical, 2 high");
    expect(a1.findingsCritical).toBe(1);
    expect(a1.findingsHigh).toBe(2);
    expect(a1.lastAudit).toBe("2026-02-03");
    expect(a1.auditResult).toBe("2 major findings");
    expect(a1.auditMajor).toBe(2);
  });

  it("with pick first takes every group from the first row", () => {
    const s = applyPatch(D(), { source: { tabs: { aud: { pick: "first" } } } });
    const a1 = assemble(base(), s).apps[0]!;
    expect(a1.lastPentest).toBe("2025-06-01");
    expect(a1.lastAudit).toBe("2024-01-01");
    expect(a1.auditMajor).toBe(0);
  });

  it("latest falls back to the first row when no row has a date, and prefers a dated row", () => {
    const t = base();
    t.aud = { headers: aud[0] as string[], rows: [["a1", "", "x", "", ""], ["a1", "", "y", "", ""], ["a2", "", "p", "", ""], ["a2", "01/02/2025", "q", "", ""]] };
    const { apps } = assemble(t, D());
    expect(apps[0]!.findingsText).toBe("x");
    expect(apps[1]!.findingsText).toBe("q");
    expect(apps[1]!.lastPentest).toBe("2025-02-01");
  });

  it("joins by name, ignoring case and spacing", () => {
    const s = applyPatch(D(), { source: { tabs: { aud: { joinOn: "name", joinColumn: "App" } } } });
    const t = base();
    t.aud = { headers: ["App", "Last Pentest", "Pentest Findings", "Last Audit", "Audit Result"], rows: [["  alpha ", "2025-01-01", "None", "", ""], ["Nobody", "2025-01-01", "", "", ""]] };
    const r = assemble(t, s);
    expect(r.apps[0]!.lastPentest).toBe("2025-01-01");
    expect(r.apps[1]!.lastPentest).toBeNull();
    expect(r.issues.unmatched).toEqual([{ tab: "aud", count: 1, examples: ["Nobody"] }]);
  });

  it("reports every issue type", () => {
    const s = applyPatch(D(), { fields: { subdomain: { header: "" }, lastAudit: { header: "Audited On" } }, source: { tabs: { drp: { name: "" } } } });
    const t = base();
    (t.apps!.rows as unknown[][]).push(appRow("a2", "Beta again"), appRow("a4", "Delta", { Tiering: "9" }));
    (t as Record<string, unknown>).ciat = { headers: ["UUID", "Confidentiality level", "Date of Security Check"], rows: [["a1", 3, "31/02/2026"], ["ghost", 2, ""]] };
    (t as Record<string, unknown>).plat = { headers: ["UUID", "Hosting Type"], rows: [["a1", "Cloud"], ["a1", "SaaS"]] };
    const { issues } = assemble(t, s);

    expect(issues.missingHeaders).toContainEqual({ tab: "aud", header: "Audited On", fields: ["lastAudit"] });
    const ciatMissing = issues.missingHeaders.find((m) => m.tab === "ciat");
    expect(ciatMissing!.fields).toContain("ciatI");
    expect(issues.missingTabs).toEqual([]);
    expect(issues.unmatched).toContainEqual({ tab: "ciat", count: 1, examples: ["ghost"] });
    expect(issues.unmatched).toContainEqual({ tab: "aud", count: 1, examples: ["zz"] });
    expect(issues.duplicateIds).toContainEqual({ tab: "apps", id: "a2", rows: [3, 5] });
    expect(issues.duplicateIds).toContainEqual({ tab: "plat", id: "a1", rows: [2, 3] });
    expect(issues.unparseable).toContainEqual({ tab: "ciat", field: "securityCheck", count: 1, examples: ["31/02/2026"] });
    expect(issues.unparseable).toContainEqual({ tab: "apps", field: "tier", count: 1, examples: ["9"] });
    expect(issues.unmapped).toContainEqual({ field: "subdomain", reason: "no column chosen" });
    expect(issues.unmapped).toContainEqual({ field: "lastAudit", reason: "column missing" });
    expect(issues.unmapped).toContainEqual({ field: "mtd", reason: "tab not used" });
  });

  it("reports a configured tab that is absent from the workbook", () => {
    const { apps, issues } = assemble({ apps: base().apps }, D());
    expect(issues.missingTabs).toEqual(["ciat", "aud", "drp", "plat"]);
    expect(issues.unmapped).toContainEqual({ field: "hosting", reason: "tab not found" });
    expect(apps[0]!.hosting).toBeNull();
  });

  it("keeps the first of a duplicate id and drops the rest", () => {
    const t = base();
    (t.apps!.rows as unknown[][]).push(appRow("a1", "Alpha clone"));
    const { apps } = assemble(t, D());
    expect(apps.filter((a) => a.id === "a1")).toHaveLength(1);
    expect(apps[0]!.name).toBe("Alpha");
  });

  it("does not report duplicates on a side tab that picks the latest row", () => {
    expect(assemble(base(), D()).issues.duplicateIds).toEqual([]);
  });

  it("skips blank rows and gives rows without an id a stable one", () => {
    const t: TabsInput = { apps: { headers: APPS_H, rows: [appRow("", ""), appRow("", "No id")] } };
    const { apps } = assemble(t, D());
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ id: "row-3", name: "No id" });
  });

  it("never throws on ragged rows, odd cells or a missing apps tab", () => {
    const t: TabsInput = { apps: { headers: APPS_H, rows: [["x"], [null, undefined, 5, true], []] } };
    expect(() => assemble(t, D())).not.toThrow();
    expect(assemble({}, D()).apps).toEqual([]);
    expect(assemble({ apps: { headers: [], rows: [] } }, D()).apps).toEqual([]);
  });

  it("matches headers regardless of case and padding", () => {
    const t: TabsInput = { apps: { headers: ["  uuid ", "NAME", "tiering"], rows: [["q", "Q", "T2"]] } };
    expect(assemble(t, D()).apps[0]).toMatchObject({ id: "q", name: "Q", tier: 2 });
  });
});

describe("assemble on the dev workbook", () => {
  const wb = genWorkbook({ csvPath: SYNTHETIC_CSV });
  const toTabs = (): TabsInput => {
    const keyOf: Record<string, TabKey> = { Apps: "apps", CIAT: "ciat", Audits: "aud", DRP: "drp", Platform: "plat" };
    const out: TabsInput = {};
    for (const t of wb.tabs) {
      const [headers, ...rows] = t.rows;
      out[keyOf[t.name]!] = {
        headers: headers as string[],
        rows: rows.map((r) => r.map((c) => (c && typeof c === "object" && "$wall" in c ? (c as { $wall: string }).$wall : c))),
      };
    }
    return out;
  };

  it("reports the planted irregularities", () => {
    const { apps, issues } = assemble(toTabs(), D());
    expect(apps).toHaveLength(1125);
    expect(issues.unmatched).toEqual([{ tab: "ciat", count: 1, examples: [wb.facts.unmatchedId] }]);
    expect(issues.duplicateIds.find((d) => d.tab === "plat")!.id).toBe(wb.facts.duplicateId);
    expect(issues.missingHeaders).toEqual([{ tab: "drp", header: "Recovery Time Objectives", fields: ["rto"] }]);
    expect(apps.every((a) => a.rto === null)).toBe(true);
    expect(apps.some((a) => a.mtd !== null)).toBe(true);
    const tr = wb.facts.textDateRow!;
    const rec = apps.find((a) => a.id === tr.id)!;
    expect(rec.lastDrpTest).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("is deterministic", () => {
    expect(JSON.stringify(assemble(toTabs(), D()))).toBe(JSON.stringify(assemble(toTabs(), D())));
  });
});

const HAS_REAL_CSV = existsSync(REAL_CSV);

describe.skipIf(!HAS_REAL_CSV)("assemble on the real Apps tab", () => {
  // A skipped describe still runs its body to collect the tests, so read the file only when it
  // is there; otherwise the whole file fails with ENOENT on every machine without the sample.
  const csv = HAS_REAL_CSV ? parseCsv(readFileSync(REAL_CSV, "utf8")) : [["UUID"]];
  const headers = csv[0]!;
  const rows = csv.slice(1);
  const { apps, issues } = assemble({ apps: { headers, rows } }, D());
  const iHeader = (h: string) => headers.indexOf(h);

  it("gives 1,125 records", () => {
    expect(apps).toHaveLength(1125);
    expect(new Set(apps.map((a) => a.id)).size).toBe(1125);
    expect(apps[0]!._row.apps).toBe(2);
    expect(apps[1124]!._row.apps).toBe(1126);
  });

  it("turns a blank Domain into NO DOMAIN and a blank Tiering into null", () => {
    const blankDomain = rows.filter((r) => r[iHeader("Domain")]!.trim() === "").length;
    expect(blankDomain).toBeGreaterThan(0);
    expect(apps.filter((a) => a.domain === "NO DOMAIN")).toHaveLength(blankDomain);
    const blankTier = rows.filter((r) => r[iHeader("Tiering")]!.trim() === "").length;
    expect(apps.filter((a) => a.tier === null)).toHaveLength(blankTier);
    expect(apps.filter((a) => a.tier !== null).every((a) => [1, 2, 3, 4].includes(a.tier!))).toBe(true);
  });

  it("leaves the fields of absent tabs null, and reads the people names", () => {
    for (const a of apps) {
      expect(a.exposed).toBeNull();
      expect(a.lastPentest).toBeNull();
      expect(a.ciat).toEqual({ c: null, i: null, a: null, t: null });
      expect(a.mtd).toBeNull();
      expect(a.sso).toBeNull();
      expect(a.findingsCritical).toBeNull();
    }
    expect(apps.some((a) => a.owner !== null && /^Person \d+$/.test(a.owner))).toBe(true);
    const unmappedKeys = new Set(issues.unmapped.map((u) => u.field));
    expect(unmappedKeys.has("id")).toBe(false);
    expect(unmappedKeys.has("tier")).toBe(false);
    expect(unmappedKeys.has("exposed")).toBe(true);
    expect(issues.missingTabs).toEqual(["ciat", "aud", "drp", "plat"]);
    expect(issues.missingHeaders).toEqual([]);
    expect(issues.unparseable).toEqual([]);
    expect(issues.duplicateIds).toEqual([]);
  });

  it("encodes to a small payload that decodes exactly (size logged)", () => {
    const p = encodeRegister(apps, { loadedAt: "2026-11-11T09:42:00Z", dataVersion: 1 });
    const json = JSON.stringify(p);
    const bytes = payloadBytes(p);
    const gz = gzipSync(json).length;
    console.log("[WP04] register payload for " + apps.length + " apps (Apps tab only): " + bytes + " bytes JSON, " + gz + " bytes gzipped");
    expect(bytes).toBeLessThan(600_000);
    expect(decodeRegister(JSON.parse(json))).toEqual(JSON.parse(JSON.stringify(apps)));
  });
});

describe("register codec", () => {
  it("round-trips records with every field and none missing", () => {
    const t: TabsInput = { apps: { headers: APPS_H, rows: [appRow("a1", "Alpha", { Tiering: 2 }), appRow("a2", "Beta")] } };
    const { apps } = assemble(t, D());
    const p = encodeRegister(apps, { loadedAt: "x", dataVersion: 3 });
    expect(p.v).toBe(1);
    expect(p.dataVersion).toBe(3);
    expect(decodeRegister(JSON.parse(JSON.stringify(p)))).toEqual(JSON.parse(JSON.stringify(apps)));
    expect(Object.keys(apps[0]!).length).toBeGreaterThanOrEqual(FIELD_KEYS.length - 6);
    expect(() => decodeRegister({ ...p, v: 99 })).toThrow();
  });
});

describe("pillars in the Applications tab (same tab)", () => {
  const SAME = (): Settings => makeDefaultSettings();
  const inventory = (): TabsInput => ({ apps: { headers: APPS_H, rows: [appRow("a1", "Alpha", { Tiering: 1 }), appRow("a2", "Beta"), appRow("a1", "Alpha again")] } });
  const withPillars = (): TabsInput => ({
    apps: {
      headers: [...APPS_H, "Integrity Level", "Last Pentest", "Last DRP Test", "Hosting Type"],
      rows: [
        [...appRow("a1", "Alpha"), 3, "2025-06-01", "2025-01-02", "Cloud"],
        [...appRow("a2", "Beta"), "", "", "", ""],
        [...appRow("a1", "Alpha again"), 1, "2020-01-01", "", "Onsite"],
      ],
    },
  });

  it("is the default for every pillar, and apps is never same-tab", () => {
    const t = SAME().source.tabs;
    expect([t.ciat.sameTab, t.aud.sameTab, t.drp.sameTab, t.plat.sameTab, t.apps.sameTab]).toEqual([true, true, true, true, false]);
  });

  it("leaves every pillar field null and reports nothing but not-provided-yet", () => {
    const { apps, issues } = assemble(inventory(), SAME());
    expect(apps.map((a) => a.id)).toEqual(["a1", "a2"]);
    for (const a of apps) {
      expect(a.ciat).toEqual({ c: null, i: null, a: null, t: null });
      expect([a.lastPentest, a.lastAudit, a.mtd, a.lastDrpTest, a.drpResult, a.hosting, a.sso, a.exposed]).toEqual([null, null, null, null, null, null, null, null]);
    }
    expect(issues.missingHeaders).toEqual([]);
    expect(issues.missingTabs).toEqual([]);
    expect(issues.unmatched).toEqual([]);
    expect(issues.unparseable).toEqual([]);
    // The one repeated id is the inventory's own, reported once for the Applications tab only.
    expect(issues.duplicateIds).toEqual([{ tab: "apps", id: "a1", rows: [2, 4] }]);
    const pending = issues.unmapped.filter((u) => u.reason === "not provided yet").map((u) => u.field);
    expect(pending).toEqual(expect.arrayContaining(["ciatC", "lastPentest", "mtd", "hosting", "exposed"]));
    expect(issues.unmapped.filter((u) => u.reason !== "not provided yet")).toEqual([]);
  });

  it("joins each row to itself and fills the pillar columns that are present", () => {
    const { apps, issues } = assemble(withPillars(), SAME());
    expect(apps[0]).toMatchObject({ id: "a1", lastPentest: "2025-06-01", lastDrpTest: "2025-01-02", hosting: "Cloud" });
    expect(apps[0]!.ciat.i).toBe(3);
    expect(apps[0]!.ciat.c).toBeNull();
    expect(apps[1]).toMatchObject({ id: "a2", lastPentest: null, hosting: null });
    expect(apps[0]!._row).toMatchObject({ apps: 2, ciat: 2, aud: 2, drp: 2, plat: 2 });
    expect(issues.unmatched).toEqual([]);
    expect(issues.missingHeaders).toEqual([]);
    const pending = issues.unmapped.filter((u) => u.reason === "not provided yet").map((u) => u.field);
    expect(pending).toContain("ciatC");
    expect(pending).not.toContain("ciatI");
    expect(pending).not.toContain("lastPentest");
  });

  it("a separate tab keeps the missing-header report", () => {
    const s = SAME();
    s.source.tabs.plat = { ...s.source.tabs.plat, name: "Platform", sameTab: false };
    const t: TabsInput = { ...inventory(), plat: { headers: ["UUID", "Hosting Type"], rows: [["a1", "Cloud"]] } };
    const { issues } = assemble(t, s);
    expect(issues.missingHeaders.some((m) => m.tab === "plat" && m.header === "Single Sign-On - Availability")).toBe(true);
    expect(issues.unmapped.some((u) => u.reason === "column missing")).toBe(true);
  });

  it("when the Applications tab itself is missing, a same-tab pillar says tab not found", () => {
    const { issues } = assemble({}, SAME());
    expect(issues.missingTabs).toEqual(["apps"]);
    expect(issues.unmapped.find((u) => u.field === "hosting")!.reason).toBe("tab not found");
  });
});
