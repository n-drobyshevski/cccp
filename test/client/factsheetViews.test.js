import { describe, expect, it } from "vitest";
import { headerView, metaView, scorecardView, tabsView } from "../../src/client/pages/factsheet/header.js";
import { peopleView } from "../../src/client/pages/factsheet/people.js";
import { tierBadge } from "../../src/client/components/tags.js";
import { barView, sectionsView, valueView } from "../../src/client/pages/factsheet/sections.js";
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

describe("fact sheet no-tier badge", () => {
  it("the header keeps the dashed no-tier badge, and Identity > Tier draws it too", () => {
    const h = s(metaView({ ...m.header, tier: null }));
    expect(h).toContain('class="tier tw t0"');
    expect(h).toContain("No tier");
    expect(h).toContain("No tiering set");
    expect(s(valueView({ kind: "tier", value: null }))).toContain("No tiering set");
    expect(s(valueView({ kind: "tier", value: 2 }))).toContain("Tier 2");
  });
  it("the badge is focusable so the tip works from the keyboard", () => {
    expect(s(tierBadge(null))).toContain('tabindex="0"');
  });
  it("the fact sheet tabs use roving tabindex with aria-controls", () => {
    const out = s(tabsView("people", 2));
    expect(out.match(/tabindex="0"/g)).toHaveLength(1);
    expect(out).toContain('id="fs-tab-people" aria-controls="fs-panel" tabindex="0"');
    expect(out).toContain('tabindex="-1"');
  });
});

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
    const h = s(headerView(clean.header, "list", true));
    for (const k of ["cyber", "compliance", "continuity", "platform"]) expect(h).toContain('data-act="jump" data-sx="' + k + '"');
    expect(h).toContain("Back to inventory");
  });
  it("the scorecard has one cell per pillar with glyph, status word and why", () => {
    const row = rowOf({ id: "g1", name: "Gee", securityOfficer: null });
    const fm = factsheetModel(row, ctx);
    const h = s(scorecardView(fm.header.statuses));
    expect([...h.matchAll(/class="sc pc-(\w+)"/g)].map((m) => m[1])).toEqual(["cyber", "compliance", "continuity", "platform"]);
    expect([...h.matchAll(/<span class="gl (\w+)/g)].length).toBe(4);
    for (const st of fm.header.statuses) {
      expect(h).toContain("<b>" + st.word + "</b>");
      expect(h).toContain('<span class="w">' + st.why.replace(/&/g, "&amp;") + "</span>");
    }
  });
  it("the meta line reads tier, lifecycle, hosting and owner", () => {
    const fm = factsheetModel(rowOf({ id: "m1", name: "Em", tier: 2, lifecycle: "GENERAL_AVAILABILITY", hosting: "Cloud", owner: "Ann Lee" }), ctx);
    const h = s(metaView(fm.header)).replace(/<[^>]+>/g, "");
    expect(h).toBe("Tier 2·General availability·Cloud·owned by Ann Lee");
  });
  it("the rail shows the big percentage and Missing or Filled in words", () => {
    const h = s(sidebarView(clean.dq, [], false));
    expect(h).toContain('data-fs="pct"');
    expect(h).toContain(clean.dq.pct + "%");
    expect(h).toContain(clean.dq.filled + " of " + clean.dq.total + " mandatory fields");
    expect(h).toContain('<span class="qs">Missing</span>');
    expect(h).toContain("qi x");
  });
  it("sections are headed in their pillar colour class, Overview is not", () => {
    const h = s(sectionsView(clean.sections, new Set(), false));
    expect(h).toContain('class="fsx pc-cyber"');
    expect(h).toContain('class="fsx" id="sx-overview"');
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
