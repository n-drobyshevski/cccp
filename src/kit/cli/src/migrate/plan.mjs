// The migration plan: the steps that move a source app onto the kit, in order, and what each one
// has done. buildPlan is pure: the same inventory gives the same plan bytes. A re-plan keeps the
// person's rulings for every step id it still produces (done and skipped steps, attempts, outputs,
// notes) and their edits to maps.* (roles included), and names the steps it dropped. The data files
// in <target>/.migrate are read and written only here, and a plan is validated both ways: plan.json
// sits in the target and a person may edit it.
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { UsageError } from "../args.mjs";
import { termLine } from "./steps/_common.mjs";
import { sha256 } from "../hash.mjs";
import { assertNoLink } from "../vendor.mjs";
import { PLAN_SCHEMA, renderJson, validateInventory, validatePlan } from "./schema.mjs";
import { createWriteSet, relProblem } from "./writeSet.mjs";

/** @typedef {import("./schema.mjs").Step} Step */
/** @typedef {import("./schema.mjs").Plan} Plan */
/** @typedef {import("./schema.mjs").Inventory} Inventory */
/**
 * A plan step as the runner keeps it: spawnedBy names the tool step whose result inserted it, so a
 * re-plan keeps it while that step stays done.
 * @typedef {Step & { spawnedBy?: string }} PlanStep
 */
/**
 * A profile module (profiles/<name>.mjs).
 * @typedef {{ name: string, detect: (tree: any, inv?: Inventory) => { score: number, evidence: string[] }, steps: (inv: Inventory, opts: { fidelity: string }) => Step[] }} ProfileModule
 */
/** The vocabularies of maps.mjs that seed a plan. @typedef {{ moduleMap: (profile: string) => Record<string, string>, tokenMap: (profile: string) => Record<string, string> }} MapsModule */
/** Where the source lives, relative to the target when it can be. @typedef {{ root: string, shared: string[] }} SourceRecord */

export const MIGRATE_DIR = ".migrate";
export const PLAN_FILE = ".migrate/plan.json";
export const INVENTORY_FILE = ".migrate/inventory.json";
export const SOURCE_FILE = ".migrate/source.json";
export const REPORT_FILE = ".migrate/report.md";
/** The data files only the CLI writes: a step may not write or remove them. */
export const RUNNER_FILES = [PLAN_FILE, INVENTORY_FILE, SOURCE_FILE];

/** A data file larger than this is refused rather than read. */
const MAX_DATA_BYTES = 64 * 1024 * 1024;

/** The invariant every tool step keeps: the target stays green. */
const GREEN = ["check", "build", "kit:verify"];

/** Keys never copied out of an edited object (prototype pollution through a merge). */
const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * A step in the one key order every plan uses, so plan bytes depend on content only.
 * @param {PlanStep} s
 * @returns {PlanStep}
 */
export function normalizeStep(s) {
  /** @type {PlanStep} */
  const out = /** @type {any} */ ({ id: s.id, kind: s.kind, ...(s.kind === "tool" && s.run !== undefined ? { run: s.run } : {}), title: s.title, after: [...(s.after ?? [])] });
  if (s.page !== undefined) out.page = s.page;
  if (s.pilot !== undefined) out.pilot = s.pilot;
  out.files = { reads: [...(s.files?.reads ?? [])], writes: [...(s.files?.writes ?? [])] };
  out.verify = [...(s.verify ?? [])];
  out.status = s.status ?? "pending";
  if (s.why !== undefined) out.why = s.why;
  out.attempts = s.attempts ?? 0;
  out.outputs = { ...(s.outputs ?? {}) };
  if (s.notes !== undefined) out.notes = [...s.notes];
  if (s.spawnedBy !== undefined) out.spawnedBy = s.spawnedBy;
  return out;
}

/**
 * @param {Partial<PlanStep> & { id: string, kind: "tool" | "agent", title: string }} s
 * @returns {PlanStep}
 */
function step(s) {
  return normalizeStep({ after: [], files: { reads: [], writes: [] }, verify: s.kind === "tool" ? GREEN : ["check"], status: "pending", attempts: 0, outputs: {}, ...s });
}

/** True when the inventory found something that looks like a credential. @param {Inventory} inv */
export function hasSecretSuspects(inv) {
  const s = /** @type {{ secretSuspects?: unknown }} */ (inv).secretSuspects;
  return Array.isArray(s) && s.length > 0;
}

/** True when the source has a trigger or a menu global (an installable trigger, onOpen). @param {Inventory} inv */
export function hasTriggers(inv) {
  return (inv.globals ?? []).some((g) => g.kind === "trigger" || g.kind === "menu");
}

/**
 * The steps every profile shares, in plan order: head before the profile's tool steps, tail after
 * them, agents after the profile's agents (cleanup last).
 * @param {Inventory} inv
 * @param {"kit" | "bare"} [shell] bare adds the bare-shell step after routes
 */
export function commonSteps(inv, shell = "kit") {
  const head = [
    step({ id: "park", kind: "tool", run: "park", title: "Park the source files under .migrate/pending", files: { reads: [], writes: [".migrate/pending"] } }),
    step({ id: "tokens", kind: "tool", run: "tokens", title: "Lift the source's colours and custom properties into legacy tokens", after: ["park"], files: { reads: [], writes: ["src/client/styles/legacy-tokens.css"] } }),
    step({ id: "css-import", kind: "tool", run: "cssImport", title: "Wire the kit and legacy CSS layers and strip CDN urls", after: ["tokens"], files: { reads: [], writes: ["src/client/styles/index.css", "app.config.mjs"] } }),
  ];
  const tail = [
    step({ id: "rpc-surface", kind: "tool", run: "rpcSurface", title: "Add the source's endpoints to the RPC surface as owner-only", after: ["park"], files: { reads: [], writes: ["src/server/api.ts", "src/server/roles.ts", "src/gas/entry.js"] } }),
    step({ id: "routes", kind: "tool", run: "routes", title: "Translate the source's links into hash routes", after: ["park"], files: { reads: [], writes: ["src/client/migrated/legacyRoutes.js"] } }),
    ...(shell === "bare" ? [step({ id: "bare-shell", kind: "tool", run: "bareShell", title: "Replace the kit's app shell with a bare page skeleton like the source's", after: ["park", "routes"], files: { reads: [], writes: ["src/client/migrated/shell.js", "src/client/main.js"] } })] : []),
    step({ id: "storage", kind: "tool", run: "storage", title: "Carry the storage prefix and the raw keys", after: ["park"], files: { reads: [], writes: ["src/client/migrated/legacyStorage.js"] } }),
    step({ id: "pin-tests", kind: "tool", run: "pinTests", title: "Generate tests that pin every route and storage key", files: { reads: [], writes: ["test/client/migrated"] } }),
  ];
  const agents = [
    // Any profile: a trigger or menu global needs a home in the target. It waits for port-server
    // when the profile has one (buildPlan), never the other way round: no page waits for it.
    ...(hasTriggers(inv) ? [step({ id: "triggers", kind: "agent", title: "Port the triggers and menus (the add-trigger skill: setup in src/server/setup.ts, the handler in src/gas/entry.js)", files: { reads: [], writes: ["src/server/setup.ts", "src/gas/entry.js"] }, verify: ["check"] })] : []),
    step({ id: "classify-roles", kind: "agent", title: "Classify each endpoint's role (every carried endpoint starts as owner)", files: { reads: [], writes: ["src/server/roles.ts"] }, verify: ["check"] }),
    step({ id: "review-access", kind: "agent", title: "Review the scopes and the access mode (list by default; a wider one needs a written reason)", files: { reads: [], writes: ["app.config.mjs", "src/gas/appsscript.json"] }, verify: ["check", "kit:verify"] }),
    ...(hasSecretSuspects(inv) ? [step({ id: "secrets", kind: "agent", title: "Move the suspected secrets out of the code into Script Properties", files: { reads: [], writes: [] }, verify: ["check"] })] : []),
    step({ id: "dark-mode", kind: "agent", title: "Review the dark theme", files: { reads: [], writes: ["src/client/styles/legacy-tokens.css"] }, verify: ["check", "build"] }),
    step({ id: "retire-register", kind: "agent", title: "Retire the template's register pages", files: { reads: [], writes: ["src/client/pages"] }, verify: GREEN }),
    step({ id: "cleanup", kind: "agent", title: "Clean up: remove .migrate/pending and its ESLint ignore", files: { reads: [], writes: [".migrate/pending", "eslint.config.js"] }, verify: GREEN }),
  ];
  return { head, tail, agents };
}

/**
 * The hash route a source route most likely becomes: "#/x" stays, "?page=x" and "?r=x" become "#/x".
 * A seed only: the person (or the routes step) corrects maps.routes.
 * @param {string} route
 */
export function guessHashRoute(route) {
  if (route.startsWith("#/")) return route;
  const m = /^\?[a-z]+=([^&#]*)/.exec(route);
  return m ? "#/" + (m[1] ?? "") : route;
}

/** A plain copy of an object with string keys, dangerous keys dropped. @param {unknown} o @returns {Record<string, unknown>} */
function plainCopy(o) {
  /** @type {Record<string, unknown>} */
  const out = {};
  if (typeof o !== "object" || o === null || Array.isArray(o)) return out;
  for (const [k, v] of Object.entries(o)) if (!BAD_KEYS.has(k)) out[k] = v;
  return out;
}

/**
 * The maps a fresh plan starts with.
 * @param {Inventory} inv @param {string} profile @param {MapsModule | undefined} maps
 * @returns {Record<string, Record<string, unknown>>}
 */
function seedMaps(inv, profile, maps) {
  const rpc = [...new Set(inv.rpc ?? [])].sort();
  const routes = [...new Set(inv.routes ?? [])];
  return {
    tokens: maps ? plainCopy(maps.tokenMap(profile)) : {},
    modules: maps ? plainCopy(maps.moduleMap(profile)) : {},
    routes: Object.fromEntries(routes.map((r) => [r, guessHashRoute(r)])),
    rpc: Object.fromEntries(rpc.map((n) => [n, n])),
    storage: { prefix: inv.config.prefix, raw: [...(inv.config.rawKeys ?? [])].sort() },
    baseline: {},
    // Fail closed: every carried endpoint is owner-only until a person classifies it.
    roles: Object.fromEntries(rpc.map((n) => [n, "owner"])),
  };
}

/** @param {string[]} a @param {string[]} b */
function union(a, b) {
  return [...new Set([...a, ...b])];
}

/**
 * Build the plan for an inventory. Order: park, tokens, css-import, the profile's tool steps,
 * rpc-surface, routes, storage, pin-tests, the profile's agent steps, the common agent steps,
 * cleanup last. after: a profile tool step with none waits for park; pin-tests waits for every other
 * tool step; an agent step that waits for no agent step waits for pin-tests; the common triggers
 * step (a source with a trigger or menu global) waits for the profile's port-server when there is
 * one; cleanup waits for every other agent step. With previous, the person's rulings are carried over (see the file comment).
 * @param {Inventory} inv
 * @param {{ fidelity: "preserve" | "reskin", profileModule: ProfileModule, previous?: Plan | null, maps?: MapsModule, shell?: "kit" | "bare" }} opts
 * @returns {Plan}
 */
export function buildPlan(inv, { fidelity, profileModule, previous = null, maps, shell }) {
  const profile = /** @type {Plan["profile"]} */ (inv.profile);
  if (!profile) throw new Error("the inventory names no profile; run migrate:inventory with --profile");
  if (profileModule.name !== profile) throw new Error("the profile module " + profileModule.name + " does not match the inventory's profile " + profile);
  // The shell: the caller's choice, else the previous plan's, else bare for preserve and kit for reskin.
  const prevShell = /** @type {unknown} */ (/** @type {Record<string, unknown>} */ (previous?.maps ?? {})["shell"]);
  const shellChoice = shell ?? (prevShell === "kit" || prevShell === "bare" ? prevShell : fidelity === "preserve" ? "bare" : "kit");
  const { head, tail, agents } = commonSteps(inv, shellChoice);
  const common = new Set([...head, ...tail, ...agents].map((s) => s.id));
  const own = profileModule.steps(inv, { fidelity }).map((s) => normalizeStep(s));
  for (const s of own) if (common.has(s.id)) throw new Error("profile " + profile + " has a step id that a common step uses: " + s.id);
  const ownTools = own.filter((s) => s.kind === "tool");
  const ownAgents = own.filter((s) => s.kind === "agent");
  for (const s of ownTools) if (!s.after.length) s.after = ["park"];
  const tools = [...head, ...ownTools, ...tail];
  const pin = /** @type {PlanStep} */ (tail[tail.length - 1]);
  pin.after = tools.filter((s) => s !== pin).map((s) => s.id);
  const allAgents = [...ownAgents, ...agents];
  const agentIds = new Set(allAgents.map((s) => s.id));
  const triggers = agents.find((s) => s.id === "triggers");
  if (triggers && agentIds.has("port-server")) triggers.after = union(triggers.after, ["port-server"]);
  const cleanup = /** @type {PlanStep} */ (agents[agents.length - 1]);
  for (const s of allAgents) {
    if (s === cleanup) continue;
    if (!s.after.some((a) => agentIds.has(a))) s.after = union(s.after, [pin.id]);
  }
  cleanup.after = union([pin.id], allAgents.filter((s) => s !== cleanup).map((s) => s.id));
  /** @type {PlanStep[]} */
  let steps = [...tools, ...allAgents];

  /** @type {Record<string, Record<string, unknown>>} */
  const mapsOut = seedMaps(inv, profile, maps);
  if (previous) {
    const prevById = new Map(previous.steps.map((s) => [s.id, /** @type {PlanStep} */ (s)]));
    for (const s of steps) {
      const p = prevById.get(s.id);
      if (!p) continue;
      if (p.status === "done" || p.status === "skipped") {
        s.status = p.status;
        if (p.why !== undefined) s.why = p.why;
        else delete s.why;
        if (p.notes !== undefined) s.notes = [...p.notes];
      }
      s.attempts = p.attempts;
      s.outputs = { ...p.outputs };
    }
    steps = keepSpawned(steps, /** @type {PlanStep[]} */ (previous.steps));
    const prevMaps = /** @type {Record<string, unknown>} */ (previous.maps ?? {});
    for (const [name, value] of Object.entries(prevMaps)) {
      if (BAD_KEYS.has(name) || typeof value !== "object" || value === null || Array.isArray(value)) continue;
      mapsOut[name] = { ...(mapsOut[name] ?? {}), ...plainCopy(value) };
    }
  }
  mapsOut["shell"] = /** @type {any} */ (shellChoice);
  /** @type {Plan} */
  const plan = {
    schema: PLAN_SCHEMA,
    profile,
    fidelity,
    inventorySha: inventorySha(inv),
    maps: /** @type {Plan["maps"]} */ (mapsOut),
    steps: steps.map(normalizeStep),
  };
  const bad = planProblems(plan);
  if (bad.length) throw new Error("the plan for profile " + profile + " is not valid:\n  " + bad.join("\n  "));
  return plan;
}

/**
 * Steps a tool step spawned in the previous plan, put back right after it while it is done.
 * @param {PlanStep[]} steps @param {PlanStep[]} prev
 */
function keepSpawned(steps, prev) {
  const ids = new Set(steps.map((s) => s.id));
  const out = [...steps];
  for (const p of prev) {
    if (!p.spawnedBy || ids.has(p.id)) continue;
    const at = out.findIndex((s) => s.id === p.spawnedBy);
    const parent = out[at];
    if (!parent || parent.status !== "done") continue;
    let pos = at + 1;
    while (pos < out.length && /** @type {PlanStep} */ (out[pos]).spawnedBy === parent.id) pos++;
    const kept = normalizeStep(p);
    out.splice(pos, 0, kept);
    ids.add(kept.id);
  }
  for (const s of out) if (s.spawnedBy) {
    s.after = s.after.filter((a) => ids.has(a));
    if (!s.after.length) s.after = [s.spawnedBy];
  }
  return out;
}

/**
 * Ids of the previous plan's steps that a new plan no longer has.
 * @param {Plan | null | undefined} previous @param {Plan} plan
 */
export function droppedSteps(previous, plan) {
  if (!previous) return [];
  const ids = new Set(plan.steps.map((s) => s.id));
  return previous.steps.filter((s) => !ids.has(s.id)).map((s) => s.id);
}

/** sha256 of an inventory as inventory.json holds it. @param {Inventory} inv */
export function inventorySha(inv) {
  return sha256(renderJson(inv));
}

/**
 * validatePlan plus the runner's own field: spawnedBy names a step of the plan.
 * @param {unknown} o
 */
export function planProblems(o) {
  const bad = validatePlan(o);
  const steps = /** @type {{ steps?: unknown }} */ (o)?.steps;
  if (Array.isArray(steps)) {
    const ids = new Set(steps.map((s) => (s && typeof s === "object" ? /** @type {{ id?: unknown }} */ (s).id : undefined)));
    for (const s of steps) {
      if (!s || typeof s !== "object" || !("spawnedBy" in s)) continue;
      const by = /** @type {{ spawnedBy?: unknown, id?: unknown }} */ (s);
      if (typeof by.spawnedBy !== "string" || !ids.has(by.spawnedBy)) bad.push("step " + String(by.id) + ": spawnedBy does not name a step of the plan");
    }
  }
  return bad;
}

/**
 * The text of a data file in the target, or null when it is absent. Refuses a symlink anywhere on
 * the way, a non-file and an oversized file.
 * @param {string} target @param {string} rel
 */
export function readDataText(target, rel) {
  const root = resolve(target);
  assertNoLink(root, rel, { deep: false, who: "migrate", hint: " (the .migrate files must be real files)" });
  const abs = join(root, ...rel.split("/"));
  let st;
  try {
    st = lstatSync(abs);
  } catch {
    return null;
  }
  if (!st.isFile()) throw new Error(rel + " is not a regular file");
  if (st.size > MAX_DATA_BYTES) throw new Error(rel + " is over " + MAX_DATA_BYTES + " bytes; refusing to read it");
  return readFileSync(abs, "utf8");
}

/** @param {string} rel @param {string} text */
function parseData(rel, text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(rel + " is not JSON: " + /** @type {Error} */ (e).message);
  }
}

/** @param {string} target */
function notTarget(target) {
  return new UsageError(resolve(target) + " is not a migration target (no " + PLAN_FILE + "); pass --root <target>, or start one with migrate:init", { title: "This folder is not a migration target", why: "There is no " + PLAN_FILE + " in " + termLine(resolve(target)) + ".", fix: "Pass --root <target>, or start one with npm run kit -- migrate:init <source> <target> --fidelity preserve|reskin.", more: "npm run kit -- help" });
}

/**
 * The target's plan, validated. Throws with every problem when it is not usable.
 * @param {string} target
 * @returns {Plan}
 */
export function readPlan(target) {
  const text = readDataText(target, PLAN_FILE);
  if (text === null) throw notTarget(target);
  const o = parseData(PLAN_FILE, text);
  const bad = planProblems(o);
  if (bad.length) throw new Error(PLAN_FILE + " is not a usable plan (fix it by hand, or run migrate:plan):\n  " + bad.join("\n  "));
  return o;
}

/**
 * The target's inventory, validated, and its inventorySha (of its content, so reformatting the
 * file does not count as a change).
 * @param {string} target
 * @returns {{ inv: Inventory, sha: string }}
 */
export function readInventory(target) {
  const text = readDataText(target, INVENTORY_FILE);
  if (text === null) throw notTarget(target);
  const o = parseData(INVENTORY_FILE, text);
  const bad = validateInventory(o);
  if (bad.length) throw new Error(INVENTORY_FILE + " is not a usable inventory (run migrate:inventory):\n  " + bad.join("\n  "));
  return { inv: o, sha: inventorySha(o) };
}

/**
 * The source roots recorded at init, resolved against the target.
 * @param {string} target
 * @returns {{ root: string, shared: string[] }}
 */
export function readSource(target) {
  const text = readDataText(target, SOURCE_FILE);
  if (text === null) throw new Error(SOURCE_FILE + " is missing: it records where the source is. Write { \"root\": \"<source dir>\", \"shared\": [] } there");
  const o = parseData(SOURCE_FILE, text);
  const ok = o && typeof o === "object" && typeof o.root === "string" && o.root && Array.isArray(o.shared) && o.shared.every((/** @type {unknown} */ s) => typeof s === "string" && s);
  if (!ok) throw new Error(SOURCE_FILE + " is not { root: string, shared: string[] }");
  const root = resolve(target);
  return { root: resolve(root, o.root), shared: o.shared.map((/** @type {string} */ s) => resolve(root, s)) };
}

/**
 * How a source path is recorded: relative to the target (posix) when it can be, so source.json
 * names no home directory and survives a move of both folders together.
 * @param {string} target @param {string} abs
 */
export function recordPath(target, abs) {
  const from = resolve(target);
  const rel = relative(from, resolve(abs));
  if (!rel || isAbsolute(rel)) return resolve(abs);
  const parts = rel.split(sep);
  const ups = parts.filter((p) => p === "..").length;
  // A path that climbs to the filesystem root shares no folder with the target: keep it absolute.
  const depth = from.split(sep).filter(Boolean).length;
  if (ups >= depth) return resolve(abs);
  return parts.join("/");
}

/**
 * @param {string} target @param {{ root: string, shared: string[] }} src absolute or relative to the cwd
 * @returns {SourceRecord}
 */
export function sourceRecord(target, src) {
  return { root: recordPath(target, src.root), shared: src.shared.map((s) => recordPath(target, s)) };
}

/**
 * Write data files into the target in one write set, each only when its text changed.
 * @param {string} target @param {Record<string, string>} files rel to text
 * @returns {string[]} the rels written
 */
export function writeDataFiles(target, files) {
  const ws = createWriteSet(target);
  for (const [rel, text] of Object.entries(files)) {
    const why = relProblem(rel);
    if (why) throw new Error("refusing data file " + rel + ": " + why);
    if (readDataText(target, rel) !== text) ws.write(rel, text);
  }
  return ws.apply().written;
}

/**
 * Write the plan (validated first: an invalid plan is never written). False when unchanged.
 * @param {string} target @param {Plan} plan
 */
export function writePlan(target, plan) {
  const bad = planProblems(plan);
  if (bad.length) throw new Error("refusing to write an invalid plan:\n  " + bad.join("\n  "));
  return writeDataFiles(target, { [PLAN_FILE]: renderJson(plan) }).length > 0;
}

/** @param {string} target @param {Inventory} inv */
export function writeInventory(target, inv) {
  const bad = validateInventory(inv);
  if (bad.length) throw new Error("refusing to write an invalid inventory:\n  " + bad.join("\n  "));
  return writeDataFiles(target, { [INVENTORY_FILE]: renderJson(inv) }).length > 0;
}

/** @param {string} target @param {SourceRecord} record */
export function writeSource(target, record) {
  return writeDataFiles(target, { [SOURCE_FILE]: renderJson(record) }).length > 0;
}
