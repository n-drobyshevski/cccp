// Extracted from the author's production Apps Script apps; adapted.
// Calls the server bundle once per identity and endpoint and compares the outcome with a table.
//
// opts:
//   server      the loaded server bundle or entry globals (passed through to call)
//   identities  [{ label, setup?(), teardown?() }]  setup puts the fakes in that identity's state.
//               The access decision is memoized per execution, so setup must call
//               access.resetMemo() (or otherwise drop the memo) after it changes the identity.
//   expect      { name: { allowed: [identity label, ...], params?: any } }  the expected matrix, as
//               ARCHITECTURE names it. In register() the test runner's expect is the third
//               argument, so the table is read from opts.expect there and the runner never
//               collides with it. endpoints is an accepted alias of the same table.
//   rolesTable  optional ENDPOINT_ROLES object or name list; when given, every key must appear in
//               endpoints, so an endpoint left out of the matrix is reported instead of untested
//   roleIdentities optional { role: [identity label, ...] }, the identities that hold each role of
//               the roles table (viewer: owner, admin, viewer; admin: owner, admin; owner: owner).
//               With an object rolesTable, an endpoint whose allowed list differs from the set of
//               its role is reported (a hand-written row cannot drift from roles.ts), and the
//               identities must include one that no role and no endpoint allows (a stranger).
//   call        (server, name, params, identity) => result | Promise<result>  (default: server[name](params))
//   isForbidden (result) => boolean   (default: the kit's refusal envelope, errorKind "forbidden",
//               as run() and the role gate return it; a thrown ApiError of kind "forbidden" counts
//               too)
//   state       () => snapshot | false   required. A refusal envelope says nothing about what ran
//               before it: an endpoint that drops a cache or writes a property and then refuses
//               looks refused. So the state is snapshotted after setup and again after every call
//               that was refused (or threw a refusal), and a difference is a violation. Over the
//               kit's fakes pass state: () => storeState(fakes), which covers the Script
//               Properties AND the script cache (a refused reload that only drops the cache
//               changes no property). state: false says the server has no store to compare (a
//               plain object in a unit test); leaving it out is reported, so the check is never
//               skipped by omission. The identities a row refuses are called before the ones it
//               allows, so an allowed call's own legitimate change does not hide a refused one's.
//   prepare     () => void   optional, run before each identity's setup: put the stores in a state
//               that a side effect would change (fresh fakes with a warm cache, say), so a
//               refused call that drops or writes something is seen whatever ran before it.

/**
 * The state of the kit's Apps Script fakes that a refused call must not change: every Script
 * Property, and every script cache entry with its expiry. JSON-comparable.
 * @param {{ props: Map<string, string>, cache: Map<string, { v: string, exp: number }> }} fakes the installGasFakes handle
 * @returns {{ properties: [string, string][], cache: [string, string, number][] }}
 */
export function storeState(fakes) {
  if (!fakes || !(fakes.props instanceof Map) || !(fakes.cache instanceof Map)) throw new TypeError("storeState needs the installGasFakes handle (its props and cache)");
  return {
    properties: [...fakes.props.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    cache: [...fakes.cache.entries()].map(([k, e]) => /** @type {[string, string, number]} */ ([k, e.v, e.exp])).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
  };
}

/**
 * The matrix table of an options object: expect (the spec name) or its alias endpoints.
 * @param {{ expect?: any, endpoints?: any }} opts
 * @returns {Record<string, {allowed: string[], params?: any}>}
 */
function tableOf(opts) {
  const t = opts.expect ?? opts.endpoints;
  if (!t || typeof t !== "object") throw new TypeError("roleMatrix needs the expected matrix as expect: { endpoint: { allowed: [identity labels] } }");
  return t;
}

/** @param {any} r */
function defaultForbidden(r) {
  return !!r && typeof r === "object" && r.ok === false && r.errorKind === "forbidden";
}

/** @param {any} e a thrown value */
const thrownForbidden = (e) => !!e && typeof e === "object" && e.kind === "forbidden";

/**
 * Keys of the roles table that the matrix does not mention and, when roleIdentities is given with
 * an object rolesTable, rows whose allowed set differs from their role's, plus a missing denied
 * identity.
 * @param {{ expect?: Record<string, any>, endpoints?: Record<string, any>, rolesTable?: Record<string, unknown> | string[],
 *   roleIdentities?: Record<string, string[]>, identities?: { label: string }[] }} opts
 * @returns {string[]} violations
 */
export function coverage(opts) {
  const { rolesTable, roleIdentities, identities } = opts;
  if (!rolesTable) return [];
  const endpoints = tableOf(opts);
  const keys = Array.isArray(rolesTable) ? rolesTable : Object.keys(rolesTable);
  const bad = keys.filter((k) => !(k in endpoints)).map((k) => k + ": classified in the roles table but missing from the role matrix");
  if (!roleIdentities || Array.isArray(rolesTable)) return bad;
  const sorted = (/** @type {string[]} */ a) => [...new Set(a)].sort();
  for (const [name, spec] of Object.entries(endpoints)) {
    if (!(name in rolesTable)) continue;
    const role = String(/** @type {Record<string, unknown>} */ (rolesTable)[name]);
    const want = roleIdentities[role];
    if (!Array.isArray(want)) { bad.push(name + ": role " + JSON.stringify(role) + " has no entry in roleIdentities"); continue; }
    const got = sorted(spec.allowed || []);
    if (JSON.stringify(got) !== JSON.stringify(sorted(want))) {
      bad.push(name + ": the matrix allows [" + got.join(", ") + "] but its role " + role + " in the roles table is held by [" + sorted(want).join(", ") + "]");
    }
  }
  if (identities) {
    const allowed = new Set([...Object.values(roleIdentities).flat(), ...Object.values(endpoints).flatMap((e) => e.allowed || [])]);
    if (!identities.some((i) => !allowed.has(i.label))) bad.push("the identities include none that is allowed nowhere: add a caller on no list (a stranger), who must be refused everywhere");
  }
  return bad;
}

/** JSON text of a state snapshot, or a marker when it cannot be taken. @param {() => unknown} state */
function snapshot(state) {
  try { return JSON.stringify(state()); } catch (e) { return "unreadable state: " + String(e && /** @type {any} */ (e).message); }
}

/**
 * @param {{ server: any, identities: {label: string, setup?: () => void, teardown?: () => void}[],
 *   expect?: Record<string, {allowed: string[], params?: any}>,
 *   endpoints?: Record<string, {allowed: string[], params?: any}>,
 *   rolesTable?: Record<string, unknown> | string[], roleIdentities?: Record<string, string[]>,
 *   call?: (server: any, name: string, params: any, identity: any) => any,
 *   isForbidden?: (r: any) => boolean, state?: (() => unknown) | false, prepare?: () => void }} opts
 * @returns {Promise<string[]>} violations
 */
export async function check(opts) {
  const { server, identities, rolesTable, roleIdentities, call, isForbidden = defaultForbidden, state } = opts;
  const endpoints = tableOf(opts);
  const invoke = call || ((/** @type {any} */ s, /** @type {string} */ n, /** @type {any} */ p) => s[n](p));
  /** @type {string[]} */ const bad = coverage({ expect: endpoints, rolesTable, roleIdentities, identities });
  if (state !== false && typeof state !== "function") bad.push("roleMatrix needs state: () => storeState(fakes) (the Script Properties and the script cache), so a refused call that changed either is seen; pass state: false only for a server with no store");
  const labels = identities.map((i) => i.label);
  for (const [name, spec] of Object.entries(endpoints)) {
    for (const a of spec.allowed) if (!labels.includes(a)) bad.push(name + ": allowed lists unknown identity " + a);
    const ordered = [...identities.filter((i) => !spec.allowed.includes(i.label)), ...identities.filter((i) => spec.allowed.includes(i.label))];
    for (const id of ordered) {
      const want = spec.allowed.includes(id.label);
      opts.prepare?.();
      id.setup?.();
      /** @type {boolean} */ let forbidden = false;
      /** @type {string | null} */ let crashed = null;
      /** @type {string | null} */ let changed = null;
      const before = typeof state === "function" ? snapshot(state) : null;
      try {
        forbidden = !!isForbidden(await invoke(server, name, spec.params, id));
      } catch (e) {
        if (thrownForbidden(e)) forbidden = true;
        else crashed = String(e && /** @type {any} */ (e).message);
      } finally {
        if (forbidden && typeof state === "function" && snapshot(state) !== before) changed = "refused, but changed the stored state (Script Properties or script cache) before refusing";
        id.teardown?.();
      }
      if (crashed !== null) {
        bad.push(name + " as " + id.label + ": threw " + crashed);
        continue;
      }
      if (changed) bad.push(name + " as " + id.label + ": " + changed);
      if (want && forbidden) bad.push(name + " as " + id.label + ": expected allowed, got forbidden");
      if (!want && !forbidden) bad.push(name + " as " + id.label + ": expected forbidden, was allowed");
    }
  }
  return bad;
}

/** @param {any} describe @param {any} it @param {any} expect @param {Parameters<typeof check>[0]} opts */
export function register(describe, it, expect, opts) {
  describe("role matrix", () => {
    const table = tableOf(opts);
    for (const name of Object.keys(table)) {
      it(name + " is allowed or forbidden per identity as the table says", async () => {
        const only = { ...opts, rolesTable: undefined, expect: { [name]: table[name] }, endpoints: undefined };
        expect(await check(only)).toEqual([]);
      });
    }
    if (opts.rolesTable) {
      it(opts.roleIdentities ? "covers every classified endpoint, as its role in the roles table says" : "covers every classified endpoint", () => {
        expect(coverage(opts)).toEqual([]);
      });
    }
  });
}
