// Extracted from the author's production Apps Script apps; adapted.
// The role of every RPC, and the gate run() applies before any body executes.
//
// An app lists every export of its api.ts in one table, ENDPOINT_ROLES, and binds the gate:
//
//   const gate = createRoleGate(ENDPOINT_ROLES, () => access.role(), { who: () => access.decide().email });
//   export const run = createRun({ requireRole: gate.requireRole, recordError });
//
// The roles:
//   viewer  any allowed caller (listed, org, admin, owner)
//   admin   owner or admin
//   owner   the deploying account only
//
// FAIL CLOSED. An endpoint missing from the table is refused, and so is a name the table only
// inherits ("constructor", "toString"): lookup is by own property. A table entry that is not a
// role throws when the gate is created, so a typo cannot ship as a silent refusal or grant. A
// caller role that is not one of the three reads as denied.
//
// A refusal is not a fault: it is one JSON console line, never an error-log record.

import type { ApiResult } from "./envelope";

export type Role = "viewer" | "admin" | "owner";

/** Every role, lowest first. */
export const ROLES: readonly Role[] = ["viewer", "admin", "owner"];

const RANK: Record<Role, number> = { viewer: 1, admin: 2, owner: 3 };

/** True for exactly one of the three role names. */
export function isRole(v: unknown): v is Role {
  return v === "viewer" || v === "admin" || v === "owner";
}

/** True when `have` (null for a denied caller) meets `need`. */
export function roleAllows(have: Role | null, need: Role): boolean {
  if (!isRole(have) || !isRole(need)) return false;
  return RANK[have] >= RANK[need];
}

/**
 * The refusal envelope minted by the role gate and by access.denyResult. It is an
 * ApiResult<never>, so run() hands it back as-is.
 */
export interface DenyEnvelope extends ApiResult<never> {
  ok: false;
  error: string;
  errorKind: "forbidden";
  /** The owner's address, for a "contact X" line. Absent when it could not be resolved. */
  contact?: string;
  /** A mailto for that line, with the subject filled in. */
  contactUrl?: string;
}

export const UNCLASSIFIED_MESSAGE = "That action is not available.";
export const NOT_PERMITTED_MESSAGE = "You don't have permission to do that.";

export interface RoleGate {
  /** The role an endpoint needs, or undefined when it is not classified. */
  requiredRole(name: string): Role | undefined;
  /** Null when the caller may run `name`, else a forbidden envelope (and one console line). */
  requireRole(name: string): DenyEnvelope | null;
}

export interface RoleGateOptions {
  /**
   * The caller's address, added to the refusal line as `who` so a probe can be attributed.
   * A throw or a non-string leaves `who` out; the refusal stands either way.
   */
  who?: () => string;
}

export function createRoleGate(
  table: Readonly<Record<string, Role>>,
  callerRole: () => Role | null,
  opts: RoleGateOptions = {},
): RoleGate {
  if (table === null || typeof table !== "object") throw new Error("createRoleGate: the role table must be an object.");
  const bad = Object.keys(table).filter((k) => !isRole(table[k]));
  if (bad.length) {
    throw new Error("createRoleGate: not a role (viewer, admin or owner) for " + bad.join(", ") + ".");
  }

  function requiredRole(name: string): Role | undefined {
    if (typeof name !== "string" || !Object.prototype.hasOwnProperty.call(table, name)) return undefined;
    const need = table[name];
    return isRole(need) ? need : undefined;
  }

  function requireRole(name: string): DenyEnvelope | null {
    const need = requiredRole(name);
    const got = callerRole();
    const have = isRole(got) ? got : null;
    if (need !== undefined && roleAllows(have, need)) return null;
    const line: Record<string, unknown> = { access: "refused", op: name, need: need ?? "unclassified", have };
    if (opts && typeof opts.who === "function") {
      try {
        const w = opts.who();
        if (typeof w === "string") line["who"] = w;
      } catch {
        // the refusal does not depend on naming the caller
      }
    }
    console.log(JSON.stringify(line));
    return {
      ok: false,
      error: need === undefined ? UNCLASSIFIED_MESSAGE : NOT_PERMITTED_MESSAGE,
      errorKind: "forbidden",
    };
  }

  return { requiredRole, requireRole };
}
