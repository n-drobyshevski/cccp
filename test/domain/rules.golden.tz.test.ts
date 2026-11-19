import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, evaluateAll, RULES_VERSION } from "../../src/domain/rules";
import type { AppRecord } from "../../src/domain/types";
import { ZONES, useZone } from "./tz";

// Regenerate with: UPDATE_GOLDEN=1 npx vitest run --project domain test/domain/rules.golden.test.ts
const FIX = resolve(__dirname, "../fixtures");
const GOLDEN = resolve(FIX, "rules.golden.json");
const apps = JSON.parse(readFileSync(resolve(FIX, "apps60.json"), "utf8")) as AppRecord[];
const compute = () => ({ version: RULES_VERSION, today: "2026-11-11", results: evaluateAll(apps, DEFAULT_RULES, "2026-11-11") });

describe.each(ZONES)("rules golden under %s", (tz) => {
  useZone(tz);
  it("evaluateAll(apps60) equals rules.golden.json", () => {
    if (process.env.UPDATE_GOLDEN === "1") {
      writeFileSync(GOLDEN, JSON.stringify(compute(), null, 1) + "\n");
    }
    expect(existsSync(GOLDEN)).toBe(true);
    expect(apps).toHaveLength(60);
    expect(JSON.parse(JSON.stringify(compute()))).toEqual(JSON.parse(readFileSync(GOLDEN, "utf8")));
  });
});
