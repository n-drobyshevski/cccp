// Resolves "--from": a kit checkout directory, or a git URL with an optional #ref.
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { UsageError } from "./args.mjs";
import { blobId, gitIn, gitView, headTree, runGit } from "./git.mjs";
import { vendoredKey } from "./hash.mjs";

/** A scheme URL (also a mistyped "https:/" or "https:///"): the scheme with its slashes, and the rest. */
const SCHEME_URL = /^([a-z][a-z0-9+.-]*:\/+)([\s\S]*)$/i;

/** An authority that holds no credentials: a host (or [IPv6]) and an optional numeric port. */
const PLAIN_AUTHORITY = /^(?:\[[0-9A-Za-z:.%]*\]|[A-Za-z0-9._~-]*)(?::\d*)?$/;

/**
 * Where the credentials of a URL end (the index of their @ in the text after the scheme), or -1 when
 * it has none. The authority ends at the first "/": when it holds an @, the credentials run to its last
 * @. When it holds none and is not a plain host or host:port (a password that holds a "/", say
 * "ada:s3cr3t/TOKEN@host", whose port part "s3cr3t" is not a number), they run to the last @ of the
 * whole text. A path with an @ after a plain host keeps it.
 * @param {string} rest the text after the scheme (or the whole text of a form with no scheme)
 */
function credentialsEnd(rest) {
  const slash = rest.indexOf("/");
  const head = slash === -1 ? rest : rest.slice(0, slash);
  const at = head.lastIndexOf("@");
  if (at !== -1) return at;
  return PLAIN_AUTHORITY.test(head) ? -1 : rest.lastIndexOf("@");
}

/**
 * A source string fit to print or to record as kit.source: the credentials of a URL are dropped,
 * whatever they hold. For a scheme URL (also a mistyped "https:/" or "https:///") everything between
 * the scheme and the end of the credentials goes (see credentialsEnd: a #, ? or / inside a password goes
 * too), and so does a query string (a ?private_token=...). For anything else (a "user:pw@host:path"
 * typo, a source padded with spaces or wrapped in quotes, a path) the text up to the end of the
 * credentials goes. Only the conventional git@ login of an ssh URL stays: it is not a secret, and the
 * URL does not work without it. Redact before splitting off a #ref (see splitSource): a # can sit in a
 * password.
 * @param {string} from
 */
export function redactUrl(from) {
  const s = String(from);
  const m = SCHEME_URL.exec(s);
  const scheme = m ? /** @type {string} */ (m[1]) : "";
  let rest = m ? /** @type {string} */ (m[2]) : s;
  const at = credentialsEnd(rest);
  if (at !== -1) {
    const user = rest.slice(0, at);
    rest = (/^git(?::|$)/.test(user) ? "git@" : "") + rest.slice(at + 1);
  }
  if (!m) return rest;
  // A query string can carry a token: drop it, and keep a #ref after it.
  const q = rest.indexOf("?");
  if (q !== -1) {
    const hash = rest.lastIndexOf("#");
    rest = rest.slice(0, q) + (hash > q ? rest.slice(hash) : "");
  }
  return scheme + rest;
}

/** Control characters (C0, DEL and C1): an escape sequence or a carriage return can repaint a terminal. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * A value read from a file (kit.lock.json's kit.source or kit.remote) fit to print: redactUrl, then
 * every control character shown as "?".
 * @param {unknown} value
 */
export function printable(value) {
  return redactUrl(String(value)).replace(CONTROL, "?");
}

/**
 * Text (a git error, say) with every secret of a source string taken out: the source itself and its
 * userinfo, password and query wherever they appear, and the credentials of any URL left in it.
 * @param {string} text
 * @param {string} from the source the text may echo
 */
export function redactText(text, from) {
  let out = String(text);
  const src = String(from);
  const safe = redactUrl(src);
  if (safe !== src) out = out.split(src).join(safe);
  const url = splitSource(src).url;
  if (redactUrl(url) !== url) out = out.split(url).join(redactUrl(url));
  const m = SCHEME_URL.exec(url);
  const rest = m ? /** @type {string} */ (m[2]) : url;
  const at = credentialsEnd(rest);
  /** @type {string[]} */
  const secrets = [];
  if (at !== -1 && rest.slice(0, at) !== "git") {
    const user = rest.slice(0, at);
    secrets.push(user + "@");
    const pw = user.slice(user.indexOf(":") + 1);
    if (user.includes(":") && pw.length >= 4) secrets.push(pw, encodeURIComponent(pw));
  }
  const q = /\?[^#]*/.exec(rest.slice(at + 1));
  if (q && q[0].length > 1) secrets.push(q[0]);
  for (const secret of secrets.sort((a, b) => b.length - a.length)) out = out.split(secret).join(secret.endsWith("@") ? "" : "***");
  return out.replace(/[a-z][a-z0-9+.-]*:\/+[^\s'"]*/gi, (u) => redactUrl(u));
}

/** @param {string} from */
export function isGitUrl(from) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(from) || /^git@[^:]+:/.test(from);
}

/** The scheme of a git URL, lower case: "ssh" for the scp-like git@host:path form. @param {string} url */
export function urlScheme(url) {
  const m = /^([a-z][a-z0-9+.-]*):\/\//i.exec(url);
  return m ? /** @type {string} */ (m[1]).toLowerCase() : /^git@[^:]+:/.test(url) ? "ssh" : null;
}

/** Schemes a kit repository may be fetched from or remembered with: https and ssh only. */
const REMOTE_SCHEMES = new Set(["https", "ssh", "git+ssh", "ssh+git"]);

/**
 * A ref git can take safely: it never starts with "-" (git would read it as an option), and it is a
 * plain branch, tag or commit name.
 * @param {string} ref
 */
export function checkRef(ref) {
  if (ref.startsWith("-") || !/^[A-Za-z0-9][A-Za-z0-9._\/+@-]*$/.test(ref) || ref.includes("..")) {
    throw new Error("refusing the ref " + JSON.stringify(ref) + ": a ref must be a branch, tag or commit name and must not start with a dash");
  }
}

/**
 * Split a #ref off a string that holds no credentials (one that went through redactUrl). For a source
 * as typed, use splitSource.
 * @param {string} from @returns {{ url: string, ref: string | null }}
 */
export function splitRef(from) {
  const i = from.lastIndexOf("#");
  return i === -1 ? { url: from, ref: null } : { url: from.slice(0, i), ref: from.slice(i + 1) || null };
}

/**
 * Split a #ref off a source as typed, which may hold credentials: the ref is found after redactUrl, so
 * a # inside a password is never read as one. The url keeps its credentials (git needs them): print it
 * through redactUrl only.
 * @param {string} from @returns {{ url: string, ref: string | null }}
 */
export function splitSource(from) {
  const s = String(from);
  const red = redactUrl(s);
  const i = red.lastIndexOf("#");
  if (i === -1) return { url: s, ref: null };
  const suffix = red.slice(i);
  // Redaction only removes text before the ref, so the ref is the same tail of the source.
  if (!s.endsWith(suffix)) return { url: s, ref: null };
  return { url: s.slice(0, s.length - suffix.length), ref: suffix.slice(1) || null };
}

/**
 * The git commit of a directory when it is the top of a checkout whose vendored files (and root
 * package.json, which names the version) are exactly that commit's bytes, else null: a dirty tree has
 * no commit that describes its bytes. It never runs `git status`, which would run the checkout's own
 * clean filters: the HEAD tree and the index are read with plumbing and the files are hashed in Node.
 * Files outside the vendored set (docs, the template, ignored files) do not count; an untracked file
 * that would be vendored makes the tree dirty.
 * @param {string} dir
 * @returns {string | null}
 */
export function commitOf(dir) {
  const tree = headTree(dir);
  const view = tree && gitView(dir);
  if (!tree || !view || !view.top) return null;
  /** @param {string} p */
  const scoped = (p) => p === "package.json" || vendoredKey(p) !== null;
  const paths = new Set([...[...tree.blobs.keys()].filter(scoped), ...view.files.filter(scoped)]);
  try {
    for (const p of paths) {
      const want = tree.blobs.get(p);
      if (!want || want.startsWith("link:")) return null;
      if (!lstatSync(join(dir, p)).isFile()) return null;
      if (blobId(readFileSync(join(dir, p)), tree.format) !== want) return null;
    }
  } catch {
    return null;
  }
  return tree.head;
}

/**
 * The URL of the `origin` remote when a directory is the top of a git checkout, else null. It is the
 * URL as configured (no insteadOf rewriting, which is a setting of this machine). Never throws.
 * @param {string} dir
 * @returns {string | null}
 */
export function originOf(dir) {
  const git = gitIn(dir);
  try {
    const top = git(["rev-parse", "--show-toplevel"]).trim();
    if (realpathSync(top) !== realpathSync(dir)) return null;
    return git(["config", "--get", "remote.origin.url"]).trim() || null;
  } catch {
    return null;
  }
}

/** A host that only answers on this machine. @param {string} host without brackets or port */
function isLoopback(host) {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!h || h === "localhost" || h.endsWith(".localhost")) return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(h) || h === "0.0.0.0") return true;
  return h === "::1" || h === "::" || /^(?:0+:){7}0*1$/.test(h);
}

/** One control character (C0, DEL or C1). */
const CONTROL_ONE = /[\u0000-\u001f\u007f-\u009f]/;
/** A host name or a bracketed IPv6 address: letters, digits, dots and dashes, never a % escape. */
const HOST = /^(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)$/;
/** A host and an optional port of digits. */
const HOST_PORT = /^(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?::\d{1,5})?$/;

/**
 * The form of a kit repository URL that may go in kit.lock.json as `kit.remote`: one a teammate can
 * fetch from, over https or ssh (scheme URLs, or the scp-like git@host:path form). Any #ref is
 * dropped, and so are credentials (the userinfo of a scheme URL; only the conventional `git@` login
 * of an ssh URL stays, since the URL does not work without it) and a query string. Null for any other
 * transport (http, git, ftp, file, ext, fd...), for anything that only works on this machine (a local
 * path, a loopback host), for anything git could read as an option, for an authority that is not
 * host or host:digits once its credentials are gone, and for any control character.
 * @param {string | null | undefined} url
 * @returns {string | null}
 */
export function shareableRemote(url) {
  if (typeof url !== "string") return null;
  const typed = url.trim();
  if (CONTROL_ONE.test(typed)) return null;
  // The authority as typed, after its credentials, must be host or host:digits: anything else (a
  // password holding a "/", a percent-encoded host) is not a plain repository URL, and is not guessed at.
  const scheme0 = /^[a-z][a-z0-9+.-]*:\/\/([^\/]*)/i.exec(typed);
  if (scheme0) {
    const authority = /** @type {string} */ (scheme0[1]);
    if (!HOST_PORT.test(authority.slice(authority.lastIndexOf("@") + 1).replace(/[?#][\s\S]*$/, ""))) return null;
  }
  const raw = splitRef(redactUrl(typed)).url;
  if (!raw || raw.startsWith("-") || /[\s\\]/.test(raw) || !isGitUrl(raw)) return null;
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^\/?#]*)(.*)$/i.exec(raw);
  if (!m) {
    // The scp-like form git@host:org/repo.git.
    const scp = /^git@([^:\/]+):./.exec(raw);
    return scp && HOST.test(/** @type {string} */ (scp[1])) && !isLoopback(/** @type {string} */ (scp[1])) && !raw.includes("?") ? raw : null;
  }
  const scheme = /** @type {string} */ (m[1]).toLowerCase();
  const authority = /** @type {string} */ (m[2]);
  const rest = /** @type {string} */ (m[3]).replace(/\?.*$/, "");
  if (!REMOTE_SCHEMES.has(scheme) || rest.includes("#")) return null;
  const at = authority.lastIndexOf("@");
  const userinfo = at === -1 ? "" : authority.slice(0, at);
  const hostPort = authority.slice(at + 1);
  const bracketed = /^\[([^\]]*)\]/.exec(hostPort);
  if (isLoopback(bracketed ? /** @type {string} */ (bracketed[1]) : hostPort.replace(/:\d*$/, ""))) return null;
  const login = scheme.includes("ssh") && /^git(?::|$)/.test(userinfo) ? "git@" : "";
  return scheme + "://" + login + hostPort + rest;
}

/**
 * Why a value cannot be a remembered kit remote, or "" when it can (after shareableRemote drops its
 * credentials). The same rules hold for --remote, --kit-remote and kit.remote in kit.lock.json.
 * @param {unknown} value
 * @returns {string}
 */
export function remoteProblem(value) {
  if (typeof value !== "string" || value.trim().startsWith("-") || !isGitUrl(value.trim())) return "is not a git URL";
  if (redactUrl(value).includes("#")) return "carries a #ref, and the remembered remote is the repository only (pick a version with kit:sync --ref)";
  const scheme = urlScheme(value.trim());
  if (scheme === "file") return "only works on this machine (a file: URL), so it is never written to kit.lock.json";
  if (!scheme || !REMOTE_SCHEMES.has(scheme)) return "uses the " + (scheme ?? "unknown") + ": transport, and the kit is fetched over https or ssh only";
  if (shareableRemote(value) === null) return "only works on this machine (a loopback host) or is not a plain repository URL, so it is never written to kit.lock.json";
  return "";
}

/**
 * The value of `kit:sync --remote` or `create --kit-remote`: "none" is null (remember nothing), anything
 * else must be a git URL a teammate can fetch from (https or ssh). Credentials and a query are dropped.
 * @param {string} flag the flag as typed, for the message
 * @param {string} value
 * @returns {string | null}
 */
export function remoteFromFlag(flag, value) {
  if (value === "none") return null;
  const why = remoteProblem(value);
  if (why) throw new UsageError(flag + " " + JSON.stringify(redactUrl(value)) + " " + why + "; give the kit repository's git URL (https or ssh), or none");
  return shareableRemote(value);
}

/**
 * The kit.remote of a lock, checked like --remote and also required to be stored exactly in its
 * shareable form (no credentials, no query). Null when the lock names none; a UsageError naming
 * --remote when it is not acceptable.
 * @param {unknown} had the lock's kit.remote
 * @returns {string | null}
 */
export function lockedRemote(had) {
  if (had === null || had === undefined || had === "") return null;
  const why = remoteProblem(had) || (shareableRemote(/** @type {string} */ (had)) !== had ? "carries credentials, a query string or extra text" : "");
  if (why) {
    throw new UsageError(
      "kit.lock.json remembers the kit remote " + JSON.stringify(redactUrl(String(had))) + ", which " + why + ". Replace it with npm run kit:sync -- --remote <git URL> (https or ssh), or pass --from",
    );
  }
  return /** @type {string} */ (had);
}

/** @param {string} dir */
export function kitVersion(dir) {
  const p = join(dir, "package.json");
  if (!existsSync(p)) throw new Error("not a gas-kit checkout: " + dir + " has no package.json");
  return String(JSON.parse(readFileSync(p, "utf8")).version ?? "0.0.0");
}

/**
 * @typedef {object} KitSource
 * @property {string} dir the checkout directory
 * @property {string} version
 * @property {string | null} commit
 * @property {string} source what goes in kit.lock.json
 * @property {() => void} cleanup
 */

/** A ref made only of hex digits is a commit id (or an abbreviation of one), never a branch or tag name. */
export const HEX_REF = /^[0-9a-f]{7,64}$/i;

/** A full commit id: 40 hex digits (sha1) or 64 (sha256). @param {unknown} s */
export function isFullCommit(s) {
  return typeof s === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(s);
}

/**
 * Check out a commit named by hex in a fresh repository whose origin is set. A remote branch or tag
 * with exactly that name is refused (it could stand for other code than the commit). Every branch and
 * tag of the remote is then fetched with its full history into a namespace no short name resolves in,
 * and the commit must be one of them or an ancestor of one: a commit the remote holds only under
 * another kind of ref (a pull request's refs/pull/<n>/head, a deleted branch the server has not pruned
 * yet) is refused, although the server would serve it by its id. The commit checked out must start with
 * the hex asked for.
 * @param {(args: string[]) => string} git
 * @param {string} ref
 * @returns {string} the full commit
 */
function checkoutCommit(git, ref) {
  const want = ref.toLowerCase();
  const names = git(["ls-remote", "origin"])
    .split("\n")
    .map((l) => (l.split("\t")[1] ?? "").trim().toLowerCase())
    .filter(Boolean);
  const clash = names.filter((n) => n === "refs/heads/" + want || n === "refs/tags/" + want || n === "refs/tags/" + want + "^{}");
  if (clash.length) {
    throw new Error(
      "refusing --ref " + ref + ": the remote has a " + (clash[0]?.startsWith("refs/heads/") ? "branch" : "tag") + " named " + ref +
        ", so the name could stand for other code than the commit. Give the full commit id (40 characters), or a release tag",
    );
  }
  git(["fetch", "-q", "--no-tags", "--", "origin", "+refs/heads/*:refs/remotes/origin/heads/*", "+refs/tags/*:refs/remotes/origin/tags/*"]);
  const notHeld = (/** @type {string} */ c) =>
    new Error("commit " + c + " is not on any branch or tag of the remote (a pull request or other ref is not enough); give a release tag or a commit a branch or tag holds");
  /** @type {string} */
  let commit;
  try {
    commit = git(["rev-parse", "--verify", "--quiet", want + "^{commit}"]).trim();
  } catch {
    if (isFullCommit(want)) throw notHeld(want);
    throw new Error("no single commit starting with " + ref + " is on the remote's branches and tags (missing, or the abbreviation is ambiguous); give the full commit id");
  }
  if (!isFullCommit(commit) || !commit.startsWith(want)) throw new Error("refusing --ref " + ref + ": it resolved to " + commit + ", which is not the commit asked for");
  const holders = git(["for-each-ref", "--contains", commit, "--format=%(refname)", "--", "refs/remotes/origin/heads/", "refs/remotes/origin/tags/"]).trim();
  if (!holders) throw notHeld(commit);
  git(["checkout", "-q", "--detach", commit]);
  return commit;
}

/**
 * @param {string} from a directory, or a git URL with an optional #ref
 * @param {{ commit?: boolean, label?: string }} [opts] commit: false skips git in a local directory (kit:diff needs
 *   no commit); label names where the source came from in an error ("--from" by default). A file: URL
 *   is fetched only when the label is --from or GAS_KIT (an explicit local source); every other source
 *   is fetched over https or ssh only.
 * @returns {KitSource}
 */
export function resolveSource(from, opts = {}) {
  const label = opts.label ?? "--from";
  if (!isGitUrl(from)) {
    const dir = resolve(from);
    if (!existsSync(join(dir, "packages", "server", "src"))) throw new Error(label + " " + redactUrl(from) + " is not a gas-kit checkout (packages/server/src not found)");
    return { dir, version: kitVersion(dir), commit: opts.commit === false ? null : commitOf(dir), source: "local checkout", cleanup: () => {} };
  }
  const { url, ref } = splitSource(from);
  if (url.startsWith("-")) throw new Error("refusing the URL " + JSON.stringify(redactUrl(url)) + ": it must not start with a dash");
  const scheme = urlScheme(url);
  const allowFile = scheme === "file" && (label === "--from" || label === "GAS_KIT");
  if (!allowFile && (!scheme || !REMOTE_SCHEMES.has(scheme))) {
    throw new Error(
      "refusing to fetch " + redactUrl(from) + " (" + label + "): the kit is fetched over https or ssh only" + (scheme === "file" ? "; a file: URL is taken only as an explicit --from or GAS_KIT" : ""),
    );
  }
  if (ref) checkRef(ref);
  const tmp = mkdtempSync(join(tmpdir(), "gas-kit-src-"));
  const git = (/** @type {string[]} */ args) => runGit(args, { cwd: tmp, allowFile });
  const cleanup = () => rmSync(tmp, { recursive: true, force: true });
  try {
    if (ref) {
      git(["init", "-q"]);
      git(["remote", "add", "--", "origin", url]);
      if (HEX_REF.test(ref)) {
        checkoutCommit(git, ref);
      } else {
        git(["fetch", "-q", "--depth", "1", "--no-tags", "--", "origin", ref]);
        git(["checkout", "-q", "--detach", "FETCH_HEAD"]);
      }
    } else {
      runGit(["clone", "-q", "--depth", "1", "--no-tags", "--", url, tmp], { allowFile });
    }
    const commit = git(["rev-parse", "HEAD"]).trim();
    if (ref && HEX_REF.test(ref) && !commit.startsWith(ref.toLowerCase())) {
      throw new Error("refusing --ref " + ref + ": the remote answered with commit " + commit + ", which is not the commit asked for");
    }
    if (!existsSync(join(tmp, "packages", "server", "src"))) throw new Error(redactUrl(url) + " is not a gas-kit checkout (packages/server/src not found)");
    return { dir: tmp, version: kitVersion(tmp), commit, source: redactUrl(from), cleanup };
  } catch (e) {
    cleanup();
    const err = /** @type {Error & { stderr?: string }} */ (e);
    const raw = err.stderr ? String(err.stderr).trim() : err.message;
    throw new Error("could not fetch " + redactUrl(from) + ": " + redactText(raw, from));
  }
}
