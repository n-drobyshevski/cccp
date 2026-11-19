// The only code that reads a migration source. A source app is untrusted data: this module lists
// it (with git when it is a repository), never follows a symlink in it, never reads a secret-shaped
// file, caps sizes and counts, hashes every file it reads, and re-hashes on every later read so a
// source that changed since the inventory is refused. It never writes and never runs anything from
// the source: git is asked only through the local helpers of git.mjs (no network, so no lazy fetch
// a hostile partial-clone config could start; no ssh command; a timeout), and a repository git will
// not list is read as empty, with a problem line, rather than walked past its ignore rules.
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import { basename, join, posix, resolve, sep } from "node:path";
import { UsageError } from "../args.mjs";
import { termLine } from "./steps/_common.mjs";
import { blobId, gitBytes, gitListing } from "../git.mjs";
import { sha256 } from "../hash.mjs";

/** @typedef {"js"|"ts"|"gs"|"html"|"css"|"json"|"md"|"other"} FileKind */

/**
 * @typedef {object} SourceFile
 * @property {string} key "<rel>" for root 0, "@<sharedName>/<rel>" for a shared root
 * @property {number} root index into roots
 * @property {string} rel posix path below its root
 * @property {string} abs absolute path below the root's real path
 * @property {number} bytes
 * @property {string} sha256
 * @property {FileKind} kind
 */

/** @typedef {{ name: string, abs: string }} SourceRoot roots[0].name is "source"; a shared root is named by its basename */

/**
 * Why a path is not in files. "special" (not a regular file, a FIFO or a device) and "bad-name" (a
 * name no key may hold: a control character, a backslash, a name that is not valid UTF-8, or a
 * root-0 path whose first segment starts with "@", which would read as a shared root's key) are
 * additions to the spec.
 * @typedef {"symlink"|"too-big"|"secret-file"|"ignored-dir"|"binary"|"cap"|"special"|"bad-name"} SkipWhy
 */

/** @typedef {{ fileBytes: number, totalBytes: number, files: number, gitMs: number }} Limits gitMs: how long one git read may take */

/**
 * @typedef {object} SourceTree
 * @property {SourceRoot[]} roots
 * @property {Map<string, SourceFile>} files text files, sorted by key
 * @property {Map<string, SourceFile>} assets binary files (also listed in skipped as "binary"): hashed, readable with readBytes only
 * @property {{ key: string, why: SkipWhy }[]} skipped
 * @property {string[]} problems what could not be listed and why (a repository git would not list is read as empty, never walked)
 * @property {{ repo: boolean, clean: boolean | null, head: string | null }} git root 0 only. clean is null when it cannot be
 *   told without reading a file this module never reads (a secret-shaped or over-size tracked file)
 * @property {(key: string) => string} read utf8 text of a file; throws "source changed since inventory: <key>" on a mismatch
 * @property {(key: string) => Buffer} readBytes the bytes of a file or an asset, re-hashed the same way
 * @property {(fromKey: string, spec: string) => string | null} resolve a relative import spec to a key, or null
 * @property {() => string} digest sha256 over the sorted "key sha" lines of files and assets
 */

/** @type {Limits} */
export const DEFAULT_LIMITS = { fileBytes: 1_000_000, totalBytes: 20_000_000, files: 5000, gitMs: 60_000 };

/** Directories never descended into, at any depth. */
export const SKIP_DIRS = new Set(["node_modules", ".git", "coverage", "test-results", "playwright-report", ".cache"]);

/** Extensions read as binary without looking (they are still hashed, never decoded). */
const BINARY_EXT = /\.(?:png|jpe?g|gif|webp|avif|bmp|ico|icns|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|bz2|xz|7z|jar|wasm|mp3|mp4|webm|ogg|wav|mov|psd|xlsx?|docx?|pptx?)$/i;

/** Code points HFS+ ignores in a name (as git's is_hfs_dotgit does), so ".g\u200cit" is ".git" there. */
const HFS_IGNORABLE = /[\u200c-\u200f\u202a-\u202e\u206a-\u206f\ufeff]/g;

/**
 * The form of a name a filesystem may treat it as: HFS+ ignorable code points dropped, an NTFS
 * stream suffix (":$DATA", "::$INDEX_ALLOCATION") cut, trailing dots and spaces cut (Windows drops
 * them), lower case.
 * @param {string} name
 */
export function comparableName(name) {
  let n = name.replace(HFS_IGNORABLE, "");
  const colon = n.indexOf(":");
  if (colon >= 0) n = n.slice(0, colon);
  return n.replace(/[. ]+$/, "").toLowerCase();
}

/**
 * True when a name is, or a filesystem may read it as, ".git": the case-folded, HFS+ and NTFS
 * aliases (".GIT", ".git.", ".git ", ".git::$INDEX_ALLOCATION", ".g\u200cit") and the 8.3 short
 * name GIT~1.
 * @param {string} name
 */
export function isDotGit(name) {
  const n = comparableName(name);
  return n === ".git" || /^git~\d+$/.test(n);
}

/**
 * A file name that may hold a credential: never opened, never hashed, recorded as "secret-file".
 * The spec list (.clasprc.json, .env*, *.pem, *.key, id_rsa*) plus more credential shapes (.envrc,
 * .npmrc, .netrc and .git-credentials tokens, other ssh keys, PKCS#12 and Java key stores, OAuth
 * client and token files), which only narrows what is read. Compared in comparableName form, so
 * ".ENV", ".env." and ".env::$DATA" are secret too.
 * @param {string} name a file or directory name
 */
export function isSecretName(name) {
  const n = comparableName(name);
  return (
    n === ".clasprc.json" ||
    n === ".env" ||
    n.startsWith(".env.") ||
    n === ".envrc" ||
    n.endsWith(".pem") ||
    n.endsWith(".key") ||
    n.startsWith("id_rsa") ||
    n.startsWith("id_dsa") ||
    n.startsWith("id_ed25519") ||
    n.startsWith("id_ecdsa") ||
    n === ".npmrc" ||
    n === ".netrc" ||
    n === ".git-credentials" ||
    n.endsWith(".p12") ||
    n.endsWith(".pfx") ||
    n.endsWith(".jks") ||
    n.endsWith(".keystore") ||
    n === "credentials.json" ||
    n === "token.json" ||
    (n.startsWith("client_secret") && n.endsWith(".json"))
  );
}

/** A directory never entered: a SKIP_DIRS name or any alias of .git. @param {string} name */
function skipDir(name) {
  return SKIP_DIRS.has(name) || isDotGit(name);
}

/** @param {string} rel @returns {FileKind} */
export function kindOf(rel) {
  const m = /\.([^./]+)$/.exec(rel);
  const ext = m ? /** @type {string} */ (m[1]).toLowerCase() : "";
  if (ext === "js" || ext === "mjs" || ext === "cjs" || ext === "jsx") return "js";
  if (ext === "ts" || ext === "mts" || ext === "cts" || ext === "tsx") return "ts";
  if (ext === "gs") return "gs";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "css") return "css";
  if (ext === "json") return "json";
  if (ext === "md") return "md";
  return "other";
}

// O_NOFOLLOW refuses a final symlink at open time; O_NONBLOCK keeps a FIFO from blocking the open
// (it is then refused as not a regular file). Both are 0 where the platform lacks them.
const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

/**
 * Read at most max bytes of a regular file without following a symlink. Returns null when the
 * file holds more than max bytes. Throws when the path is not a regular file.
 * @param {string} abs @param {number} max
 * @returns {Buffer | null}
 */
function readBounded(abs, max) {
  const fd = openSync(abs, OPEN_FLAGS);
  try {
    if (!fstatSync(fd).isFile()) throw new Error("not a regular file: " + abs);
    const chunks = [];
    let total = 0;
    const buf = Buffer.alloc(64 * 1024);
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      total += n;
      if (total > max) return null;
      chunks.push(Buffer.from(buf.subarray(0, n)));
    }
    return Buffer.concat(chunks, total);
  } finally {
    closeSync(fd);
  }
}

/** True when the bytes look binary: a NUL in the first 8 kB. @param {Buffer} b */
function looksBinary(b) {
  return b.subarray(0, 8192).includes(0);
}

/**
 * A rel no key may hold: a control character, a backslash, or an empty, "." or ".." segment (git
 * refuses those itself; a hostile index is not trusted to).
 * @param {string} rel
 */
function badName(rel) {
  return /[\u0000-\u001f\u007f\\\ufffd]/.test(rel) || rel.startsWith("/") || rel.split("/").some((p) => p === "" || p === "." || p === "..");
}

/** Case-folded on filesystems that are usually case-insensitive. @param {string} p */
function fold(p) {
  return process.platform === "darwin" || process.platform === "win32" ? p.toLowerCase() : p;
}

/** @param {string} p */
function withSep(p) {
  return p.endsWith(sep) ? p : p + sep;
}

/**
 * True when one real path is the other or inside it.
 * @param {string} a @param {string} b
 */
export function pathsOverlap(a, b) {
  const x = withSep(fold(a));
  const y = withSep(fold(b));
  return x.startsWith(y) || y.startsWith(x);
}

/** True when a posix path is strictly below a posix root. @param {string} p @param {string} root */
function isUnder(p, root) {
  const r = fold(root).endsWith("/") ? fold(root) : fold(root) + "/";
  return fold(p).startsWith(r) && fold(p).length > r.length;
}

/**
 * The real path of a root directory; throws when it is missing or not a directory.
 * @param {string} p
 */
function realDir(p) {
  let real;
  try {
    real = realpathSync(resolve(p));
  } catch {
    throw new UsageError("migration source not found: " + p, { title: "The migration source was not found", why: "There is nothing at " + termLine(p) + ".", fix: "Check the path of the source app.", more: "npm run kit -- help" });
  }
  if (!lstatSync(real).isDirectory()) throw new UsageError("migration source is not a directory: " + p, { title: "The migration source is not a folder", why: termLine(p) + " is a file or a link, not a directory.", fix: "Point it at the app's folder.", more: "npm run kit -- help" });
  return real;
}

/**
 * The first symlink (or non-directory) among the parent components of rel below root, as a rel,
 * or null when every parent is a real directory.
 * @param {string} root @param {string} rel
 * @returns {{ at: string, why: "symlink" | "special" } | null}
 */
function badParent(root, rel) {
  const parts = rel.split("/");
  let cur = "";
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur ? cur + "/" + parts[i] : /** @type {string} */ (parts[i]);
    let st;
    try {
      st = lstatSync(join(root, cur));
    } catch {
      return null; // gone: the file's own lstat fails next and it is left out
    }
    if (st.isSymbolicLink()) return { at: cur, why: "symlink" };
    if (!st.isDirectory()) return { at: cur, why: "special" };
  }
  return null;
}

/**
 * Candidate paths of one root, sorted: git-listed when the root is inside a work tree, else walked.
 * A repository git would not list (a failure, a timeout, an owner git refuses) or lists as empty is
 * read as empty, with a problem line: walking it would read the files its ignore rules keep out.
 * Directories in SKIP_DIRS, .git aliases and secret-shaped directories are recorded once, never
 * entered. Symlinks are recorded, never followed. A name that is not valid UTF-8 is recorded as
 * bad-name.
 * @param {string} abs the root's real path
 * @param {number} gitMs
 * @returns {{ rels: string[], skipped: { rel: string, why: SkipWhy }[], git: boolean, problem: string | null }}
 */
function listRoot(abs, gitMs) {
  /** @type {{ rel: string, why: SkipWhy }[]} */
  const skipped = [];
  const view = gitListing(abs, { timeoutMs: gitMs });
  if (view.state === "failed") return { rels: [], skipped, git: true, problem: abs + " is in a git repository that git would not list (" + view.reason + "); nothing was read from it" };
  if (view.state === "ok") {
    for (const u of view.undecodable) skipped.push({ rel: u, why: "bad-name" });
    if (!view.files.length) return { rels: [], skipped, git: true, problem: abs + " is in a git repository that lists no file there (all ignored, or empty); nothing was read from it" };
    /** @type {Set<string>} */
    const seenDirs = new Set();
    /** @type {string[]} */
    const rels = [];
    for (const f of view.files) {
      const parts = f.split("/");
      const hit = parts.slice(0, -1).findIndex((p) => skipDir(p) || isSecretName(p));
      if (hit >= 0) {
        const dir = parts.slice(0, hit + 1).join("/");
        if (!seenDirs.has(dir)) {
          seenDirs.add(dir);
          skipped.push({ rel: dir, why: isSecretName(/** @type {string} */ (parts[hit])) ? "secret-file" : "ignored-dir" });
        }
        continue;
      }
      rels.push(f);
    }
    return { rels: rels.sort(), skipped, git: true, problem: null };
  }
  /** @type {string[]} */
  const rels = [];
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  /** @param {string} sub */
  const go = (sub) => {
    /** @type {Buffer[]} */
    let names;
    try {
      names = readdirSync(sub ? join(abs, sub) : abs, { encoding: "buffer" });
    } catch {
      return;
    }
    /** @type {string[]} */
    const decoded = [];
    for (const raw of names) {
      try {
        decoded.push(utf8.decode(raw));
      } catch {
        skipped.push({ rel: (sub ? sub + "/" : "") + raw.toString("utf8"), why: "bad-name" });
      }
    }
    for (const name of decoded.sort()) {
      const rel = sub ? sub + "/" + name : name;
      let st;
      try {
        st = lstatSync(join(abs, rel));
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) skipped.push({ rel, why: "symlink" });
      else if (st.isDirectory()) {
        if (skipDir(name)) skipped.push({ rel, why: "ignored-dir" });
        else if (isSecretName(name)) skipped.push({ rel, why: "secret-file" });
        else go(rel);
      } else rels.push(rel);
    }
  };
  go("");
  return { rels: rels.sort(), skipped, git: false, problem: null };
}

/**
 * Whether the git-listed files of a root match its HEAD tree, compared in Node (blob ids of the
 * bytes already read, readlink for symlinks): git status is never run, because it runs the
 * checkout's own filters. null when a tracked file was not read (secret-shaped, too big, a cap).
 * @param {string} abs
 * @param {Map<string, Buffer>} bytesByRel
 * @param {Set<string>} links rels recorded as symlinks
 * @param {string[]} listed every rel git listed
 * @param {number} gitMs
 * @returns {{ clean: boolean | null, head: string | null }}
 */
function gitState(abs, bytesByRel, links, listed, gitMs) {
  const git = (/** @type {string[]} */ args) => gitBytes(abs, args, { timeoutMs: gitMs }).toString("utf8");
  let head;
  try {
    head = git(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]).trim();
  } catch {
    return { clean: listed.length ? false : true, head: null };
  }
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(head)) return { clean: null, head: null };
  const format = head.length === 64 ? "sha256" : "sha1";
  /** @type {Map<string, string>} */
  const blobs = new Map();
  try {
    for (const entry of git(["ls-tree", "-r", "-z", head]).split("\0")) {
      const m = /^(\d+) (\w+) ([0-9a-f]+)\t([\s\S]+)$/.exec(entry);
      if (m && m[2] === "blob") blobs.set(/** @type {string} */ (m[4]), (m[1] === "120000" ? "link:" : "") + m[3]);
    }
  } catch {
    return { clean: null, head };
  }
  /** @type {boolean | null} */
  let clean = true;
  for (const rel of new Set([...listed, ...blobs.keys()])) {
    const want = blobs.get(rel);
    if (want === undefined) return { clean: false, head };
    // A name no key may hold is never passed to lstat or readlink: it cannot be compared.
    if (badName(rel)) {
      clean = null;
      continue;
    }
    if (want.startsWith("link:")) {
      let target;
      try {
        target = readlinkSync(join(abs, rel));
      } catch {
        return { clean: false, head };
      }
      if (!links.has(rel) || "link:" + blobId(Buffer.from(target), format) !== want) return { clean: false, head };
      continue;
    }
    const bytes = bytesByRel.get(rel);
    if (!bytes) {
      let present = true;
      try {
        lstatSync(join(abs, rel));
      } catch {
        present = false;
      }
      if (!present) return { clean: false, head };
      clean = null;
      continue;
    }
    if (blobId(bytes, format) !== want) return { clean: false, head };
  }
  return { clean, head };
}

/**
 * Why a shared root's folder name cannot name it, or null. The name is the "@<name>/" segment of
 * its keys, so it is held to the key rules: one plain segment, no "@", no .git alias, not "source".
 * @param {string} name
 */
export function rootNameProblem(name) {
  if (!name || name === "." || name === "..") return "empty or a dot segment";
  if (/[\u0000-\u001f\u007f/\\@:\ufffd]/.test(name)) return "a control character, a slash, a backslash, a colon or an @";
  if (/[. ]$/.test(name)) return "a trailing dot or space";
  if (isDotGit(name)) return "a .git alias";
  return null;
}

/**
 * Open a migration source read-only.
 * @param {{ root: string, shared?: string[], limits?: Partial<Limits> }} opts
 * @returns {SourceTree}
 */
export function openSource({ root, shared = [], limits }) {
  const lim = { ...DEFAULT_LIMITS, ...(limits ?? {}) };
  /** @type {SourceRoot[]} */
  const roots = [{ name: "source", abs: realDir(root) }];
  for (const s of shared) {
    const abs = realDir(s);
    const name = basename(abs);
    if (rootNameProblem(name)) throw new UsageError("shared root has an unusable name: " + s + " (" + rootNameProblem(name) + ")", { title: "A shared root has an unusable name", why: "The folder " + termLine(s) + " cannot be used as a shared root name.", fix: "Rename the folder, or share another one with --shared <dir,dir>.", more: "npm run kit -- help" });
    if (roots.some((r) => r.name === name)) throw new UsageError("two roots share the name " + name + "; shared roots are named by their folder name, which must be unique and not \"source\"", { title: "Two shared roots have the same name", why: "Shared roots are named by their folder, so the name " + termLine(name) + " must be unique and not source.", fix: "Rename one of the folders, or leave one out of --shared.", more: "npm run kit -- help" });
    roots.push({ name, abs });
  }
  for (let i = 0; i < roots.length; i++) {
    for (let j = i + 1; j < roots.length; j++) {
      const a = /** @type {SourceRoot} */ (roots[i]);
      const b = /** @type {SourceRoot} */ (roots[j]);
      if (pathsOverlap(a.abs, b.abs)) throw new UsageError("source roots overlap: " + a.abs + " and " + b.abs + " (a shared root may not be, contain or sit inside another root)", { title: "Two source roots overlap", why: "A shared root may not be, contain or sit inside another root: " + termLine(a.abs) + " and " + termLine(b.abs) + ".", fix: "Share folders that do not overlap with --shared <dir,dir>.", more: "npm run kit -- help" });
    }
  }

  /** @type {Map<string, SourceFile>} */
  const files = new Map();
  /** @type {Map<string, SourceFile>} */
  const assets = new Map();
  /** @type {{ key: string, why: SkipWhy }[]} */
  const skipped = [];
  /** @type {string[]} */
  const problems = [];
  /** @type {{ repo: boolean, clean: boolean | null, head: string | null }} */
  let git = { repo: false, clean: null, head: null };
  let total = 0;
  let count = 0;

  roots.forEach((r, ri) => {
    const prefix = ri === 0 ? "" : "@" + r.name + "/";
    const listed = listRoot(r.abs, lim.gitMs);
    if (listed.problem) problems.push(listed.problem);
    /** @type {Map<string, Buffer>} */
    const bytesByRel = new Map();
    /** @type {Set<string>} */
    const links = new Set();
    /** @type {Set<string>} */
    const badParents = new Set();
    /** @param {string} rel @param {SkipWhy} why */
    const skip = (rel, why) => {
      if (why === "symlink") links.add(rel);
      skipped.push({ key: prefix + rel, why });
    };
    for (const s of listed.skipped) skip(s.rel, s.why);
    for (const rel of listed.rels) {
      // A root-0 path under "@x/" would read as shared root x's key: no key may impersonate one.
      if (badName(rel) || (ri === 0 && rel.startsWith("@"))) {
        skip(rel, "bad-name");
        continue;
      }
      const name = rel.slice(rel.lastIndexOf("/") + 1);
      // A parent swapped for a symlink after git listed it (or a hostile index entry) is never entered.
      const bad = badParent(r.abs, rel);
      if (bad) {
        if (!badParents.has(bad.at)) {
          badParents.add(bad.at);
          skip(bad.at, bad.why);
        }
        continue;
      }
      const abs = join(r.abs, ...rel.split("/"));
      let st;
      try {
        st = lstatSync(abs);
      } catch {
        continue; // listed by git but gone from disk
      }
      if (st.isSymbolicLink()) {
        skip(rel, "symlink");
        continue;
      }
      if (isSecretName(name)) {
        skip(rel, "secret-file");
        continue;
      }
      if (st.isDirectory()) {
        skip(rel, "ignored-dir"); // a submodule: another repository
        continue;
      }
      if (!st.isFile()) {
        skip(rel, "special");
        continue;
      }
      if (st.size > lim.fileBytes) {
        skip(rel, "too-big");
        continue;
      }
      if (count >= lim.files) {
        skip(rel, "cap");
        continue;
      }
      let bytes;
      try {
        bytes = readBounded(abs, lim.fileBytes);
      } catch {
        skip(rel, "special");
        continue;
      }
      if (bytes === null) {
        skip(rel, "too-big");
        continue;
      }
      total += bytes.length;
      if (total > lim.totalBytes) throw new Error("migration source is over " + lim.totalBytes + " bytes in total (at " + prefix + rel + "); pass a smaller root or raise the limit");
      count++;
      bytesByRel.set(rel, bytes);
      const key = prefix + rel;
      if (files.has(key) || assets.has(key)) throw new Error("two source files map to the key " + key);
      const binary = BINARY_EXT.test(rel) || looksBinary(bytes);
      /** @type {SourceFile} */
      const file = { key, root: ri, rel, abs, bytes: bytes.length, sha256: sha256(bytes), kind: binary ? "other" : kindOf(rel) };
      if (binary) {
        assets.set(key, file);
        skipped.push({ key, why: "binary" });
      } else files.set(key, file);
    }
    if (ri === 0 && listed.git) git = listed.problem ? { repo: true, clean: null, head: null } : { repo: true, ...gitState(r.abs, bytesByRel, links, listed.rels, lim.gitMs) };
  });

  /** @param {string} key */
  const lookup = (key) => {
    const f = files.get(key) ?? assets.get(key);
    if (!f) throw new Error("not in the migration source: " + key);
    return f;
  };
  /** @param {SourceFile} f */
  const reread = (f) => {
    const r = /** @type {SourceRoot} */ (roots[f.root]);
    /** @type {Buffer | null} */
    let bytes = null;
    try {
      if (!badParent(r.abs, f.rel)) bytes = readBounded(f.abs, lim.fileBytes);
    } catch {
      bytes = null;
    }
    if (!bytes || sha256(bytes) !== f.sha256) throw new Error("source changed since inventory: " + f.key);
    return bytes;
  };

  return {
    roots,
    files,
    assets,
    skipped,
    problems,
    git,
    read(key) {
      const f = files.get(key);
      if (!f) throw new Error(assets.has(key) ? key + " is binary; use readBytes" : "not in the migration source: " + key);
      return reread(f).toString("utf8");
    },
    readBytes(key) {
      return reread(lookup(key));
    },
    resolve(fromKey, spec) {
      const from = files.get(fromKey) ?? assets.get(fromKey);
      if (!from || typeof spec !== "string" || !(spec.startsWith("./") || spec.startsWith("../")) || spec.includes("\\") || spec.includes("\0")) return null;
      const target = posix.normalize(posix.join(posix.dirname(toPosix(from.abs)), spec));
      for (const cand of [target, target + ".js", target + ".mjs", target + ".ts", target + "/index.js"]) {
        for (let ri = 0; ri < roots.length; ri++) {
          const r = /** @type {SourceRoot} */ (roots[ri]);
          const rootP = toPosix(r.abs);
          if (!isUnder(cand, rootP)) continue;
          const rel = posix.relative(rootP, cand);
          const key = (ri === 0 ? "" : "@" + r.name + "/") + rel;
          if (files.has(key)) return key;
        }
      }
      return null;
    },
    digest() {
      const lines = [...files.values(), ...assets.values()].map((f) => f.key + " " + f.sha256).sort();
      return sha256(lines.join("\n") + "\n");
    },
  };
}

/** An absolute path in posix form (a no-op off Windows). @param {string} p */
function toPosix(p) {
  return sep === "/" ? p : p.split(sep).join("/");
}
