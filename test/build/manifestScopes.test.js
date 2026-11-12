import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(new URL("../../src/gas/appsscript.json", import.meta.url), "utf8"));

const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/script.scriptapp",
  // SpreadsheetApp.openById refuses spreadsheets.readonly, so the full scope is required. The
  // source stays read-only by code: only sourceSheet.ts touches SpreadsheetApp, and the static
  // scans refuse any mutator in src/server.
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/userinfo.email",
];

describe("the manifest", () => {
  it("is a DOMAIN web app executing as the deployer", () => {
    expect(manifest.webapp.access).toBe("DOMAIN");
    expect(manifest.webapp.executeAs).toBe("USER_DEPLOYING");
  });
  it("pins exactly the four scopes", () => {
    expect([...manifest.oauthScopes].sort()).toEqual(SCOPES);
  });
  it("never asks for full Drive access", () => {
    expect(manifest.oauthScopes).not.toContain("https://www.googleapis.com/auth/drive");
  });
  it("enables the Sheets v4 and Drive v3 advanced services", () => {
    const svc = manifest.dependencies.enabledAdvancedServices.map((s) => [s.userSymbol, s.serviceId, s.version]);
    expect(svc).toEqual([["Sheets", "sheets", "v4"], ["Drive", "drive", "v3"]]);
  });
  it("uses the V8 runtime", () => {
    expect(manifest.runtimeVersion).toBe("V8");
  });
});
