// Installs the Apps Script fakes from dev/gas-shims.js as globals for a node test, and puts
// the previous globals back afterwards. The same file drives the browser dev harness.
//
//   const env = installGasEnv({ workbook: genWorkbook() });
//   ...
//   env.uninstall();
//
// or, inside a suite, `useGasEnv()` installs before each test and restores after it.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach } from "vitest";
import { genWorkbook, type Workbook } from "../dev/genTabs.mjs";

export const GAS_GLOBALS = [
  "Utilities", "PropertiesService", "Session", "ScriptApp", "LockService", "CacheService",
  "HtmlService", "SpreadsheetApp", "Sheets", "Drive", "__gasFakes",
] as const;

export interface GasFakes {
  WRITE_ERROR: string;
  OWNER: string;
  counters(): Record<string, number> & { propGetKeys: Record<string, number> };
  resetCounters(): void;
  calls(): Array<{ svc: string; args: Record<string, unknown> }>;
  exports(): Array<{ spreadsheet: Record<string, unknown>; values: Record<string, unknown[][]>; batches: unknown[]; permissions: unknown[] }>;
  loadWorkbook(wb: Workbook, o?: { empty?: boolean; tz?: string }): string;
  seedDefaults(o?: { sheetId?: string; mode?: string | null; admins?: string | null; nosource?: boolean }): void;
  setActiveUser(email: string): void;
  setEffectiveUser(email: string): void;
  setSourceAccess(ok: boolean): void;
  setCacheDisabled(off: boolean): void;
  clearCache(): void;
  holdLock(held: boolean): void;
  setHtmlFile(name: string, content: string): void;
  advance(ms: number): void;
  now(): number;
  reset(): void;
}

const SHIMS = readFileSync(new URL("../dev/gas-shims.js", import.meta.url), "utf8");
const g = globalThis as unknown as Record<string, unknown>;

export interface GasEnv {
  fakes: GasFakes;
  uninstall(): void;
}

export function installGasEnv(opts: { workbook?: Workbook; seed?: boolean } = {}): GasEnv {
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const name of GAS_GLOBALS) saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  // The shim file picks its host from `window`; hand it globalThis without defining `window`.
  new Function("window", SHIMS)(globalThis);
  const fakes = g.__gasFakes as GasFakes;
  fakes.reset();
  if (opts.workbook) {
    const id = fakes.loadWorkbook(opts.workbook);
    if (opts.seed) fakes.seedDefaults({ sheetId: id });
  }
  return {
    fakes,
    uninstall() {
      for (const name of GAS_GLOBALS) {
        const d = saved.get(name);
        if (d) Object.defineProperty(globalThis, name, d);
        else delete g[name];
      }
    },
  };
}

/** Install before each test and restore after it. Returns a getter for the live fakes. */
export function useGasEnv(opts: { workbook?: boolean; seed?: boolean } = {}): () => GasFakes {
  let env: GasEnv | null = null;
  beforeEach(() => {
    env = installGasEnv({ workbook: opts.workbook ? genWorkbook() : undefined, seed: opts.seed });
  });
  afterEach(() => {
    env?.uninstall();
    env = null;
  });
  return () => {
    if (!env) throw new Error("useGasEnv: fakes are only available inside a test");
    return env.fakes;
  };
}
