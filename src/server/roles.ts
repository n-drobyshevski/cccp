// The role every endpoint needs. Every export of api.ts must be listed here (the endpointsClassified
// contract fails on one that is not, and the role gate in run.ts refuses an unlisted name at run
// time), and has a delegator in src/gas/entry.js.
//   viewer  any allowed caller (listed, org, admin, owner)
//   admin   owner or admin
//   owner   the deploying account only
import type { Role } from "@gas-kit/server";

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
