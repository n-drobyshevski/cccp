import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AppRecord } from "../../src/domain/types";
import { DEFAULT_RULES, evaluate } from "../../src/domain/rules";
import { completeness } from "../../src/domain/quality";
import { makeRow } from "../../src/domain/facets";
import type { Row } from "../../src/domain/facets";
import { mk } from "./mk";

export const TODAY = "2026-11-11";

export function rowOf(over: Partial<AppRecord> = {}): Row {
  const app = mk(over);
  return makeRow(app, evaluate(app, DEFAULT_RULES, TODAY), completeness(app).pct);
}

export function fixtureRows(): Row[] {
  const apps = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/apps60.json"), "utf8")) as AppRecord[];
  return apps.map((a) => makeRow(a, evaluate(a, DEFAULT_RULES, TODAY), completeness(a).pct));
}
