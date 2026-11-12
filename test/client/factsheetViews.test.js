import { describe, expect, it } from "vitest";
import { headerView, tabsView } from "../../src/client/pages/factsheet/header.js";
import { peopleView } from "../../src/client/pages/factsheet/people.js";
import { barView, sectionsView } from "../../src/client/pages/factsheet/sections.js";
import { sidebarView } from "../../src/client/pages/factsheet/dqSidebar.js";
import { factsheetModel } from "../../src/domain/factsheet";
import { linkFor } from "../../src/client/state/url.js";
import { initialState } from "../../src/client/state/store.js";
import { rowOf, TODAY } from "../domain/rows";

const s = (v) => String(v);
const ctx = { today: TODAY, reviewMonths: 12, sheetUrl: "https://example.test/s", sheetGid: 3 };
const EVIL = '<img src=x onerror=alert(1)>"\'&';
const evil = rowOf({
  id: "e1", name: EVIL, domain: EVIL, subdomain: EVIL, supportGroup: EVIL, owner: EVIL, backupOwner: EVIL, securityOfficer: EVIL,
  typology: EVIL, hosting: EVIL, lifecycle: EVIL, findingsText: EVIL, auditResult: EVIL, internalUsers: EVIL, externalUsers: EVIL, _row: { apps: 5 },
});
const m = factsheetModel(evil, ctx);
/** Markup with every quoted attribute value blanked, so only real attribute names remain. */
const bare = (h) => h.replace(/"[^"]*"/g, '""').replace(/>[^<]*</g, "><");
const all = () => s(headerView(m.header, "list", true)) + s(tabsView("sheet", 3)) + s(barView(EVIL)) + s(sectionsView(m.sections, new Set(), false)) + s(peopleView(m.people)) + s(sidebarView(m.dq, [{ id: "r1", name: EVIL, status: evil.status }], false));

describe("fact sheet views: XSS battery", () => {
  it("escapes every hostile value", () => {
    const h = all();
    expect(h).not.toContain("<img");
    expect(bare(h)).not.toMatch(/\sonerror=/);
    expect(h).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
  it("has no title attribute and no inline handler", () => {
    const h = all();
    expect(bare(h)).not.toMatch(/\stitle=/);
    expect(bare(h)).not.toMatch(/\son[a-z]+=/);
  });
  it("refuses a script URL for Open row in sheet", () => {
    const bad = factsheetModel(rowOf({ _row: { apps: 2 } }), { ...ctx, sheetUrl: "javascript:alert(1)" });
    expect(s(headerView(bad.header, "list", true))).not.toContain("javascript:");
    expect(bad.header.sheetLink).toBeNull();
  });
});

describe("fact sheet views", () => {
  const clean = factsheetModel(rowOf({ id: "c1", name: "Alpha", owner: "Ann Lee" }), ctx);
  it("unknown values render as a muted dash", () => {
    expect(s(sectionsView(clean.sections, new Set(), false))).toContain('<span class="mut" aria-hidden="true">—</span>');
  });
  it("status buttons carry their section", () => {
    const h = s(headerView(clean.header, "heatmap", true));
    for (const k of ["cyber", "compliance", "continuity", "platform"]) expect(h).toContain('data-act="jump" data-sx="' + k + '"');
    expect(h).toContain("Back to heatmap");
  });
  it("closed sections render closed, a find forces them open", () => {
    const closed = new Set(["cyber"]);
    expect(s(sectionsView(clean.sections, closed, false))).toMatch(/id="sx-cyber" data-sx="cyber">/);
    expect(s(sectionsView(clean.sections, closed, true))).toMatch(/id="sx-cyber" data-sx="cyber" open>/);
  });
  it("people flags None assigned", () => {
    const h = s(peopleView(clean.people));
    expect((h.match(/None assigned/g) || []).length).toBe(2);
    expect(h).toContain("1 person");
  });
  it("sidebar collapses to a strip and lists recent", () => {
    expect(s(sidebarView(clean.dq, [], true))).toContain('aria-label="Show data quality"');
    expect(s(sidebarView(clean.dq, [{ id: "r", name: "Beta", status: rowOf().status }], false))).toContain("Recently viewed");
    expect(s(sidebarView(clean.dq, [], false))).not.toContain("Recently viewed");
  });
  it("Copy link gives ?app=", () => {
    const st = { ...initialState(), route: "app", app: "c1" };
    expect(linkFor("https://svc.test/exec", st)).toMatch(/\?app=c1$/);
  });
  it("renders the RTO against MTD widget", () => {
    const w = (o) => s(sectionsView(factsheetModel(rowOf(o), ctx).sections, new Set(), false));
    const both = w({ rto: 4, mtd: 24 });
    expect(both).toContain('aria-label="RTO 4 hours, MTD 24 hours"');
    for (const m of both.match(/class="track"[\s\S]*?<\/div>/)[0].matchAll(/width:calc\(([\d.]+)%/g)) {
      expect(Number(m[1])).toBeGreaterThan(0);
      expect(Number(m[1])).toBeLessThanOrEqual(100);
    }
    const noMtd = w({ rto: 4, mtd: null });
    expect(noMtd).toContain('aria-label="RTO 4 hours"');
    expect(noMtd).not.toContain("MTD");
  });
});
