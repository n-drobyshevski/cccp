// The app's server-side constants: the Script Property names CCCP reads and writes. The helpers
// that read and write them (getProp, putJsonProp, withScriptLock, ...) come from the kit.
//
// Only the SCRIPT store is used. UserProperties under USER_DEPLOYING is the deployer's store,
// shared by every viewer, so it is never touched (the dev fakes throw on it).

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
