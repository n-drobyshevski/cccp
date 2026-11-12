// Script Properties access: the keys CCCP reads and the two JSON helpers the settings and
// shared-view stores write through.
//
// Derived from sidekick gas_hub/src/server/props.ts at commit 77bcf22 (see VENDOR.md): the
// sibling-URL keys are gone, the CCCP keys are in, and getJsonProp / putJsonProp enforce the
// 8000-byte section cap before the write rather than leaving it to the platform's raw quota
// exception.
//
// Only the SCRIPT store is used. UserProperties under USER_DEPLOYING is the deployer's store,
// shared by every viewer, so it is never touched (the dev fakes throw on it).

import { utf8ByteLength } from "../vendor/gas_shared/server/errorLog";

export const PROP_KEYS = {
  // Who may open the app, on top of the deployment's own domain fence. See access.ts.
  allowedUsers: "ALLOWED_USERS",
  // Who may edit settings and the people list. Owner-only to change.
  allowedAdmins: "ALLOWED_ADMINS",
  // "list" or "org"; unset means list. Owner-only to change.
  accessMode: "ACCESS_MODE",
  // The settings sections, one property each.
  cfgSource: "CFG_SOURCE",
  cfgFields: "CFG_FIELDS",
  cfgRules: "CFG_RULES",
  cfgDisplay: "CFG_DISPLAY",
  // Shared saved views.
  sharedViews: "SHARED_VIEWS",
  // Cache epochs: the settings generation and the data version.
  cfgGen: "CFG_GEN",
  viewsGen: "VIEWS_GEN",
  dataVersion: "DATA_VERSION",
} as const;

/** One property value may not exceed this many UTF-8 bytes. */
export const PROP_MAX_BYTES = 8000;

export function getProp(key: string): string | null {
  return PropertiesService.getScriptProperties().getProperty(key);
}

export function setProp(key: string, value: string): void {
  PropertiesService.getScriptProperties().setProperty(key, value);
}

export function deleteProp(key: string): void {
  PropertiesService.getScriptProperties().deleteProperty(key);
}

/** The parsed JSON value of a property, or `fallback` when it is unset, empty or malformed. */
export function getJsonProp<T>(key: string, fallback: T): T {
  const raw = getProp(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Store a value as JSON. Refuses above PROP_MAX_BYTES (UTF-8 bytes, the unit the quota counts)
 * BEFORE anything is written, with a sentence the caller can act on.
 */
export function putJsonProp(key: string, value: unknown): void {
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error("Nothing to store for " + key + ".");
  const bytes = utf8ByteLength(json);
  if (bytes > PROP_MAX_BYTES) {
    throw new Error(
      "That is too large to store (" + bytes + " of " + PROP_MAX_BYTES + " bytes in " + key + ").",
    );
  }
  setProp(key, json);
}
