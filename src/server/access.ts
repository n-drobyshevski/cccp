// Who may use the deployed web app, and in which role: the kit's createAccess, bound to CCCP.
//
// The deployment's own fence is "Anyone within <domain>" (webapp.access DOMAIN, pinned by a
// contract). This narrows it to the addresses in ALLOWED_USERS and ALLOWED_ADMINS, or, in org
// mode, to every account on the owner's domain. Decision order (kit decideAccess): anonymous,
// owner, admin, listed, org, not-listed; an unset, empty or unparseable list admits nobody but
// the owner, who is allowed by IDENTITY. A malformed ACCESS_MODE reads as list.
//
// The Script Property names are CCCP's own (config.ts PROP_KEYS), so stored lists and the mode
// carry over. The kit reads both the delimited text CCCP always stored and the JSON array it
// writes itself; a list is rewritten as JSON on its next save.
//
// The guards live in src/gas/entry.js (denyResult, deniedPage, assertOwner) and in run() (the
// role gate fed by role()): google.script.run reaches top-level globals directly, and the client
// is never the authority.
import { beginExecution, createAccess, getProp, setProp, type AccessChange } from "@gas-kit/server";
import { ACCESS_DEFAULT, PRODUCT, PROP_KEYS } from "./config";

/**
 * One console line per access change, with who and what: the stored value alone says who has
 * access and nothing about who let them in. It runs inside the lock after the save is validated
 * and before the write.
 */
export function logAccessChange(e: AccessChange): void {
  if (e.kind === "mode") {
    console.log(JSON.stringify({ access: "mode", actor: e.actor, before: e.from, after: e.to }));
    return;
  }
  console.log(JSON.stringify({ access: "changed", what: e.kind, actor: e.actor, added: e.added ?? [], removed: e.removed ?? [] }));
}

export const access = createAccess({
  product: PRODUCT,
  props: { get: getProp, set: setProp },
  modeDefault: ACCESS_DEFAULT,
  keys: { users: PROP_KEYS.allowedUsers, admins: PROP_KEYS.allowedAdmins, mode: PROP_KEYS.accessMode },
  onChange: logAccessChange,
  // The deployment is DOMAIN (the manifestWebapp contract pins it), so a caller whose address
  // cannot be read is still inside the Workspace; the denied page and envelope name the owner to
  // them as they always did. The kit's default withholds the owner from an unidentified caller.
  contactAnonymous: true,
});

/** Tests: forget the memoized decision and start a new execution (a new Script Properties snapshot). */
export function __resetMemosForTest(): void {
  access.resetMemo();
  beginExecution();
}
