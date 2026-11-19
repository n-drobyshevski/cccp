// The setup checks behind `doctor`. Every check reads the machine through the context (root, env, home, a command
// runner with a timeout), so tests run them against a temp folder and fakes. Only the command runner is injected:
// file reads use the real fs, and the default runner builds git's environment from process.env, not ctx.env.
// A check never throws and never reads a secret: the Google credentials file is only looked for, never opened.
import { existsSync as nodeExists, lstatSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { MIN_NODE, nodeTooOld, plainLine } from "./bin.mjs";
import { gitEnv } from "./git.mjs";
import { LOCK_FILE, parseLock } from "./hash.mjs";
import { ENSURE_COMMAND, KIT_SCRIPTS, packageIsLink, planScripts } from "./scripts.mjs";
import { printable, remoteProblem } from "./source.mjs";
import { verifyApp } from "./verify.mjs";

/**
 * @typedef {object} Fix
 * @property {string} label what to show after "Fix:" (a command, or a plain sentence for a manual step)
 * @property {string[]} command argv to run ([] for a manual step: doctor only prints it)
 * @property {"npm-install" | "clasp-login" | "link" | "manual"} kind
 *
 * @typedef {object} CheckResult
 * @property {string} id stable id (node, git, where, tools, kit-files, kit-scripts, kit-remote, kit-update, google-login, project-link)
 * @property {"ok" | "warn" | "fail" | "info"} status
 * @property {string} title
 * @property {string} detail
 * @property {Fix} [fix]
 *
 * @typedef {{ code: number | null, stdout: string, timedOut: boolean }} RunResult
 *
 * @typedef {object} CheckContext
 * @property {string} root the folder to check
 * @property {Record<string, string | undefined>} env
 * @property {string} nodeVersion
 * @property {string} home the home folder (where clasp keeps its credentials)
 * @property {boolean} offline skip the network check
 * @property {(cmd: string, args: string[], o: { cwd: string, timeoutMs: number }) => RunResult} run runs a command with no shell
 */

/** The longest the network check may take. */
export const NETWORK_TIMEOUT_MS = 5000;

/** The default command runner: no shell, a timeout, git's clean environment. @type {CheckContext["run"]} */
export function runCommand(cmd, args, { cwd, timeoutMs }) {
  const env = gitEnv();
  // No ssh host-key or passphrase prompt can hang on the terminal during the short network check.
  if (!env["GIT_SSH_COMMAND"] && !env["GIT_SSH"]) env["GIT_SSH_COMMAND"] = "ssh -o BatchMode=yes";
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: timeoutMs, shell: false, env, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 4 * 1024 * 1024 });
  const timedOut = /** @type {NodeJS.ErrnoException | undefined} */ (r.error)?.code === "ETIMEDOUT";
  return { code: r.status, stdout: String(r.stdout ?? ""), timedOut };
}

/** The context for the real machine. @param {Partial<CheckContext> & { root: string }} o @returns {CheckContext} */
export function realContext(o) {
  return { env: process.env, nodeVersion: process.version, home: homedir(), offline: false, run: runCommand, ...o };
}

/** @param {string} p */
function lstat(p) {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
}

/** Text from outside (a file, a URL, a command) fit to print on one line. @param {unknown} s */
const clean = (s) => plainLine(String(s)).replace(/\t/g, " ");

/** semver "1.2.3" (optionally v-prefixed, no prerelease) to numbers, else null. @param {string} s */
export function parseSemver(s) {
  const m = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(s);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** @param {number[]} a @param {number[]} b */
function newer(a, b) {
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return false;
}

/**
 * The highest semver tag in `git ls-remote --tags --refs` output (strict tags only: anything else is ignored).
 * @param {string} text
 * @returns {string | null} as "1.2.3"
 */
export function newestTag(text) {
  return newestTagEntry(text)?.version ?? null;
}

/** Like newestTag, but also the tag exactly as the remote spells it (so a hint can name a ref that exists). @param {string} text @returns {{ version: string, name: string } | null} */
export function newestTagEntry(text) {
  /** @type {number[] | null} */
  let best = null;
  let name = "";
  for (const line of text.split("\n")) {
    const m = /\trefs\/tags\/(.+)$/.exec(line);
    const v = m ? parseSemver((m[1] ?? "").trim()) : null;
    if (v && (!best || newer(v, best))) {
      best = v;
      name = (m?.[1] ?? "").trim();
    }
  }
  return best ? { version: best.join("."), name } : null;
}

/** True when there is no local browser to sign in with (Cloud Shell, or ssh with no display). @param {Record<string, string | undefined>} env */
export function noLocalBrowser(env) {
  if (env["CLOUD_SHELL"]) return true;
  return Boolean(env["SSH_CONNECTION"]) && !env["DISPLAY"] && !env["WAYLAND_DISPLAY"];
}

/**
 * The command a person types for a doctor hint: through npm in an app, through node in the kit repo.
 * @param {boolean} app
 * @param {string} args
 */
export function kitCommand(app, args) {
  return app ? "npm run kit -- " + args : "node packages/cli/src/bin.mjs " + args;
}

/**
 * Where clasp 3 keeps its sign-in: the file named by clasp_config_auth (a folder there means <folder>/.clasprc.json),
 * else ~/.clasprc.json. clasp never reads a .clasprc.json in the project folder, so neither does doctor.
 * @param {CheckContext} ctx
 */
export function claspCredentialFiles(ctx) {
  const custom = ctx.env["clasp_config_auth"];
  if (custom) {
    const p = resolve(ctx.root, custom);
    const st = lstat(p);
    return [st && st.isDirectory() ? join(p, ".clasprc.json") : p];
  }
  return [join(ctx.home, ".clasprc.json")];
}

/**
 * Run every check that applies here.
 * @param {CheckContext} ctx
 * @returns {CheckResult[]}
 */
export function runChecks(ctx) {
  /** @type {CheckResult[]} */
  const out = [];
  /** @param {CheckResult} r */
  const add = (r) => out.push({ ...r, title: clean(r.title), detail: clean(r.detail) });
  const safe = (/** @type {string} */ id, /** @type {() => void} */ f) => {
    try {
      f();
    } catch (e) {
      add({ id, status: "fail", title: "This check could not run", detail: clean(/** @type {Error} */ (e).message) });
    }
  };

  const nodeShort = ctx.nodeVersion.replace(/^v/, "").split(".").slice(0, 2).join(".");
  add(
    nodeTooOld(ctx.nodeVersion)
      ? { id: "node", status: "fail", title: "Node.js " + nodeShort + " is too old", detail: "needs " + MIN_NODE + " or newer", fix: { label: "nvm install " + MIN_NODE + "   (or install Node " + MIN_NODE + " from nodejs.org)", command: [], kind: "manual" } }
      : { id: "node", status: "ok", title: "Node.js " + nodeShort, detail: "needs " + MIN_NODE + " or newer" },
  );

  const git = ctx.run("git", ["--version"], { cwd: tmpdir(), timeoutMs: NETWORK_TIMEOUT_MS });
  const gitVer = /(\d+\.\d+(?:\.\d+)?)/.exec(git.stdout)?.[1];
  add(
    git.code === 0 && gitVer
      ? { id: "git", status: "ok", title: "Git " + gitVer, detail: "" }
      : { id: "git", status: "warn", title: "Git is not installed", detail: "needed to fetch kit updates and for create --git", fix: { label: "install Git from git-scm.com, then run doctor again", command: [], kind: "manual" } },
  );

  const lockPath = join(ctx.root, LOCK_FILE);
  const app = lstat(lockPath) !== null;
  const kitRepo = !app && nodeExists(join(ctx.root, "packages", "server", "src")) && nodeExists(join(ctx.root, "package.json"));
  add(
    app
      ? { id: "where", status: "ok", title: "This folder is a gas-kit app", detail: LOCK_FILE + " found" }
      : kitRepo
        ? { id: "where", status: "ok", title: "This folder is the gas-kit repository", detail: "app checks are skipped" }
        : { id: "where", status: "warn", title: "This folder is not a gas-kit app", detail: "no " + LOCK_FILE + " here; run doctor from your app's folder, or pass --root <folder>" },
  );

  if (app || kitRepo) safe("tools", () => add(toolsCheck(ctx, app)));
  if (!app) return out;

  /** @type {import("./hash.mjs").Lock | null} */
  let lock = null;
  safe("kit-files", () => {
    try {
      lock = parseLock(readFileSync(lockPath, "utf8"));
    } catch {
      lock = null;
    }
    const { problems } = verifyApp(ctx.root);
    if (!problems.length) {
      add({ id: "kit-files", status: "ok", title: "Kit files untouched", detail: Object.keys(/** @type {any} */ (lock)?.files ?? {}).length + " files match " + LOCK_FILE });
      return;
    }
    const first = problems[0];
    add({
      id: "kit-files",
      status: "fail",
      title: "Kit files changed",
      detail: problems.length + " problem" + (problems.length === 1 ? "" : "s") + ", first: " + clean(first?.file ?? "") + " " + clean(first?.message ?? ""),
      fix: { label: clean(first?.fix ?? "run kit:verify for the list"), command: [], kind: "manual" },
    });
  });

  safe("kit-scripts", () => {
    const fix = { label: ENSURE_COMMAND, command: /** @type {string[]} */ ([]), kind: /** @type {"manual"} */ ("manual") };
    /** @type {unknown} */
    let pkg = null;
    try {
      pkg = JSON.parse(readFileSync(join(ctx.root, "package.json"), "utf8"));
    } catch {
      pkg = null;
    }
    if (!pkg || typeof pkg !== "object") return add({ id: "kit-scripts", status: "warn", title: "package.json could not be read", detail: "the kit scripts (npm run kit and the rest) could not be checked", fix: { label: "make package.json a valid JSON file, then run " + ENSURE_COMMAND, command: [], kind: "manual" } });
    const plan = planScripts(pkg);
    if (!plan.missing.length && !plan.different.length) return add({ id: "kit-scripts", status: "ok", title: "Kit scripts present", detail: Object.keys(KIT_SCRIPTS).join(", ") });
    const parts = [];
    if (plan.missing.length) parts.push("missing: " + plan.missing.join(", "));
    if (plan.different.length) parts.push("different from the kit's: " + plan.different.map((d) => d.name).join(", ") + " (edit by hand; kit:sync never overwrites them)");
    const link = packageIsLink(ctx.root);
    add({
      id: "kit-scripts",
      status: "warn",
      title: "Kit scripts incomplete in package.json",
      detail: parts.join("; "),
      fix: plan.missing.length && !link ? fix : { label: link ? "replace package.json (a symbolic link) with a real file, then run " + ENSURE_COMMAND : "set " + plan.different.map((d) => d.name + " to " + JSON.stringify(d.want)).join(", "), command: [], kind: "manual" },
    });
  });

  const l = /** @type {import("./hash.mjs").Lock | null} */ (lock);
  const remote = l?.kit?.remote;
  if (l) {
    safe("kit-remote", () => {
      if (remote === false) add({ id: "kit-remote", status: "info", title: "No kit remote, on purpose", detail: "kit.remote is false in " + LOCK_FILE });
      else if (typeof remote === "string" && !remoteProblem(remote)) add({ id: "kit-remote", status: "ok", title: "Kit remote remembered", detail: printable(remote) });
      else {
        const why = typeof remote === "string" ? remoteProblem(remote) : "";
        const fix = { label: "npm run kit:sync -- --remote <git URL>", command: /** @type {string[]} */ ([]), kind: /** @type {"manual"} */ ("manual") };
        if (why) add({ id: "kit-remote", status: "warn", title: "Kit remote cannot be used", detail: LOCK_FILE + " remembers one, but it " + clean(why), fix });
        else add({ id: "kit-remote", status: "warn", title: "No kit remote remembered", detail: "kit:sync and kit:diff need --from until " + LOCK_FILE + " names one", fix });
      }
    });
    safe("kit-update", () => {
      if (ctx.offline || typeof remote !== "string" || remoteProblem(remote)) return;
      const have = parseSemver(String(l.kit.version ?? ""));
      if (!have) return;
      // A fresh empty folder, like source.mjs: a network git run must not pick up the app folder's own .git/config
      // (core.sshCommand, url.<base>.insteadOf, credential.helper, http.proxy).
      const scratch = mkdtempSync(join(tmpdir(), "gas-kit-doctor-"));
      let r;
      try {
        r = ctx.run("git", ["ls-remote", "--tags", "--refs", "--", remote], { cwd: scratch, timeoutMs: NETWORK_TIMEOUT_MS });
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
      if (r.timedOut || r.code !== 0) {
        add({ id: "kit-update", status: "warn", title: "Could not look for a newer kit", detail: (r.timedOut ? "no answer from " + printable(remote) + " in " + NETWORK_TIMEOUT_MS / 1000 + "s" : "could not read " + printable(remote)) + "; run doctor --offline to skip this" });
        return;
      }
      const top = newestTagEntry(r.stdout);
      const topV = top ? parseSemver(top.version) : null;
      if (top && topV && newer(topV, have)) add({ id: "kit-update", status: "info", title: "A newer kit is available", detail: have.join(".") + " to " + top.version + ", run npm run kit:sync -- --ref " + top.name });
      else add({ id: "kit-update", status: "ok", title: "Kit is up to date", detail: have.join(".") });
    });
  }

  safe("google-login", () => {
    // Existence only: the file holds tokens and is never opened.
    const found = claspCredentialFiles(ctx).some((p) => {
      const st = lstat(p);
      return st !== null && st.isFile() && st.size > 0;
    });
    if (found) add({ id: "google-login", status: "ok", title: "Signed in to Google", detail: "clasp credentials found" });
    else {
      const command = ["npx", "clasp", "login", ...(noLocalBrowser(ctx.env) ? ["--no-localhost"] : [])];
      add({ id: "google-login", status: "fail", title: "Not signed in to Google", detail: "needed to put the app online" + (noLocalBrowser(ctx.env) ? ". No browser on this machine (Cloud Shell or ssh), so sign-in gives you a link to open on another computer" : ""), fix: { label: command.join(" "), command, kind: "clasp-login" } });
    }
  });

  safe("project-link", () => {
    const p = join(ctx.root, ".clasp.json");
    const st = lstat(p);
    const manual = { label: "cp .clasp.json.example .clasp.json, then put your script id in it", command: /** @type {string[]} */ ([]), kind: /** @type {"manual"} */ ("manual") };
    if (st && st.isSymbolicLink()) return add({ id: "project-link", status: "warn", title: ".clasp.json is a symbolic link", detail: "the kit does not follow links; replace it with a real file", fix: manual });
    let id = "";
    if (st && st.isFile()) {
      try {
        id = String(JSON.parse(readFileSync(p, "utf8"))?.scriptId ?? "").trim();
      } catch {
        id = "";
      }
    }
    if (id) add({ id: "project-link", status: "ok", title: "Apps Script project linked", detail: ".clasp.json has a script id" });
    else add({ id: "project-link", status: "warn", title: "No Apps Script project linked", detail: st ? ".clasp.json has no script id" : "no .clasp.json", fix: { label: "npm run kit -- link   (you paste the script's web address)", command: [], kind: "link" } });
  });
  return out;
}

/** @param {CheckContext} ctx @param {boolean} app @returns {CheckResult} */
function toolsCheck(ctx, app) {
  const nm = join(ctx.root, "node_modules");
  const lock = join(ctx.root, "package-lock.json");
  const fix = { label: "npm install", command: ["npm", "install"], kind: /** @type {"npm-install"} */ ("npm-install") };
  const stamp = lstat(join(nm, ".package-lock.json")) ?? lstat(nm);
  if (!stamp) return { id: "tools", status: "fail", title: "App tools not installed", detail: "no node_modules folder", fix };
  let locked = null;
  try {
    locked = statSync(lock);
  } catch {
    locked = null;
  }
  if (locked && stamp.mtimeMs < locked.mtimeMs) return { id: "tools", status: "fail", title: "App tools out of date", detail: "node_modules is older than package-lock.json", fix };
  return { id: "tools", status: "ok", title: app ? "App tools installed" : "Tools installed", detail: locked ? "matches package-lock.json" : "" };
}
