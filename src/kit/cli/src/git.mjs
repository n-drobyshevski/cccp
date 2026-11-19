// The one way the CLI runs git: a clean environment, a transport allow-list, and safe flags for a
// checkout whose own .git/config is not trusted.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";

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
 * @param {{ cwd?: string, allowFile?: boolean, stderr?: "pipe" | "ignore" }} [opts]
 * @returns {string} stdout
 */
export function runGit(args, opts = {}) {
  return execFileSync("git", args, {
    cwd: opts.cwd,
    encoding: "utf8",
    env: gitEnv({ allowFile: opts.allowFile === true }),
    stdio: ["ignore", "pipe", opts.stderr ?? "pipe"],
    maxBuffer: 256 * 1024 * 1024,
  });
}

/**
 * The switches of every git run inside a folder that is not trusted (a kit checkout given as --from or
 * GAS_KIT, or a folder downloaded without its .git): none of them lets the folder's own configuration
 * start a program or a transfer.
 * - core.fsmonitor=false: no file-system monitor command.
 * - core.hooksPath=/dev/null: no hook.
 * - core.sshCommand=false: never the folder's ssh command (one from the caller's own GIT_SSH_COMMAND
 *   still wins, as it is the caller's).
 * - safe.bareRepository=explicit: a folder laid out like a bare repository (HEAD, config, objects and
 *   refs at its top) is never discovered as one, so its config is never read.
 * - --no-optional-locks: no index refresh is written.
 * Command-line -c settings outrank the folder's .git/config, and safe.bareRepository is honoured only
 * from protected configuration, which includes the command line.
 */
export const UNTRUSTED_FLAGS = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "core.sshCommand=false", "-c", "safe.bareRepository=explicit", "--no-optional-locks"];

/**
 * The environment of a git run inside an untrusted folder: gitEnv with GIT_NO_LAZY_FETCH=1 (a partial
 * clone never fetches a missing object from the promisor remote its config names) and an empty
 * GIT_ALLOW_PROTOCOL (no transport at all, so nothing is fetched even by a git that predates
 * GIT_NO_LAZY_FETCH).
 * @param {Record<string, string | undefined>} [base]
 * @returns {Record<string, string>}
 */
export function untrustedEnv(base = process.env) {
  return { ...gitEnv({}, base), GIT_NO_LAZY_FETCH: "1", GIT_ALLOW_PROTOCOL: "" };
}

/** git's warning when it wanted an object it would have fetched lazily. */
const LAZY = /lazy fetching disabled/i;

/**
 * An Error from a git run, with what git said on stderr.
 * @typedef {Error & { stderr?: string, gitUnsafe?: string, spawnCode?: string }} GitError
 */

/**
 * git in a folder whose own .git/config is untrusted, with UNTRUSTED_FLAGS and untrustedEnv. Callers
 * use only plumbing that never runs a filter (ls-files, ls-tree, rev-parse, config --get): `git status`
 * re-hashes stat-dirty files through the checkout's own filter.<name>.clean commands, so it is never run
 * here. It throws when git fails, and also when git says it wanted an object it would have fetched
 * lazily (git still exits 0 then, with an answer computed without it): the error's gitUnsafe says why
 * the folder cannot be read safely.
 * @param {string} dir
 * @returns {(args: string[]) => string}
 */
export function gitIn(dir) {
  return (args) => {
    const r = spawnSync("git", [...UNTRUSTED_FLAGS, "-C", dir, ...args], {
      encoding: "utf8",
      env: untrustedEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 256 * 1024 * 1024,
    });
    const stderr = String(r.stderr ?? "");
    if (r.error || r.status !== 0 || LAZY.test(stderr)) {
      /** @type {GitError} */
      const err = new Error("git " + (args[0] ?? "") + " failed in " + dir + (stderr.trim() ? ": " + stderr.trim().split("\n")[0] : ""));
      err.stderr = stderr;
      const why = unsafeReason(stderr);
      if (why) err.gitUnsafe = why;
      if (r.error) err.spawnCode = String(/** @type {NodeJS.ErrnoException} */ (r.error).code ?? "");
      throw err;
    }
    return String(r.stdout);
  };
}

/**
 * Why git's stderr shows a folder cannot be read safely, or "" when it does not.
 * @param {string} stderr
 */
function unsafeReason(stderr) {
  if (LAZY.test(stderr)) return "it is a partial clone with missing objects, which git would fetch from a remote its own configuration names";
  if (/cannot use bare repository/i.test(stderr)) return "it is laid out like a bare git repository (HEAD, config, objects and refs at its top), and git would read its config";
  if (/dubious ownership/i.test(stderr)) return "it belongs to another user, so git will not read it";
  if (/unknown repository extension|repositoryformatversion|bad config|not a valid object name|bad object|unable to read|corrupt/i.test(stderr)) return "git cannot read it as it stands (" + stderr.trim().split("\n")[0] + ")";
  return "";
}

/**
 * A refusal of an untrusted folder, for a git error that says it cannot be read safely.
 * @param {string} dir
 * @param {unknown} e
 * @returns {Error | null}
 */
function refusal(dir, e) {
  const why = /** @type {GitError | undefined} */ (e)?.gitUnsafe;
  if (!why) return null;
  return new Error("refusing the kit folder " + printableText(dir) + ": " + printableText(why) + ". Use a fresh git clone of the kit, or a plain copy without git files");
}

/** Text with every control character shown as ?. @param {string} s */
function printableText(s) {
  return String(s).replace(/[\u0000-\u001f\u007f-\u009f]/g, "?");
}

/** True when a git error says the folder is not in any repository. @param {unknown} e */
function notARepository(e) {
  const err = /** @type {GitError} */ (e);
  return /not a git repository/i.test(String(err?.stderr ?? "")) || err?.spawnCode === "ENOENT";
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
 * ignore rules, never through a filter. Null when the directory is not inside any git repository (or
 * git is not installed). Any other failure throws a refusal of the folder rather than guessing its file
 * set: a partial clone that would fetch, a folder laid out like a bare repository, one git will not read.
 * @param {string} dir
 * @returns {GitView | null}
 */
export function gitView(dir) {
  const git = gitIn(dir);
  try {
    if (git(["rev-parse", "--is-inside-work-tree"]).trim() !== "true") return null;
    const top = git(["rev-parse", "--show-toplevel"]).trim();
    const files = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--"]).split("\0").filter(Boolean);
    return { top: realpathSync(top) === realpathSync(dir), files: [...new Set(files)] };
  } catch (e) {
    if (notARepository(e)) return null;
    const err = /** @type {GitError} */ (e);
    if (!err.gitUnsafe) err.gitUnsafe = "git cannot list its files (" + (String(err.stderr ?? "").trim().split("\n")[0] || err.message) + ")";
    throw refusal(dir, err);
  }
}

/**
 * The HEAD tree of the top of a checkout: commit, object format and path to blob id. Null when the
 * directory is not the top of a checkout with a commit; a refusal (thrown) when git shows the folder
 * cannot be read safely (see gitIn).
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
  } catch (e) {
    // No commit, or not a checkout: the commit is unknown. A folder that cannot be read safely is refused.
    const refused = refusal(dir, e);
    if (refused) throw refused;
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
