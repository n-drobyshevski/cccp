// The carry-roles step of the kit-shaped profile: the source's ENDPOINT_ROLES (src/server/roles.ts,
// read as text with the tokenizer, never run) become plan.maps.roles, which rpc-surface reads when it
// adds each endpoint (it runs after this step). viewer, admin and owner mean what the kit means by
// them and are carried as they are. Any other role (an app's own "editor", say), and a value the
// step cannot read as a string, becomes owner, the strictest, with an agent step review-role-<name>:
// a person decides which kit role is right. The step writes no file.
import { tokenizeJs, unquote } from "../scan/js.mjs";
import { pendingPath } from "./_common.mjs";
import { agentStep, spawnId } from "./copyDomain.mjs";
import { closeOf } from "./kitImports.mjs";

/** @typedef {import("../apply.mjs").StepContext} StepContext */
/** @typedef {import("../apply.mjs").StepResult} StepResult */

const ROLES = "src/server/roles.ts";
const KIT_ROLES = new Set(["viewer", "admin", "owner"]);
const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * The entries of `ENDPOINT_ROLES = { name: "role", ... }` in a roles.ts text. A value that is not a
 * string literal reads as null.
 * @param {string} text
 * @returns {{ name: string, role: string | null }[] | null} null when there is no such object
 */
export function readEndpointRoles(text) {
  const toks = tokenizeJs(text).filter((t) => t.type !== "comment");
  const at = toks.findIndex((t, i) => t.type === "ident" && t.value === "ENDPOINT_ROLES" && toks[i + 1]?.value === "=" );
  if (at < 0) return null;
  let open = at + 2;
  while (open < toks.length && toks[open]?.value !== "{") {
    if (toks[open]?.value === ";") return null;
    open++;
  }
  const close = closeOf(toks, open);
  if (close < 0) return null;
  /** @type {{ name: string, role: string | null }[]} */
  const out = [];
  let i = open + 1;
  while (i < close) {
    const k = /** @type {import("../scan/js.mjs").JsToken} */ (toks[i]);
    if (k.value === ",") {
      i++;
      continue;
    }
    const name = k.type === "string" ? unquote(k.value) : k.type === "ident" ? k.value : null;
    if (name === null || toks[i + 1]?.value !== ":") return null;
    // The value runs to the next comma of this object.
    let j = i + 2;
    while (j < close && toks[j]?.value !== ",") {
      const t = toks[j];
      if (t && t.type === "punct" && (t.value === "(" || t.value === "[" || t.value === "{")) j = closeOf(toks, j);
      if (j < 0) return null;
      j++;
    }
    const v = toks.slice(i + 2, j);
    out.push({ name, role: v.length === 1 && v[0]?.type === "string" ? unquote(v[0].value) : null });
    i = j;
  }
  return out;
}

/** @param {StepContext} ctx @returns {StepResult} */
export function run(ctx) {
  if (!ctx.tree.files.has(ROLES)) return { notes: [ROLES + " is not in the source: every endpoint stays owner-only until classify-roles"] };
  const entries = readEndpointRoles(ctx.tree.read(ROLES));
  if (!entries) return { notes: [ROLES + " has no ENDPOINT_ROLES object the step can read: every endpoint stays owner-only until classify-roles"] };
  /** @type {Record<string, string>} */
  const roles = {};
  /** @type {string[]} */
  const notes = [];
  /** @type {import("./copyDomain.mjs").SpawnStep[]} */
  const spawn = [];
  for (const { name, role } of entries) {
    if (BAD_KEYS.has(name) || !/^[A-Za-z_$][\w$]*$/.test(name)) {
      notes.push("endpoint name " + JSON.stringify(name.slice(0, 40)) + " is not an identifier: not carried");
      continue;
    }
    if (role !== null && KIT_ROLES.has(role)) {
      roles[name] = role;
      continue;
    }
    roles[name] = "owner";
    const shown = role === null ? "that is not a string literal" : JSON.stringify(role.slice(0, 40));
    const why = "source role " + shown + " has no kit equivalent";
    notes.push(name + ": " + why + "; carried as owner");
    spawn.push(agentStep({
      id: spawnId(ctx, "review-role", name),
      title: "Choose the kit role for " + name + " (the source's role was " + shown + ")",
      why: why + ". " + name + " is owner-only until you choose viewer, admin or owner in src/server/roles.ts and the role matrix in test/contracts.test.ts",
      reads: [ROLES],
      writes: ["src/server/roles.ts", "test/contracts.test.ts"],
    }));
  }
  ctx.out.remove(pendingPath(ROLES));
  notes.unshift(Object.keys(roles).length + " endpoint role" + (Object.keys(roles).length === 1 ? "" : "s") + " carried into maps.roles (rpc-surface applies them)");
  return { notes, maps: { roles }, ...(spawn.length ? { spawn } : {}) };
}
