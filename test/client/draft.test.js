// The settings draft: one patch of exactly the changed values, tab marks, problems mapped to
// tabs, clamped labels and the unsaved-changes guard. Plus the three tab views as strings.
import { afterEach, describe, expect, it } from "vitest";
import { applyPatch, makeDefaultSettings } from "../../src/domain/settings";
import {
  barModel, changedKeys, clampedText, committed, discard, edit, effective, errorsOf, guardSettings, isDirty,
  SAME_TAB, chooseTab, keyForSentence, newSession, resetGuardForTest, tabMarks, toPatch, unmappedFields,
} from "../../src/client/pages/settings/draft.js";
import { sourceView } from "../../src/client/pages/settings/source.js";
import { fieldsView } from "../../src/client/pages/settings/fields.js";
import { displayView, hideCounts } from "../../src/client/pages/settings/display.js";
import { savebar } from "../../src/client/components/savebar.js";

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz";
const URL_OF = ["https:", "", "docs.google.com", "spreadsheets", "d", ID, "edit"].join("/");
const settings = () => { const s = makeDefaultSettings(); s.source.sheetId = ID; return s; };
const INV = ["UUID", "Name", "Domain", "Subdomain", "Support Group", "Owner Name", "Backup Owner Name", "Lifecycle", "Typology", "Tiering", "Security Officer Name"];
const session = () => newSession({ settings: settings(), cfgGen: 4, headers: { apps: ["UUID", "Name", "Domain"] }, examples: { apps: { Name: "Billing" } } }, URL_OF);

describe("draft and patch", () => {
  it("a fresh session is clean and its draft shows the Sheet link", () => {
    const s = session();
    expect(isDirty(s)).toBe(false);
    expect(s.draft["source.sheetId"]).toBe(URL_OF);
    expect(barModel(s).count).toBe(0);
  });

  it("pasting the link of the saved Sheet is not a change, a different one is", () => {
    let s = edit(session(), "source.sheetId", ID);
    expect(isDirty(s)).toBe(false);
    s = edit(s, "source.sheetId", ["https:", "", "docs.google.com", "spreadsheets", "d", "ZZZZZZZZZZZZZZZZ", "edit"].join("/"));
    expect(toPatch(s.savedDraft, s.draft)).toEqual({ source: { sheetId: "ZZZZZZZZZZZZZZZZ" } });
  });

  it("one patch carries only what changed, nested as Settings", () => {
    let s = session();
    s = edit(s, "source.cacheMinutes", 30);
    s = edit(s, "source.tabs.aud.pick", "first");
    s = edit(s, "fields.owner", "Owner");
    s = edit(s, "rules.cy.pentestAge", { months: 12 });
    s = edit(s, "display.theme", "dark");
    expect(toPatch(s.savedDraft, s.draft)).toEqual({
      source: { cacheMinutes: 30, tabs: { aud: { pick: "first" } } },
      fields: { owner: { header: "Owner" } },
      rules: { rules: { "cy.pentestAge": { months: 12 } } },
      display: { theme: "dark" },
    });
    const merged = applyPatch(s.saved, toPatch(s.savedDraft, s.draft));
    expect(merged.source.cacheMinutes).toBe(30);
    expect(merged.rules.rules["cy.pentestAge"].months).toBe(12);
  });

  it("changing a value back is not dirty", () => {
    let s = edit(session(), "display.hideEol", true);
    expect(isDirty(s)).toBe(true);
    s = edit(s, "display.hideEol", false);
    expect(isDirty(s)).toBe(false);
    expect(toPatch(s.savedDraft, s.draft)).toEqual({});
  });

  it("an unknown key is refused", () => {
    expect(() => edit(session(), "display.nope", 1)).toThrow(/Unknown setting/);
  });

  it("discard restores the saved draft; committed makes the server's value the saved one", () => {
    let s = edit(session(), "display.theme", "dark");
    expect(isDirty(discard(s))).toBe(false);
    const saved = applyPatch(s.saved, toPatch(s.savedDraft, s.draft));
    s = committed(s, saved, 5, URL_OF);
    expect(isDirty(s)).toBe(false);
    expect(s.baseGen).toBe(5);
    expect(s.saved.display.theme).toBe("dark");
  });

  it("effective keeps junk as typed so it differs from the saved Sheet", () => {
    expect(effective({ "source.sheetId": "not a link" })["source.sheetId"]).toBe("not a link");
    expect(effective({ "source.sheetId": "  " })["source.sheetId"]).toBe("");
    expect(changedKeys(session().savedDraft, edit(session(), "source.sheetId", "not a link").draft)).toEqual(["source.sheetId"]);
  });
});

describe("tab marks, bar and problems", () => {
  it("each tab is dirty only for its own fields; Access is never dirty", () => {
    const s = edit(edit(session(), "fields.owner", "Owner"), "display.theme", "system");
    const m = tabMarks(s, {});
    expect(Object.keys(m)).toEqual(["source", "fields", "rules", "access", "display"]);
    expect(m.fields.dirty).toBe(true);
    expect(m.display.dirty).toBe(true);
    expect(m.source.dirty).toBe(false);
    expect(m.access.dirty).toBe(false);
  });

  it("Field mapping carries the warn mark while a field has no column", () => {
    const s = session();
    expect(unmappedFields(s.draft).length).toBe(0);
    expect(tabMarks(s, {}).fields.warn).toBe(false);
    const un = edit(s, "fields.owner", "");
    expect(unmappedFields(un.draft).map((d) => d.key)).toEqual(["owner"]);
    expect(tabMarks(un, {}).fields.warn).toBe(true);
  });

  it("the bar counts changes and names each tab once", () => {
    const s = edit(edit(edit(session(), "fields.owner", "Own"), "fields.domain", "Dom"), "display.theme", "dark");
    const b = barModel(s);
    expect(b.text).toBe("3 unsaved changes");
    expect(b.tabs.map((t) => t.tab)).toEqual(["fields", "display"]);
    expect(String(savebar({ ...b, busy: false, problems: 0 }))).toContain('data-act="s-save"');
    expect(String(savebar({ count: 0, text: "", tabs: [] }))).toBe("");
  });

  it("the bar says Discard and Save, lists the first two rule changes and counts the rest", () => {
    const out = String(savebar({ count: 4, text: "4 unsaved changes", tabs: [{ tab: "rules", label: "Status rules" }], notes: ["A: 18 \u2192 24 months (131 \u2192 74 apps)", "B: on \u2192 off", "C: x", "D: y"], busy: false, problems: 0 }));
    expect(out).toContain("A: 18 \u2192 24 months (131 \u2192 74 apps); B: on \u2192 off and 2 more");
    expect(out).not.toContain("C: x");
    expect(out).toMatch(/data-act="s-discard"[^>]*>Discard</);
    expect(out).toMatch(/data-act="s-save"[^>]*>Save</);
    expect(String(savebar({ count: 1, text: "1 unsaved change", tabs: [], busy: true, problems: 0 }))).toContain("Saving…");
  });

  it("problems land on the tab that owns them and block through errors", () => {
    let s = edit(session(), "source.tabs.apps.name", "");
    let r = errorsOf(s);
    expect(r.errors["source.tabs.apps.name"]).toMatch(/Applications tab needs a name/);
    expect(tabMarks(s, r.errors).source.invalid).toBe(true);
    s = edit(edit(session(), "fields.owner", "Owner"), "source.tabs.apps.name", "Apps");
    s = edit(s, "fields.name", "");
    r = errorsOf(s);
    expect(r.errors["fields.name"]).toBeDefined();
    expect(tabMarks(s, r.errors).fields.invalid).toBe(true);
    s = edit(session(), "source.sheetId", "not a link");
    r = errorsOf(s);
    expect(r.problems.length).toBe(1);
    expect(r.errors["source.sheetId"]).toMatch(/not valid/);
  });

  it("a clean draft has no problems", () => {
    expect(errorsOf(session())).toEqual({ errors: {}, problems: [] });
  });

  it("keyForSentence maps the domain sentences", () => {
    expect(keyForSentence("The CIAT tab joins on the application id, so it needs the name of its id column.")).toBe("source.tabs.ciat.joinColumn");
    expect(keyForSentence("“Owner” is mapped to a column of a tab that is not used. Choose a tab.")).toBe("fields.owner");
    expect(keyForSentence("The display settings are too large to save")).toBe("display.opensOn");
    expect(keyForSentence("Something else")).toBeNull();
  });

  it("clamped paths become friendly labels", () => {
    expect(clampedText(["source.cacheMinutes"])).toBe("Saved. Adjusted to the allowed range: Keep data in memory for.");
    expect(clampedText(["rules.rules.cy.pentestAge.months"])).toMatch(/Last pentest older than 18 months/);
    expect(clampedText([])).toBe("");
  });
});

describe("guard", () => {
  afterEach(() => { resetGuardForTest(); delete globalThis.window; delete globalThis.document; });

  it("asks before leaving only while dirty, and is installed once", () => {
    const listeners = [];
    globalThis.window = { addEventListener: (t, f) => listeners.push([t, f]), removeEventListener: () => {} };
    globalThis.document = { body: { isConnected: true } };
    let dirty = false;
    expect(guardSettings(() => dirty)).toBe(true);
    expect(guardSettings(() => dirty)).toBe(false);
    expect(listeners.length).toBe(1);
    const ev = () => ({ prevented: false, preventDefault() { this.prevented = true; }, returnValue: undefined });
    let e = ev();
    listeners[0][1](e);
    expect(e.prevented).toBe(false);
    dirty = true;
    e = ev();
    listeners[0][1](e);
    expect(e.prevented).toBe(true);
  });
});

describe("the tab views", () => {
  // Audits reads from its own tab here (the legacy shape); the pillars default to the same tab.
  const sepSession = () => {
    const st = settings();
    st.source.tabs.aud = { ...st.source.tabs.aud, name: "Audits", sameTab: false };
    return newSession({ settings: st, cfgGen: 4, headers: { apps: ["UUID", "Name", "Domain"] }, examples: { apps: { Name: "Billing" } }, tabNames: ["Apps", "Audits"] }, URL_OF);
  };
  const ctx = (over) => {
    const s = sepSession();
    return {
      session: s,
      meta: { title: "CCCP data", url: URL_OF, tz: "UTC", loadedAt: "2026-11-11T09:42:00.000Z", dataVersion: 1, tabs: [{ key: "apps", name: "Apps", gid: 1, rows: 1125, missingHeaders: [], unmatched: 0 }, { key: "aud", name: "Audits", gid: 2, rows: 10, missingHeaders: ["Last Audit"], unmatched: 3 }], issues: { missingTabs: [], duplicateIds: [], unparseable: [] } },
      viewer: { canEditSource: true },
      ui: { adv: false, probe: { state: "idle" }, reloadBusy: false, reloadedAt: false },
      errors: {},
      rows: [{ app: { name: "TO DELETE x", lifecycle: "END_OF_LIFE" } }, { app: { name: "Billing", lifecycle: "LIVE" } }],
      ...over,
    };
  };

  it("an owner edits and probes; an admin reads the link with a reason", () => {
    const owner = String(sourceView(ctx()));
    expect(owner).toContain('data-act="s-probe"');
    expect(owner).toContain('data-key="source.sheetId"');
    expect(owner).toContain("Columns missing");
    expect(owner).toContain("1,125");
    const admin = String(sourceView(ctx({ viewer: { canEditSource: false } })));
    expect(admin).not.toContain('data-act="s-probe"');
    expect(admin).not.toContain('data-key="source.sheetId"');
    expect(admin).toContain("data-readonly-link");
    expect(admin).toContain("Only the owner");
  });

  it("a one-tab workbook: the detected tab, pillars on the same tab, no warning styling", () => {
    const st = settings();
    const sess = newSession({ settings: st, cfgGen: 4, headers: { apps: ["UUID", "Name"], ciat: ["UUID", "Name"] }, examples: {}, tabNames: ["Inventory"] }, URL_OF);
    const tabs = [{ key: "apps", name: "Inventory", gid: 1, rows: 1125, missingHeaders: [], unmatched: 0, detected: true }];
    for (const [k, found, n] of [["ciat", 0, 8], ["aud", 0, 4], ["drp", 0, 5], ["plat", 0, 5]]) tabs.push({ key: k, name: "Inventory", gid: 1, rows: 1125, missingHeaders: [], unmatched: 0, sameTab: true, columnsFound: found, columnsMapped: n });
    const out = String(sourceView({ ...ctx({ session: sess }), session: sess, meta: { title: "CCCP data", url: URL_OF, tz: "UTC", loadedAt: "", dataVersion: 1, tabs, issues: { missingTabs: [], duplicateIds: [], unparseable: [], unmapped: [] } } }));
    expect(out).toContain("Inventory · detected");
    expect(out).toContain("Same tab as Applications");
    expect(out).toContain("0 of 8 columns yet");
    expect(out).not.toContain("Columns missing");
    expect(out).not.toContain("res warn");
    expect(out).not.toContain("Tab not found");
    expect(out).not.toContain('data-key="source.tabs.ciat.name"');
  });

  it("choosing a pillar tab sets sameTab and name together", () => {
    let s = chooseTab(session(), "ciat", "CIAT");
    expect(toPatch(s.savedDraft, s.draft)).toEqual({ source: { tabs: { ciat: { name: "CIAT", sameTab: false } } } });
    s = chooseTab(s, "ciat", SAME_TAB);
    expect(isDirty(s)).toBe(true);
    expect(toPatch(s.savedDraft, s.draft)).toEqual({ source: { tabs: { ciat: { name: "CIAT" } } } });
    s = chooseTab(session(), "plat", "");
    expect(applyPatch(s.saved, toPatch(s.savedDraft, s.draft)).source.tabs.plat).toMatchObject({ sameTab: false, name: "" });
  });

  it("Last loaded reads just now after a reload", () => {
    expect(String(sourceView(ctx({ ui: { adv: false, probe: { state: "idle" }, reloadedAt: true } })))).toContain("Last loaded just now");
  });

  it("same-tab pillar columns that are absent are a neutral note, not a warning", () => {
    const out = String(fieldsView({ session: newSession({ settings: settings(), cfgGen: 4, headers: { apps: INV, ciat: INV, aud: INV, drp: INV, plat: INV }, examples: {} }, URL_OF) }));
    expect(out).toContain("data-callout-note");
    expect(out).toContain("not provided yet");
    expect(out).not.toContain("not found in the Sheet");
    expect(out).not.toContain("data-callout>");
  });

  it("the mapping view shows real headers, examples and the callout", () => {
    const out = String(fieldsView({ session: sepSession() }));
    expect(out).toContain('<option value="Domain">Domain</option>');
    expect(out).toContain("Billing");
    expect(out).toContain("not found in the Sheet");
    expect(out).not.toContain("are not mapped");
    const gap = String(fieldsView({ session: edit(edit(session(), "fields.owner", ""), "fields.domain", "") }));
    expect(gap).toContain("2 fields are not mapped");
  });

  it("the display counts follow the draft", () => {
    const rows = ctx().rows;
    expect(hideCounts(rows, { "display.hidePrefix": "to delete" })).toEqual({ prefix: 1, eol: 1 });
    expect(hideCounts(rows, { "display.hidePrefix": "" }).prefix).toBe(0);
    const out = String(displayView({ session: edit(session(), "display.hidePrefix", "bill"), rows, errors: {} }));
    expect(out).toContain('data-cnt="hidePrefix"><b>1</b>');
  });
});
