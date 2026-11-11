import { afterAll, beforeAll } from "vitest";

/** The zones the date-dependent suites run under: the default and one far ahead of UTC. */
export const ZONES = ["UTC", "Pacific/Kiritimati"] as const;

/** Call inside a describe: sets process.env.TZ for its tests and restores it afterwards. */
export function useZone(tz: string): void {
  let prev: string | undefined;
  beforeAll(() => {
    prev = process.env.TZ;
    process.env.TZ = tz;
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.TZ;
    else process.env.TZ = prev;
  });
}
