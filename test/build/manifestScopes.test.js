import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(new URL("../../src/gas/appsscript.json", import.meta.url), "utf8"));

const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/script.scriptapp",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
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
  it("never asks for a writable spreadsheet or full drive scope", () => {
    expect(manifest.oauthScopes).not.toContain("https://www.googleapis.com/auth/spreadsheets");
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
