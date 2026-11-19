// The server-map step of the kit-shaped profile, in two runs. The first (server-map) maps the
// source's server modules onto the kit: a module whose job the kit's server kernel does (props,
// locks, pageShell, errors..., maps.SERVER_FILE_FOR) is not copied, since the template already has
// the kit's; roles.ts is carry-roles' and index.ts and main.ts stay with the template's own; every
// other module, api.ts included, is copied to src/server/app/<x>.ts with its imports pointed at
// @gas-kit/server (when the kit exports every name it takes), at the template's own modules (when
// they export the names), at src/domain/app or at another copied module. A module that cannot be
// made to typecheck there, or that names an Apps Script service (SECURITY.md: such a module is
// reviewed into the contracts' allow lists by a person), stays in .migrate/pending with an agent
// step port-server-<x>. When api.ts was copied, the step spawns server-endpoints, a run of this same
// module that waits for rpc-surface: it turns each "not migrated yet" stub of a source endpoint into
// a call into src/server/app/api.ts. Only a stub is replaced, never a body a person wrote, and an
// endpoint whose shape it does not know (several positional parameters, async) keeps its stub.
import { SERVER_FILE_FOR, SERVER_SPECIFIER, kitExports } from "../maps.mjs";
import { scanJs, tokenizeJs } from "../scan/js.mjs";
import { jsHeader, pendingPath } from "./_common.mjs";
import { agentStep, domainTarget, importSites, listOf, rewriteImports, serverRuleBreaks, spawnId } from "./copyDomain.mjs";
import { closeOf, splitArgs } from "./kitImports.mjs";

/** @typedef {import("../apply.mjs").StepContext} StepContext */
/** @typedef {import("../apply.mjs").StepResult} StepResult */
/** @typedef {import("./copyDomain.mjs").Located} Located */
/** @typedef {import("./copyDomain.mjs").SpawnStep} SpawnStep */

const SERVER = "src/server/";
const APP = "src/server/app/";
const API = "src/server/api.ts";
const LEGACY_API = "src/server/app/api.ts";
/** The modules the template owns: its own stand in for the source's. */
const OWNED = new Set(["api.ts", "roles.ts", "index.ts", "main.ts"]);
const SPAWNED = "server-endpoints";
const NS = "legacyApi";

/** The target path of a source server key. @param {string} key */
export const serverTarget = (key) => APP + key.slice(SERVER.length).replace(/\.js$/, ".ts");

/** @param {string} key */
const covered = (key) => {
  const rel = key.slice(SERVER.length);
  return !rel.includes("/") && Object.prototype.hasOwnProperty.call(SERVER_FILE_FOR, rel.replace(/\.(?:ts|js)$/, ""));
};

/**
 * The source's endpoint functions: export function NAME(params) at the top level of api.ts.
 * @param {string} text
 * @returns {{ name: string, params: string[], async: boolean }[]}
 */
export function endpointFunctions(text) {
  const toks = tokenizeJs(text).filter((t) => t.type !== "comment");
  /** @type {{ name: string, params: string[], async: boolean }[]} */
  const out = [];
  let depth = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = /** @type {import("../scan/js.mjs").JsToken} */ (toks[i]);
    if (t.type === "punct" && t.value === "{") depth++;
    else if (t.type === "punct" && t.value === "}") depth--;
    if (depth !== 0 || t.value !== "export" || t.type !== "ident") continue;
    let j = i + 1;
    const isAsync = toks[j]?.value === "async";
    if (isAsync) j++;
    if (toks[j]?.value !== "function") continue;
    const name = toks[j + 1]?.value;
    if (!name || toks[j + 2]?.value !== "(") continue;
    const close = closeOf(toks, j + 2);
    if (close < 0) continue;
    const params = splitArgs(toks, j + 3, close).map(([a, b]) => text.slice(/** @type {any} */ (toks[a]).start, /** @type {any} */ (toks[b - 1]).end));
    out.push({ name, params, async: isAsync });
  }
  return out;
}

/**
 * The text range of `export function name(` ... its closing brace in a TypeScript text, or null.
 * @param {string} text @param {string} name
 */
export function functionRange(text, name) {
  const m = new RegExp("^(?:/\\*\\*[^\\n]*\\*/\\n)?export (?:async )?function " + name + "\\(", "m").exec(text);
  if (!m) return null;
  const toks = tokenizeJs(text.slice(m.index)).filter((t) => t.type !== "comment");
  const open = toks.findIndex((t) => t.type === "punct" && t.value === "{");
  if (open < 0) return null;
  const close = closeOf(toks, open);
  if (close < 0) return null;
  return { start: m.index, end: m.index + /** @type {any} */ (toks[close]).end };
}

/**
 * The ported text of one endpoint: the template's shape (one run() call, its own name), the
 * source's body called from src/server/app/api.ts.
 * @param {string} target the endpoint's name in the target @param {string} source its name in the source @param {number} arity
 */
export function portedEndpoint(target, source, arity) {
  const call = arity === 0 ? NS + "." + source + "()" : NS + "." + source + "(obj(p) as Parameters<typeof " + NS + "." + source + ">[0])";
  return [
    "/** The source's " + source + " (" + API + "), ported by gas-kit migrate: the body is in ./app/api.ts. */",
    "export function " + target + "(p?: Params) {",
    "  return run(" + JSON.stringify(target) + ", () => " + call + ");",
    "}",
  ].join("\n");
}

/** A stub rpc-surface (or the template's add-rpc script) wrote, which a port may replace. @param {string} fn */
const isStub = (fn) => /not migrated yet/.test(fn) || /received:\s*Object\.keys\(obj\(p\)\)/.test(fn);

/** @param {StepContext} ctx @returns {StepResult} */
export function run(ctx) {
  return ctx.step.spawnedBy ? portEndpoints(ctx) : mapModules(ctx);
}

/** @param {StepContext} ctx @returns {StepResult} */
function mapModules(ctx) {
  const keys = ctx.inv.files.filter((f) => f.key.startsWith(SERVER) && (f.kind === "ts" || f.kind === "js")).map((f) => f.key).sort();
  const kit = new Set(kitExports(ctx.kitRoot, SERVER_SPECIFIER));
  /** @type {string[]} */
  const notes = [];
  /** @type {string[]} */
  const app = [];
  for (const key of keys) {
    const rel = key.slice(SERVER.length);
    if (covered(key)) {
      notes.push(key + ": the kit's server kernel (" + SERVER_SPECIFIER + ", " + SERVER_FILE_FOR[rel.replace(/\.(?:ts|js)$/, "")] + ") does its job; not copied");
      ctx.out.remove(pendingPath(key));
    } else if (rel === "roles.ts") notes.push(key + ": carried by carry-roles");
    else if (rel === "index.ts" || rel === "main.ts") notes.push(key + ": the template's own " + rel + " stands in (kept in .migrate/pending to compare)");
    else app.push(key);
  }
  /** @type {Set<string>} */
  const failed = new Set();
  /** @type {Map<string, { text: string, problems: string[] }>} */
  let results = new Map();
  for (let round = 0; round <= app.length; round++) {
    results = new Map();
    let more = false;
    for (const key of app) {
      /** @param {string} k @param {import("./copyDomain.mjs").ImportSite} site @returns {Located} */
      const locate = (k, site) => {
        const names = (site.names ?? []).map((n) => n.imported);
        if (k.startsWith("src/domain/")) return ctx.readTarget(domainTarget(k)) !== null ? { path: domainTarget(k) } : { problem: "imports " + k + ", which stays pending" };
        if (k.startsWith(SERVER) && covered(k)) {
          const missing = names.filter((n) => !kit.has(n));
          if (!names.length || missing.length) return { problem: "imports " + (missing.length ? missing.join(", ") : "everything") + " from " + k + ", which " + SERVER_SPECIFIER + " does not export" };
          return { spec: SERVER_SPECIFIER };
        }
        if (k.startsWith(SERVER) && OWNED.has(k.slice(SERVER.length))) {
          const own = ctx.readTarget(k);
          const has = new Set(own === null ? [] : scanJs(own).exports);
          const missing = names.filter((n) => !has.has(n));
          if (!names.length || missing.length) return { problem: "imports " + (missing.length ? missing.join(", ") : "everything") + " from " + k + ", which the template's " + k + " does not export" };
          return { path: k };
        }
        if (app.includes(k)) return failed.has(k) ? { problem: "imports " + k + ", which stays pending" } : { path: serverTarget(k) };
        return { problem: "imports " + k + ", which is not server or domain code the migration ports" };
      };
      const text = ctx.tree.read(key);
      const r = rewriteImports(text, key, serverTarget(key), ctx.tree.resolve, locate);
      const problems = [...new Set([...r.problems, ...serverRuleBreaks(text)])];
      results.set(key, { text: r.text, problems });
      if (problems.length && !failed.has(key)) {
        failed.add(key);
        more = true;
      }
    }
    if (!more) break;
  }
  /** @type {SpawnStep[]} */
  const spawn = [];
  let copied = 0;
  for (const key of app) {
    const r = /** @type {{ text: string, problems: string[] }} */ (results.get(key));
    if (failed.has(key)) {
      notes.push(key + " stays in .migrate/pending: " + listOf(r.problems));
      spawn.push(agentStep({ id: spawnId(ctx, "port-server", key.slice(SERVER.length).replace(/\.(?:ts|js)$/, "")), title: "Port the server module " + key + " by hand", why: key + " cannot be copied as it is: " + listOf(r.problems), reads: [key], writes: [serverTarget(key)] }));
      continue;
    }
    ctx.out.write(serverTarget(key), jsHeader(ctx.step.id, key) + r.text);
    // api.ts keeps its pending copy until every endpoint body is ported (server-endpoints).
    if (key !== API) ctx.out.remove(pendingPath(key));
    copied++;
  }
  notes.unshift(copied + " server module" + (copied === 1 ? "" : "s") + " copied into " + APP);
  if (app.includes(API) && !failed.has(API) && endpointFunctions(ctx.tree.read(API)).length) {
    const after = ["rpc-surface"].filter((id) => ctx.plan.steps.some((s) => s.id === id));
    spawn.push({
      id: SPAWNED,
      kind: "tool",
      run: "serverMap",
      title: "Port the endpoint bodies that are plain calls into the copied server code",
      after: [ctx.step.id, ...after],
      files: { reads: [API], writes: [API] },
      verify: ["check", "build", "kit:verify"],
    });
  }
  return { notes, ...(spawn.length ? { spawn } : {}) };
}

/** @param {StepContext} ctx @returns {StepResult} */
function portEndpoints(ctx) {
  /** @type {string[]} */
  const notes = [];
  if (ctx.readTarget(LEGACY_API) === null) return { notes: [LEGACY_API + " is not in the target: no endpoint body to port"] };
  const api = ctx.readTarget(API);
  if (api === null) throw new Error(ctx.step.id + ": the template drifted: " + API + " is missing");
  if (!/^const obj = /m.test(api) || !/^type Params\b/m.test(api) || !/^import \{[^}]*\brun\b[^}]*\} from "\.\/run";$/m.test(api)) {
    throw new Error(ctx.step.id + ": the template drifted: " + API + " has no obj(), Params or run import to port into");
  }
  const rpc = /** @type {Record<string, string>} */ (ctx.plan.maps.rpc ?? {});
  let text = api;
  /** @type {string[]} */
  const open = [];
  let ported = 0;
  for (const ep of endpointFunctions(ctx.tree.read(API))) {
    const target = rpc[ep.name] ?? ep.name;
    const range = functionRange(text, target);
    if (!range) {
      open.push(ep.name + " (no endpoint " + target + " in " + API + ")");
      continue;
    }
    if (ep.async || ep.params.length > 1) {
      open.push(ep.name + " (" + (ep.async ? "async" : ep.params.length + " positional parameters") + ": the kit passes one object)");
      continue;
    }
    const gen = portedEndpoint(target, ep.name, ep.params.length);
    const now = text.slice(range.start, range.end);
    if (now === gen) {
      ported++;
      continue;
    }
    if (!isStub(now)) {
      open.push(ep.name + " (" + target + " is not a stub any more: left as it is)");
      continue;
    }
    text = text.slice(0, range.start) + gen + text.slice(range.end);
    ported++;
    notes.push(ep.name + " ported into " + target);
  }
  if (ported && !text.includes("import * as " + NS + " from")) {
    const sites = importSites(text).filter((s) => !s.dynamic);
    const last = sites[sites.length - 1];
    if (!last) throw new Error(ctx.step.id + ": the template drifted: " + API + " has no import to add one after");
    text = text.slice(0, last.stmtEnd) + "\n" + ["import * as", NS, "from", JSON.stringify("./app/api") + ";"].join(" ") + text.slice(last.stmtEnd);
  }
  if (text !== api) ctx.out.write(API, text);
  /** @type {SpawnStep[]} */
  const spawn = [];
  if (open.length) {
    notes.push("left as stubs: " + listOf(open));
    spawn.push(agentStep({ id: spawnId(ctx, "port-server", "api"), title: "Port the remaining endpoint bodies of " + API, why: "these endpoints still throw \"not migrated yet\": " + listOf(open), reads: [API], writes: [API, LEGACY_API] }));
  } else ctx.out.remove(pendingPath(API));
  notes.unshift(ported + " endpoint bod" + (ported === 1 ? "y" : "ies") + " ported from " + API);
  return { notes, ...(spawn.length ? { spawn } : {}) };
}
