// The rpc-surface step: every server endpoint the source exposes (inv.globals of kind endpoint, an
// api_ prefix dropped) becomes an endpoint of the target in the three places that must agree: an
// export of src/server/api.ts, a row of ENDPOINT_ROLES in roles.ts, and a delegator in src/gas/entry.js,
// plus its row of the role matrix in test/contracts.test.ts. These are the edits of the template's own
// add-rpc script, made here as text patches (that script reads and writes the disk itself, and the
// target's copy is target code). The body throws "not migrated yet" and the role is the one in
// plan.maps.roles, else owner, so a carried endpoint fails closed until the classify-roles step.
// The final name of each endpoint is finalRpcNames' (steps/_rpcName.mjs), the rule gsr-to-call and
// server-park use too: a name the template already uses, or that is not a valid identifier, becomes
// legacy<Name>, and the pair is recorded in maps.rpc.
import { drift } from "./_common.mjs";
import { finalRpcNames, sourceEndpoints, templateNames } from "./_rpcName.mjs";

export { sourceEndpoints };

const API = "src/server/api.ts";
const ROLES = "src/server/roles.ts";
const ENTRY = "src/gas/entry.js";
const CONTRACTS = "test/contracts.test.ts";
const ALLOWED = { viewer: '["owner", "admin", "viewer"]', admin: '["owner", "admin"]', owner: '["owner"]' };

/**
 * Add one endpoint to the four files, as text patches. Idempotent: a file that has it is left alone.
 * @param {import("../apply.mjs").StepContext} ctx @param {string} name @param {"viewer" | "admin" | "owner"} role @param {string} what
 */
function addEndpoint(ctx, name, role, what) {
  const api = ctx.readTarget(API);
  if (api === null) drift("rpc-surface", API + " is missing");
  if (!/import\s*\{[^}]*\bApiError\b[^}]*\}\s*from\s*"@gas-kit\/server"/.test(api)) drift("rpc-surface", API + " does not import ApiError from @gas-kit/server");
  if (!new RegExp("export (async )?function " + name + "\\b").test(api)) {
    const stub = ["", "/** " + what + " */", "export function " + name + "(_p?: Params) {", '  return run("' + name + '", () => { throw new ApiError("error", "not migrated yet: ' + name + '"); });', "}", ""].join("\n");
    ctx.out.write(API, api.replace(/\s*$/, "\n") + stub);
  }
  const roles = ctx.readTarget(ROLES);
  if (roles === null) drift("rpc-surface", ROLES + " is missing");
  if (!new RegExp("^\\s+" + name + ":", "m").test(roles)) ctx.patchTarget(ROLES, /^\} as const satisfies/m, (m) => "  " + name + ': "' + role + '",\n' + m);
  const entry = ctx.readTarget(ENTRY);
  if (entry === null) drift("rpc-surface", ENTRY + " is missing");
  if (!new RegExp("function api_" + name + "\\(").test(entry)) {
    const re = /^function api_\w+\(p\) \{ return timedApi_\("\w+", p\); \}[ \t]*$/gm;
    /** @type {RegExpExecArray | null} */
    let last = null;
    for (let m = re.exec(entry); m; m = re.exec(entry)) last = m;
    if (!last) drift("rpc-surface", ENTRY + " has no api_ delegator line to insert after");
    ctx.patchTarget(ENTRY, last[0], (m) => m + "\nfunction api_" + name + '(p) { return timedApi_("' + name + '", p); }');
  }
  const tests = ctx.readTarget(CONTRACTS);
  if (tests === null) drift("rpc-surface", CONTRACTS + " is missing");
  const matrix = /const endpoints = \{[\s\S]*?\n {2}\};/;
  if (!matrix.test(tests)) drift("rpc-surface", CONTRACTS + " has no 'const endpoints = {' role matrix");
  const start = tests.indexOf("const endpoints = {");
  if (!new RegExp("^\\s+" + name + ": \\{ allowed", "m").test(tests.slice(start))) ctx.patchTarget(CONTRACTS, matrix, (m) => m.replace(/\n {2}\};$/, "\n    " + name + ": { allowed: " + ALLOWED[role] + " },\n  };"));
}

/** @param {import("../apply.mjs").StepContext} ctx */
export function run(ctx) {
  const eps = sourceEndpoints(ctx.inv);
  /** @type {Record<string, string>} */
  const roles = /** @type {any} */ (ctx.plan.maps).roles ?? {};
  let final;
  try {
    final = finalRpcNames(ctx.inv, /** @type {Record<string, unknown>} */ (ctx.plan.maps.rpc ?? {}), templateNames(ctx.kitRoot));
  } catch (e) {
    throw new Error("rpc-surface: " + /** @type {Error} */ (e).message);
  }
  /** @type {Record<string, string>} */
  const names = {};
  const notes = final.notes.filter((n) => eps.some((ep) => n.startsWith(ep.call + " ")));
  for (const ep of eps) {
    const name = /** @type {string} */ (final.names[ep.call]);
    names[ep.call] = name;
    const asked = roles[ep.call] ?? roles[ep.global] ?? roles[name] ?? "owner";
    /** @type {"viewer" | "admin" | "owner"} */
    let role = "owner";
    if (asked === "viewer" || asked === "admin" || asked === "owner") role = asked;
    else notes.push(ep.call + ": role " + JSON.stringify(String(asked).slice(0, 40)) + " is not viewer, admin or owner: carried as owner");
    addEndpoint(ctx, name, role, ("Not migrated yet: " + ep.call + " (source " + ep.key + ":" + ep.line + "). Port the body, then lower the role if it is wrong.").replace(/\*\//g, ""));
  }
  notes.unshift(eps.length + " endpoint" + (eps.length === 1 ? "" : "s") + " carried; each body throws until it is ported");
  return { notes, maps: { rpc: names } };
}
