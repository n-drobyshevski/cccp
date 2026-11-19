// The read-only guarantee, as a scan of src/server: the register Sheet is touched in ONE app file
// (sourceSheet.ts, which keeps the multi-tab read the kit has no equivalent for), no app file calls
// the advanced Sheets and Drive services (the kit's sheetExport.ts is the only module that does,
// and it writes a NEW file), and no source mutator is named anywhere.
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

  // A member access, with the TypeScript non-null mark: Sheets!.Spreadsheets!.create, Drive.Files.update.
  const ADVANCED = /(?<![\w$.])(Sheets|Drive)\s*[!?]*\s*\.\s*[A-Z]\w*/;

  it("calls the Sheets and Drive advanced services in no app file", () => {
    expect(using(ADVANCED)).toEqual([]);
  });

  it("the advanced-service pattern fires on a seeded violation", () => {
    expect(ADVANCED.test("Sheets!.Spreadsheets!.create({})")).toBe(true);
    expect(ADVANCED.test("Drive.Permissions.create(a, b)")).toBe(true);
    expect(ADVANCED.test("const sheets = rows.Sheets")).toBe(false);
  });

  it("in the kit, only sheetExport.ts (and the audit sink, which no app file wires yet) call them", () => {
    const kitDir = join(root, "src/kit/server/src");
    const kit = readdirSync(kitDir).filter((f) => f.endsWith(".ts"));
    const hits = kit.filter((f) => ADVANCED.test(code(readFileSync(join(kitDir, f), "utf8")))).sort();
    expect(hits).toEqual(["audit.ts", "sheetExport.ts"]);
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
