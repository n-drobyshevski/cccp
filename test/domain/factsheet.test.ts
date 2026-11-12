import { describe, expect, it } from "vitest";
import { factsheetModel, findInSections, lifecycleSteps, pushRecent, recentFor, reviewMonthsOf, sheetRowLink, RECENT_MAX } from "../../src/domain/factsheet";
import { DEFAULT_RULES } from "../../src/domain/rules";
import { rowOf, TODAY, fixtureRows } from "./rows";

const ctx = { today: TODAY, reviewMonths: 12, sheetUrl: "https://example.test/sheet", sheetGid: 7 };

describe("factsheet model", () => {
  it("returns header, sections, people and dq", () => {
    const m = factsheetModel(fixtureRows()[0]!, ctx);
    expect(Object.keys(m).sort()).toEqual(["dq", "header", "people", "sections"]);
    expect(m.sections.map((s) => s.key)).toEqual(["overview", "cyber", "compliance", "continuity", "platform"]);
    expect(m.header.statuses.map((s) => s.label)).toEqual(["Cyber", "Compliance", "Continuity", "Platform"]);
    expect(m.dq.groups).toHaveLength(5);
    expect(m.sections[1]!.pct).toBe(m.dq.groups[0]!.pct);
  });
  it("keeps unknown values null, never coerced", () => {
    const m = factsheetModel(rowOf(), ctx);
    const rows = m.sections.flatMap((s) => s.subsections.flatMap((u) => u.rows));
    const nulls = rows.filter((r) => r.value === null);
    expect(nulls.length).toBeGreaterThan(10);
    expect(m.header.lifecycle).toBeNull();
    expect(m.header.tags).toEqual([]);
    expect(m.header.seal.state).toBe("need");
    expect(m.sections[2]!.subsections[0]!.widget).toEqual({ type: "ciat", levels: null });
  });
  it("people flags None assigned and counts the named", () => {
    const m = factsheetModel(rowOf({ owner: "Ann" }), ctx);
    expect(m.people.count).toBe(1);
    expect(m.people.rows.map((p) => p.flag)).toEqual([null, "None assigned", "None assigned"]);
  });
  it("tags, lifecycle and risk", () => {
    const m = factsheetModel(rowOf({ typology: "Hybrid", hosting: "Cloud", exposed: true, personalData: true, sso: false, lifecycle: "END_OF_LIFE" }), ctx);
    expect(m.header.tags.map((t) => t.label)).toEqual(["Hybrid", "Cloud", "Internet exposed", "Personal data", "No SSO"]);
    expect(m.header.lifecycle).toEqual({ key: "END_OF_LIFE", label: "End of life" });
    const exp = m.sections[1]!.subsections[0]!.rows[0]!;
    expect(exp.risk).toBe(true);
  });
  it("lifecycle steps mark done, current and end", () => {
    expect(lifecycleSteps("BETA").map((s) => s.state)).toEqual(["done", "cur", "todo", "todo", "todo", "todo"]);
    expect(lifecycleSteps("END_OF_LIFE")[5]!.state).toBe("end");
    expect(lifecycleSteps("weird").every((s) => s.state === "todo")).toBe(true);
  });
  it("sheet link and review months", () => {
    expect(factsheetModel(rowOf({ _row: { apps: 12 } }), ctx).header.sheetLink).toBe("https://example.test/sheet#gid=7&range=A12");
    expect(factsheetModel(rowOf(), ctx).header.sheetLink).toBeNull();
    expect(sheetRowLink("javascript:alert(1)", 1, 2)).toBeNull();
    expect(reviewMonthsOf(DEFAULT_RULES)).toBe(12);
  });
});

describe("find and recent", () => {
  const m = factsheetModel(rowOf({ owner: "Ann", exposed: false }), ctx);
  it("an empty find keeps everything", () => expect(findInSections(m.sections, "  ").sections).toHaveLength(5));
  it("narrows to matching rows and sections", () => {
    const r = findInSections(m.sections, "pentest");
    expect(r.sections.map((s) => s.key)).toEqual(["cyber"]);
    expect(r.sections[0]!.subsections.flatMap((u) => u.rows.map((x) => x.label))).toEqual(["Last pentest"]);
    expect(findInSections(m.sections, "compliance").sections[0]!.subsections).toHaveLength(4);
    expect(findInSections(m.sections, "zzzz").sections).toEqual([]);
  });
  it("recent keeps 8 others and the view excludes the current", () => {
    let l: string[] = [];
    for (let i = 0; i < 15; i++) l = pushRecent(l, "a" + i);
    expect(l).toHaveLength(RECENT_MAX + 1);
    expect(l[0]).toBe("a14");
    expect(recentFor(l, "a14")).toHaveLength(RECENT_MAX);
    expect(recentFor(l, "a14")).not.toContain("a14");
    expect(pushRecent(["x", "y"], "y")).toEqual(["y", "x"]);
    expect(pushRecent([1, null] as unknown[], "z")).toEqual(["z"]);
  });
});
