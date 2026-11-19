// The dependency audit: npm's advisory report for each folder, held to a policy, with written
// exceptions that expire.
//
//   node <tooling>/deps/audit.mjs [<dir> ...] [--level low|moderate|high|critical] [--offline-ok]
//                                 [--markdown] [--today yyyy-MM-dd]
//
// For each folder (default: the current one) it runs `npm audit --json` there (npm reads the
// folder's package-lock.json; no install is needed) and lists every advisory, dev tools included:
// clasp, esbuild and the test runner run on the developer's machine, and clasp holds the Google
// token that can push and deploy the app. An advisory at or above the level (default moderate) is
// a finding, unless the folder's `audit-allow.json` names it:
//
//   [{ "id": "GHSA-xxxx-xxxx-xxxx", "package": "zod", "reason": "why it cannot reach us", "until": "2027-01-31" }]
//
// An entry needs an advisory id, a reason of at least 20 characters and an `until` date no more
// than MAX_ALLOW_DAYS ahead, so an exception is a visible, dated decision that comes back for
// review. An expired or malformed entry, or a malformed file, is a finding too (fail closed).
// An entry that matches nothing is reported so it can be deleted.
//
// Exit codes: 0 clean, 1 findings, 2 the audit could not run (no lockfile, no registry, an npm
// error). `--offline-ok` turns 2 into a warning and exit 0, for `npm run push` behind a proxy
// that blocks the npm registry; CI and the scheduled audit never pass it.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SEVERITIES = /** @type {const} */ (["info", "low", "moderate", "high", "critical"]);
export const ALLOW_FILE = "audit-allow.json";
export const MAX_ALLOW_DAYS = 90;
export const DEFAULT_LEVEL = "moderate";
const ID_RE = /^(GHSA(-[23456789cfghjmpqrvwx]{4}){3}|npm-[0-9]{1,9})$/;
const DAY_RE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

/**
 * @typedef {{ id: string, package: string, severity: string, title: string, url: string,
 *   range: string, by: string[], fix: string }} Finding
 * @typedef {{ id: string, package?: string, reason: string, until: string }} Allowance
 * @typedef {{ dir: string, status: "ok" | "findings" | "unavailable", findings: Finding[],
 *   allowed: Array<Finding & { reason: string, until: string }>, below: Finding[],
 *   problems: string[], unused: Allowance[], error?: string }} FolderResult
 */

/** @param {string} s */
const rank = (s) => SEVERITIES.indexOf(/** @type {any} */ (s));

/**
 * Days from one yyyy-MM-dd to another, or NaN when either is not a real calendar day.
 * @param {string} from @param {string} to
 */
export function daysBetween(from, to) {
  /** @param {string} d */
  const at = (d) => {
    const m = DAY_RE.exec(d);
    if (!m) return NaN;
    const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    // Date.UTC rolls 2027-02-30 over to March; a day that does not round-trip is not a day.
    return new Date(t).toISOString().slice(0, 10) === d ? t : NaN;
  };
  return (at(to) - at(from)) / 86_400_000;
}

/** The advisory id of a url (GHSA-...), else npm-<source>. @param {any} a */
function advisoryId(a) {
  const m = /GHSA(-[a-z0-9]{4}){3}/.exec(String(a.url || ""));
  return m ? m[0] : "npm-" + String(a.source ?? "");
}

/**
 * The advisories in an `npm audit --json` report (format 2, npm 7 and later), one per advisory and
 * package, with the direct dependencies that bring each in and the fix npm offers.
 * @param {any} report
 * @returns {Finding[]}
 */
export function findingsOf(report) {
  const vulns = report && typeof report.vulnerabilities === "object" && report.vulnerabilities ? report.vulnerabilities : {};
  /** Direct dependencies above a package, through `effects` (the packages that depend on it). @param {string} name */
  const directAbove = (name) => {
    /** @type {Set<string>} */
    const out = new Set();
    const seen = new Set();
    const walk = (/** @type {string} */ n) => {
      if (seen.has(n)) return;
      seen.add(n);
      const v = Object.prototype.hasOwnProperty.call(vulns, n) ? vulns[n] : null;
      if (!v) return;
      if (v.isDirect) out.add(n);
      for (const e of Array.isArray(v.effects) ? v.effects : []) walk(String(e));
    };
    walk(name);
    // A package no vulnerable direct dependency leads to is brought in by an unaffected one.
    return [...out].sort();
  };
  /** @type {Map<string, Finding>} */
  const found = new Map();
  for (const [name, v] of Object.entries(vulns)) {
    for (const a of Array.isArray(v?.via) ? v.via : []) {
      if (!a || typeof a !== "object") continue;
      const pkg = String(a.name || name);
      const id = advisoryId(a);
      const key = id + " " + pkg;
      if (found.has(key)) continue;
      found.set(key, {
        id, package: pkg,
        severity: SEVERITIES.includes(a.severity) ? a.severity : "critical",
        title: String(a.title || "").replace(/\s+/g, " ").trim(),
        url: String(a.url || ""),
        range: String(a.range || v.range || ""),
        by: directAbove(pkg),
        fix: fixText(v.fixAvailable),
      });
    }
  }
  return [...found.values()].sort((x, y) => rank(y.severity) - rank(x.severity) || x.package.localeCompare(y.package) || x.id.localeCompare(y.id));
}

/** @param {any} f npm's fixAvailable */
function fixText(f) {
  if (f === true) return "npm audit fix (within the ranges in package.json)";
  if (f && typeof f === "object" && f.name) {
    return "npm proposes " + f.name + "@" + f.version + (f.isSemVerMajor ? ", a major change: read it first, it can be a downgrade" : "");
  }
  return "no fixed version in range yet: update the package that brings it in, add an override in package.json, or allow it in " + ALLOW_FILE;
}

/**
 * Validates an `audit-allow.json` value. Every problem is a finding, so a broken file fails the
 * audit instead of allowing everything or nothing silently.
 * @param {unknown} value
 * @param {string} today yyyy-MM-dd
 * @returns {{ entries: Allowance[], problems: string[] }}
 */
export function readAllowances(value, today) {
  /** @type {string[]} */
  const problems = [];
  /** @type {Allowance[]} */
  const entries = [];
  if (!Array.isArray(value)) return { entries, problems: [ALLOW_FILE + " must hold a JSON array of entries"] };
  value.forEach((e, i) => {
    const at = ALLOW_FILE + " entry " + (i + 1);
    if (!e || typeof e !== "object" || Array.isArray(e)) { problems.push(at + " is not an object"); return; }
    const extra = Object.keys(e).filter((k) => !["id", "package", "reason", "until"].includes(k));
    if (extra.length) problems.push(at + " has unknown keys: " + extra.join(", "));
    const id = typeof e.id === "string" ? e.id : "";
    if (!ID_RE.test(id)) { problems.push(at + ": id must be an advisory id (GHSA-xxxx-xxxx-xxxx or npm-<number>)"); return; }
    if (e.package !== undefined && (typeof e.package !== "string" || !e.package)) { problems.push(at + " (" + id + "): package must be a package name"); return; }
    if (typeof e.reason !== "string" || e.reason.trim().length < 20) { problems.push(at + " (" + id + "): reason must say, in at least 20 characters, why the advisory cannot reach this app"); return; }
    const left = daysBetween(today, typeof e.until === "string" ? e.until : "");
    if (Number.isNaN(left)) { problems.push(at + " (" + id + "): until must be a date, yyyy-MM-dd"); return; }
    if (left < 0) { problems.push(at + " (" + id + "): expired on " + e.until + "; fix the dependency, or review the reason and set a new date"); return; }
    if (left > MAX_ALLOW_DAYS) { problems.push(at + " (" + id + "): until is more than " + MAX_ALLOW_DAYS + " days away; an exception comes back for review"); return; }
    entries.push({ id, ...(e.package ? { package: e.package } : {}), reason: e.reason.trim(), until: e.until });
  });
  return { entries, problems };
}

/**
 * Holds findings to the level and the allowances.
 * @param {Finding[]} all
 * @param {Allowance[]} entries
 * @param {string} level
 */
export function applyPolicy(all, entries, level) {
  const min = rank(level);
  if (min < 0) throw new Error("audit: unknown level " + level + " (one of " + SEVERITIES.join(", ") + ")");
  /** @type {Set<Allowance>} */
  const used = new Set();
  /** @type {Finding[]} */ const findings = [];
  /** @type {Array<Finding & { reason: string, until: string }>} */ const allowed = [];
  /** @type {Finding[]} */ const below = [];
  for (const f of all) {
    const a = entries.find((e) => e.id === f.id && (!e.package || e.package === f.package));
    if (a) used.add(a);
    if (rank(f.severity) < min) below.push(f);
    else if (a) allowed.push({ ...f, reason: a.reason, until: a.until });
    else findings.push(f);
  }
  return { findings, allowed, below, unused: entries.filter((e) => !used.has(e)) };
}

/**
 * Runs `npm audit --json` in a folder. npm exits 1 when it finds anything, so the answer is read
 * from stdout, not the status; no JSON, or an `error` object, means the audit did not run.
 * @param {string} dir
 * @param {{ spawn?: (cmd: string, args: string[], o: object) => { status: number | null, stdout?: string | Buffer | null, stderr?: string | Buffer | null, error?: Error }, env?: Record<string, string | undefined> }} [o]
 * @returns {{ report: any } | { error: string }}
 */
export function npmAudit(dir, o = {}) {
  const env = o.env ?? process.env;
  const spawn = o.spawn ?? ((cmd, args, opts) => spawnSync(cmd, args, /** @type {any} */ (opts)));
  if (!existsSync(join(dir, "package-lock.json"))) return { error: "no package-lock.json: run npm install and commit the lockfile" };
  // Under npm run, npm_execpath is npm's own script: run it with this node, no shell. Outside npm
  // the npm on PATH is used (through a shell on Windows, where it is npm.cmd), with fixed arguments.
  const npmCli = env.npm_execpath && /npm-cli\.[cm]?js$/.test(env.npm_execpath) ? env.npm_execpath : "";
  const [cmd, args] = npmCli ? [process.execPath, [npmCli, "audit", "--json"]] : ["npm", ["audit", "--json"]];
  const r = spawn(cmd, args, { cwd: dir, encoding: "utf8", env, shell: !npmCli && process.platform === "win32", maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
  if (r.error) return { error: "npm audit did not start: " + r.error.message };
  const out = String(r.stdout ?? "");
  let report;
  try { report = JSON.parse(out); } catch { return { error: "npm audit gave no report (exit " + r.status + "): " + firstLine(String(r.stderr ?? "") || out) }; }
  if (report && report.error) return { error: "npm audit failed: " + firstLine(String(report.error.summary || report.error.code || "unknown error")) };
  if (!report || typeof report.vulnerabilities !== "object") return { error: "npm audit gave a report this tool does not read (npm 7 or later is needed)" };
  return { report };
}

/** @param {string} s */
const firstLine = (s) => s.trim().split(/\r?\n/)[0].slice(0, 300) || "no output";

/**
 * Audits one folder.
 * @param {string} dir
 * @param {{ level?: string, today: string, audit?: (dir: string) => ({ report: any } | { error: string }), readFile?: (p: string) => string | null }} o
 * @returns {FolderResult}
 */
export function auditFolder(dir, o) {
  const level = o.level ?? DEFAULT_LEVEL;
  const readFile = o.readFile ?? ((p) => (existsSync(p) ? readFileSync(p, "utf8") : null));
  /** @type {string[]} */
  let problems = [];
  /** @type {Allowance[]} */
  let entries = [];
  const text = readFile(join(dir, ALLOW_FILE));
  if (text !== null) {
    let value;
    try { value = JSON.parse(text); } catch { value = undefined; problems.push(ALLOW_FILE + " is not valid JSON"); }
    if (value !== undefined) ({ entries, problems } = readAllowances(value, o.today));
  }
  const got = (o.audit ?? ((d) => npmAudit(d)))(dir);
  if ("error" in got) return { dir, status: "unavailable", findings: [], allowed: [], below: [], problems, unused: [], error: got.error };
  const p = applyPolicy(findingsOf(got.report), entries, level);
  return { dir, status: p.findings.length || problems.length ? "findings" : "ok", ...p, problems };
}

/**
 * The exit code for a set of folder results.
 * @param {FolderResult[]} results @param {{ offlineOk?: boolean }} [o]
 */
export function exitCode(results, o = {}) {
  if (results.some((r) => r.status === "findings" || r.problems.length)) return 1;
  if (results.some((r) => r.status === "unavailable")) return o.offlineOk ? 0 : 2;
  return 0;
}

/** @param {Finding} f */
const findingLines = (f) => [
  f.severity + "  " + f.package + " " + f.range + "  " + f.id + "  " + f.title,
  "    " + (f.by.length && !(f.by.length === 1 && f.by[0] === f.package) ? "brought in by " + f.by.join(", ") + "; " : "") + "fix: " + f.fix,
  ...(f.url ? ["    " + f.url] : []),
];

/**
 * A plain-text report, one block per folder.
 * @param {FolderResult[]} results @param {{ level?: string, offlineOk?: boolean }} [o]
 */
export function formatReport(results, o = {}) {
  const level = o.level ?? DEFAULT_LEVEL;
  /** @type {string[]} */
  const out = [];
  for (const r of results) {
    if (r.status === "unavailable") {
      out.push("audit " + r.dir + ": did not run: " + r.error + (o.offlineOk ? " (continuing: --offline-ok)" : ""));
      continue;
    }
    const n = r.findings.length;
    out.push("audit " + r.dir + ": " + (n ? n + " advisor" + (n === 1 ? "y" : "ies") + " at or above " + level + " need an update" : "no advisory at or above " + level) +
      (r.allowed.length ? ", " + r.allowed.length + " allowed" : "") + (r.below.length ? ", " + r.below.length + " below the level" : ""));
    for (const f of r.findings) out.push(...findingLines(f).map((l) => "  " + l));
    for (const p of r.problems) out.push("  " + p);
    for (const a of r.allowed) out.push("  allowed until " + a.until + ": " + a.package + " " + a.id + " (" + a.reason + ")");
    for (const u of r.unused) out.push("  " + ALLOW_FILE + ": " + u.id + " matches nothing now; delete the entry");
  }
  return out.join("\n");
}

/**
 * A Markdown report for the scheduled audit's issue. The marker line carries the sorted finding
 * keys, so the workflow can tell a new advisory from one it already reported.
 * @param {FolderResult[]} results @param {{ level?: string }} [o]
 */
export function formatMarkdown(results, o = {}) {
  const level = o.level ?? DEFAULT_LEVEL;
  const keys = results.flatMap((r) => [...r.findings.map((f) => f.id + "@" + f.package), ...r.problems.map(() => "allow-file"), ...(r.status === "unavailable" ? ["unavailable"] : [])]);
  const out = ["<!-- gas-kit-audit: " + [...new Set(keys)].sort().join(" ") + " -->", "", "The dependency audit found something to update (level: " + level + ").", ""];
  for (const r of results) {
    out.push("### `" + r.dir + "`", "");
    if (r.status === "unavailable") { out.push("The audit did not run: " + r.error, ""); continue; }
    if (!r.findings.length && !r.problems.length) { out.push("Clean.", ""); continue; }
    if (r.findings.length) {
      out.push("| severity | package | advisory | brought in by | fix |", "| --- | --- | --- | --- | --- |");
      for (const f of r.findings) {
        const cells = [f.severity, code(f.package + " " + f.range), (/^https:\/\/[a-z0-9.-]+\/[A-Za-z0-9._\/-]+$/.test(f.url) ? "[" + f.id + "](" + f.url + ")" : f.id) + " " + text(f.title), f.by.map(code).join(", "), text(f.fix)];
        out.push("| " + cells.join(" | ") + " |");
      }
      out.push("");
    }
    for (const p of r.problems) out.push("- " + text(p));
    if (r.problems.length) out.push("");
  }
  out.push("Fix it in a branch: `npm update <package>` or an override in `package.json`, then `npm run audit` and the checks. When an advisory cannot reach this app, add it to `" + ALLOW_FILE + "` with a reason and a date at most " + MAX_ALLOW_DAYS + " days ahead.");
  return out.join("\n");
}

/**
 * Text from the registry (an advisory title) or naming a package, for an issue body: a pipe would
 * end the table cell, and an at sign before a name would notify that GitHub user or organisation,
 * so it gets a zero-width space after it.
 * @param {string} s
 */
const text = (s) => s.replace(/\|/g, "\\|").replace(/@/g, "@\u200b").replace(/[<>]/g, (c) => (c === "<" ? "&lt;" : "&gt;"));
/** A code span (no mention, no markup inside), without the backticks a value could carry. @param {string} s */
const code = (s) => "`" + s.replace(/[`|]/g, "") + "`";

/** @param {string[]} argv */
export function parseArgs(argv) {
  /** @type {{ dirs: string[], level: string, offlineOk: boolean, markdown: boolean, today?: string }} */
  const o = { dirs: [], level: DEFAULT_LEVEL, offlineOk: false, markdown: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--level") o.level = String(argv[++i] ?? "");
    else if (a === "--offline-ok") o.offlineOk = true;
    else if (a === "--markdown") o.markdown = true;
    else if (a === "--today") o.today = String(argv[++i] ?? "");
    else if (a.startsWith("--")) throw new Error("audit: unknown option " + a);
    else o.dirs.push(a);
  }
  if (rank(o.level) < 0) throw new Error("audit: unknown level " + o.level + " (one of " + SEVERITIES.join(", ") + ")");
  if (o.today !== undefined && Number.isNaN(daysBetween(o.today, o.today))) throw new Error("audit: --today must be yyyy-MM-dd");
  if (!o.dirs.length) o.dirs.push(".");
  return o;
}

/**
 * The command line. Returns the exit code.
 * @param {string[]} argv
 * @param {{ cwd?: string, log?: (s: string) => void, error?: (s: string) => void, today?: string, audit?: (dir: string) => ({ report: any } | { error: string }) }} [io]
 */
export function main(argv, io = {}) {
  const log = io.log ?? ((s) => console.log(s));
  const error = io.error ?? ((s) => console.error(s));
  let o;
  try { o = parseArgs(argv); } catch (e) { error(/** @type {Error} */ (e).message); return 2; }
  const today = o.today ?? io.today ?? new Date().toISOString().slice(0, 10);
  const results = o.dirs.map((d) => {
    const r = auditFolder(resolve(io.cwd ?? process.cwd(), d), { level: o.level, today, audit: io.audit });
    return { ...r, dir: d };
  });
  const code = exitCode(results, { offlineOk: o.offlineOk });
  // The Markdown report is the scheduled audit's issue body: always on stdout.
  if (o.markdown) log(formatMarkdown(results, { level: o.level }));
  else (code === 0 ? log : error)(formatReport(results, { level: o.level, offlineOk: o.offlineOk }));
  return code;
}

const real = (/** @type {string} */ p) => { try { return realpathSync(p); } catch { return p; } };
if (process.argv[1] && real(fileURLToPath(import.meta.url)) === real(process.argv[1])) {
  process.exit(main(process.argv.slice(2)));
}
