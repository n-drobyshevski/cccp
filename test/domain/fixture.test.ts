import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { genWorkbook, parseCsv, REAL_CSV, SYNTHETIC_CSV, workbookJson } from "../../dev/genTabs.mjs";

const tab = (wb: ReturnType<typeof genWorkbook>, n: string) => wb.tabs.find((t) => t.name === n)!.rows;
const ids = (rows: any[][]) => rows.slice(1).map((r) => r[0] as string);

describe("genTabs", () => {
  const wb = genWorkbook();

  it("is byte-identical across runs, in process and across processes", () => {
    expect(workbookJson()).toBe(workbookJson());
    const run = () => execFileSync(process.execPath, ["dev/genTabs.mjs"], { cwd: process.cwd(), maxBuffer: 1 << 28 }).toString();
    const a = run();
    expect(a).toBe(run());
    expect(a.trimEnd()).toBe(workbookJson());
  });

  it("has an Apps tab of 1,125 rows with the 14 headers", () => {
    const apps = tab(wb, "Apps");
    expect(apps).toHaveLength(1126);
    expect(apps[0]).toHaveLength(14);
    expect(apps[0].slice(0, 3)).toEqual(["UUID", "Name", "Domain"]);
    expect(new Set(ids(apps)).size).toBe(1125);
    expect(wb.tabs.map((t) => t.name)).toEqual(["Apps", "CIAT", "Audits", "DRP", "Platform"]);
  });

  it("uses the committed synthetic CSV when the real one is not selected", () => {
    const syn = genWorkbook({ csvPath: SYNTHETIC_CSV });
    expect(syn.source).toBe("synthetic");
    expect(tab(syn, "Apps")).toHaveLength(1126);
    expect(parseCsv(readFileSync(SYNTHETIC_CSV, "utf8"))).toHaveLength(1126);
  });

  it.skipIf(!existsSync(REAL_CSV))("reads the real CSV when present", () => {
    const real = genWorkbook({ csvPath: REAL_CSV });
    expect(tab(real, "Apps")).toHaveLength(1126);
    expect(workbookJson({ csvPath: REAL_CSV })).toBe(workbookJson({ csvPath: REAL_CSV }));
  });

  it("includes an unmatched row on CIAT", () => {
    const apps = new Set(ids(tab(wb, "Apps")));
    const unmatched = ids(tab(wb, "CIAT")).filter((i) => !apps.has(i));
    expect(unmatched).toEqual([wb.facts.unmatchedId]);
    for (const t of ["Audits", "DRP", "Platform"]) expect(ids(tab(wb, t)).every((i) => apps.has(i))).toBe(true);
  });

  it("includes a duplicate id on Platform", () => {
    const plat = ids(tab(wb, "Platform"));
    const dup = plat.filter((i) => i === wb.facts.duplicateId);
    expect(wb.facts.duplicateId).toBeTruthy();
    expect(dup).toHaveLength(2);
  });

  it("includes a dd/MM/yyyy text date", () => {
    const drp = tab(wb, "DRP");
    const c = drp[0].indexOf("Last DRP Test");
    const texts = drp.slice(1).filter((r) => typeof r[c] === "string" && r[c] !== "");
    expect(texts).toHaveLength(1);
    expect(texts[0][c]).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(texts[0][c]).toBe(wb.facts.textDateRow!.text);
    expect(drp.slice(1).some((r) => typeof r[c] === "object" && r[c] && "$wall" in (r[c] as object))).toBe(true);
  });

  it("includes a renamed header and blanks", () => {
    const drp = tab(wb, "DRP");
    expect(drp[0]).toContain(wb.facts.renamedHeader);
    expect(drp[0]).not.toContain(wb.facts.renamedFrom);
    const blanks = tab(wb, "Audits").slice(1).filter((r) => r.slice(1).every((v) => v === ""));
    expect(blanks.length).toBeGreaterThan(0);
    expect(tab(wb, "Platform").slice(1).some((r) => r.includes(""))).toBe(true);
  });

  it("has some applications with several Audits rows", () => {
    const counts = new Map<string, number>();
    for (const i of ids(tab(wb, "Audits"))) counts.set(i, (counts.get(i) ?? 0) + 1);
    expect([...counts.values()].some((n) => n > 1)).toBe(true);
  });
});
