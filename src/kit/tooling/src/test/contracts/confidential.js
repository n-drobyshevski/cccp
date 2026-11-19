// A confidential app is deployed and configured the strict way, and every weakening of its policy
// is explained in writing. When app.config.mjs says dataClass "confidential", it fails unless:
//   - the manifest runs as the deploying account (USER_DEPLOYING) and admits the owner's domain
//     or the owner alone (webapp.access DOMAIN or MYSELF, never ANYONE or ANYONE_ANONYMOUS);
//   - the access mode default is "list" (no whole-domain access before anyone chose it);
//   - DATA_CLASS in src/server/config.ts says "confidential" too, and the policy the server
//     built from it is the confidential one;
//   - every key in weakened (weakenedKeys(policy), the overrides that make the policy weaker than
//     its class) has a non-empty written reason in app.config.mjs acceptedRisks.
// For an internal app it only checks that dataClass is one of the two known values.
import { readFileSync } from "node:fs";
import { wire } from "./_util.js";

export const DATA_CLASSES = ["internal", "confidential"];
export const CONFIDENTIAL_ACCESS = ["DOMAIN", "MYSELF"];

/**
 * @param {{ appConfig?: Record<string, any>, manifestPath?: string, manifest?: string | Record<string, any>,
 *   dataClass?: unknown, policy?: { dataClass?: unknown } | null, weakened?: string[] }} opts
 *   appConfig: the app's app.config.mjs default export. manifestPath or manifest: appsscript.json
 *   (path, text or parsed). dataClass: DATA_CLASS from src/server/config.ts. policy: the policy
 *   the server uses (src/server/policy.ts). weakened: weakenedKeys(policy) from @gas-kit/server.
 * @returns {string[]} violations
 */
export function check({ appConfig, manifestPath, manifest, dataClass, policy, weakened }) {
  if (!appConfig || typeof appConfig !== "object") return ["confidential needs appConfig (the default export of app.config.mjs)"];
  const cls = appConfig.dataClass;
  if (!DATA_CLASSES.includes(cls)) return ["app.config.mjs dataClass is " + JSON.stringify(cls) + "; it must be \"internal\" or \"confidential\""];
  if (cls !== "confidential") return [];

  /** @type {string[]} */ const bad = [];
  /** @type {any} */ let m = manifest;
  try {
    if (m === undefined) m = manifestPath ? readFileSync(manifestPath, "utf8") : undefined;
    if (typeof m === "string") m = JSON.parse(m);
  } catch (e) {
    m = undefined;
    bad.push("the manifest cannot be read: " + /** @type {Error} */ (e).message);
  }
  if (m === undefined && !bad.length) bad.push("confidential needs manifestPath or manifest");
  else if (m !== undefined) {
    const w = m && typeof m === "object" ? m.webapp : undefined;
    if (!w || typeof w !== "object") bad.push("the manifest has no webapp section");
    else {
      if (w.executeAs !== "USER_DEPLOYING") bad.push("a confidential app must run as USER_DEPLOYING, not " + JSON.stringify(w.executeAs));
      if (!CONFIDENTIAL_ACCESS.includes(w.access)) bad.push("a confidential app admits DOMAIN or MYSELF at Google's door, not " + JSON.stringify(w.access));
    }
  }
  if (appConfig.accessDefault !== "list") bad.push("a confidential app's accessDefault must be \"list\", not " + JSON.stringify(appConfig.accessDefault));
  if (dataClass !== "confidential") bad.push("app.config.mjs says confidential but DATA_CLASS in src/server/config.ts is " + JSON.stringify(dataClass));
  if (!policy || typeof policy !== "object" || policy.dataClass !== "confidential") {
    bad.push("the server's policy is not the confidential one (src/server/policy.ts must build it from DATA_CLASS)");
  }
  if (!Array.isArray(weakened)) bad.push("confidential needs weakened: the result of weakenedKeys(policy)");
  else {
    const risks = appConfig.acceptedRisks && typeof appConfig.acceptedRisks === "object" ? appConfig.acceptedRisks : {};
    for (const k of weakened) {
      const why = Object.prototype.hasOwnProperty.call(risks, k) ? risks[k] : undefined;
      if (typeof why !== "string" || why.trim() === "") {
        bad.push("the override " + k + " weakens the confidential policy; write why it is acceptable in app.config.mjs acceptedRisks." + k);
      }
    }
  }
  return bad;
}

/** @param {any} describe @param {any} it @param {any} expect @param {Parameters<typeof check>[0]} opts */
export function register(describe, it, expect, opts) {
  wire(describe, it, expect, "the confidential data class", () => check(opts));
}
