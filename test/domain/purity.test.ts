import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// src/domain is compiled into both the server and the client bundle, so it may touch neither
// Apps Script nor the DOM nor the clock. Comments and string literals are blanked first, so
// prose that merely names a global does not trip the scan.

const ROOT = resolve(__dirname, "../../src/domain");

function blank(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && n === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
    } else if (c === '"' || c === "'" || c === "`") {
      i++;
      while (i < src.length && src[i] !== c) i += src[i] === "\\" ? 2 : 1;
      i++;
      out += '""';
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

export const FORBIDDEN: [string, RegExp][] = [
  ["Apps Script service", /\b(SpreadsheetApp|PropertiesService|CacheService|LockService|ScriptApp|HtmlService|UrlFetchApp|DriveApp|DocumentApp|GmailApp|MailApp|Session|Utilities|Logger|ContentService|Sheets|Drive)\s*\./],
  ["google.script", /\bgoogle\s*\.\s*script\b/],
  ["document", /\bdocument\b/],
  ["window", /\bwindow\b/],
  ["browser storage or navigator", /\b(localStorage|sessionStorage|navigator|location|history)\b/],
  ["Node API", /\b(process|require|Buffer|__dirname)\b/],
  ["clock", /\bDate\s*\.\s*now\b|\bnew\s+Date\s*\(\s*\)|\bperformance\s*\.\s*now\b/],
  ["randomness", /\bMath\s*\.\s*random\b/],
  ["local time zone", /\.(getFullYear|getMonth|getDate|getDay|getHours|getMinutes|getTimezoneOffset|toLocale\w*)\s*\(/],
];

export function violations(src: string): string[] {
  const code = blank(src);
  return FORBIDDEN.filter(([, re]) => re.test(code)).map(([name]) => name);
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
}

describe("src/domain purity", () => {
  const all = files(ROOT);

  it("finds the domain files", () => {
    expect(all.length).toBeGreaterThanOrEqual(7);
  });

  for (const f of all) {
    it(f.slice(ROOT.length + 1) + " uses no GAS global, DOM, Node API or clock", () => {
      expect(violations(readFileSync(f, "utf8"))).toEqual([]);
    });
  }

  it("imports only from the domain itself and the vendored pure codecs", () => {
    for (const f of all) {
      for (const m of readFileSync(f, "utf8").matchAll(/from\s+"([^"]+)"/g)) {
        const spec = m[1]!;
        expect(spec.startsWith("./") || /^\.\.\/vendor\/gas_shared\/domain\/[a-zA-Z0-9]+$/.test(spec), f + " imports " + spec).toBe(true);
      }
    }
  });

  it("the scanner catches what it should and ignores prose", () => {
    expect(violations("const a = SpreadsheetApp.getActive();")).toContain("Apps Script service");
    expect(violations("const t = new Date();")).toContain("clock");
    expect(violations("document.title = 'x'")).toContain("document");
    expect(violations("window.alert(1)")).toContain("window");
    expect(violations("d.getHours()")).toContain("local time zone");
    expect(violations("// uses SpreadsheetApp.get and document\nconst s = 'window document Date.now()'; /* new Date() */")).toEqual([]);
  });
});
