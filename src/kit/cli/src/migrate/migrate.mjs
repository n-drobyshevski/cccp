// The migrate commands: doctor, init, inventory, plan, apply, done, status, serve, and migrate (init,
// apply, status in one). Each returns the lines to print and an exit code (0 ok, 1 an error or a
// refusal, 3 for status --exit-code while steps are open); only bin.mjs prints. The source is read
// through sourceTree.mjs only and is never written or run; init scaffolds the target with create
// and fails closed on access ("list") whatever the source allowed.
import { lstatSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { UsageError } from "../args.mjs";
import { termLine } from "./steps/_common.mjs";
import { defaultKitRoot, runCreate } from "../create.mjs";
import { checkAccent, checkName, checkPrefix, checkProduct, checkTz, slugFromDir } from "../values.mjs";
import { applyPlan, commitAll, markDone } from "./apply.mjs";
import { startHarness as realStartHarness } from "./harness.mjs";
import { PROFILES, buildInventory, chooseProfile } from "./inventory.mjs";
import * as maps from "./maps.mjs";
import { INVENTORY_FILE, PLAN_FILE, REPORT_FILE, SOURCE_FILE, buildPlan, droppedSteps, readDataText, readInventory, readPlan, readSource, sourceRecord, writeDataFiles, writeInventory, writePlan, writeSource } from "./plan.mjs";
import { FAST_LOADS_RECIPE, HASH_LINK_RULE, PAGE_LINK_RULE, hashLinkFindings, hashLinkLine, openSteps, relativeLinkFindings, relativeLinkLine, renderReport, scriptPropFindings, scriptPropLine, statusCounts, statusLines } from "./report.mjs";
import { renderJson, validateInventory } from "./schema.mjs";
import { openSource } from "./sourceTree.mjs";
import { assertSafeTarget } from "./writeSet.mjs";

/** @typedef {import("./plan.mjs").Plan} Plan */
/** @typedef {import("./plan.mjs").Inventory} Inventory */
/** @typedef {import("./plan.mjs").ProfileModule} ProfileModule */
/** @typedef {{ positional: string[], flags: Record<string, string | boolean> }} Parsed */
/** @typedef {{ lines: string[], code: number }} Result */
/**
 * What a command may be given instead of the real thing (tests).
 * @typedef {object} MigrateOpts
 * @property {string} [kitRoot] the kit checkout (default: the one this CLI runs from)
 * @property {string} [stepsDir] where apply finds steps/<run>.mjs
 * @property {import("./apply.mjs").RunVerify} [runVerify]
 * @property {typeof realStartHarness} [startHarness]
 */

export const FIDELITIES = ["preserve", "reskin"];
export const PROFILE_NAMES = ["auto", "kit-shaped", "el-builder", "classic"];
/** The create flags migrate:init passes through. */
const CREATE_STRINGS = ["name", "product", "prefix", "accent", "access", "tz", "kit-remote"];
/** The ESLint ignore every migration target gets while parked code waits in .migrate/pending. */
export const ESLINT_IGNORE = ".migrate/**";

/** @param {Parsed} parsed @param {string} k */
function str(parsed, k) {
  const v = parsed.flags[k];
  return typeof v === "string" ? v : undefined;
}

/** --shared a,b as a list of paths. @param {Parsed} parsed */
function sharedList(parsed) {
  const v = str(parsed, "shared");
  return v === undefined ? [] : v.split(",").map((s) => s.trim()).filter(Boolean);
}

/** @param {Parsed} parsed */
function rootOf(parsed) {
  return resolve(str(parsed, "root") ?? ".");
}

/** @param {Parsed} parsed @returns {"preserve" | "reskin"} */
function fidelityOf(parsed) {
  const f = str(parsed, "fidelity");
  if (f === undefined)
    throw new UsageError("--fidelity is required, and the person migrating chooses it: preserve keeps the app's CSS and class names (proven by a pixel diff), reskin moves it onto kit components and tokens (proven by aria snapshots and keyboard specs)", { title: "--fidelity is required", why: "You choose how faithfully the app is migrated: preserve keeps its CSS and class names, reskin moves it onto kit components and tokens.", fix: "Add --fidelity preserve or --fidelity reskin.", more: "npm run kit -- help" });
  if (!FIDELITIES.includes(f)) throw new UsageError("--fidelity must be preserve or reskin, not " + JSON.stringify(f), { title: "--fidelity must be preserve or reskin", why: JSON.stringify(termLine(f)) + " is not one of the two.", fix: "Use --fidelity preserve or --fidelity reskin.", more: "npm run kit -- help" });
  return /** @type {"preserve" | "reskin"} */ (f);
}

/**
 * --shell kit|bare; undefined when not given (preserve then defaults to bare, reskin to kit).
 * @param {Parsed} parsed @returns {"kit" | "bare" | undefined}
 */
function shellOf(parsed) {
  const v = str(parsed, "shell");
  if (v === undefined) return undefined;
  if (v !== "kit" && v !== "bare") throw new UsageError("--shell must be kit or bare, not " + JSON.stringify(v), { title: "--shell must be kit or bare", why: JSON.stringify(termLine(v)) + " is not one of the two.", fix: "Use --shell kit or --shell bare.", more: "npm run kit -- help" });
  return v;
}

/** @param {Parsed} parsed @param {string} [fallback] */
function profileOf(parsed, fallback = "auto") {
  const p = str(parsed, "profile") ?? fallback;
  if (!PROFILE_NAMES.includes(p)) throw new UsageError("--profile must be one of " + PROFILE_NAMES.join(", ") + ", not " + JSON.stringify(p), { title: "--profile is not a known profile", why: JSON.stringify(termLine(p)) + " is not one of: " + PROFILE_NAMES.join(", ") + ".", fix: "Use --profile " + PROFILE_NAMES.join(", --profile ") + ".", more: "npm run kit -- help" });
  return p;
}

/** @param {string} name @returns {ProfileModule} */
function profileModule(name) {
  const m = PROFILES.find((p) => p.name === name);
  if (!m) throw new Error("no profile module named " + name);
  return /** @type {ProfileModule} */ (/** @type {unknown} */ (m));
}

/** init and apply need templates/register, so a kit checkout, not the CLI vendored into an app. @param {string} kitRoot @param {string} what */
function assertCheckout(kitRoot, what) {
  let ok = false;
  try {
    ok = lstatSync(join(kitRoot, "templates", "register", "app.config.mjs")).isFile();
  } catch {
    ok = false;
  }
  if (!ok) throw new Error(what + " needs a gas-kit checkout (templates/register next to the packages folder), and " + kitRoot + " is not one. Run it from a kit clone, not from an app's src/kit/cli");
}

/**
 * Add .migrate/** to the ignores of a target's eslint.config.js (idempotent). Throws when the
 * template's ignores list is not there.
 * @param {string} text
 */
export function addEslintIgnore(text) {
  const re = /(\bignores:\s*\[)([^\]]*)(\])/;
  const m = re.exec(text);
  if (!m) throw new Error("template marker not found: eslint.config.js ignores");
  if (/** @type {string} */ (m[2]).includes(JSON.stringify(ESLINT_IGNORE))) return text;
  const body = /** @type {string} */ (m[2]).replace(/[\s,]*$/, "");
  return text.replace(re, (_all, a, _b, c) => a + body + (body.trim() ? ", " : "") + JSON.stringify(ESLINT_IGNORE) + c);
}

/**
 * The create flags for a migration: the person's flags win, else the values the inventory carries
 * when create would accept them. Access is list unless --access says otherwise: the source's
 * access is the review-access step's question, not a default.
 * @param {Inventory} inv @param {Parsed} parsed @param {string} target
 * @returns {{ flags: Record<string, string | boolean>, notes: string[] }}
 */
export function createFlagsFor(inv, parsed, target) {
  /** @type {Record<string, string | boolean>} */
  const flags = { yes: true };
  for (const k of CREATE_STRINGS) {
    const v = str(parsed, k);
    if (v !== undefined) flags[k] = v;
  }
  if (parsed.flags["git"] === true) flags["git"] = true;
  // The data class is the person's answer, never the source's: create's --confidential, passed on.
  if (parsed.flags["confidential"] === true) flags["confidential"] = true;
  if (typeof parsed.flags["e2e"] === "boolean") flags["e2e"] = parsed.flags["e2e"];
  /** @type {string[]} */
  const notes = [];
  const cfg = inv.config;
  if (flags["product"] === undefined && cfg.product) {
    if (checkProduct(cfg.product) === null) flags["product"] = cfg.product;
    else notes.push("The source's product name is not one create accepts (" + checkProduct(cfg.product) + "); pass --product.");
  }
  if (flags["name"] === undefined && typeof flags["product"] === "string") {
    const slug = slugFromDir(flags["product"]);
    if (checkName(slug) === null) flags["name"] = slug;
  }
  if (flags["prefix"] === undefined && cfg.prefix) {
    if (checkPrefix(cfg.prefix) === null) flags["prefix"] = cfg.prefix;
    else {
      const name = typeof flags["name"] === "string" ? flags["name"] : slugFromDir(basename(resolve(target)));
      const def = name.replace(/-/g, "") + ".";
      notes.push("The source's storage prefix " + JSON.stringify(cfg.prefix) + " is not a kit prefix (lowercase, ending in a dot); the app uses " + JSON.stringify(def) + " and the storage step carries the old keys.");
    }
  }
  if (flags["accent"] === undefined && cfg.accent && checkAccent(cfg.accent) === null) flags["accent"] = cfg.accent;
  if (flags["tz"] === undefined && cfg.timeZone && checkTz(cfg.timeZone) === null) flags["tz"] = cfg.timeZone;
  if (flags["access"] === undefined) {
    flags["access"] = "list";
    const had = inv.manifest?.webapp?.access;
    if (had) notes.push("The source's web app access was " + had + "; the target starts at list (listed people only), and the review-access step decides.");
  }
  return { flags, notes };
}

/** @param {Plan} plan */
function planLine(plan) {
  const tools = plan.steps.filter((s) => s.kind === "tool").length;
  return "Plan: " + plan.steps.length + " steps (" + tools + " tool, " + (plan.steps.length - tools) + " agent), profile " + plan.profile + ", fidelity " + plan.fidelity + ".";
}

/** @param {Inventory} inv */
function inventoryLine(inv) {
  return "Inventory: " + inv.files.length + " files read, " + inv.skipped.length + " skipped; profile " + inv.profile + ".";
}

/** How many findings of one kind (hash links, relative links, Script Properties reads) doctor names, one per line. */
const MAX_DOCTOR_LINKS = 20;

/**
 * migrate:doctor <source> [--shared a,b]: read-only checks, a score per profile, the hash links
 * that would leave Apps Script's frame, the relative links that would break in it and the direct
 * Script Properties reads in carried server code, each by file and line.
 * @param {Parsed} parsed
 * @returns {Result}
 */
export function runDoctor(parsed) {
  const src = parsed.positional[0];
  if (!src) throw new UsageError("migrate:doctor needs a source: gas-kit migrate:doctor <source> [--shared <dir,dir>]", { title: "migrate:doctor needs a source", why: "It checks a source app, and none was given.", fix: "Run npm run kit -- migrate:doctor <source> [--shared <dir,dir>].", more: "npm run kit -- help" });
  const tree = openSource({ root: src, shared: sharedList(parsed) });
  const inv = buildInventory(tree, { profile: null });
  const binary = tree.assets.size;
  /** @type {string[]} */
  const lines = ["Source " + tree.roots[0]?.abs + (tree.roots.length > 1 ? " with " + tree.roots.slice(1).map((r) => "@" + r.name).join(", ") : "") + ": " + tree.files.size + " text files, " + binary + " binary."];
  lines.push("Node " + process.version + ": ok.");
  if (!tree.git.repo) lines.push("git: not a repository, so the inventory's hashes are the only record of the baseline.");
  else if (tree.git.clean === true) lines.push("git: clean at " + (tree.git.head ?? "no commit") + ".");
  else if (tree.git.clean === false) lines.push("git: uncommitted changes. Commit them first, so the baseline is a state you can return to.");
  else lines.push("git: cannot tell whether it is clean (a tracked file is never read: secret-shaped or too big).");
  /** @type {Record<string, number>} */
  const why = {};
  for (const s of tree.skipped) why[s.why] = (why[s.why] ?? 0) + 1;
  if (tree.skipped.length) lines.push("Skipped: " + Object.entries(why).map(([k, n]) => n + " " + k).join(", ") + ". Secret-shaped files are never opened.");
  if (inv.manifest) {
    const m = inv.manifest;
    lines.push("appsscript.json: time zone " + (m.timeZone ?? "none") + ", web app " + (m.webapp ? (m.webapp.access ?? "?") + " / " + (m.webapp.executeAs ?? "?") : "none") + ", " + m.scopes.length + " scopes, " + m.advancedServices.length + " advanced services.");
    for (const p of m.problems) lines.push("  problem: " + p);
  } else lines.push("appsscript.json: not found.");
  if (inv.clasp) {
    lines.push(".clasp.json: rootDir " + (inv.clasp.rootDir === null ? "none" : JSON.stringify(inv.clasp.rootDir)) + (inv.clasp.hasScriptId ? ", a script id (not shown)" : "") + ".");
    for (const p of inv.clasp.problems) lines.push("  problem: " + p);
  }
  for (const p of [...inv.profiles].sort((a, b) => b.score - a.score)) lines.push("Profile " + p.name + ": " + p.score + (p.evidence.length ? " (" + p.evidence.join("; ") + ")" : ""));
  try {
    lines.push("Detected: " + chooseProfile(inv.profiles) + ".");
  } catch (e) {
    lines.push(/** @type {Error} */ (e).message + ".");
  }
  const links = hashLinkFindings(/** @type {Inventory} */ (inv));
  if (links.length) {
    lines.push("Hash links: " + links.length + " would leave Apps Script's frame. " + HASH_LINK_RULE);
    for (const l of links.slice(0, MAX_DOCTOR_LINKS)) lines.push("  " + hashLinkLine(l));
    if (links.length > MAX_DOCTOR_LINKS) lines.push("  and " + (links.length - MAX_DOCTOR_LINKS) + " more.");
  }
  const rel = relativeLinkFindings(/** @type {Inventory} */ (inv));
  if (rel.length) {
    lines.push("Relative links: " + rel.length + " would break in Apps Script's frame. " + PAGE_LINK_RULE);
    for (const l of rel.slice(0, MAX_DOCTOR_LINKS)) lines.push("  " + relativeLinkLine(l));
    if (rel.length > MAX_DOCTOR_LINKS) lines.push("  and " + (rel.length - MAX_DOCTOR_LINKS) + " more.");
  }
  const props = scriptPropFindings(/** @type {Inventory} */ (inv));
  if (props.length) {
    lines.push("Script Properties: " + props.length + " direct " + (props.length === 1 ? "read" : "reads") + " in carried server code, reported, not rewritten. See " + FAST_LOADS_RECIPE + ".");
    for (const l of props.slice(0, MAX_DOCTOR_LINKS)) lines.push("  " + scriptPropLine(l));
    if (props.length > MAX_DOCTOR_LINKS) lines.push("  and " + (props.length - MAX_DOCTOR_LINKS) + " more.");
  }
  return { lines, code: 0 };
}

/**
 * migrate:init <source> <target> --fidelity preserve|reskin [...]: scaffold, inventory, plan.
 * @param {Parsed} parsed @param {MigrateOpts} [opts] @param {{ applied?: boolean }} [how] applied: migrate runs apply next
 * @returns {Promise<Result>}
 */
export async function runInit(parsed, opts = {}, how = {}) {
  const [src, target] = parsed.positional;
  if (!src || !target) throw new UsageError("migrate:init needs a source and a target: gas-kit migrate:init <source> <target> --fidelity preserve|reskin", { title: "migrate:init needs a source and a target", why: "It copies the source app into a new target folder, and one of them is missing.", fix: "Run npm run kit -- migrate:init <source> <target> --fidelity preserve|reskin.", more: "npm run kit -- help" });
  const fidelity = fidelityOf(parsed);
  const profile = profileOf(parsed);
  const kitRoot = resolve(opts.kitRoot ?? defaultKitRoot());
  assertCheckout(kitRoot, "migrate:init");
  const shared = sharedList(parsed);
  const root = resolve(target);
  assertSafeTarget(root, { sources: [src, ...shared], kitRoot });
  const tree = openSource({ root: src, shared });
  const inv = /** @type {Inventory} */ (buildInventory(tree, { profile, fidelity }));
  const bad = validateInventory(inv);
  if (bad.length) throw new Error("the inventory is not valid:\n  " + bad.join("\n  "));
  const plan = buildPlan(inv, { fidelity, profileModule: profileModule(/** @type {string} */ (inv.profile)), maps, shell: shellOf(parsed) });
  const { flags, notes } = createFlagsFor(inv, parsed, target);
  const created = await runCreate({ positional: [target], flags }, { kitRoot });
  const eslint = readDataText(root, "eslint.config.js");
  if (eslint === null) throw new Error("the scaffold has no eslint.config.js");
  writeDataFiles(root, {
    [INVENTORY_FILE]: renderJson(inv),
    [SOURCE_FILE]: renderJson(sourceRecord(root, { root: tree.roots[0]?.abs ?? resolve(src), shared: tree.roots.slice(1).map((r) => r.abs) })),
    [PLAN_FILE]: renderJson(plan),
    [REPORT_FILE]: renderReport(plan, inv),
    "eslint.config.js": addEslintIgnore(eslint),
  });
  /** @type {string[]} */
  const lines = [...createdHead(created), ""];
  let committed = false;
  if (flags["git"] === true) {
    try {
      committed = commitAll(root, "migrate init: inventory and plan");
      if (committed) lines.push("Committed the inventory and the plan.");
    } catch (e) {
      lines.push("Could not commit the inventory and the plan: " + /** @type {Error} */ (e).message);
    }
  }
  lines.push(...notes, inventoryLine(inv), planLine(plan), "Wrote .migrate/ (inventory.json, source.json, plan.json, report.md); ESLint ignores .migrate/** until the cleanup step.");
  lines.push(...initNextSteps(target, { git: flags["git"] === true, committed, confidential: flags["confidential"] === true, applied: how.applied === true }));
  return { lines, code: 0 };
}

/**
 * The lines create printed before its own "Next steps" (a fresh app's steps: npm install, clasp,
 * push), which are not a migration's: init prints its own.
 * @param {string[]} created
 */
export function createdHead(created) {
  const at = created.indexOf("Next steps:");
  if (at < 0) return created;
  return created.slice(0, at).filter((l, i, all) => !(l === "" && i === all.length - 1));
}

/**
 * What to do after migrate:init, true to what it did: with --git the target is a repository with
 * the scaffold and .migrate committed; without it nothing is committed and git is the person's
 * first step (migrate:apply --commit needs it).
 * @param {string} target as the person typed it
 * @param {{ git: boolean, committed: boolean, confidential: boolean, applied?: boolean }} done applied: migrate runs apply itself
 */
export function initNextSteps(target, done) {
  const lines = ["", "Next steps:"];
  if (!done.applied) lines.push("  node packages/cli/src/bin.mjs migrate:apply --root " + target + "    from the kit checkout: runs the tool steps");
  lines.push("  cd " + target);
  lines.push("  npm install            (or link the kit checkout's node_modules, as the kit's own tests do)");
  lines.push("  npm run check          the target stays green after every tool step");
  if (done.git && done.committed) lines.push("  git add -A && git commit    after each step you check (or migrate:apply --commit makes one commit per tool step)");
  else if (done.git) lines.push("  git add -A && git commit    the scaffold is a repository, but .migrate is not committed yet");
  else lines.push("  git init && git add -A && git commit -m \"migrate init\"    not a git repository yet (--git makes one): commit .migrate with the app while the migration runs; migrate:apply --commit needs it");
  lines.push("  read .migrate/report.md, then write .migrate/harness.json (the finish-migration skill in the target)");
  if (done.confidential) lines.push("  the data class is confidential (list access only, an owner pin required): the target's deploy skill says how to pin the owner");
  return lines;
}

/**
 * migrate:inventory [--root] [--shared a,b] [--profile ..]: re-scan the source.
 * @param {Parsed} parsed @param {MigrateOpts} [opts]
 * @returns {Result}
 */
export function runInventory(parsed, opts = {}) {
  const root = rootOf(parsed);
  const plan = readPlan(root);
  const { inv: before } = readInventory(root);
  const recorded = readSource(root);
  const src = parsed.flags["shared"] !== undefined ? { root: recorded.root, shared: sharedList(parsed).map((s) => resolve(s)) } : recorded;
  const profile = profileOf(parsed, before.profile ?? "auto");
  assertSafeTarget(root, { sources: [src.root, ...src.shared], kitRoot: resolve(opts.kitRoot ?? defaultKitRoot()) });
  const tree = openSource({ root: src.root, shared: src.shared });
  const inv = /** @type {Inventory} */ (buildInventory(tree, { profile, fidelity: plan.fidelity }));
  const changed = writeInventory(root, inv);
  writeSource(root, sourceRecord(root, { root: tree.roots[0]?.abs ?? src.root, shared: tree.roots.slice(1).map((r) => r.abs) }));
  const lines = [inventoryLine(inv)];
  if (!changed) lines.push("Unchanged since the last inventory.");
  else lines.push(before.source.digest === inv.source.digest ? "The source is unchanged; the findings changed." : "The source changed since the last inventory.", "Next: migrate:plan, to re-plan from it (done and skipped steps and edited maps are kept).");
  return { lines, code: 0 };
}

/**
 * migrate:plan [--root]: re-plan from the inventory, keeping the person's rulings.
 * @param {Parsed} parsed
 * @returns {Result}
 */
export function runPlan(parsed) {
  const root = rootOf(parsed);
  const previous = readPlan(root);
  const { inv } = readInventory(root);
  const plan = buildPlan(inv, { fidelity: previous.fidelity, profileModule: profileModule(/** @type {string} */ (inv.profile)), previous, maps, shell: shellOf(parsed) });
  const dropped = droppedSteps(previous, plan);
  const changed = writePlan(root, plan);
  const kept = plan.steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  return {
    code: 0,
    lines: [planLine(plan) + (changed ? "" : " Unchanged."), kept + " done or skipped step" + (kept === 1 ? "" : "s") + " kept.", ...(dropped.length ? ["Dropped (no longer produced): " + dropped.join(", ")] : [])],
  };
}

/**
 * migrate:status [--root] [--json] [--exit-code]: write the report, print a summary.
 * @param {Parsed} parsed
 * @returns {Result}
 */
export function runStatus(parsed) {
  const root = rootOf(parsed);
  const plan = readPlan(root);
  /** @type {Inventory | null} */
  let inv = null;
  try {
    inv = readInventory(root).inv;
  } catch {
    inv = null;
  }
  writeDataFiles(root, { [REPORT_FILE]: renderReport(plan, inv) });
  const open = openSteps(plan);
  const code = parsed.flags["exit-code"] === true && open.length ? 3 : 0;
  if (parsed.flags["json"] === true) {
    const o = { profile: plan.profile, fidelity: plan.fidelity, counts: statusCounts(plan), open: open.map((s) => ({ id: s.id, kind: s.kind, status: s.status, ...(s.why !== undefined ? { why: s.why } : {}) })) };
    return { code, lines: renderJson(o).replace(/\n$/, "").split("\n") };
  }
  return { code, lines: statusLines(plan) };
}

/**
 * migrate:serve <source> --harness <file> [--shared a,b] [--port n]: the baseline harness.
 * @param {Parsed} parsed @param {MigrateOpts} [opts]
 * @returns {Promise<{ lines: string[], url: string, close: () => Promise<void> }>}
 */
export async function runServe(parsed, opts = {}) {
  const src = parsed.positional[0];
  const file = str(parsed, "harness");
  if (!src || !file) throw new UsageError("migrate:serve needs a source and a harness file: gas-kit migrate:serve <source> --harness <file>", { title: "migrate:serve needs a source and a harness file", why: "It serves the source with a harness, and one of them is missing.", fix: "Run npm run kit -- migrate:serve <source> --harness <file>.", more: "npm run kit -- help" });
  const portText = str(parsed, "port") ?? "0";
  if (!/^\d{1,5}$/.test(portText) || Number(portText) > 65535) throw new UsageError("--port takes a number from 0 to 65535", { title: "--port needs a number from 0 to 65535", why: "The value is not a port number.", fix: "Use --port 8080, say, or leave it out to pick a free port.", more: "npm run kit -- help" });
  const abs = resolve(file);
  let st;
  try {
    st = lstatSync(abs);
  } catch {
    throw new UsageError("harness file not found: " + file, { title: "The harness file was not found", why: "There is no file at " + termLine(file) + ".", fix: "Check the path given to --harness.", more: "npm run kit -- help" });
  }
  if (!st.isFile() || st.size > 8_000_000) throw new UsageError("the harness file must be a regular file under 8 MB: " + file, { title: "The harness file cannot be used", why: "It must be a regular file under 8 MB: " + termLine(file) + ".", fix: "Point --harness at a JSON file, not a folder or a large file.", more: "npm run kit -- help" });
  let config;
  try {
    config = JSON.parse(readFileSync(abs, "utf8"));
  } catch (e) {
    throw new UsageError("the harness file is not JSON: " + /** @type {Error} */ (e).message, { title: "The harness file is not valid JSON", why: "It could not be parsed.", fix: "Fix the JSON in " + termLine(file) + ", then run it again.", more: "npm run kit -- help" });
  }
  const tree = openSource({ root: src, shared: sharedList(parsed) });
  const server = await (opts.startHarness ?? realStartHarness)({ tree, config, port: Number(portText) });
  return {
    url: server.url,
    close: server.close,
    lines: ["Serving " + (tree.roots[0]?.abs ?? src) + " read-only at " + server.url + " (offline: its CSP blocks requests that leave the harness, not a navigation away; the source's scripts run in your browser). Ctrl-C stops it.", ...(server.warnings ?? []).map((w) => "warning: " + w)],
  };
}

/**
 * migrate <source> <target> ...: init, apply, status.
 * @param {Parsed} parsed @param {MigrateOpts} [opts]
 * @returns {Promise<Result>}
 */
export async function runMigrate(parsed, opts = {}) {
  const init = await runInit(parsed, opts, { applied: true });
  const target = /** @type {string} */ (parsed.positional[1]);
  const apply = await applyPlan(target, { kitRoot: opts.kitRoot, stepsDir: opts.stepsDir, commit: parsed.flags["commit"] === true });
  const status = runStatus({ positional: [], flags: { root: target, ...(parsed.flags["exit-code"] === true ? { "exit-code": true } : {}) } });
  return { lines: [...init.lines, "", ...apply.lines, "", ...status.lines], code: apply.code || status.code };
}

/**
 * Dispatch a migrate command other than migrate:serve.
 * @param {string} command @param {Parsed} parsed @param {MigrateOpts} [opts]
 * @returns {Promise<Result>}
 */
export async function runMigrateCommand(command, parsed, opts = {}) {
  switch (command) {
    case "migrate":
      return runMigrate(parsed, opts);
    case "migrate:doctor":
      return runDoctor(parsed);
    case "migrate:init":
      return runInit(parsed, opts);
    case "migrate:inventory":
      return runInventory(parsed, opts);
    case "migrate:plan":
      return runPlan(parsed);
    case "migrate:apply": {
      const kitRoot = resolve(opts.kitRoot ?? defaultKitRoot());
      assertCheckout(kitRoot, "migrate:apply");
      return applyPlan(rootOf(parsed), { kitRoot, stepsDir: opts.stepsDir, step: str(parsed, "step"), dryRun: parsed.flags["dry-run"] === true, force: parsed.flags["force"] === true, commit: parsed.flags["commit"] === true });
    }
    case "migrate:done": {
      const id = parsed.positional[0];
      if (!id) throw new UsageError("migrate:done needs a step id: gas-kit migrate:done <step id> [--root <target>]", { title: "migrate:done needs a step id", why: "It marks one step done, and none was named.", fix: "Run npm run kit -- migrate:done <step id> [--root <target>].", more: "npm run kit -- help" });
      return markDone(rootOf(parsed), id, { runVerify: opts.runVerify });
    }
    case "migrate:status":
      return runStatus(parsed);
    default:
      throw new UsageError("unknown command " + JSON.stringify(command), { title: "gas-kit does not know the command " + JSON.stringify(termLine(command)), why: "It is not one of the migrate commands.", fix: "Pick one of migrate:doctor, init, inventory, plan, apply, done, status or serve.", more: "npm run kit -- help" });
  }
}
