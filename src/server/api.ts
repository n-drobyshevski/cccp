// The RPC surface. Every export needs a delegator in src/gas/entry.js (a test and the build
// guard hold the two together) and an entry in roles.ts ENDPOINT_ROLES. Later work packages
// append their endpoints here in order.
//
// Derived from sidekick gas_hub/src/server/api.ts at commit 77bcf22 (see VENDOR.md): keeps
// run(), logAccessChange, getAccess, saveAccess and saveAdmins; run() checks the role before
// the body; the errorKinds busy and conflict are added; the URL endpoints are gone.

import { BUILD_ID } from "../vendor/gas_shared/server/buildInfo";
import * as access from "./access";
import { ApiError, recordError, type ErrorKind } from "./errors";
import { PROP_KEYS, setProp } from "./props";
import { requireRole } from "./roles";

export interface ApiResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  errorKind?: ErrorKind;
}

/**
 * THE ENVELOPE, and the role gate. The role check runs first: a refused call never reaches
 * `fn`, so it cannot reach a property write. A thrown ApiError keeps its kind (busy,
 * conflict); anything else is an `error` and is recorded in the recent-errors log.
 */
function run<T>(name: string, fn: () => T): ApiResult<T> {
  const refused = requireRole(name);
  if (refused) return refused as ApiResult<T>;
  try {
    return { ok: true, data: fn() };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: e.message, errorKind: e.kind };
    recordError(name, e);
    return { ok: false, error: String(e instanceof Error ? e.message : e), errorKind: "error" };
  }
}

/** Stub: the real bootstrap (cached core plus live fields) arrives with the data path. */
export function bootstrap(_p?: unknown): ApiResult<{ stub: true; buildId: string }> {
  return run("bootstrap", () => ({ stub: true as const, buildId: BUILD_ID }));
}

/**
 * A change to who may reach the app, logged with actor and before/after: the value alone says
 * who has access and nothing about who let them in.
 */
function logAccessChange(what: string, actor: string, before: string[], after: string[]): void {
  const added = after.filter((e) => before.indexOf(e) < 0);
  const removed = before.filter((e) => after.indexOf(e) < 0);
  console.log(JSON.stringify({ access: "changed", what, actor, added, removed }));
}

/**
 * What the Access panel needs. Any allowed caller may ask, but THE ROSTER IS ONLY INCLUDED FOR
 * SOMEONE WHO MAY EDIT IT: nothing on the wire for a viewer, not just nothing in the DOM.
 */
export function getAccess(_p?: unknown): ApiResult<Record<string, unknown>> {
  return run("getAccess", () => {
    if (!access.canEditUsers()) {
      return { canEditUsers: false, canEditAdmins: false, canEditMode: false };
    }
    return {
      canEditUsers: true,
      canEditAdmins: access.canEditAdmins(),
      canEditMode: access.canEditMode(),
      mode: access.accessMode(),
      owner: access.ownerEmail(),
      domain: access.ownerDomain(),
      users: access.currentUsers(),
      admins: access.currentAdmins(),
    };
  });
}

/** Add or remove people. Owner or admin. Re-checks: the panel is not the boundary. */
export function saveAccess(p?: { users?: unknown }): ApiResult<{ users: string[] }> {
  return run("saveAccess", () => {
    if (!access.canEditUsers()) throw new Error("Only the owner or an admin can change access.");
    const before = access.currentUsers();
    const list = access.validateAddresses(p?.users);
    // The owner is always written in: redundant with the identity rule, but it keeps the
    // property self-documenting for whoever opens Project Settings.
    const owner = access.ownerEmail().trim().toLowerCase();
    const withOwner = owner && list.indexOf(owner) < 0 ? [owner].concat(list) : list;
    setProp(PROP_KEYS.allowedUsers, withOwner.join(", "));
    logAccessChange("users", access.check().email, before, withOwner);
    return { users: withOwner };
  });
}

/** Add or remove admins. OWNER ONLY: this check is what keeps the admin tier real. */
export function saveAdmins(p?: { admins?: unknown }): ApiResult<{ admins: string[] }> {
  return run("saveAdmins", () => {
    if (!access.canEditAdmins()) throw new Error("Only the owner can change admins.");
    const before = access.currentAdmins();
    const list = access.validateAddresses(p?.admins);
    setProp(PROP_KEYS.allowedAdmins, list.join(", "));
    logAccessChange("admins", access.check().email, before, list);
    return { admins: list };
  });
}

/** Switch between list and org access. OWNER ONLY. Anything but 'org' or 'list' is refused. */
export function saveAccessMode(p?: { mode?: unknown }): ApiResult<{ mode: access.AccessMode }> {
  return run("saveAccessMode", () => {
    if (!access.canEditMode()) throw new Error("Only the owner can change the access mode.");
    const mode = p?.mode;
    if (mode !== "org" && mode !== "list") throw new Error("The access mode must be 'org' or 'list'.");
    const before = access.accessMode();
    setProp(PROP_KEYS.accessMode, mode);
    console.log(JSON.stringify({
      access: "mode", actor: access.check().email, before, after: mode,
    }));
    return { mode };
  });
}
