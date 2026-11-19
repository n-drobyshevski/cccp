// The final name of each source endpoint in the target, as one pure rule the rpc-surface, gsr-to-call
// and server-park steps share, so their order in the plan does not change what a call is named.
// A name a person set in plan.maps.rpc wins (it must be a valid endpoint name the template does not
// use); otherwise a name the template's api.ts already exports, or one that is not a valid endpoint
// name, becomes legacy<Name> (legacy<Name>2 ... on a clash with any name that stays, whatever the
// order). Every other name stays as it is. Two endpoints that are one name once api_ is dropped are
// refused. The
// template's endpoint names come from the kit checkout's templates/register/src/server/api.ts, else
// a fixed list (a CLI vendored into an app has no template).
import { readFileSync } from "node:fs";
import { join } from "node:path";

const API = "src/server/api.ts";
/** Names the target's entry or server already use for something else. */
export const RESERVED = new Set(["doGet", "doPost", "include", "setup", "deploymentDiagnostic", "refreshRegister", "run", "obj", "constructor", "prototype", "default"]);
/** An endpoint name: camelCase letters and digits. */
export const VALID = /^[a-z][A-Za-z0-9]*$/;
/** The endpoints of a fresh template, for a kit checkout that does not ship it. */
const TEMPLATE_FALLBACK = ["bootstrap", "listItems", "getItem", "getSettings", "saveSettings", "getAccess", "saveUsers", "saveAdmins", "saveMode", "reloadData", "exportToSheet"];

/** @type {Map<string, Set<string>>} */
const templateCache = new Map();

/** The export names of an api.ts text. @param {string} text */
export function exportsOf(text) {
  return [...text.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)].map((m) => /** @type {string} */ (m[1]));
}

/** The names the template's api.ts exports. @param {string} kitRoot @returns {Set<string>} */
export function templateNames(kitRoot) {
  const had = templateCache.get(kitRoot);
  if (had) return had;
  /** @type {Set<string>} */
  let names = new Set(TEMPLATE_FALLBACK);
  try {
    const found = exportsOf(readFileSync(join(kitRoot, "templates", "register", API), "utf8"));
    if (found.length) names = new Set(found);
  } catch {
    // the kit checkout has no template (an app running a vendored CLI): the fixed list stands in
  }
  templateCache.set(kitRoot, names);
  return names;
}

/**
 * The endpoints of the source: the call name (api_ dropped), the global's own name, where it is. Two
 * globals with one call name (api_save and save) give the first, in key and line order; finalRpcNames
 * refuses such a source (endpointClashes).
 * @param {import("../schema.mjs").Inventory} inv
 */
export function sourceEndpoints(inv) {
  /** @type {Map<string, { call: string, global: string, key: string, line: number }>} */
  const seen = new Map();
  for (const g of sortedGlobals(inv)) {
    const call = g.name.replace(/^api_/, "");
    if (!seen.has(call)) seen.set(call, { call, global: g.name, key: g.key, line: g.line });
  }
  return [...seen.values()];
}

/** The endpoint globals in a fixed order (key, line, name), whatever order the inventory lists them in. @param {import("../schema.mjs").Inventory} inv */
function sortedGlobals(inv) {
  return (inv.globals ?? []).filter((g) => g.kind === "endpoint").sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.line - b.line || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)));
}

/**
 * The call names two source endpoints share once api_ is dropped (api_save and save are both save in
 * the kit), each with the globals that claim it and where they are.
 * @param {import("../schema.mjs").Inventory} inv
 * @returns {string[]}
 */
export function endpointClashes(inv) {
  /** @type {Map<string, string[]>} */
  const by = new Map();
  for (const g of sortedGlobals(inv)) {
    const call = g.name.replace(/^api_/, "");
    const at = g.name + " (" + g.key + ":" + g.line + ")";
    const list = by.get(call) ?? [];
    if (!list.some((x) => x.startsWith(g.name + " "))) list.push(at);
    by.set(call, list);
  }
  return [...by].filter(([, list]) => list.length > 1).map(([call, list]) => call + ": " + list.join(" and "));
}

/** @param {string} s */
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Every source endpoint (and every name the source calls) with its final name. Pure and independent
 * of the order the inventory lists things in: the same inventory, rename map and template names give
 * the same answer. First every name that stays (a valid name the template does not use) and every
 * rename a person set is taken; then each other name, in sorted order, gets legacy<Name> (or
 * legacy<Name>2 ...) free of all of those. A global's own name (api_save) answers as its call name
 * does. Throws on a rename a person set that cannot stand, when two endpoints would get one name, and
 * when two source endpoints are one call name (api_save and save): fail-safe, as either choice would
 * silently send one endpoint's calls to the other.
 * @param {import("../schema.mjs").Inventory} inv
 * @param {Record<string, unknown>} given plan.maps.rpc
 * @param {Set<string>} template the template's endpoint names
 * @returns {{ names: Record<string, string>, notes: string[] }}
 */
export function finalRpcNames(inv, given, template) {
  const clash = endpointClashes(inv);
  if (clash.length) throw new Error("two source endpoints are one name once api_ is dropped (" + clash.join("; ") + "): rename one of them in the source, then run migrate:inventory and migrate:plan again");
  const eps = sourceEndpoints(inv);
  const calls = [...eps.map((e) => ({ call: e.call, global: e.global }))];
  for (const n of [...new Set(inv.rpc ?? [])]) {
    const call = n.replace(/^api_/, "");
    if (!calls.some((c) => c.call === n || c.global === n || c.call === call)) calls.push({ call, global: n });
  }
  calls.sort((a, b) => (a.call < b.call ? -1 : a.call > b.call ? 1 : 0));
  /** @type {Record<string, string>} a null prototype: a called name such as __proto__ is a key like any other */
  const names = Object.create(null);
  /** @type {Set<string>} */
  const taken = new Set();
  /** @type {string[]} */
  const notes = [];
  /** @param {string} k */
  const asked = (k) => (Object.prototype.hasOwnProperty.call(given, k) && typeof given[k] === "string" ? /** @type {string} */ (given[k]) : undefined);
  /** @type {Map<{ call: string, global: string }, string>} */
  const kept = new Map();
  // A map entry that names an endpoint's own global (api_save: "api_save", as a plan seeds it) asks for
  // nothing: the endpoint keeps its call name, api_ dropped.
  /** @param {{ call: string, global: string }} ep */
  const wanted = (ep) => {
    const w = asked(ep.call) ?? asked(ep.global) ?? ep.call;
    return w === ep.global ? ep.call : w;
  };
  for (const ep of calls) {
    const want = wanted(ep);
    const edited = want !== ep.call && want !== ep.global;
    const bad = !VALID.test(want) || RESERVED.has(want);
    if (edited) {
      if (bad || template.has(want)) throw new Error("maps.rpc renames " + ep.call + " to " + JSON.stringify(want) + ", which " + (bad ? "is not a valid endpoint name (camelCase letters and digits, not reserved)" : "the template already uses") + "; edit .migrate/plan.json");
      kept.set(ep, want);
    } else if (!bad && !template.has(want)) kept.set(ep, want);
  }
  for (const [, name] of kept) {
    if (taken.has(name)) throw new Error("two endpoints would both be " + name + "; edit maps.rpc in .migrate/plan.json");
    taken.add(name);
  }
  for (const ep of calls) {
    let name = kept.get(ep);
    if (name === undefined) {
      const want = wanted(ep);
      const stem = "legacy" + cap(want.replace(/[^A-Za-z0-9]+/g, " ").trim().replace(/\s+(\w)/g, (_m, c) => String(c).toUpperCase()));
      name = stem;
      for (let i = 2; template.has(name) || taken.has(name) || !VALID.test(name) || RESERVED.has(name); i++) {
        if (i > 99) throw new Error("no free name for the endpoint " + JSON.stringify(ep.call));
        name = stem + i;
      }
      taken.add(name);
      notes.push(ep.call + " is " + (template.has(want) ? "a name the template uses" : "not a valid endpoint name") + ": carried as " + name);
    }
    names[ep.call] = name;
    if (ep.global !== ep.call) names[ep.global] = name;
  }
  return { names, notes };
}

/**
 * The final name of one source endpoint (or called name), from the step context: the plan's
 * maps.rpc, the inventory and the template's names. A name the source never had stays as it is.
 * @param {string} name the source's name (api_ dropped or not)
 * @param {{ inv: import("../schema.mjs").Inventory, plan: { maps: Record<string, any> }, kitRoot: string }} ctx
 */
export function finalRpcName(name, ctx) {
  const { names } = finalRpcNames(ctx.inv, /** @type {Record<string, unknown>} */ (ctx.plan.maps["rpc"] ?? {}), templateNames(ctx.kitRoot));
  const call = name.replace(/^api_/, "");
  return names[call] ?? names[name] ?? name;
}
