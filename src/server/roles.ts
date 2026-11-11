// The role of every RPC, and the gate run() applies before any body executes.
//
// EVERY export of api.ts must be listed here: test/server/roles.test.ts reads api.ts and fails
// on an unclassified export, and an endpoint missing from this table is refused at run time
// (fail closed). Entries may name endpoints that later work packages add.
//
//   viewer  any allowed caller (listed, org, admin, owner)
//   admin   owner or admin
//   owner   the deploying account only

import { role as callerRole, type DenyEnvelope, type Role } from "./access";

export type { Role };

export const ENDPOINT_ROLES = {
  bootstrap: "viewer",
  getRegister: "viewer",
  getAccess: "viewer",
  exportToSheet: "viewer",
  getSettings: "admin",
  saveSettings: "admin",
  reloadData: "admin",
  saveSharedView: "admin",
  deleteSharedView: "admin",
  saveAccess: "admin",
  getDiagnostics: "admin",
  saveAdmins: "owner",
  saveAccessMode: "owner",
  probeSource: "owner",
} as const satisfies Record<string, Role>;

const RANK: Record<Role, number> = { viewer: 1, admin: 2, owner: 3 };

/** True when `have` (null for a denied caller) meets `need`. */
export function roleAllows(have: Role | null, need: Role): boolean {
  return have !== null && RANK[have] >= RANK[need];
}

/** The role an endpoint needs, or undefined when it is not classified. */
export function requiredRole(name: string): Role | undefined {
  return Object.prototype.hasOwnProperty.call(ENDPOINT_ROLES, name)
    ? (ENDPOINT_ROLES as Record<string, Role>)[name]
    : undefined;
}

/**
 * The role gate: null when the caller may run `name`, else a forbidden envelope. An
 * unclassified endpoint is refused. A refusal is logged as a console line, not recorded as a
 * fault.
 */
export function requireRole(name: string): DenyEnvelope | null {
  const need = requiredRole(name);
  const have = callerRole();
  if (need !== undefined && roleAllows(have, need)) return null;
  console.log(JSON.stringify({ access: "refused", op: name, need: need ?? "unclassified", have }));
  return {
    ok: false,
    error: need === undefined ? "That action is not available." : "You don't have permission to do that.",
    errorKind: "forbidden",
  };
}
