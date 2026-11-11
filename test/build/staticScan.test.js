// The read-only guarantee, as a scan of src/server: the register Sheet is touched in ONE file,
// the advanced Sheets and Drive services in ONE other, and no source mutator is named anywhere.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url).pathname;
const serverDir = join(root, "src/server");
const files = readdirSync(serverDir).filter((f) => f.endsWith(".ts"));
const read = (f) => readFileSync(join(serverDir, f), "utf8");

// Code only: block comments and whole-line comments are dropped, so prose may name a service.
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const using = (re) => files.filter((f) => re.test(code(read(f)))).sort();

describe("static scan of src/server", () => {
  it("has the modules it should", () => {
    expect(files).toEqual(expect.arrayContaining(["sourceSheet.ts", "registerStore.ts", "api.ts"]));
  });

  it("calls SpreadsheetApp only in sourceSheet.ts", () => {
    expect(using(/\bSpreadsheetApp\b/)).toEqual(["sourceSheet.ts"]);
  });

  it("calls the Sheets and Drive advanced services only in exportSheet.ts", () => {
    const hits = using(/\b(Sheets|Drive)\.[A-Z]\w*/);
    expect(hits.filter((f) => f !== "exportSheet.ts")).toEqual([]);
  });

  it("never names a spreadsheet mutator", () => {
    const MUTATORS = [
      "setValue", "setValues", "setFormula", "setFormulas", "appendRow", "insertSheet", "deleteSheet", "duplicateSheet",
      "insertRows", "insertRowsAfter", "insertRowsBefore", "insertRowBefore", "insertRowAfter", "insertColumns",
      "insertColumnAfter", "insertColumnBefore", "deleteRow", "deleteRows", "deleteColumn", "deleteColumns",
      "clearContents", "clearContent", "clearFormats", "clearNotes", "setNote", "setNotes", "setBackground", "setBackgrounds",
      "setFrozenRows", "setFrozenColumns", "setNumberFormat", "setNumberFormats", "setSpreadsheetTimeZone",
      "setSpreadsheetLocale", "addEditor", "addEditors", "addViewer", "addViewers", "removeEditor", "removeViewer",
      "setDataValidation", "insertCheckboxes", "setConditionalFormatRules", "protect", "setActiveSheet",
    ];
    const re = new RegExp("\\.(" + MUTATORS.join("|") + ")\\s*\\(");
    const hits = files.filter((f) => re.test(code(read(f))));
    expect(hits).toEqual([]);
    expect(using(/SpreadsheetApp\s*\.\s*(create|open)\b/)).toEqual([]);
  });

  it("never touches UserProperties, the user cache or the user lock", () => {
    expect(using(/\b(getUserProperties|getUserCache|getUserLock|getDocumentProperties)\b/)).toEqual([]);
  });

  it("hands nothing but plain data out of sourceSheet.ts", () => {
    const src = code(read("sourceSheet.ts"));
    expect(src).not.toMatch(/export\s+(function|const)\s+\w+\s*(\([^)]*\))?\s*:\s*GoogleAppsScript/);
    expect(src).not.toMatch(/return\s+(ss|sheet|range)\s*;/);
  });
});
