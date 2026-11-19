// The RPC surface. Every export needs a delegator in src/gas/entry.js (a test and the build
// guard hold the two together) and an entry in roles.ts ENDPOINT_ROLES. Later work packages
// append their endpoints here in order.
//
// Derived from sidekick gas_hub/src/server/api.ts at commit 77bcf22 (see VENDOR.md). run() is the
// kit's createRun, bound in run.ts: it checks the role before the body, keeps an ApiError's kind
// and message, and answers any other fault with a fixed sentence and a reference (the text goes
// to the error log, and to an admin as `detail`). A body is exactly `return run("<its name>", ...)`.

import type { BootstrapResponse, RegisterPayload, SaveSettingsResponse, SettingsResponse, SourceMeta } from "../domain/payload";
import type { SavedView } from "../domain/types";
import * as access from "./access";
import { getBootstrap } from "./bootstrap";
import { exportToSheet as exportSheet, type ExportResult } from "./exportSheet";
import { diagnosticsReport, type DiagnosticsReport } from "./diagnostics";
import { ApiError, setProp, withScriptLock } from "@gas-kit/server";
import { PROP_KEYS } from "./config";
import { getRegisterPayload, reloadRegister } from "./registerStore";
import { run } from "./run";
import { sheetIdFrom } from "../domain/settings";
import { getSettingsView, loadSettings, saveSettings as saveSettingsStore } from "./settingsStore";
import { probeWorkbook, type ProbeResult } from "./sourceSheet";
import { deleteSharedView as deleteSharedViewStore, saveSharedView as saveSharedViewStore } from "./sharedViews";

/** The cached viewer-free core, the live per-viewer part and, when warm and small, the register. */
export function bootstrap(_p?: unknown) {
  return run("bootstrap", () => getBootstrap());
}

/** The whole register, encoded. Any allowed caller. */
export function getRegister(_p?: unknown) {
  return run("getRegister", () => getRegisterPayload());
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
export function getAccess(_p?: unknown) {
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
export function saveAccess(p?: { users?: unknown; base?: unknown }) {
  return run("saveAccess", () => {
    if (!access.canEditUsers()) throw new ApiError("forbidden", "Only the owner or an admin can change access.");
    const list = access.validateAddresses(p?.users);
    return withScriptLock(() => saveUsersLocked(list, p?.base));
  });
}

/** A list the client read earlier must still be the stored one, or its whole-list write would revoke someone else's edit. */
function checkBase(base: unknown, current: string[], what: string, ignore = ""): void {
  if (base === undefined) return;
  // The panel shows the owner apart from the list, so the owner never counts as a difference.
  const norm = (l: string[]): string => l.filter((e) => e !== ignore).sort().join(",");
  if (norm(access.validateAddresses(base)) !== norm(current)) {
    throw new ApiError("conflict", "Someone else changed the " + what + " since you opened them. Reload to see their changes, then save again.");
  }
}

function saveUsersLocked(list: string[], base: unknown): { users: string[] } {
  {
    const before = access.currentUsers();
    checkBase(base, before, "access list", access.ownerEmail().trim().toLowerCase());
    // The owner is always written in: redundant with the identity rule, but it keeps the
    // property self-documenting for whoever opens Project Settings.
    const owner = access.ownerEmail().trim().toLowerCase();
    const withOwner = owner && list.indexOf(owner) < 0 ? [owner].concat(list) : list;
    setProp(PROP_KEYS.allowedUsers, withOwner.join(", "));
    logAccessChange("users", access.check().email, before, withOwner);
    return { users: withOwner };
  }
}

/** Add or remove admins. OWNER ONLY: this check is what keeps the admin tier real. */
export function saveAdmins(p?: { admins?: unknown; base?: unknown }) {
  return run("saveAdmins", () => {
    if (!access.canEditAdmins()) throw new ApiError("forbidden", "Only the owner can change admins.");
    const list = access.validateAddresses(p?.admins);
    return withScriptLock(() => {
      const before = access.currentAdmins();
      checkBase(p?.base, before, "admins");
      setProp(PROP_KEYS.allowedAdmins, list.join(", "));
      logAccessChange("admins", access.check().email, before, list);
      return { admins: list };
    });
  });
}

/** Switch between list and org access. OWNER ONLY. Anything but 'org' or 'list' is refused. */
export function saveAccessMode(p?: { mode?: unknown }) {
  return run("saveAccessMode", () => {
    if (!access.canEditMode()) throw new ApiError("forbidden", "Only the owner can change the access mode.");
    const mode = p?.mode;
    if (mode !== "org" && mode !== "list") throw new ApiError("error", "The access mode must be 'org' or 'list'.");
    const before = access.accessMode();
    setProp(PROP_KEYS.accessMode, mode);
    console.log(JSON.stringify({
      access: "mode", actor: access.check().email, before, after: mode,
    }));
    return { mode };
  });
}

/** Settings, with each configured tab's headers and an example value per header. Admin. */
export function getSettings(_p?: unknown) {
  return run("getSettings", () => {
    if (!access.canEditSettings()) throw new ApiError("forbidden", "Only the owner or an admin can open the settings.");
    return getSettingsView();
  });
}

/**
 * What a Sheet holds, so the owner can check a link before saving it: title, time zone and each
 * tab with its row count and headers. An empty link probes the saved source. Saves nothing. Owner.
 */
export function probeSource(p?: { url?: unknown }) {
  return run("probeSource", () => {
    const given = typeof p?.url === "string" ? p.url.trim() : "";
    const id = given === "" ? loadSettings().source.sheetId : sheetIdFrom(given);
    if (id === "") throw new ApiError("error", given === "" ? "No data source is configured yet. Paste the Google Sheet link." : "That does not look like a Google Sheet link.");
    return probeWorkbook(id);
  });
}

/**
 * One save of a partial settings update, under the script lock, against the generation the
 * caller opened (a stale one is a conflict). Changing source.sheetId is OWNER ONLY, re-checked
 * in the store as well as here.
 */
export function saveSettings(p?: { patch?: unknown; baseGen?: unknown }) {
  return run("saveSettings", () => {
    if (!access.canEditSettings()) throw new ApiError("forbidden", "Only the owner or an admin can change the settings.");
    return saveSettingsStore(p?.patch, p?.baseGen, { actor: access.check().email, isOwner: access.canEditSource() });
  });
}

/** Re-read the Sheet now: bumps the data version and primes the cache. Admin. */
export function reloadData(_p?: unknown) {
  return run("reloadData", () => {
    if (!access.canEditSettings()) throw new ApiError("forbidden", "Only the owner or an admin can reload the data.");
    console.log(JSON.stringify({ reload: "data", actor: access.check().email }));
    return reloadRegister();
  });
}

/** Add or replace a shared view. Admin. */
export function saveSharedView(p?: { view?: unknown }) {
  return run("saveSharedView", () => {
    if (!access.canEditSettings()) throw new ApiError("forbidden", "Only the owner or an admin can share a view.");
    return saveSharedViewStore(p?.view, access.check().email);
  });
}

/** Remove a shared view. Admin. */
export function deleteSharedView(p?: { id?: unknown }) {
  return run("deleteSharedView", () => {
    if (!access.canEditSettings()) throw new ApiError("forbidden", "Only the owner or an admin can delete a shared view.");
    return deleteSharedViewStore(p?.id, access.check().email);
  });
}

/** The diagnostics report. Admin. Never throws. */
export function getDiagnostics(_p?: unknown) {
  return run("getDiagnostics", () => diagnosticsReport());
}

/** Build a new Google Sheet from the given application ids and columns, shared to the caller. Viewer. */
export function exportToSheet(p?: { ids?: unknown; columns?: unknown; title?: unknown }) {
  return run("exportToSheet", () => exportSheet(p));
}
