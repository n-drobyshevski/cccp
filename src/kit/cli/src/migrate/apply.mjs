// The migration runner. applyPlan runs the plan's pending tool steps (steps/<run>.mjs, one module
// per step, no registry) in plan order once the steps each waits for are done or skipped. Before
// anything runs it re-checks that the source is the one the inventory read and that the plan was
// made from this inventory. A step only describes writes: the runner refuses one that touches the
// vendored kit, its lock or the runner's own files, refuses to overwrite a file the step wrote
// earlier that a person has edited since (unless --force, as kit:sync does), skips writes whose
// bytes are unchanged, and applies the rest through a write set. markDone closes an agent step by
// running its verify entries: the target's own npm scripts, an in-process grep, or the
// finish-migration compare script; a missing check fails closed. The CLI never executes source code.
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { UsageError } from "../args.mjs";
import { defaultKitRoot } from "../create.mjs";
import { runGit } from "../git.mjs";
import { sha256 } from "../hash.mjs";
import { assertNoLink } from "../vendor.mjs";
import { RUNNER_FILES, normalizeStep, planProblems, readDataText, readInventory, readPlan, readSource, writePlan } from "./plan.mjs";
import { comparableName, openSource } from "./sourceTree.mjs";
import { termLine } from "./steps/_common.mjs";
import { assertSafeTarget, createWriteSet, relProblem } from "./writeSet.mjs";

/** @typedef {import("./plan.mjs").Plan} Plan */
/** @typedef {import("./plan.mjs").PlanStep} PlanStep */
/** @typedef {import("./plan.mjs").Inventory} Inventory */
/** @typedef {import("./sourceTree.mjs").SourceTree} SourceTree */

/**
 * The only way a step writes. Entries are checked when they are added: a write-safe relative path,
 * never src/kit, kit.lock.json or a runner file (and never a removal that would take one of them).
 * @typedef {object} StepWriter
 * @property {(rel: string, content: string | Buffer) => void} write
 * @property {(rel: string) => void} remove
 * @property {() => { rel: string, op: "write" | "remove", bytes: number }[]} list in the order entries were first added
 * @property {() => Map<string, { op: "write", content: Buffer } | { op: "remove" }>} entries
 */

/**
 * What a step's run(ctx) receives.
 * @typedef {object} StepContext
 * @property {PlanStep} step a copy of the step being run
 * @property {Plan} plan a copy of the plan: read it, return maps to change it
 * @property {Inventory} inv
 * @property {"preserve" | "reskin"} fidelity
 * @property {string} profile
 * @property {SourceTree} tree the source, read-only (read(key) re-checks each file's hash)
 * @property {string} target absolute path of the new app
 * @property {string} kitRoot absolute path of the kit checkout running the CLI
 * @property {StepWriter} out
 * @property {(rel: string) => string | null} readTarget the target file as this step leaves it so far
 *   (its own pending writes first, then the disk); null when absent
 * @property {(rel: string, marker: string | RegExp, replace: (match: string, ...groups: string[]) => string) => void} patchTarget
 *   replace the first match of marker in a target file, through out; throws
 *   "marker not found: <rel>: <marker>" when the template drifted
 */

/**
 * What run(ctx) returns (or resolves to). Nothing is fine too.
 * @typedef {object} StepResult
 * @property {string[]} [notes] recorded on the step
 * @property {Array<Partial<PlanStep> & { id: string, kind: "tool" | "agent", title: string }>} [spawn] steps inserted right
 *   after this one (status pending, after [this step] unless given)
 * @property {Record<string, Record<string, unknown>>} [maps] merged into plan.maps, map by map
 */

/** @typedef {{ ok: boolean, output: string }} VerifyResult */
/** @typedef {(target: string, entry: string) => VerifyResult | Promise<VerifyResult>} RunVerify */

/** The step modules shipped with the CLI. */
export const STEPS_DIR = join(dirname(fileURLToPath(import.meta.url)), "steps");
/** A run names a module file by a plain identifier: no path, no dot. */
export const RUN_NAME = /^[a-z][a-zA-Z0-9]*$/;
/** The finish-migration skill's compare script in the target, run for a ui:<page> verify. */
export const COMPARE_SCRIPT = ".claude/skills/finish-migration/scripts/compare.mjs";
const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const TAIL = 40;

/**
 * Why a step may not write (or remove) rel, or null. Each segment is compared in comparableName form
 * (case-folded, trailing dots and spaces dropped, an NTFS stream suffix cut, the code points HFS+
 * ignores dropped), so no variant a filesystem reads as src/kit or a runner file gets through.
 * @param {string} rel @param {"write" | "remove"} op
 */
export function guardProblem(rel, op) {
  const low = rel.split("/").map(comparableName).join("/");
  if (low === "kit.lock.json") return "a step never writes kit.lock.json";
  if (low === "src/kit" || low.startsWith("src/kit/")) return "a step never writes into src/kit (the vendored kit)";
  if (op === "remove" && low === "src") return "removing src would remove src/kit";
  for (const f of RUNNER_FILES) {
    if (low === f) return f + " belongs to the runner";
    if (op === "remove" && f.startsWith(low + "/")) return "removing " + rel + " would remove " + f;
  }
  return null;
}

/**
 * A guarded writer for one step.
 * @param {string} stepId
 * @returns {StepWriter}
 */
export function createStepWriter(stepId) {
  /** @type {Map<string, { op: "write", content: Buffer } | { op: "remove" }>} */
  const entries = new Map();
  /** @param {string} rel @param {"write" | "remove"} op */
  const check = (rel, op) => {
    const why = relProblem(rel) ?? guardProblem(rel, op);
    if (why) throw new Error("step " + stepId + " may not " + op + " " + JSON.stringify(rel) + ": " + why);
  };
  return {
    write(rel, content) {
      check(rel, "write");
      if (typeof content !== "string" && !Buffer.isBuffer(content)) throw new Error("step " + stepId + ": content for " + rel + " must be a string or a Buffer");
      entries.delete(rel);
      entries.set(rel, { op: "write", content: Buffer.from(content) });
    },
    remove(rel) {
      check(rel, "remove");
      entries.delete(rel);
      entries.set(rel, { op: "remove" });
    },
    list() {
      return [...entries].map(([rel, e]) => ({ rel, op: e.op, bytes: e.op === "write" ? e.content.length : 0 }));
    },
    entries() {
      return new Map(entries);
    },
  };
}

/**
 * The bytes of a target file, or null when it is absent. Never through a symlink.
 * @param {string} root @param {string} rel
 */
function targetBytes(root, rel) {
  const why = relProblem(rel);
  if (why) throw new Error("target path " + JSON.stringify(rel) + ": " + why);
  assertNoLink(root, rel, { deep: false, who: "migrate", hint: " or migrate into a fresh target" });
  const abs = join(root, ...rel.split("/"));
  let st;
  try {
    st = lstatSync(abs);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  const real = realpathSync(abs);
  const top = realpathSync(root);
  if (real !== top && !real.startsWith(top.endsWith(sep) ? top : top + sep)) throw new Error("target path " + rel + " resolves outside the target");
  return readFileSync(abs);
}

/**
 * The context a step's run receives. M7 and M8 unit tests build one with this, run a step, then look
 * at ctx.out.list() and ctx.readTarget(rel), or apply it with applyWrites.
 * @param {{ step: PlanStep, plan: Plan, inv: Inventory, tree: SourceTree, target: string, kitRoot?: string }} opts
 * @returns {StepContext}
 */
export function createStepContext({ step, plan, inv, tree, target, kitRoot }) {
  const root = resolve(target);
  const out = createStepWriter(step.id);
  /** @param {string} rel */
  const readTarget = (rel) => {
    const why = relProblem(rel);
    if (why) throw new Error("readTarget " + JSON.stringify(rel) + ": " + why);
    const pending = out.entries();
    const own = pending.get(rel);
    if (own) return own.op === "write" ? own.content.toString("utf8") : null;
    for (const [r, e] of pending) if (e.op === "remove" && rel.startsWith(r + "/")) return null;
    const bytes = targetBytes(root, rel);
    return bytes === null ? null : bytes.toString("utf8");
  };
  return {
    step: structuredClone(step),
    plan: structuredClone(plan),
    inv,
    fidelity: plan.fidelity,
    profile: plan.profile,
    tree,
    target: root,
    kitRoot: resolve(kitRoot ?? defaultKitRoot()),
    out,
    readTarget,
    patchTarget(rel, marker, replace) {
      const text = readTarget(rel);
      const label = typeof marker === "string" ? JSON.stringify(marker) : String(marker);
      if (text === null) throw new Error("marker not found: " + rel + ": " + label + " (the file does not exist)");
      let at = -1;
      let match = "";
      /** @type {string[]} */
      let groups = [];
      if (typeof marker === "string") {
        at = marker ? text.indexOf(marker) : -1;
        match = marker;
      } else {
        const re = new RegExp(marker.source, marker.flags.replace(/[gy]/g, ""));
        const m = re.exec(text);
        if (m) {
          at = m.index;
          match = m[0];
          groups = m.slice(1).map((g) => g ?? "");
        }
      }
      if (at < 0) throw new Error("marker not found: " + rel + ": " + label);
      const rep = replace(match, ...groups);
      if (typeof rep !== "string") throw new Error("patchTarget " + rel + ": the replace function must return a string");
      out.write(rel, text.slice(0, at) + rep + text.slice(at + match.length));
    },
  };
}

/**
 * Apply a step writer to the target: writes whose bytes are already on disk are skipped, removals of
 * absent paths are dropped, the rest goes through one write set (dryRun lists only).
 * @param {string} target @param {StepWriter} out @param {{ dryRun?: boolean }} [opts]
 * @returns {{ written: string[], unchanged: string[], removed: string[], shas: Record<string, string> }}
 */
export function applyWrites(target, out, { dryRun = false } = {}) {
  const root = resolve(target);
  const ws = createWriteSet(root);
  /** @type {string[]} */
  const unchanged = [];
  /** @type {Record<string, string>} */
  const shas = {};
  for (const [rel, e] of out.entries()) {
    if (e.op === "write") {
      shas[rel] = sha256(e.content);
      const now = targetBytes(root, rel);
      if (now !== null && now.equals(e.content)) unchanged.push(rel);
      else ws.write(rel, e.content);
    } else if (existsSync(join(root, ...rel.split("/"))) || isLink(join(root, ...rel.split("/")))) {
      ws.remove(rel);
    }
  }
  const res = ws.apply({ dryRun });
  return { written: res.written, unchanged, removed: res.removed, shas };
}

/** @param {string} p */
function isLink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/** @param {PlanStep | undefined} s */
const settled = (s) => !!s && (s.status === "done" || s.status === "skipped");

/** A step apply picks up on its own: pending, failed, or blocked only for want of its module. @param {PlanStep} s */
const runnable = (s) => s.status === "pending" || s.status === "failed" || (s.status === "blocked" && (s.why ?? "").startsWith("not implemented: "));

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function isObj(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A one-line, control-free commit subject. @param {string} s */
function subject(s) {
  return s.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 200);
}

/** -c flags for a fixed identity, only where the user has none configured. @param {string} cwd */
function gitIdentity(cwd) {
  /** @param {string} key */
  const has = (key) => {
    try {
      return runGit(["config", key], { cwd, stderr: "ignore" }).trim() !== "";
    } catch {
      return false;
    }
  };
  return [...(has("user.name") ? [] : ["-c", "user.name=gas-kit"]), ...(has("user.email") ? [] : ["-c", "user.email=gas-kit@example.org"])];
}

/**
 * Throw unless dir is the top of a git work tree.
 * @param {string} dir
 */
export function assertGitTop(dir) {
  let top = "";
  try {
    top = runGit(["rev-parse", "--show-toplevel"], { cwd: dir, stderr: "ignore" }).trim();
  } catch {
    top = "";
  }
  if (!top || realpathSync(top) !== realpathSync(dir)) throw new Error("--commit needs the target to be the top of a git repository: run git init in " + dir + " (or migrate:init --git), or leave --commit out");
}

/**
 * Paths outside .migrate/ that git sees as changed in the target.
 * @param {string} dir
 */
function dirtyOutsideMigrate(dir) {
  const parts = runGit(["status", "--porcelain", "-z", "--untracked-files=all"], { cwd: dir }).split("\0");
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const e = /** @type {string} */ (parts[i]);
    if (e.length < 4) continue;
    const path = e.slice(3);
    if (/^[RC]/.test(e)) i++;
    if (!path.startsWith(".migrate/")) out.push(path);
  }
  return out;
}

/**
 * git add -A and one commit, when anything is staged. True when it committed.
 * @param {string} dir @param {string} message
 */
export function commitAll(dir, message) {
  runGit(["add", "-A"], { cwd: dir });
  try {
    runGit(["diff", "--cached", "--quiet"], { cwd: dir });
    return false;
  } catch {
    runGit([...gitIdentity(dir), "commit", "-q", "-m", subject(message)], { cwd: dir });
    return true;
  }
}

/**
 * Merge a step's maps into the plan's, map by map, dangerous keys dropped.
 * @param {Plan} plan @param {unknown} maps
 */
function mergeMaps(plan, maps) {
  if (maps === undefined) return;
  if (!isObj(maps)) throw new Error("its result.maps is not an object");
  /** @type {Record<string, unknown>} */
  const into = /** @type {any} */ (plan.maps);
  for (const [name, value] of Object.entries(maps)) {
    if (BAD_KEYS.has(name)) continue;
    if (!isObj(value)) throw new Error("its result.maps." + name + " is not an object");
    /** @type {Record<string, unknown>} */
    const merged = { ...(isObj(into[name]) ? /** @type {Record<string, unknown>} */ (into[name]) : {}) };
    for (const [k, v] of Object.entries(value)) if (!BAD_KEYS.has(k)) merged[k] = v;
    into[name] = merged;
  }
}

/**
 * Insert the steps a step spawned right after it (and after what it spawned before). A spawned id
 * that is already in the plan from the same parent is redefined, keeping its status and outputs.
 * @param {Plan} plan @param {PlanStep} parent @param {unknown} spawn
 */
function insertSpawned(plan, parent, spawn) {
  if (spawn === undefined) return;
  if (!Array.isArray(spawn)) throw new Error("its result.spawn is not a list of steps");
  for (const raw of spawn) {
    if (!isObj(raw)) throw new Error("its result.spawn holds a value that is not a step");
    const status = raw["status"] === "blocked" ? "blocked" : "pending";
    const s = normalizeStep({ .../** @type {any} */ (raw), status, attempts: 0, outputs: {}, spawnedBy: parent.id });
    // A pending spawned step keeps its why: it is the reason a person or agent must act on it.
    if (!s.after.length) s.after = [parent.id];
    const at = plan.steps.findIndex((x) => x.id === s.id);
    if (at >= 0) {
      const had = /** @type {PlanStep} */ (plan.steps[at]);
      if (had.spawnedBy !== parent.id) throw new Error("it spawned " + s.id + ", which the plan already has");
      plan.steps[at] = normalizeStep({ ...s, status: had.status, attempts: had.attempts, outputs: had.outputs, ...(had.why !== undefined ? { why: had.why } : {}), ...(had.notes ? { notes: had.notes } : {}) });
      continue;
    }
    let pos = plan.steps.findIndex((x) => x.id === parent.id) + 1;
    while (pos < plan.steps.length && /** @type {PlanStep} */ (plan.steps[pos]).spawnedBy === parent.id) pos++;
    plan.steps.splice(pos, 0, s);
  }
}

/** @param {PlanStep} s */
function label(s) {
  return termLine(s.id + ": " + s.title);
}

/**
 * Run the plan's tool steps.
 * @param {string} target
 * @param {{ kitRoot?: string, step?: string, dryRun?: boolean, force?: boolean, commit?: boolean, stepsDir?: string,
 *   sources?: { root: string, shared: string[] } }} [opts] sources overrides .migrate/source.json
 * @returns {Promise<{ lines: string[], code: number }>}
 */
export async function applyPlan(target, opts = {}) {
  const root = resolve(target);
  const kitRoot = resolve(opts.kitRoot ?? defaultKitRoot());
  const stepsDir = resolve(opts.stepsDir ?? STEPS_DIR);
  const dryRun = opts.dryRun === true;
  const force = opts.force === true;
  if (opts.commit && dryRun) throw new UsageError("--commit and --dry-run do not go together", { title: "--commit and --dry-run cannot be used together", why: "A dry run changes nothing, so there is nothing to commit.", fix: "Drop one of them: npm run kit -- migrate:apply --dry-run, or npm run kit -- migrate:apply --commit.", more: "npm run kit -- help" });
  if (opts.step !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(opts.step)) throw new UsageError("--step takes a step id (kebab-case): " + JSON.stringify(opts.step), { title: "--step needs a step id", why: "A step id is lower-case words joined by hyphens, and " + JSON.stringify(termLine(opts.step)) + " is not one.", fix: "Copy an id from .migrate/plan.json, then run npm run kit -- migrate:apply --step <id>.", more: "npm run kit -- help" });
  let plan = readPlan(root);
  const { inv, sha } = readInventory(root);
  if (plan.inventorySha !== sha) return { code: 1, lines: ["migrate:apply refused: .migrate/inventory.json changed since the plan was made; run migrate:plan"] };
  const src = opts.sources ?? readSource(root);
  assertSafeTarget(root, { sources: [src.root, ...src.shared], kitRoot });
  const tree = openSource({ root: src.root, shared: src.shared });
  if (tree.digest() !== inv.source.digest) return { code: 1, lines: ["source changed since inventory: run migrate:inventory, then migrate:plan"] };
  if (opts.commit) {
    assertGitTop(root);
    const dirty = dirtyOutsideMigrate(root);
    if (dirty.length) return { code: 1, lines: ["migrate:apply --commit refused: the target has uncommitted changes outside .migrate/ (" + dirty.slice(0, 5).join(", ") + (dirty.length > 5 ? ", ..." : "") + "); commit or stash them first"] };
  }

  /** @type {string[]} */
  const lines = dryRun ? ["Dry run: nothing is written. Later steps see the target as it is now."] : [];
  /** @param {string} id */
  const byId = (id) => /** @type {PlanStep | undefined} */ (plan.steps.find((s) => s.id === id));
  /** @param {PlanStep} s */
  const waitingOn = (s) => s.after.filter((a) => !settled(byId(a)));
  const save = () => {
    if (!dryRun) writePlan(root, plan);
  };

  /** @type {PlanStep[]} */
  let queue;
  if (opts.step !== undefined) {
    const s = byId(opts.step);
    if (!s) throw new UsageError("no step " + JSON.stringify(opts.step) + " in the plan", { title: "The plan has no step " + JSON.stringify(termLine(opts.step)), why: "Step ids come from .migrate/plan.json.", fix: "Check the id, or run npm run kit -- migrate:status to list the steps.", more: "npm run kit -- help" });
    if (s.kind !== "tool") throw new UsageError(s.id + " is an agent step: do the work, then run migrate:done " + s.id, { title: termLine(s.id) + " is a step for you to do, not for the tool", why: "Agent steps are done by hand, so migrate:apply does not run them.", fix: "Do the work, then run npm run kit -- migrate:done " + termLine(s.id) + ".", more: "npm run kit -- help" });
    if (s.status === "skipped") return { code: 1, lines: ["migrate:apply refused: " + s.id + " is skipped; set its status to pending in .migrate/plan.json to run it"] };
    const wait = waitingOn(s);
    if (wait.length) return { code: 1, lines: ["migrate:apply refused: " + s.id + " waits on " + wait.join(", ") + ", which " + (wait.length === 1 ? "is" : "are") + " not done"] };
    queue = [s];
  } else queue = [];

  /** @type {Set<string>} */
  const tried = new Set();
  let ran = 0;
  for (;;) {
    const next =
      opts.step !== undefined
        ? queue.shift()
        : plan.steps.find((s) => s.kind === "tool" && !tried.has(s.id) && runnable(s) && !waitingOn(s).length);
    if (!next) break;
    tried.add(next.id);
    const res = await runStep(next);
    if (res === "stop") return { code: 1, lines: [...lines, ...summary(plan)] };
  }
  if (!ran && opts.step === undefined) lines.push("Nothing to run: every tool step is done, skipped, blocked or waiting.");
  return { code: 0, lines: [...lines, ...summary(plan)] };

  /**
   * @param {PlanStep} s
   * @returns {Promise<"ok" | "stop">}
   */
  async function runStep(s) {
    const run = s.run ?? "";
    if (!RUN_NAME.test(run)) {
      s.status = "blocked";
      s.why = "run is not a plain module name: " + JSON.stringify(run);
      lines.push("blocked " + label(s) + " (" + s.why + ")");
      save();
      return "ok";
    }
    const modPath = join(stepsDir, run + ".mjs");
    let isFile = false;
    try {
      isFile = lstatSync(modPath).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) {
      s.status = "blocked";
      s.why = "not implemented: " + run;
      lines.push("blocked " + label(s) + " (" + s.why + ")");
      save();
      return "ok";
    }
    // An output a person edited since the step wrote it is theirs until they say otherwise.
    const edited = Object.entries(s.outputs).filter(([rel, want]) => {
      const now = targetBytes(root, rel);
      return now === null || sha256(now) !== want;
    }).map(([rel]) => rel);
    if (edited.length && !force) {
      lines.push(
        "migrate:apply refused: " + s.id + " would overwrite " + (edited.length === 1 ? "a file" : edited.length + " files") + " changed since it wrote " + (edited.length === 1 ? "it" : "them") + ":",
        ...edited.map((r) => "  " + r),
        "Keep the edits (set the step's status to skipped in .migrate/plan.json), or pass --force to overwrite them.",
      );
      return "stop";
    }
    if (edited.length) lines.push("--force: " + s.id + " overwrites " + edited.join(", "));
    /** @param {string} why */
    const fail = (why) => {
      s.status = "failed";
      s.why = why;
      lines.push("failed  " + label(s) + ": " + termLine(why));
      save();
      return /** @type {const} */ ("stop");
    };
    let mod;
    try {
      mod = await import(pathToFileURL(modPath).href);
    } catch (e) {
      return fail("steps/" + run + ".mjs does not load: " + /** @type {Error} */ (e).message);
    }
    if (typeof mod.run !== "function") return fail("steps/" + run + ".mjs exports no run function");
    const ctx = createStepContext({ step: s, plan, inv, tree, target: root, kitRoot });
    /** @type {unknown} */
    let result;
    try {
      result = await mod.run(ctx);
    } catch (e) {
      return fail(/** @type {Error} */ (e)?.message ?? String(e));
    }
    if (result !== undefined && result !== null && !isObj(result)) return fail("its result is not an object");
    const r = /** @type {Record<string, unknown>} */ (result ?? {});
    const notes = r["notes"];
    if (notes !== undefined && !(Array.isArray(notes) && notes.every((n) => typeof n === "string"))) return fail("its result.notes is not a list of strings");
    // The plan as it will be when this step is done: checked before anything is written.
    const next = structuredClone(plan);
    const mine = /** @type {PlanStep} */ (next.steps.find((x) => x.id === s.id));
    try {
      mergeMaps(next, r["maps"]);
      insertSpawned(next, mine, r["spawn"]);
    } catch (e) {
      return fail(/** @type {Error} */ (e).message);
    }
    const bad = planProblems(next);
    if (bad.length) return fail("the plan it leaves is not valid: " + bad.join("; "));
    let res;
    try {
      res = applyWrites(root, ctx.out, { dryRun });
    } catch (e) {
      return fail(/** @type {Error} */ (e).message);
    }
    const outputs = { ...mine.outputs, ...res.shas };
    for (const rel of res.removed) for (const k of Object.keys(outputs)) if (k === rel || k.startsWith(rel + "/")) delete outputs[k];
    mine.outputs = outputs;
    mine.status = "done";
    delete mine.why;
    if (Array.isArray(notes)) mine.notes = [.../** @type {string[]} */ (notes)];
    plan = next;
    ran++;
    const verb = dryRun ? "would run " : "done    ";
    lines.push(verb + label(mine) + " (" + res.written.length + " written, " + res.unchanged.length + " unchanged, " + res.removed.length + " removed)");
    // The step's first note is its summary (what it converted, what it left): it belongs on screen.
    if (Array.isArray(notes) && typeof notes[0] === "string") lines.push("  " + termLine(notes[0]).slice(0, 300));
    if (dryRun) {
      for (const rel of res.written) lines.push("  write  " + rel);
      for (const rel of res.removed) lines.push("  remove " + rel);
    }
    const spawned = /** @type {PlanStep[]} */ (next.steps).filter((x) => x.spawnedBy === s.id).map((x) => x.id);
    if (spawned.length) lines.push("  spawned " + spawned.join(", "));
    save();
    if (opts.commit && commitAll(root, "migrate " + mine.id + ": " + mine.title)) lines.push("  committed: migrate " + mine.id);
    // A spawned tool step runs in this apply too (it comes right after, in plan order).
    return "ok";
  }
}

/**
 * The closing lines of apply: counts, and what is open.
 * @param {Plan} plan
 */
export function summary(plan) {
  /** @type {Record<string, number>} */
  const n = { done: 0, skipped: 0, pending: 0, blocked: 0, failed: 0 };
  for (const s of plan.steps) n[s.status] = (n[s.status] ?? 0) + 1;
  const agents = plan.steps.filter((s) => s.kind === "agent" && !settled(s)).length;
  return [
    "Plan: " + plan.steps.length + " steps: " + n["done"] + " done, " + n["skipped"] + " skipped, " + n["pending"] + " pending, " + n["blocked"] + " blocked, " + n["failed"] + " failed; " + agents + " agent step" + (agents === 1 ? "" : "s") + " open.",
    "Next: migrate:status writes .migrate/report.md with the open steps.",
  ];
}

/** The last lines of a text. @param {string} text @param {number} [n] */
export function tail(text, n = TAIL) {
  const all = text.replace(/\s+$/, "").split(/\r?\n/);
  return all.slice(-n);
}

/**
 * Lines of the target's src (outside src/kit) that match re, as "rel:line: text". Symlinks are
 * never followed; binary and oversized files are left out.
 * @param {string} target @param {RegExp} re
 */
export function grepTarget(target, re) {
  const root = resolve(target);
  /** @type {string[]} */
  const hits = [];
  /** @param {string} rel */
  const go = (rel) => {
    const abs = join(root, ...rel.split("/"));
    let names;
    try {
      names = readdirSync(abs).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const sub = rel + "/" + name;
      if (sub.toLowerCase() === "src/kit" || name === "node_modules") continue;
      const st = lstatSync(join(abs, name));
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) go(sub);
      else if (st.isFile() && st.size <= 2_000_000) {
        const bytes = readFileSync(join(abs, name));
        if (bytes.subarray(0, 8192).includes(0)) continue;
        bytes.toString("utf8").split(/\r?\n/).forEach((line, i) => {
          if (re.test(line)) hits.push(sub + ":" + (i + 1) + ": " + line.trim().slice(0, 200));
        });
      }
    }
  };
  go("src");
  return hits;
}

/** The file the baseline is described in (the finish-migration skill's harness.json). */
export const HARNESS_FILE = ".migrate/harness.json";

/**
 * The role a harness page is compared as (its "role" in .migrate/harness.json: owner, admin or
 * viewer), or null when the page names none, the file is absent or unreadable, or the role is not one
 * of the three (compare then opens the page as owner).
 * @param {string} target @param {string} page
 * @returns {"owner" | "admin" | "viewer" | null}
 */
export function harnessRole(target, page) {
  let o;
  try {
    const text = readDataText(target, HARNESS_FILE);
    if (text === null) return null;
    o = JSON.parse(text);
  } catch {
    return null;
  }
  const pages = o && typeof o === "object" && Array.isArray(o.pages) ? o.pages : [];
  const p = pages.find((/** @type {any} */ x) => x && typeof x === "object" && x.name === page);
  const role = p && typeof p.role === "string" ? p.role : null;
  return role === "owner" || role === "admin" || role === "viewer" ? role : null;
}

/**
 * Run one verify entry in the target. check, build and kit:verify are the target's own npm scripts
 * (spawned without a shell); grep:<re> passes when no line of src outside src/kit matches; ui:<page>
 * runs the finish-migration compare script (with --role when the page's harness.json entry names
 * one) and fails closed when the target has none.
 * @param {string} target @param {string} entry
 * @returns {VerifyResult}
 */
export function defaultRunVerify(target, entry) {
  const root = resolve(target);
  if (entry === "check" || entry === "build" || entry === "kit:verify") {
    const win = process.platform === "win32";
    // The arguments are fixed literals, so the shell Windows needs for npm.cmd sees nothing from the plan.
    const r = spawnSync(win ? "npm.cmd" : "npm", ["run", entry], { cwd: root, encoding: "utf8", shell: win, maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60 * 1000 });
    const output = (r.stdout ?? "") + (r.stderr ?? "") + (r.error ? "\n" + r.error.message : "");
    return { ok: r.status === 0, output };
  }
  if (entry.startsWith("grep:")) {
    let re;
    try {
      re = new RegExp(entry.slice(5));
    } catch (e) {
      return { ok: false, output: "the grep pattern does not compile: " + /** @type {Error} */ (e).message };
    }
    const hits = grepTarget(root, re);
    return { ok: hits.length === 0, output: hits.length ? hits.length + " line" + (hits.length === 1 ? "" : "s") + " of src still match " + re + ":\n" + hits.join("\n") : "no match for " + re };
  }
  if (entry.startsWith("ui:")) {
    const page = entry.slice(3);
    let present = false;
    try {
      assertNoLink(root, COMPARE_SCRIPT, { deep: false, who: "migrate" });
      present = lstatSync(join(root, ...COMPARE_SCRIPT.split("/"))).isFile();
    } catch {
      present = false;
    }
    if (!present) return { ok: false, output: "ui check not available: " + COMPARE_SCRIPT + " is not in the target (it comes with the template's finish-migration skill), so ui:" + page + " cannot pass" };
    const role = harnessRole(root, page);
    const r = spawnSync(process.execPath, [join(root, ...COMPARE_SCRIPT.split("/")), "--page", page, ...(role ? ["--role", role] : [])], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60 * 1000 });
    return { ok: r.status === 0, output: (r.stdout ?? "") + (r.stderr ?? "") + (r.error ? "\n" + r.error.message : "") };
  }
  return { ok: false, output: "unknown verify " + JSON.stringify(entry) };
}

/**
 * Close an agent step: run each of its verify entries in order, count the attempt, and mark it done
 * only when every one passes. A failure leaves it failed, with the output's tail as why.
 * @param {string} target @param {string} id
 * @param {{ runVerify?: RunVerify }} [opts]
 * @returns {Promise<{ lines: string[], code: number }>}
 */
export async function markDone(target, id, { runVerify = defaultRunVerify } = {}) {
  const root = resolve(target);
  const plan = readPlan(root);
  const s = plan.steps.find((x) => x.id === id);
  if (!s) throw new UsageError("no step " + JSON.stringify(id) + " in the plan", { title: "The plan has no step " + JSON.stringify(termLine(id)), why: "Step ids come from .migrate/plan.json.", fix: "Check the id, or run npm run kit -- migrate:status to list the steps.", more: "npm run kit -- help" });
  if (s.kind !== "agent") throw new UsageError(id + " is a tool step: run migrate:apply --step " + id + " (or set its status to skipped in .migrate/plan.json)", { title: termLine(id) + " is a step the tool runs", why: "migrate:done is only for steps you do by hand.", fix: "Run npm run kit -- migrate:apply --step " + termLine(id) + ", or set its status to skipped in .migrate/plan.json.", more: "npm run kit -- help" });
  if (s.status === "done") return { code: 0, lines: [id + " is already done."] };
  if (s.status === "skipped") return { code: 1, lines: ["migrate:done refused: " + id + " is skipped; set its status to pending in .migrate/plan.json first"] };
  const wait = s.after.filter((a) => !settled(/** @type {PlanStep | undefined} */ (plan.steps.find((x) => x.id === a))));
  if (wait.length) return { code: 1, lines: ["migrate:done refused: " + id + " waits on " + wait.join(", ") + ", which " + (wait.length === 1 ? "is" : "are") + " not done"] };
  /** @type {{ entry: string, output: string } | null} */
  let failed = null;
  for (const entry of s.verify) {
    const r = await runVerify(root, entry);
    if (!r.ok) {
      failed = { entry, output: r.output };
      break;
    }
  }
  // Re-read: a verify can take minutes, and only this step's fields change.
  const fresh = readPlan(root);
  const f = /** @type {PlanStep | undefined} */ (fresh.steps.find((x) => x.id === id));
  if (!f) throw new Error("step " + id + " left the plan while its verify ran");
  f.attempts += 1;
  if (failed) {
    const t = tail(failed.output);
    f.status = "failed";
    f.why = "verify " + failed.entry + " failed:\n" + t.join("\n");
    writePlan(root, fresh);
    return { code: 1, lines: ["migrate:done refused: " + id + ": verify " + failed.entry + " failed (attempt " + f.attempts + "). The last lines:", ...t] };
  }
  f.status = "done";
  delete f.why;
  writePlan(root, fresh);
  return { code: 0, lines: ["done    " + label(f) + " (" + (f.verify.length ? "verified: " + f.verify.join(", ") : "no verify listed") + "; attempt " + f.attempts + ")"] };
}
