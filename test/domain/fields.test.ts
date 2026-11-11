import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCsv, REAL_CSV } from "../../dev/genTabs.mjs";
import { FIELDS, FIELD_BY_KEY, FIELD_KEYS, GROUPS, PICK_DATE, fieldsOfTab } from "../../src/domain/fields";
import { DEFAULT_SETTINGS } from "../../src/domain/settings";
import { TAB_KEYS } from "../../src/domain/types";

describe("field catalogue", () => {
  it("has unique keys and a definition for every key", () => {
    expect(new Set(FIELD_KEYS).size).toBe(FIELDS.length);
    for (const d of FIELDS) expect(FIELD_BY_KEY[d.key]).toBe(d);
  });

  it("uses only known tabs, groups and types", () => {
    for (const d of FIELDS) {
      expect(TAB_KEYS).toContain(d.binding);
      expect(GROUPS).toContain(d.group);
      expect(d.label.length).toBeGreaterThan(0);
    }
  });

  it("has the 11 Apps fields with the real CSV headers as defaults", () => {
    const apps = fieldsOfTab("apps");
    expect(apps.map((d) => d.defaultHeader).sort()).toEqual(
      ["Backup Owner Name", "Domain", "Lifecycle", "Name", "Owner Name", "Security Officer Name", "Subdomain", "Support Group", "Tiering", "Typology", "UUID"].sort(),
    );
    expect(apps).toHaveLength(11);
  });

  it("orders every pick group by a date field of the same group and tab", () => {
    for (const [g, key] of Object.entries(PICK_DATE)) {
      expect(FIELD_BY_KEY[key].pickGroup).toBe(g);
      expect(FIELD_BY_KEY[key].type).toBe("date");
    }
    for (const d of FIELDS) if (d.pickGroup) expect(FIELD_BY_KEY[PICK_DATE[d.pickGroup]].binding).toBe(d.binding);
  });

  it("marks the completeness fields", () => {
    const m = FIELDS.filter((d) => d.mandatory).map((d) => d.key);
    expect(m).toHaveLength(17);
    expect(m).toContain("owner");
    expect(m).toContain("lastDrpTest");
  });

  it("the defaults in settings come from the catalogue", () => {
    for (const d of FIELDS) expect(DEFAULT_SETTINGS.fields[d.key]).toEqual({ binding: d.binding, header: d.defaultHeader });
  });

  it.skipIf(!existsSync(REAL_CSV))("the default mapping resolves the 11 Apps headers of the real CSV", () => {
    const headers = parseCsv(readFileSync(REAL_CSV, "utf8"))[0]!.map((h) => h.trim().toLowerCase());
    for (const d of fieldsOfTab("apps")) {
      const header = DEFAULT_SETTINGS.fields[d.key].header;
      expect(headers, header).toContain(header.toLowerCase());
    }
  });
});
