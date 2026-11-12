import { describe, expect, it } from "vitest";
import { visibleColumnDefs, COLUMNS } from "../../src/domain/columns";
import { exportRows } from "../../src/domain/exportRows";
import { fixtureRows, rowOf } from "./rows";

describe("exportRows", () => {
  it("follows the column order with a label header row", () => {
    const cols = visibleColumnDefs(["-d", "+h"]);
    const out = exportRows([rowOf({ name: "Alpha", hosting: "Cloud", tier: 2 })], cols);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(["Application", "Tier", "Lifecycle", "Owner", "Security officer", "Hosting",
      "Cyber", "Compliance", "Continuity", "Platform", "Cyber reason", "Compliance reason", "Continuity reason", "Platform reason"]);
    expect(out[1]![0]).toBe("Alpha");
    expect(out[1]![1]).toBe("T2");
    expect(out[1]![5]).toBe("Cloud");
    expect(out[1]!.length).toBe(out[0]!.length);
  });

  it("expands status to four words and four reasons", () => {
    const r = rowOf({ securityOfficer: null });
    const out = exportRows([r], [COLUMNS.find((c) => c.key === "st")!]);
    expect(out[1]!.slice(0, 4)).toEqual(["Gap", "No data", "No data", "No data"].map((w, i) =>
      ({ 0: r.status.cyber, 1: r.status.compliance, 2: r.status.continuity, 3: r.status.platform } as never)[i]
        ? ({ bad: "Gap", warn: "Needs attention", ok: "OK", none: "No data" } as Record<string, string>)[(([r.status.cyber, r.status.compliance, r.status.continuity, r.status.platform] as const)[i]!).status]! : w));
    expect(out[1]!.slice(4)).toEqual([r.status.cyber.sentence, r.status.compliance.sentence, r.status.continuity.sentence, r.status.platform.sentence]);
    expect(out[1]![0]).toBe("Gap");
  });

  it("gives completeness as a number and blanks unknowns", () => {
    const r = rowOf({ name: "N" });
    const out = exportRows([r], COLUMNS);
    const qi = out[0]!.indexOf("Completeness");
    expect(typeof out[1]![qi]).toBe("number");
    expect(out[1]![qi]).toBe(r.pct);
    expect(out[1]![out[0]!.indexOf("Subdomain")]).toBe("");
    expect(out[1]![out[0]!.indexOf("Tier")]).toBe("");
  });

  it("exports every fixture row at full width", () => {
    const rows = fixtureRows();
    const out = exportRows(rows, COLUMNS);
    expect(out).toHaveLength(rows.length + 1);
    for (const line of out) expect(line).toHaveLength(out[0]!.length);
  });
});
