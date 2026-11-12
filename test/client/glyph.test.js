// The four status glyphs of the Inventory and the fact sheet scorecard, as pure views: one shape
// per status, an accessible name and tip with the pillar, the word and the reason, and a dashed
// empty box for no data.
import { describe, expect, it } from "vitest";
import { PILLAR_CODE, glyph, glyphMark, glyphs, pillarGlyph } from "../../src/client/components/glyph.js";

const s = (v) => String(v);
const status = {
  cyber: { status: "bad", why: "Front exposed" }, compliance: { status: "warn", why: "Audit is old" },
  continuity: { status: "ok", why: "" }, platform: { status: "none", why: "" },
};

describe("status glyphs", () => {
  it("draws four glyphs in the order Cyber, Compliance, Continuity, Platform", () => {
    const out = s(glyphs(status));
    expect([...out.matchAll(/class="gl (\w+)"/g)].map((m) => m[1])).toEqual(["bad", "warn", "ok", "none"]);
    expect([...out.matchAll(/aria-label="(\w+):/g)].map((m) => m[1])).toEqual(["Cyber", "Compliance", "Continuity", "Platform"]);
  });
  it("names pillar, status word and reason in the label and the tip, with the same text", () => {
    const out = s(glyphs(status));
    expect(out).toContain('aria-label="Cyber: Gap. Front exposed" data-tip="Cyber: Gap. Front exposed"');
    expect(out).toContain('aria-label="Compliance: Needs attention. Audit is old" data-tip="Compliance: Needs attention. Audit is old"');
    expect(out).toContain('aria-label="Continuity: OK" data-tip="Continuity: OK"');
    expect(out).toContain('aria-label="Platform: No data" data-tip="Platform: No data"');
  });
  it("each status has its own mark; no data is an empty dashed box", () => {
    const mark = (st) => s(glyph(st, "x"));
    expect(mark("ok")).toContain("<svg");
    expect(mark("warn")).toContain("<svg");
    expect(mark("bad")).toContain("<svg");
    expect(mark("ok")).not.toBe(mark("bad"));
    const none = mark("none");
    expect(none).toContain('class="gl none"');
    expect(none).not.toContain("<svg");
  });
  it("a glyph is focusable so the tip shows from the keyboard; the bare mark is decorative", () => {
    expect(s(glyph("ok", "t"))).toContain('tabindex="0" role="img"');
    expect(s(glyphMark("bad"))).toContain('aria-hidden="true"');
    expect(s(glyphMark("bad"))).not.toContain("tabindex");
  });
  it("copes with a missing status and escapes the reason", () => {
    expect(s(glyphs(null))).toContain('aria-label="Cyber: No data"');
    expect(s(pillarGlyph("cyber", { status: "bad", why: '<img src=x onerror=1>' }))).not.toContain("<img");
  });
  it("the pillar codes are CY CO CT PL", () => {
    expect(Object.values(PILLAR_CODE)).toEqual(["CY", "CO", "CT", "PL"]);
  });
});
