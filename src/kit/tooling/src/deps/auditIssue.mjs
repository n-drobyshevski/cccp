// The scheduled audit's notice: one GitHub issue that is opened when the audit finds something,
// kept up to date while it does, and closed when the audit is clean again.
//
//   node <tooling>/deps/auditIssue.mjs <report.md> <audit exit code>
//
// It runs in a workflow with `issues: write`, after `audit.mjs --markdown` wrote the report. It
// uses the gh CLI that GitHub's runners carry (GH_TOKEN and GH_REPO from the workflow), spawned
// with fixed arguments and no shell; the body goes through a file, never the command line.
//
// - A finding and no open issue: open one (GitHub notifies the repository's watchers).
// - A finding and an open issue: replace its body; when the set of advisories changed (the
//   report's first line carries their keys), also comment, so the change notifies again.
// - Clean and an open issue: close it with a comment. Clean and none: nothing.
// Only an issue this workflow opened (author github-actions, the exact title) is ever touched, so
// an issue someone else opens with the same title is left alone.
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ISSUE_TITLE = "Dependency audit: updates needed";
const BOT = "app/github-actions";
const MARKER_RE = /^<!-- gas-kit-audit: ([^>]*) -->/;

/** The advisory keys a report's first line carries, sorted; null when it has no marker. @param {string} body */
export function markerOf(body) {
  const m = MARKER_RE.exec(String(body || ""));
  return m ? m[1].trim().split(/\s+/).filter(Boolean).sort().join(" ") : null;
}

/**
 * What to do, from the audit's exit code, the new report and the open issue (if any).
 * @param {{ code: number, body: string, open: { number: number, body: string } | null }} s
 * @returns {{ kind: "none" } | { kind: "create", body: string } | { kind: "edit", number: number, body: string, comment: string | null } | { kind: "close", number: number, comment: string }}
 */
export function planIssue({ code, body, open }) {
  if (code === 0) {
    return open ? { kind: "close", number: open.number, comment: "The dependency audit is clean again; closing." } : { kind: "none" };
  }
  if (!open) return { kind: "create", body };
  const before = markerOf(open.body);
  const now = markerOf(body);
  const added = now === null ? [] : now.split(" ").filter((k) => k && !(before || "").split(" ").includes(k));
  const comment = before === now ? null : added.length ? "New since the last run: " + added.map((k) => "`" + k + "`").join(", ") + "." : "The findings changed; the description has the current list.";
  return { kind: "edit", number: open.number, body, comment };
}

/**
 * @typedef {(cmd: string, args: string[], o: object) => { status: number | null, stdout?: string | Buffer | null, stderr?: string | Buffer | null, error?: Error }} Spawn
 */

/**
 * Reads the open issue, then carries out the plan with gh. Returns the exit code (0 when the
 * notice is in place; the audit's own failure is the workflow's next step).
 * @param {string[]} argv [report path, audit exit code]
 * @param {{ spawn?: Spawn, log?: (s: string) => void, error?: (s: string) => void, env?: Record<string, string | undefined> }} [io]
 */
export function main(argv, io = {}) {
  const log = io.log ?? ((s) => console.log(s));
  const error = io.error ?? ((s) => console.error(s));
  const env = io.env ?? process.env;
  const spawn = io.spawn ?? ((cmd, args, o) => spawnSync(cmd, args, /** @type {any} */ (o)));
  const [file, codeText] = argv;
  if (!file || !/^[0-9]+$/.test(String(codeText))) { error("auditIssue: usage: auditIssue.mjs <report.md> <audit exit code>"); return 2; }
  const code = Number(codeText);
  let body;
  try { body = readFileSync(file, "utf8"); } catch (e) { error("auditIssue: cannot read " + file + ": " + /** @type {Error} */ (e).message); return 2; }
  /** @param {string[]} args */
  const gh = (args) => {
    const r = spawn("gh", args, { encoding: "utf8", env, shell: false, timeout: 60_000 });
    if (r.error || r.status !== 0) throw new Error("gh " + args[0] + " " + args[1] + " failed: " + String(r.error?.message || r.stderr || "exit " + r.status).trim().split("\n")[0]);
    return String(r.stdout ?? "");
  };
  try {
    const listed = JSON.parse(gh(["issue", "list", "--state", "open", "--author", BOT, "--search", "in:title \"" + ISSUE_TITLE + "\"", "--json", "number,title,body", "--limit", "20"]) || "[]");
    const mine = (Array.isArray(listed) ? listed : []).filter((i) => i && i.title === ISSUE_TITLE).sort((a, b) => a.number - b.number);
    const open = mine.length ? { number: Number(mine[0].number), body: String(mine[0].body || "") } : null;
    const plan = planIssue({ code, body, open });
    if (plan.kind === "none") { log("auditIssue: clean, no open issue"); return 0; }
    if (plan.kind === "close") {
      gh(["issue", "close", String(plan.number), "--comment", plan.comment]);
      log("auditIssue: closed #" + plan.number);
      return 0;
    }
    const dir = mkdtempSync(join(tmpdir(), "audit-issue-"));
    try {
      const bodyFile = join(dir, "body.md");
      writeFileSync(bodyFile, plan.body);
      if (plan.kind === "create") {
        gh(["issue", "create", "--title", ISSUE_TITLE, "--body-file", bodyFile]);
        log("auditIssue: opened an issue");
      } else {
        gh(["issue", "edit", String(plan.number), "--body-file", bodyFile]);
        if (plan.comment) gh(["issue", "comment", String(plan.number), "--body", plan.comment]);
        log("auditIssue: updated #" + plan.number + (plan.comment ? " with a comment" : ""));
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
    return 0;
  } catch (e) {
    error("auditIssue: " + /** @type {Error} */ (e).message);
    return 1;
  }
}

const real = (/** @type {string} */ p) => { try { return realpathSync(p); } catch { return p; } };
if (process.argv[1] && real(fileURLToPath(import.meta.url)) === real(process.argv[1])) {
  process.exit(main(process.argv.slice(2)));
}
