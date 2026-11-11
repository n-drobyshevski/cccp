import { BUILD_ID } from "../vendor/gas_shared/server/buildInfo";

// The RPC surface. Every export needs a delegator in src/gas/entry.js (a test and the build
// guard hold the two together) and, from the access work package on, an entry in roles.ts.
// Later work packages append their endpoints here in order.

export interface ApiResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  errorKind?: "error" | "busy" | "conflict" | "forbidden";
}

function run<T>(fn: () => T): ApiResult<T> {
  try {
    return { ok: true, data: fn() };
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e), errorKind: "error" };
  }
}

/** Stub: the real bootstrap (cached core plus live fields) arrives with the data path. */
export function bootstrap(_p?: unknown): ApiResult<{ stub: true; buildId: string }> {
  return run(() => ({ stub: true as const, buildId: BUILD_ID }));
}
