// The copy-domain step of the kit-shaped profile, and the helpers the kit-shaped steps share.
// copy-domain copies the source's pure domain tree (src/domain/**/*.ts) verbatim, with a header,
// into src/domain/app/ of the target, where both of its bundles reach it. A domain file can only be
// copied when it still typechecks there: every import it has stays inside src/domain (so the
// relative paths hold after the move), and it names no Apps Script service (the domain is shared
// with the browser bundle). A file that does not, and every file that imports one, stays in
// .migrate/pending with an agent step port-domain-<name>. The helpers below find and rewrite module
// specifiers (with the tokenizer, never by running the code), make relative specifiers, check
// ported server text against the kit's server contracts, and name spawned steps.
import { posix } from "node:path";
import { tokenizeJs, unquote } from "../scan/js.mjs";
import { ADVANCED_WRITE_RE, MUTATORS, SHEET_CLEAR_RE } from "../../../../tooling/src/test/contracts/noMutators.js";
import { RULES } from "../../../../tooling/src/test/contracts/noDangerousServerApis.js";
import { stripComments } from "../../../../tooling/src/test/contracts/_util.js";
import { jsHeader, pendingPath } from "./_common.mjs";

/** @typedef {import("../apply.mjs").StepContext} StepContext */
/** @typedef {import("../apply.mjs").StepResult} StepResult */
/** @typedef {NonNullable<StepResult["spawn"]>[number]} SpawnStep */

/** Apps Script services and globals a ported module may not name without review. */
export const SERVICES = [
  "SpreadsheetApp", "DriveApp", "DocumentApp", "SlidesApp", "FormApp", "GmailApp", "MailApp", "CalendarApp",
  "UrlFetchApp", "PropertiesService", "CacheService", "LockService", "ScriptApp", "HtmlService", "ContentService",
  "Session", "Sheets", "Drive", "UserProperties", "CardService", "Jdbc",
];
const SERVICE_RE = new RegExp("(?<![\\w$.])(" + SERVICES.join("|") + ")(?![\\w$])", "g");
/** The domain is also browser code: it may not name these either. */
const DOMAIN_ONLY_RE = /(?<![\w$.])(Utilities|Logger|google|window|document|localStorage)(?![\w$])/g;

/**
 * A static import or re-export of a script (or a dynamic import() / require(), which no step rewrites).
 * @typedef {object} ImportSite
 * @property {string} spec the module specifier
 * @property {number} start offset of its string token (quote included)
 * @property {number} end
 * @property {boolean} dynamic import() or require()
 * @property {{ imported: string, local: string }[] | null} names named imports ("default" for a default
 *   import, "*" for a namespace); null for a side-effect import or `export *`
 * @property {number} stmtStart offset of the import / export keyword (static sites only)
 * @property {number} stmtEnd offset just past the statement (its semicolon when it has one)
 */

/**
 * The module specifiers of a script, from its tokens.
 * @param {string} text
 * @returns {ImportSite[]}
 */
export function importSites(text) {
  const toks = tokenizeJs(text).filter((t) => t.type !== "comment");
  /** @type {ImportSite[]} */
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const t = /** @type {import("../scan/js.mjs").JsToken} */ (toks[i]);
    const p = toks[i - 1];
    const pp = toks[i - 2];
    if (t.type === "ident" && (t.value === "import" || t.value === "require") && toks[i + 1]?.value === "(" && !(p && p.value === ".")) {
      const s = toks[i + 2];
      out.push({ spec: s && s.type === "string" ? unquote(s.value) : "", start: s ? s.start : t.start, end: s ? s.end : t.end, dynamic: true, names: null, stmtStart: t.start, stmtEnd: t.end });
      continue;
    }
    if (t.type !== "string" || !p || p.type !== "ident") continue;
    const sideEffect = p.value === "import" && !(pp && pp.value === ".");
    if (p.value !== "from" && !sideEffect) continue;
    // Back to the statement's keyword: import / export at the start of a statement.
    let k = i - 1;
    while (k >= 0 && !(toks[k]?.type === "ident" && (toks[k]?.value === "import" || toks[k]?.value === "export") && (k === 0 || [";", "}", "{"].includes(String(toks[k - 1]?.value)) || toks[k - 1]?.type === "string" || toks[k - 1]?.type === "template"))) k--;
    if (k < 0) continue;
    const kw = /** @type {import("../scan/js.mjs").JsToken} */ (toks[k]);
    const next = toks[i + 1];
    const stmtEnd = next && next.value === ";" ? next.end : t.end;
    out.push({ spec: unquote(t.value), start: t.start, end: t.end, dynamic: false, names: sideEffect ? null : clauseNames(toks.slice(k + 1, i - 1)), stmtStart: kw.start, stmtEnd });
  }
  return out;
}

/**
 * The names of an import or export clause (the tokens between the keyword and `from`).
 * @param {import("../scan/js.mjs").JsToken[]} toks
 * @returns {{ imported: string, local: string }[] | null}
 */
function clauseNames(toks) {
  const t = toks.filter((x) => !(x.type === "ident" && x.value === "type"));
  if (!t.length) return null;
  if (t[0]?.value === "*") {
    if (t[1]?.value === "as" && t[2]) return [{ imported: "*", local: t[2].value }];
    return null;
  }
  /** @type {{ imported: string, local: string }[]} */
  const names = [];
  let i = 0;
  if (t[0]?.type === "ident" && t[0].value !== "{") {
    names.push({ imported: "default", local: t[0].value });
    i = 1;
    if (t[i]?.value === ",") i++;
  }
  if (t[i]?.value === "*" && t[i + 1]?.value === "as" && t[i + 2]) {
    names.push({ imported: "*", local: String(t[i + 2]?.value) });
    return names;
  }
  if (t[i]?.value !== "{") return names;
  i++;
  while (i < t.length && t[i]?.value !== "}") {
    const a = t[i];
    if (!a || a.value === ",") {
      i++;
      continue;
    }
    if (t[i + 1]?.value === "as" && t[i + 2]) {
      names.push({ imported: a.type === "string" ? unquote(a.value) : a.value, local: String(t[i + 2]?.value) });
      i += 3;
    } else {
      names.push({ imported: a.value, local: a.value });
      i++;
    }
  }
  return names;
}

/**
 * Replace ranges of a text (ranges must not overlap).
 * @param {string} text @param {{ start: number, end: number, text: string }[]} edits
 */
export function applyEdits(text, edits) {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/**
 * The relative specifier from a target file to a target path. A TypeScript target, and any target
 * the source named without an extension, is written without one (the template's own style).
 * @param {string} fromRel the importing file, a target path @param {string} toRel the imported file
 * @param {boolean} keepExt
 */
export function relSpec(fromRel, toRel, keepExt) {
  let r = posix.relative(posix.dirname(fromRel), toRel);
  if (!r.startsWith(".")) r = "./" + r;
  if (/\.ts$/.test(toRel) || !keepExt) r = r.replace(/\.(?:ts|js|mjs)$/, "");
  return r;
}

/**
 * Where an imported source module lives in the target: a kit specifier, a target path, or why it
 * cannot be imported there.
 * @typedef {{ spec: string } | { path: string } | { problem: string }} Located
 */

/**
 * Rewrite every relative specifier of a script that moves to toRel. A @gas-kit/ specifier stays;
 * any other bare specifier, a dynamic import and a specifier locate refuses are problems.
 * @param {string} text @param {string} fromKey @param {string} toRel
 * @param {(fromKey: string, spec: string) => string | null} resolve the source tree's resolve
 * @param {(key: string, site: ImportSite) => Located} locate
 * @returns {{ text: string, problems: string[] }}
 */
export function rewriteImports(text, fromKey, toRel, resolve, locate) {
  /** @type {string[]} */
  const problems = [];
  /** @type {{ start: number, end: number, text: string }[]} */
  const edits = [];
  for (const site of importSites(text)) {
    if (site.dynamic) {
      problems.push("loads a module at run time (import() or require())");
      continue;
    }
    if (site.spec.startsWith("@gas-kit/")) continue;
    if (!site.spec.startsWith("./") && !site.spec.startsWith("../")) {
      problems.push("imports the package " + JSON.stringify(site.spec.slice(0, 80)));
      continue;
    }
    const key = resolve(fromKey, site.spec);
    if (!key) {
      problems.push("imports " + JSON.stringify(site.spec.slice(0, 80)) + ", which is not in the source");
      continue;
    }
    const at = locate(key, site);
    if ("problem" in at) problems.push(at.problem);
    else {
      const spec = "spec" in at ? at.spec : relSpec(toRel, at.path, /\.(?:m?js|ts)$/.test(site.spec));
      const q = text.charAt(site.start) === "'" ? "'" : '"';
      edits.push({ start: site.start, end: site.end, text: q + spec + q });
    }
  }
  return { text: applyEdits(text, edits), problems };
}

/** Each match of a global regex in comment-free code, as a short reason. @param {string} code @param {RegExp} re @param {(m: RegExpMatchArray) => string} what */
function hits(code, re, what) {
  return [...code.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))].map(what);
}

/**
 * Why a ported server (or domain) text would fail the template's server contracts, or [] when it
 * would pass: no Apps Script service named outside a reviewed module (SECURITY.md: a module that
 * touches a service is named in the contracts' allow lists, which a migration never edits), no
 * Sheets or Drive mutator, no dangerous server API.
 * @param {string} text @param {{ domain?: boolean }} [opts] domain: also refuse the browser-unsafe globals
 */
export function serverRuleBreaks(text, { domain = false } = {}) {
  const code = stripComments(text);
  /** @type {Set<string>} */
  const out = new Set();
  for (const r of hits(code, SERVICE_RE, (m) => "names the service " + m[1])) out.add(r);
  if (domain) for (const r of hits(code, DOMAIN_ONLY_RE, (m) => "names " + m[1] + ", which the shared domain may not")) out.add(r);
  const plain = MUTATORS.filter((n) => n !== "clear");
  const mut = new RegExp("(?:\\.\\s*|\\[\\s*[\"'])(" + plain.join("|") + ")(?:[\"']\\s*\\])?\\s*\\(", "g");
  for (const r of hits(code, mut, (m) => "calls the mutator " + m[1] + "()")) out.add(r);
  if (new RegExp(SHEET_CLEAR_RE.source).test(code)) out.add("calls the mutator clear()");
  if (new RegExp(ADVANCED_WRITE_RE.source).test(code)) out.add("writes through an advanced service");
  for (const rule of RULES) if (new RegExp(rule.re.source).test(code)) out.add(rule.what + " (" + rule.id + ")");
  return [...out];
}

/**
 * A step id derived from a name that is not in the plan yet (or that this step spawned before).
 * @param {StepContext} ctx @param {string} prefix @param {string} name
 */
export function spawnId(ctx, prefix, name) {
  const slug = (prefix + "-" + name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || prefix;
  /** @param {string} id */
  const free = (id) => {
    const s = /** @type {any} */ (ctx.plan.steps.find((x) => x.id === id));
    return !s || s.spawnedBy === ctx.step.id || s.spawnedBy === ctx.step.spawnedBy;
  };
  if (free(slug)) return slug;
  for (let i = 2; i < 100; i++) if (free(slug + "-" + i)) return slug + "-" + i;
  throw new Error(ctx.step.id + ": no free step id for " + slug);
}

/**
 * An agent step a tool step spawns: why goes in its notes too (the runner keeps notes on a pending step).
 * @param {{ id: string, title: string, why: string, reads?: string[], writes?: string[], verify?: string[], page?: string }} o
 * @returns {SpawnStep}
 */
export function agentStep(o) {
  return {
    id: o.id,
    kind: "agent",
    title: o.title,
    ...(o.page ? { page: o.page } : {}),
    files: { reads: o.reads ?? [], writes: o.writes ?? [] },
    verify: o.verify ?? ["check"],
    why: o.why,
    notes: [o.why],
  };
}

/** The file name of a key without its directory and extension. @param {string} key */
export const stem = (key) => (key.split("/").pop() ?? key).replace(/\.[^.]+$/, "");

/** A short list for a note. @param {string[]} xs */
export const listOf = (xs) => (xs.length > 6 ? xs.slice(0, 6).join("; ") + "; and " + (xs.length - 6) + " more" : xs.join("; "));

/** The target path of a source domain key. @param {string} key */
export const domainTarget = (key) => "src/domain/app/" + key.slice("src/domain/".length);

/** @param {StepContext} ctx @returns {StepResult} */
export function run(ctx) {
  const keys = ctx.inv.files.filter((f) => f.key.startsWith("src/domain/") && f.kind === "ts").map((f) => f.key).sort();
  /** @type {Map<string, string>} */
  const texts = new Map(keys.map((k) => [k, ctx.tree.read(k)]));
  /** @type {Map<string, string[]>} */
  const why = new Map();
  /** @type {Map<string, string[]>} */
  const deps = new Map();
  for (const key of keys) {
    const text = /** @type {string} */ (texts.get(key));
    /** @type {string[]} */
    const bad = [];
    /** @type {string[]} */
    const uses = [];
    for (const site of importSites(text)) {
      if (site.dynamic) bad.push("loads a module at run time");
      else if (!site.spec.startsWith("./") && !site.spec.startsWith("../")) bad.push("imports " + JSON.stringify(site.spec.slice(0, 80)) + ", outside src/domain");
      else {
        const k = ctx.tree.resolve(key, site.spec);
        if (!k || !k.startsWith("src/domain/")) bad.push("imports " + JSON.stringify(site.spec.slice(0, 80)) + ", outside src/domain");
        else if (!texts.has(k)) bad.push("imports " + k + ", which is not TypeScript");
        else uses.push(k);
      }
    }
    bad.push(...serverRuleBreaks(text, { domain: true }));
    if (bad.length) why.set(key, bad);
    deps.set(key, uses);
  }
  // A file that imports one that stays pending stays pending too.
  for (let changed = true; changed; ) {
    changed = false;
    for (const key of keys) {
      if (why.has(key)) continue;
      const held = (deps.get(key) ?? []).filter((k) => why.has(k));
      if (held.length) {
        why.set(key, ["imports " + held.join(", ") + ", which stays pending"]);
        changed = true;
      }
    }
  }
  /** @type {string[]} */
  const notes = [];
  /** @type {SpawnStep[]} */
  const spawn = [];
  let copied = 0;
  for (const key of keys) {
    const bad = why.get(key);
    if (bad) {
      const id = spawnId(ctx, "port-domain", key.slice("src/domain/".length).replace(/\.ts$/, ""));
      spawn.push(agentStep({ id, title: "Port the domain module " + key + " by hand", why: key + " cannot be copied as it is: " + listOf(bad), reads: [key], writes: [domainTarget(key)] }));
      notes.push(key + " stays in .migrate/pending: " + listOf(bad));
      continue;
    }
    ctx.out.write(domainTarget(key), jsHeader(ctx.step.id, key) + texts.get(key));
    ctx.out.remove(pendingPath(key));
    copied++;
  }
  notes.unshift(copied + " domain file" + (copied === 1 ? "" : "s") + " copied into src/domain/app");
  return { notes, ...(spawn.length ? { spawn } : {}) };
}
