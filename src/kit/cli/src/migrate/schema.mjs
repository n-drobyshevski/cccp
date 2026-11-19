// The shapes of a migration's data files, .migrate/inventory.json and .migrate/plan.json, and their
// validators. Both files sit in the target and a person may edit plan.json, so a validator reads
// them as untrusted: a step's run names a module by a plain identifier only, every path is a safe
// relative path, step ids are unique and kebab-case, "after" names known steps without a cycle,
// a grep verify holds a regex from a safe subset (no backreference, no quantified group that holds a
// quantifier or an alternation, at most three unbounded quantifiers, at most 200 characters), so a
// hand-edited pattern cannot make the verify run for ever. Validators return problem lines, never throw.
import { rootNameProblem } from "./sourceTree.mjs";
import { relProblem } from "./writeSet.mjs";

export const INVENTORY_SCHEMA = 1;
export const PLAN_SCHEMA = 1;

/** @typedef {"pending"|"done"|"skipped"|"failed"|"blocked"} StepStatus */

/**
 * @typedef {object} Step
 * @property {string} id kebab-case, stable across re-plans
 * @property {"tool"|"agent"} kind
 * @property {string} [run] tool steps only: the module steps/<run>.mjs
 * @property {string} title
 * @property {string[]} after ids of the steps that must be done (or skipped) first
 * @property {string} [page]
 * @property {boolean} [pilot]
 * @property {{ reads: string[], writes: string[] }} files reads are source keys or target paths; writes are target paths
 * @property {string[]} verify "check" | "build" | "kit:verify" | "ui:<page>" | "grep:<re>"; a grep
 *   pattern is held to the safe subset verifyProblem names
 * @property {StepStatus} status
 * @property {string} [why]
 * @property {number} attempts
 * @property {Record<string, string>} outputs target path to the sha256 last written there
 * @property {string[]} [notes]
 * @property {string} [spawnedBy] the id of the tool step that added this step to the plan
 */

/**
 * @typedef {object} Plan
 * @property {number} schema PLAN_SCHEMA
 * @property {"kit-shaped"|"el-builder"|"classic"} profile
 * @property {"preserve"|"reskin"} fidelity
 * @property {string} inventorySha sha256 of the inventory the plan was made from
 * @property {{ tokens: Record<string, string>, modules: Record<string, string>, routes: Record<string, string>, rpc: Record<string, string>, storage: Record<string, unknown>, baseline: Record<string, unknown> }} maps
 * @property {Step[]} steps
 */

/**
 * @typedef {object} InventoryFile
 * @property {string} key a source key ("<rel>" or "@<shared>/<rel>")
 * @property {number} bytes
 * @property {string} sha256
 * @property {import("./sourceTree.mjs").FileKind} kind
 */

/**
 * @typedef {object} Inventory
 * @property {number} schema INVENTORY_SCHEMA
 * @property {{ roots: { name: string }[], digest: string, git: { repo: boolean, clean: boolean | null, head: string | null } }} source
 *   digest is SourceTree.digest(); no absolute path is needed here
 * @property {InventoryFile[]} files
 * @property {{ key: string, why: string }[]} skipped
 * @property {{ name: string, score: number, evidence: string[] }[]} profiles
 * @property {string | null} profile the profile chosen (detected or forced)
 * @property {{ product: string | null, timeZone: string | null, accent: string | null, prefix: string | null, rawKeys: string[] }} config the values carried into the target
 * @property {Record<string, import("./scan/js.mjs").JsFindings>} [js] by source key
 * @property {Record<string, import("./scan/html.mjs").HtmlFindings>} [html]
 * @property {Record<string, import("./scan/css.mjs").CssFindings>} [css]
 * @property {import("./scan/manifest.mjs").ManifestFindings | null} [manifest]
 * @property {import("./scan/manifest.mjs").ClaspFindings | null} [clasp]
 * @property {{ name: string, kind: string, key: string, line: number }[]} [globals] server globals and their kind
 * @property {string[]} [rpc]
 * @property {string[]} [routes]
 * @property {string[]} [keyboard]
 * @property {{ key: string, line: number, name: string }[]} [secretSuspects] identifiers that look like credentials and are assigned a literal (the value is never recorded)
 */

const FILE_KINDS = new Set(["js", "ts", "gs", "html", "css", "json", "md", "other"]);
const PROFILES = new Set(["kit-shaped", "el-builder", "classic"]);
const FIDELITY = new Set(["preserve", "reskin"]);
const STATUSES = new Set(["pending", "done", "skipped", "failed", "blocked"]);
const KINDS = new Set(["tool", "agent"]);
const MAP_NAMES = ["tokens", "modules", "routes", "rpc", "storage", "baseline"];
const HEX64 = /^[0-9a-f]{64}$/;
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RUN = /^[A-Za-z][A-Za-z0-9]*$/;
const UI = /^ui:[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function isObj(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** @param {unknown} v @returns {v is string[]} */
function isStrings(v) {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * Why a source key is unusable, or null. A key is a write-safe relative path, optionally behind
 * one "@<name>/" segment naming a shared root.
 * @param {unknown} key
 */
export function keyProblem(key) {
  if (typeof key !== "string") return "a key must be a string";
  if (!key.startsWith("@")) return relProblem(key);
  const m = /^@([^/]*)\/(.+)$/.exec(key);
  if (!m) return "a key that starts with @ names a shared root: @<name>/<path>";
  const name = /** @type {string} */ (m[1]);
  const why = rootNameProblem(name);
  return why ? "the shared root name " + JSON.stringify(name) + " is unusable: " + why : relProblem(m[2]);
}

/**
 * Problems of an inventory.json value; empty when it is usable.
 * @param {unknown} o
 * @returns {string[]}
 */
export function validateInventory(o) {
  try {
    return inventoryProblems(o);
  } catch (e) {
    return ["inventory could not be checked: " + (/** @type {Error} */ (e)?.message ?? String(e))];
  }
}

/** @param {unknown} o @returns {string[]} */
function inventoryProblems(o) {
  /** @type {string[]} */
  const bad = [];
  if (!isObj(o)) return ["inventory is not a JSON object"];
  if (o["schema"] !== INVENTORY_SCHEMA) bad.push("inventory schema is " + JSON.stringify(o["schema"]) + ", expected " + INVENTORY_SCHEMA);
  const src = o["source"];
  if (!isObj(src)) bad.push("source is missing");
  else {
    if (typeof src["digest"] !== "string" || !HEX64.test(src["digest"])) bad.push("source.digest is not a sha256");
    if (!Array.isArray(src["roots"]) || !src["roots"].every((r) => isObj(r) && typeof r["name"] === "string")) bad.push("source.roots is not a list of { name }");
    if (!isObj(src["git"])) bad.push("source.git is missing");
  }
  const files = o["files"];
  if (!Array.isArray(files)) bad.push("files is not a list");
  else {
    /** @type {Set<string>} */
    const seen = new Set();
    files.forEach((file, i) => {
      if (!isObj(file)) return void bad.push("files[" + i + "] is not an object");
      const kp = keyProblem(file["key"]);
      if (kp) bad.push("files[" + i + "].key: " + kp);
      else if (seen.has(/** @type {string} */ (file["key"]))) bad.push("files[" + i + "].key is listed twice: " + file["key"]);
      else seen.add(/** @type {string} */ (file["key"]));
      if (typeof file["sha256"] !== "string" || !HEX64.test(file["sha256"])) bad.push("files[" + i + "].sha256 is not a sha256");
      if (typeof file["bytes"] !== "number" || !Number.isInteger(file["bytes"]) || file["bytes"] < 0) bad.push("files[" + i + "].bytes is not a byte count");
      if (!FILE_KINDS.has(/** @type {string} */ (file["kind"]))) bad.push("files[" + i + "].kind is not a file kind");
    });
  }
  if (!Array.isArray(o["skipped"]) || !o["skipped"].every((s) => isObj(s) && typeof s["key"] === "string" && typeof s["why"] === "string")) bad.push("skipped is not a list of { key, why }");
  const profiles = o["profiles"];
  if (!Array.isArray(profiles)) bad.push("profiles is not a list");
  else {
    profiles.forEach((p, i) => {
      if (!isObj(p) || !PROFILES.has(/** @type {string} */ (p["name"]))) bad.push("profiles[" + i + "] does not name a known profile");
      else if (typeof p["score"] !== "number" || p["score"] < 0 || p["score"] > 100) bad.push("profiles[" + i + "].score is not 0..100");
      else if (!isStrings(p["evidence"])) bad.push("profiles[" + i + "].evidence is not a list of strings");
    });
  }
  if (o["profile"] !== null && o["profile"] !== undefined && !PROFILES.has(/** @type {string} */ (o["profile"]))) bad.push("profile is not a known profile");
  const cfg = o["config"];
  if (!isObj(cfg)) bad.push("config is missing");
  else {
    for (const k of ["product", "timeZone", "accent", "prefix"]) if (cfg[k] !== null && cfg[k] !== undefined && typeof cfg[k] !== "string") bad.push("config." + k + " is not a string or null");
    if (cfg["rawKeys"] !== undefined && !isStrings(cfg["rawKeys"])) bad.push("config.rawKeys is not a list of strings");
  }
  for (const k of ["js", "html", "css"]) {
    const v = o[k];
    if (v === undefined) continue;
    if (!isObj(v)) bad.push(k + " is not an object keyed by source key");
    else for (const key of Object.keys(v)) if (keyProblem(key)) bad.push(k + " has an unusable key " + JSON.stringify(key));
  }
  for (const k of ["rpc", "routes", "keyboard"]) if (o[k] !== undefined && !isStrings(o[k])) bad.push(k + " is not a list of strings");
  if (o["globals"] !== undefined && !(Array.isArray(o["globals"]) && o["globals"].every((g) => isObj(g) && typeof g["name"] === "string" && typeof g["kind"] === "string"))) bad.push("globals is not a list of { name, kind }");
  return bad;
}

/**
 * Why a verify command is not one of the allowed shapes, or null.
 * @param {unknown} v
 */
export function verifyProblem(v) {
  if (typeof v !== "string") return "a verify entry must be a string";
  if (v === "check" || v === "build" || v === "kit:verify") return null;
  if (v.startsWith("ui:")) return UI.test(v) ? null : "a ui verify names a page in kebab-case: ui:<page>";
  if (v.startsWith("grep:")) {
    const re = v.slice(5);
    if (!re) return "a grep verify needs a pattern";
    if (re.length > 200) return "a grep pattern is at most 200 characters";
    try {
      new RegExp(re);
    } catch {
      return "a grep pattern does not compile: " + JSON.stringify(re);
    }
    return unsafePattern(re);
  }
  return "unknown verify " + JSON.stringify(v) + " (check, build, kit:verify, ui:<page> or grep:<re>)";
}

/**
 * Why a compiling pattern is outside the safe subset, or null. Conservative on purpose: it refuses
 * a backreference, a quantified group that itself holds a quantifier or an alternation ((a+)+,
 * (a|a)*), and more than three unbounded quantifiers (.*a.*b.*c.*), the shapes that backtrack
 * exponentially or with a high polynomial.
 * @param {string} re
 * @returns {string | null}
 */
function unsafePattern(re) {
  /** @type {{ quant: boolean, alt: boolean }[]} */
  const stack = [{ quant: false, alt: false }];
  let unbounded = 0;
  /** A quantifier at i, or 0: its length. @param {number} i */
  const quantAt = (i) => {
    const c = re[i];
    if (c === "*" || c === "+" || c === "?") return 1;
    if (c === "{") {
      const m = /^\{\d+(,\d*)?\}/.exec(re.slice(i, i + 24));
      if (m) return m[0].length;
    }
    return 0;
  };
  /** Mark a quantifier of length q at i on the top frame. @param {number} i @param {number} q */
  const quantify = (i, q) => {
    const top = /** @type {{ quant: boolean, alt: boolean }} */ (stack[stack.length - 1]);
    top.quant = true;
    if (re[i] === "*" || re[i] === "+" || (re[i] === "{" && /,\}$/.test(re.slice(i, i + q)))) unbounded++;
    let j = i + q;
    if (re[j] === "?" || re[j] === "+") j++; // lazy or possessive modifier
    return j;
  };
  let i = 0;
  while (i < re.length) {
    const c = re[i];
    if (c === "\\") {
      if (/[1-9]/.test(re[i + 1] ?? "") || re[i + 1] === "k") return "a grep pattern may not hold a backreference";
      i += 2;
    } else if (c === "[") {
      let j = i + 1;
      if (re[j] === "^") j++;
      if (re[j] === "]") j++;
      while (j < re.length && re[j] !== "]") j += re[j] === "\\" ? 2 : 1;
      i = j + 1;
    } else if (c === "(") {
      stack.push({ quant: false, alt: false });
      i++;
      if (re[i] === "?") {
        const m = /^\?(?:[:=!]|<[=!]|<[A-Za-z_]\w*>)/.exec(re.slice(i, i + 40));
        i += m ? m[0].length : 1;
      }
      continue;
    } else if (c === ")") {
      const inner = stack.length > 1 ? /** @type {{ quant: boolean, alt: boolean }} */ (stack.pop()) : { quant: false, alt: false };
      i++;
      const q = quantAt(i);
      if (q) {
        if (inner.quant || inner.alt) return "a grep pattern may not quantify a group that holds a quantifier or an alternation";
        i = quantify(i, q);
      } else if (inner.quant) /** @type {{ quant: boolean, alt: boolean }} */ (stack[stack.length - 1]).quant = true;
      continue;
    } else if (c === "|") {
      /** @type {{ quant: boolean, alt: boolean }} */ (stack[stack.length - 1]).alt = true;
      i++;
      continue;
    } else i++;
    const q = quantAt(i);
    if (q) i = quantify(i, q);
  }
  if (unbounded > 3) return "a grep pattern holds at most three unbounded quantifiers (*, +, {n,})";
  return null;
}

/**
 * Problems of one step; ids is the set of every step id in the plan.
 * @param {unknown} s @param {number} i @param {Set<string>} ids
 * @returns {string[]}
 */
function stepProblems(s, i, ids) {
  if (!isObj(s)) return ["steps[" + i + "] is not an object"];
  const at = "step " + (typeof s["id"] === "string" ? s["id"] : "#" + i);
  /** @type {string[]} */
  const bad = [];
  if (typeof s["id"] !== "string" || !KEBAB.test(s["id"])) bad.push(at + ": id is not kebab-case");
  if (!KINDS.has(/** @type {string} */ (s["kind"]))) bad.push(at + ": kind is not tool or agent");
  if (s["kind"] === "tool") {
    if (typeof s["run"] !== "string" || !RUN.test(s["run"])) bad.push(at + ": a tool step needs run, a plain module name (letters and digits) under steps/");
  } else if (s["run"] !== undefined) bad.push(at + ": only a tool step has run");
  if (typeof s["title"] !== "string" || !s["title"].trim()) bad.push(at + ": title is empty");
  if (!isStrings(s["after"])) bad.push(at + ": after is not a list of step ids");
  else for (const a of s["after"]) if (a === s["id"]) bad.push(at + ": it comes after itself");
  else if (!ids.has(a)) bad.push(at + ": after names an unknown step " + JSON.stringify(a));
  if (s["page"] !== undefined && (typeof s["page"] !== "string" || !KEBAB.test(s["page"]))) bad.push(at + ": page is not kebab-case");
  if (s["pilot"] !== undefined && typeof s["pilot"] !== "boolean") bad.push(at + ": pilot is not a boolean");
  const files = s["files"];
  if (!isObj(files) || !isStrings(files["reads"]) || !isStrings(files["writes"])) bad.push(at + ": files is not { reads: string[], writes: string[] }");
  else {
    for (const r of files["reads"]) {
      const p = keyProblem(r);
      if (p) bad.push(at + ": files.reads " + JSON.stringify(r) + ": " + p);
    }
    for (const w of files["writes"]) {
      const p = relProblem(w);
      if (p) bad.push(at + ": files.writes " + JSON.stringify(w) + ": " + p);
    }
  }
  if (!Array.isArray(s["verify"])) bad.push(at + ": verify is not a list");
  else
    for (const v of s["verify"]) {
      const p = verifyProblem(v);
      if (p) bad.push(at + ": " + p);
    }
  if (!STATUSES.has(/** @type {string} */ (s["status"]))) bad.push(at + ": status is not one of " + [...STATUSES].join(", "));
  if (s["why"] !== undefined && typeof s["why"] !== "string") bad.push(at + ": why is not a string");
  if (typeof s["attempts"] !== "number" || !Number.isInteger(s["attempts"]) || s["attempts"] < 0) bad.push(at + ": attempts is not a count");
  const out = s["outputs"];
  if (!isObj(out)) bad.push(at + ": outputs is not an object");
  else
    for (const [rel, sha] of Object.entries(out)) {
      const p = relProblem(rel);
      if (p) bad.push(at + ": outputs " + JSON.stringify(rel) + ": " + p);
      if (typeof sha !== "string" || !HEX64.test(sha)) bad.push(at + ": outputs " + JSON.stringify(rel) + " is not a sha256");
    }
  if (s["notes"] !== undefined && !isStrings(s["notes"])) bad.push(at + ": notes is not a list of strings");
  if (s["spawnedBy"] !== undefined) {
    if (typeof s["spawnedBy"] !== "string" || !ids.has(s["spawnedBy"])) bad.push(at + ": spawnedBy does not name a step of this plan");
    else if (s["spawnedBy"] === s["id"]) bad.push(at + ": it is spawned by itself");
  }
  return bad;
}

/**
 * Problems of a plan.json value; empty when it is usable.
 * @param {unknown} o
 * @returns {string[]}
 */
export function validatePlan(o) {
  try {
    return planProblems(o);
  } catch (e) {
    return ["plan could not be checked: " + (/** @type {Error} */ (e)?.message ?? String(e))];
  }
}

/** @param {unknown} o @returns {string[]} */
function planProblems(o) {
  if (!isObj(o)) return ["plan is not a JSON object"];
  /** @type {string[]} */
  const bad = [];
  if (o["schema"] !== PLAN_SCHEMA) bad.push("plan schema is " + JSON.stringify(o["schema"]) + ", expected " + PLAN_SCHEMA);
  if (!PROFILES.has(/** @type {string} */ (o["profile"]))) bad.push("profile is not kit-shaped, el-builder or classic");
  if (!FIDELITY.has(/** @type {string} */ (o["fidelity"]))) bad.push("fidelity is not preserve or reskin");
  if (typeof o["inventorySha"] !== "string" || !HEX64.test(o["inventorySha"])) bad.push("inventorySha is not a sha256");
  const maps = o["maps"];
  if (!isObj(maps)) bad.push("maps is missing");
  else for (const m of MAP_NAMES) if (maps[m] !== undefined && !isObj(maps[m])) bad.push("maps." + m + " is not an object");
  const steps = o["steps"];
  if (!Array.isArray(steps)) return [...bad, "steps is not a list"];
  /** @type {Set<string>} */
  const ids = new Set();
  steps.forEach((s, i) => {
    const id = isObj(s) ? s["id"] : undefined;
    if (typeof id !== "string") return;
    if (ids.has(id)) bad.push("step id " + id + " is used twice (steps[" + i + "])");
    ids.add(id);
  });
  steps.forEach((s, i) => bad.push(...stepProblems(s, i, ids)));
  const cycle = findCycle(steps);
  if (cycle) bad.push("steps form a cycle through after: " + cycle.join(" -> "));
  return bad;
}

/**
 * A cycle in the after graph, as a list of ids, or null.
 * @param {unknown[]} steps
 * @returns {string[] | null}
 */
function findCycle(steps) {
  /** @type {Map<string, string[]>} */
  const edges = new Map();
  for (const s of steps) if (isObj(s) && typeof s["id"] === "string" && isStrings(s["after"])) edges.set(s["id"], s["after"]);
  /** @type {Map<string, 1 | 2>} */
  const state = new Map();
  // Iterative depth-first search: a chain of thousands of steps cannot overflow the stack.
  for (const startId of edges.keys()) {
    if (state.has(startId)) continue;
    /** @type {{ id: string, next: number }[]} */
    const stack = [{ id: startId, next: 0 }];
    state.set(startId, 1);
    while (stack.length) {
      const top = /** @type {{ id: string, next: number }} */ (stack[stack.length - 1]);
      const out = edges.get(top.id) ?? [];
      if (top.next >= out.length) {
        state.set(top.id, 2);
        stack.pop();
        continue;
      }
      const a = /** @type {string} */ (out[top.next++]);
      if (!edges.has(a) || state.get(a) === 2) continue;
      if (state.get(a) === 1) {
        const ids = stack.map((f) => f.id);
        return [...ids.slice(ids.indexOf(a)), a];
      }
      state.set(a, 1);
      stack.push({ id: a, next: 0 });
    }
  }
  return null;
}

/**
 * The JSON text of a data file: two-space indent, a trailing newline, keys in insertion order (so
 * builders that insert deterministically render the same bytes).
 * @param {unknown} o
 */
export function renderJson(o) {
  return JSON.stringify(o, null, 2) + "\n";
}
