// The one way the CLI runs git: a clean environment, a transport allow-list, and safe flags for a
// checkout whose own .git/config is not trusted.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { FriendlyError } from "./errors.mjs";

/** Variables that would point git at another repository, index or config than the one asked for. */
const DROP = new Set(["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_COMMON_DIR", "GIT_NAMESPACE", "GIT_CONFIG", "GIT_ALLOW_PROTOCOL", "GIT_PROTOCOL_FROM_USER"]);

/** The transports a kit fetch may use. file is added only for an explicit local source. */
export const ALLOWED_PROTOCOLS = ["https", "ssh"];

/**
 * The environment of every git child process: the caller's environment without the variables that
 * redirect git to another repository (GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, GIT_OBJECT_DIRECTORY,
 * GIT_NAMESPACE, every GIT_CONFIG_*), with GIT_TERMINAL_PROMPT=0 (never wait for a password) and
 * GIT_ALLOW_PROTOCOL limited to https and ssh (plus file when allowFile).
 * @param {{ allowFile?: boolean }} [opts]
 * @param {Record<string, string | undefined>} [base] the caller's environment (default process.env)
 * @returns {Record<string, string>}
 */
export function gitEnv(opts = {}, base = process.env) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined || DROP.has(k) || k.startsWith("GIT_CONFIG_")) continue;
    env[k] = v;
  }
  env["GIT_TERMINAL_PROMPT"] = "0";
  env["GIT_ALLOW_PROTOCOL"] = [...ALLOWED_PROTOCOLS, ...(opts.allowFile ? ["file"] : [])].join(":");
  return env;
}

/**
 * Run git with the clean environment.
 * @param {string[]} args
 * @param {{ cwd?: string, allowFile?: boolean, stderr?: "pipe" | "ignore", timeout?: number }} [opts]
 * @returns {string} stdout
 */
export function runGit(args, opts = {}) {
  return execFileSync("git", args, {
    cwd: opts.cwd,
    encoding: "utf8",
    env: gitEnv({ allowFile: opts.allowFile === true }),
    stdio: ["ignore", "pipe", opts.stderr ?? "pipe"],
    maxBuffer: 256 * 1024 * 1024,
    ...(opts.timeout ? { timeout: opts.timeout } : {}),
  });
}

/**
 * Variables of the caller's environment that name a program git could run for a local read (an
 * ssh or proxy command, a password prompt, a pager, an editor, an external diff). The local
 * helpers drop them: a local read needs none of them.
 */
const LOCAL_DROP = ["GIT_SSH", "GIT_SSH_COMMAND", "GIT_SSH_VARIANT", "GIT_PROXY_COMMAND", "GIT_ASKPASS", "SSH_ASKPASS", "GIT_EXTERNAL_DIFF", "GIT_PAGER", "PAGER", "GIT_EDITOR"];

/** How long a local git read may take before it is killed and read as "no answer". */
export const LOCAL_GIT_TIMEOUT_MS = 60_000;

/**
 * The environment of a local, no-network git read in an untrusted folder: gitEnv without the
 * program variables above, GIT_ALLOW_PROTOCOL set to "none" (no transport has that name, so every
 * fetch is refused, including the lazy fetch a partial clone's promisor remote would start for a
 * missing object), and GIT_NO_LAZY_FETCH=1 (git 2.44 and later refuse the lazy fetch outright).
 * @param {Record<string, string | undefined>} [base]
 * @returns {Record<string, string>}
 */
export function localGitEnv(base = process.env) {
  const env = gitEnv({}, base);
  for (const k of LOCAL_DROP) delete env[k];
  env["GIT_ALLOW_PROTOCOL"] = "none";
  env["GIT_NO_LAZY_FETCH"] = "1";
  return env;
}

/** The same environment under the name the kit commands use for an untrusted folder. */
export const untrustedEnv = localGitEnv;

/**
 * The switches of every git run inside a folder that is not trusted (a kit checkout given as --from or
 * GAS_KIT, a folder downloaded without its .git, or the source app of a migration): none of them lets
 * the folder's own configuration start a program or a transfer.
 * - core.fsmonitor=false: no file-system monitor command.
 * - core.hooksPath=/dev/null: no hook.
 * - core.sshCommand=false: never the folder's ssh command.
 * - protocol.allow=never: no transport at all.
 * - safe.bareRepository=explicit: a folder laid out like a bare repository (HEAD, config, objects and
 *   refs at its top) is never discovered as one, so its config is never read.
 * - --no-optional-locks: no index refresh is written.
 * Command-line -c settings outrank the folder's .git/config, and safe.bareRepository is honoured only
 * from protected configuration, which includes the command line.
 */
export const UNTRUSTED_FLAGS = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "core.sshCommand=false", "-c", "protocol.allow=never", "-c", "safe.bareRepository=explicit", "--no-optional-locks"];

/** git's warning when it wanted an object it would have fetched lazily. */
const LAZY = /lazy fetching disabled/i;

/**
 * An Error from a git run, with what git said on stderr and how the child ended.
 * @typedef {Error & { stderr?: string, gitUnsafe?: string, code?: string, signal?: string | null, status?: number | null }} GitError
 */

/**
 * Why git's stderr shows a folder cannot be read safely, or "" when it does not.
 * @param {string} stderr
 */
function unsafeReason(stderr) {
  if (LAZY.test(stderr)) return "it is a partial clone with missing objects, which git would fetch from a remote its own configuration names";
  if (/cannot use bare repository/i.test(stderr)) return "it is laid out like a bare git repository (HEAD, config, objects and refs at its top), and git would read its config";
  if (/dubious ownership/i.test(stderr)) return "it belongs to another user, so git will not read it";
  return "";
}

/**
 * Run a local git read in an untrusted folder and return its raw stdout. Killed after timeoutMs (a FIFO
 * named .gitignore or .git/info/exclude would block git forever). It throws when git fails or is killed,
 * and also when git says it wanted an object it would have fetched lazily (git still exits 0 then, with
 * an answer computed without it); the error's gitUnsafe says why the folder cannot be read safely.
 * @param {string} dir @param {string[]} args @param {{ timeoutMs?: number }} [opts]
 * @returns {Buffer}
 */
export function gitBytes(dir, args, opts = {}) {
  const r = spawnSync("git", [...UNTRUSTED_FLAGS, "-C", dir, ...args], {
    env: localGitEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 256 * 1024 * 1024,
    timeout: opts.timeoutMs ?? LOCAL_GIT_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  const stderr = String(r.stderr ?? "");
  if (r.error || r.status !== 0 || LAZY.test(stderr)) {
    /** @type {GitError} */
    const err = new Error("git " + (args[0] ?? "") + " failed in " + dir + (stderr.trim() ? ": " + stderr.trim().split("\n")[0] : ""));
    err.stderr = stderr;
    err.status = r.status;
    err.signal = r.signal;
    if (r.error) err.code = String(/** @type {NodeJS.ErrnoException} */ (r.error).code ?? "");
    const why = unsafeReason(stderr);
    if (why) err.gitUnsafe = why;
    throw err;
  }
  return /** @type {Buffer} */ (r.stdout);
}

/**
 * git in a folder whose own .git/config is untrusted (UNTRUSTED_FLAGS, localGitEnv, a timeout). Callers
 * use only plumbing that never runs a filter (ls-files, ls-tree, rev-parse, config --get): `git status`
 * re-hashes stat-dirty files through the checkout's own filter.<name>.clean commands, so it is never run
 * here.
 * @param {string} dir
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {(args: string[]) => string}
 */
export function gitIn(dir, opts = {}) {
  return (args) => gitBytes(dir, args, opts).toString("utf8");
}

/**
 * The git config file of the repository a directory sits in, or null when none is found. Found by
 * walking up to the nearest .git (a directory, or a file that names the git directory, as a worktree
 * or a submodule has). Read as text only: nothing here runs git.
 * @param {string} dir
 * @returns {string | null}
 */
function configFileOf(dir) {
  let d = resolve(dir);
  for (;;) {
    const dotGit = join(d, ".git");
    if (existsSync(dotGit)) {
      try {
        if (statSync(dotGit).isDirectory()) return join(dotGit, "config");
        const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"));
        if (!m) return null;
        const gd = m[1].trim();
        return join(isAbsolute(gd) ? gd : join(d, gd), "config");
      } catch {
        return null;
      }
    }
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
}

/**
 * Why a folder's own git config makes it unsafe to read, decided from the text of that config and not
 * from git's error messages, which change between git versions: a partial clone (its missing objects
 * would be fetched from a remote the config names) or a config that pulls in other files. "" when the
 * config is fine or there is none.
 * @param {string} dir
 */
export function configUnsafeReason(dir) {
  const file = configFileOf(dir);
  if (!file || !existsSync(file)) return "";
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return "";
  }
  if (/^\s*partialclone\s*=/im.test(text) || /^\s*promisor\s*=\s*(true|yes|on|1)\s*$/im.test(text)) {
    return "it is a partial clone with missing objects, which git would fetch from a remote its own configuration names";
  }
  if (/^\s*\[\s*include(if)?\b/im.test(text)) return "its git configuration includes other files, which git would read";
  return "";
}

/**
 * Throws a refusal when a local kit folder (--from or GAS_KIT) cannot be read safely: its config text
 * names a partial clone or includes other files, or git finds it laid out like a bare repository, a
 * partial clone missing objects, or owned by another user. A kit folder is vendored into an app, so it
 * is refused outright rather than read around the problem. A migration's source app is read with
 * gitListing instead, whose fetches are already impossible.
 * @param {string} dir
 */
export function assertSafeKitFolder(dir) {
  const why = configUnsafeReason(dir);
  if (why) throw refusal(dir, why);
  try {
    gitIn(dir)(["rev-parse", "--is-inside-work-tree"]);
  } catch (e) {
    const unsafe = /** @type {GitError} */ (e).gitUnsafe;
    if (unsafe) throw refusal(dir, unsafe);
  }
}

/**
 * A refusal of an untrusted kit folder, for a reason it cannot be read safely.
 * @param {string} dir @param {string} why
 */
function refusal(dir, why) {
  return new FriendlyError({ title: "gas-kit will not read that kit folder", why: "Git says the folder is not safe to read: " + printableText(why) + ".", fix: "Use a fresh git clone of the kit, or a plain copy without git files.", more: "npm run kit -- help kit", detail: "refusing the kit folder " + printableText(dir) + ": " + printableText(why) + ". Use a fresh git clone of the kit, or a plain copy without git files" });
}

/** Text with every control character shown as ?. @param {string} s */
function printableText(s) {
  return String(s).replace(/[\u0000-\u001f\u007f-\u009f]/g, "?");
}

/**
 * The git view of a directory, or null when it is not inside a work tree git will read.
 * @typedef {object} GitView
 * @property {boolean} top the directory is the top of its work tree
 * @property {string[]} files paths git would commit, relative to the directory (posix): every tracked
 *   file plus every untracked one that is not ignored. An ignored file (.env, a token file, build
 *   output) is never among them.
 */

/**
 * The files of a directory that git would commit (relative to it): read from the index and the
 * ignore rules, never through a filter. Null when the directory is not inside a git work tree, or
 * when git fails or times out there.
 * @param {string} dir
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {GitView | null}
 */
export function gitView(dir, opts = {}) {
  const l = gitListing(dir, opts);
  return l.state === "ok" ? { top: l.top, files: l.files } : null;
}

/**
 * True when dir or one of its ancestors holds a .git entry (a folder or a gitdir file): git would
 * treat dir as part of a work tree. Read with lstat only.
 * @param {string} dir
 */
function underGit(dir) {
  let cur = dir;
  for (;;) {
    try {
      lstatSync(join(cur, ".git"));
      return true;
    } catch {
      // keep climbing
    }
    const up = dirname(cur);
    if (up === cur) return false;
    cur = up;
  }
}

/**
 * The git listing of a directory, telling "not a repository" from "a repository git would not
 * list" (a failure, a timeout, a repository owned by someone else), so a caller can refuse to walk
 * a checkout whose ignore rules it could not read.
 * @typedef {{ state: "none" } | { state: "failed", reason: string } | { state: "ok", top: boolean, files: string[], undecodable: string[] }} GitListing
 *   files are posix paths relative to dir; undecodable are paths that are not valid UTF-8 (shown
 *   with replacement characters), never among files
 */

/**
 * @param {string} dir
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {GitListing}
 */
export function gitListing(dir, opts = {}) {
  const git = gitIn(dir, opts);
  let inside;
  try {
    inside = git(["rev-parse", "--is-inside-work-tree"]).trim() === "true";
  } catch (e) {
    return underGit(dir) ? { state: "failed", reason: failure(e) } : { state: "none" };
  }
  if (!inside) return { state: "none" };
  try {
    const top = git(["rev-parse", "--show-toplevel"]).trim();
    const raw = gitBytes(dir, ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--"], opts);
    /** @type {Set<string>} */
    const files = new Set();
    /** @type {Set<string>} */
    const undecodable = new Set();
    const utf8 = new TextDecoder("utf-8", { fatal: true });
    let at = 0;
    while (at < raw.length) {
      let end = raw.indexOf(0, at);
      if (end < 0) end = raw.length;
      const part = raw.subarray(at, end);
      at = end + 1;
      if (!part.length) continue;
      try {
        files.add(utf8.decode(part));
      } catch {
        undecodable.add(part.toString("utf8"));
      }
    }
    return { state: "ok", top: realpathSync(top) === realpathSync(dir), files: [...files], undecodable: [...undecodable] };
  } catch (e) {
    return { state: "failed", reason: failure(e) };
  }
}

/** A short reason for a failed git child. @param {unknown} e */
function failure(e) {
  const err = /** @type {GitError} */ (e);
  if (err && err.gitUnsafe) return err.gitUnsafe;
  if (err && (err.code === "ETIMEDOUT" || err.signal === "SIGKILL")) return "git did not answer in time (a FIFO among its ignore files, or a very large tree)";
  if (err && err.code === "ENOENT") return "git is not installed";
  return "git refused to list it (exit " + (err && typeof err.status === "number" ? err.status : "?") + "; a repository owned by another user is refused unless it is a safe.directory)";
}

/**
 * The HEAD tree of the top of a checkout: commit, object format and path to blob id. Null when the
 * directory is not the top of a checkout with a commit, or when git fails there.
 * @param {string} dir
 * @returns {{ head: string, format: "sha1" | "sha256", blobs: Map<string, string> } | null}
 */
export function headTree(dir) {
  const git = gitIn(dir);
  try {
    const top = git(["rev-parse", "--show-toplevel"]).trim();
    if (realpathSync(top) !== realpathSync(dir)) return null;
    const head = git(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]).trim();
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(head)) return null;
    /** @type {Map<string, string>} */
    const blobs = new Map();
    for (const entry of git(["ls-tree", "-r", "-z", "--full-tree", head]).split("\0")) {
      const m = /^(\d+) (\w+) ([0-9a-f]+)\t([\s\S]+)$/.exec(entry);
      if (m && m[2] === "blob") blobs.set(/** @type {string} */ (m[4]), (m[1] === "120000" ? "link:" : "") + m[3]);
    }
    return { head, format: head.length === 64 ? "sha256" : "sha1", blobs };
  } catch {
    return null;
  }
}

/**
 * The git blob id of some bytes, computed in Node (no git, so no filter runs).
 * @param {Uint8Array} bytes
 * @param {"sha1" | "sha256"} format
 */
export function blobId(bytes, format) {
  return createHash(format).update("blob " + bytes.length + "\0").update(bytes).digest("hex");
}
