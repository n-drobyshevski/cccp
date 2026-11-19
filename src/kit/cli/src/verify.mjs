// kit:verify: re-hash src/kit against kit.lock.json and check that no vendored file imports
// anything outside the kit set. Every problem carries its fix.
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { KIT_DIR, LOCK_FILE, hashFiles, parseLock, sha256, vendorFiles, walkFiles } from "./hash.mjs";
import { importProblem, importSpecifiers } from "./imports.mjs";
import { isFullCommit, isGitUrl, lockedRemote, redactText, redactUrl, resolveSource } from "./source.mjs";

/**
 * @typedef {object} Problem
 * @property {"lock" | "edited" | "missing" | "stray" | "import" | "link" | "upstream"} kind
 * @property {string} file path under src/kit (or the lock file name)
 * @property {string} message
 * @property {string} fix
 */

/**
 * A source from kit.lock.json that is safe to print in a command to copy: a git URL with no
 * whitespace, control character or shell metacharacter, and an optional plain #ref.
 */
const STRICT_URL = /^(?:[a-z][a-z0-9+.-]*:\/\/[A-Za-z0-9._~%@:\[\]-]+(?:\/[A-Za-z0-9._~%@:+=,-]*)*|git@[A-Za-z0-9.-]+:[A-Za-z0-9._~%@+=,\/-]+)(?:#[A-Za-z0-9][A-Za-z0-9._\/+@-]*)?$/;

/**
 * kit:sync refuses while kit:verify fails, so the restore hint always carries --force. A lock that
 * remembers the kit's git URL (kit.remote) needs no --from: kit:sync defaults to it. The lock is
 * untrusted text: its source is printed only when, after redactUrl, it is a strict git URL (STRICT_URL),
 * else "<kit checkout>" stands for it.
 * @param {string | undefined} source the lock's kit.source: a strict git URL is printed, anything else is not
 * @param {string | null} [remote] the lock's kit.remote
 * @param {string | null} [commit] the lock's kit.commit: the hint restores that commit, not a newer kit
 */
export function syncFix(source, remote, commit) {
  if (typeof remote === "string" && remote && isGitUrl(remote)) {
    // The full id: an abbreviation could also be the name of a branch someone pushed.
    const pinned = isFullCommit(commit) ? "--ref " + String(commit).toLowerCase() + " " : "";
    return "run npm run kit:sync -- " + pinned + "--force";
  }
  const safe = typeof source === "string" ? redactUrl(source) : "";
  const from = safe && isGitUrl(safe) && STRICT_URL.test(safe) ? safe : "<kit checkout>";
  return "run npm run kit:sync -- --from " + from + " --force";
}
const CODE = /\.(?:m?js|cjs|ts|mts|cts)$/;

/**
 * The pure core: compare a lock with the files found on disk.
 * @param {{ kit?: { source?: string, remote?: string | null, commit?: string | null }, files: Record<string, string> }} lock
 * @param {Record<string, string>} actual path under src/kit to sha256 of what is on disk
 * @returns {Problem[]}
 */
export function compareHashes(lock, actual) {
  /** @type {Problem[]} */
  const out = [];
  const fix = syncFix(lock.kit?.source, lock.kit?.remote, lock.kit?.commit);
  for (const [file, want] of Object.entries(lock.files).sort()) {
    const got = actual[file];
    if (got === undefined) out.push({ kind: "missing", file, message: "vendored file is missing", fix: fix + " to restore it" });
    else if (got !== want) out.push({ kind: "edited", file, message: "vendored file was edited", fix: fix + " to restore it, and make the change in the kit instead" });
  }
  for (const file of Object.keys(actual).sort()) {
    if (!(file in lock.files)) out.push({ kind: "stray", file, message: "file is not in " + LOCK_FILE, fix: "move app code out of src/kit (the folder holds the vendored kit only)" });
  }
  return out;
}

/**
 * Import problems for one file's source.
 * @param {string} file path under src/kit
 * @param {string} source
 * @param {string} kitRootAbs
 * @returns {Problem[]}
 */
export function importProblems(file, source, kitRootAbs) {
  /** @type {Problem[]} */
  const out = [];
  for (const spec of importSpecifiers(source)) {
    const why = importProblem(spec, join(kitRootAbs, file), kitRootAbs);
    if (why) {
      out.push({
        kind: "import",
        file,
        message: why,
        fix: spec.startsWith(".") ? "move app code out of src/kit and import the kit by its @gas-kit/* name" : "do not import it from src/kit; use a @gas-kit/* package or move the code out of src/kit",
      });
    }
  }
  return out;
}

/**
 * Verify an app directory.
 * @param {string} root the app root
 * @returns {{ problems: Problem[], lockFound: boolean }}
 */
export function verifyApp(root) {
  const lockPath = join(root, LOCK_FILE);
  const linked = linkedPaths(root);
  if (linked.length) {
    return {
      lockFound: existsSync(lockPath),
      problems: linked.map((file) => ({ kind: "link", file, message: "is a symbolic link, so kit:sync would delete or write outside the app through it", fix: "replace it with a real " + (file === LOCK_FILE ? "file" : "directory") + " (or remove it), then run kit:sync" })),
    };
  }
  if (!existsSync(lockPath)) {
    return { lockFound: false, problems: [{ kind: "lock", file: LOCK_FILE, message: LOCK_FILE + " is missing in " + root, fix: "run npm run kit:sync -- --from <kit checkout> --force to write it" }] };
  }
  /** @type {import("./hash.mjs").Lock} */
  let lock;
  try {
    lock = parseLock(readFileSync(lockPath, "utf8"));
  } catch (e) {
    return { lockFound: true, problems: [{ kind: "lock", file: LOCK_FILE, message: /** @type {Error} */ (e).message, fix: "run npm run kit:sync -- --from <kit checkout> --force to rewrite it" }] };
  }
  const kitRoot = resolve(root, KIT_DIR);
  /** @type {string[]} */
  const links = [];
  const found = walkFiles(kitRoot, { links });
  /** @type {Record<string, string>} */
  const actual = {};
  /** @type {Problem[]} */
  const imports = [];
  for (const f of found) {
    const bytes = readFileSync(join(kitRoot, f));
    actual[f] = sha256(bytes);
    if (CODE.test(f)) imports.push(...importProblems(f, bytes.toString("utf8"), kitRoot));
  }
  const linkProblems = links.map((file) => /** @type {Problem} */ ({ kind: "stray", file, message: "is a symlink, which the vendored kit never contains", fix: "remove it (the folder holds plain vendored files only)" }));
  return { lockFound: true, problems: [...compareHashes(lock, actual), ...linkProblems, ...imports] };
}

/**
 * Which of src, src/kit and kit.lock.json in an app is a symbolic link: kit:sync deletes and writes
 * them, and would do so through the link.
 * @param {string} root the app root
 * @returns {string[]}
 */
export function linkedPaths(root) {
  /** @type {string[]} */
  const out = [];
  for (const rel of ["src", KIT_DIR, LOCK_FILE]) {
    try {
      if (lstatSync(join(root, rel)).isSymbolicLink()) out.push(rel);
    } catch {
      // absent: nothing to write through
    }
  }
  return out;
}

/**
 * kit:verify --upstream: fetch the lock's kit.remote at its full kit.commit, vendor it afresh and
 * compare it with src/kit and with the lock. It does not trust the lock's hashes, so a vendored file
 * edited together with its hash is caught. Every difference is a problem; a lock with no remote or no
 * full commit is one too (there is nothing to check against).
 * @param {string} root the app root
 * @returns {{ problems: Problem[], commit: string | null, remote: string | null }}
 */
export function verifyUpstream(root) {
  /** @type {Problem[]} */
  const problems = [];
  /** @type {import("./hash.mjs").Lock} */
  let lock;
  try {
    lock = parseLock(readFileSync(join(root, LOCK_FILE), "utf8"));
  } catch (e) {
    return { commit: null, remote: null, problems: [{ kind: "lock", file: LOCK_FILE, message: /** @type {Error} */ (e).message, fix: "run kit:verify without --upstream first" }] };
  }
  /** @type {string | null} */
  let remote;
  try {
    remote = lockedRemote(lock.kit?.remote);
  } catch (e) {
    return { commit: null, remote: null, problems: [{ kind: "upstream", file: LOCK_FILE, message: /** @type {Error} */ (e).message, fix: "fix kit.remote, then run kit:verify --upstream again" }] };
  }
  const commit = isFullCommit(lock.kit?.commit) ? String(lock.kit.commit).toLowerCase() : null;
  if (!remote) problems.push({ kind: "upstream", file: LOCK_FILE, message: "kit.remote is not set, so there is no upstream to check against", fix: "remember the kit repository with npm run kit:sync -- --remote <git URL>" });
  if (!commit) problems.push({ kind: "upstream", file: LOCK_FILE, message: "kit.commit is not a full commit id (the kit was vendored from a dirty or non-git checkout)", fix: "run npm run kit:sync -- --ref <tag | full commit> to vendor a commit of the remote" });
  if (!remote || !commit) return { commit, remote, problems };
  const from = remote + "#" + commit;
  let src;
  try {
    src = resolveSource(from, { label: "the remembered remote" });
  } catch (e) {
    return { commit, remote, problems: [{ kind: "upstream", file: LOCK_FILE, message: redactText(/** @type {Error} */ (e).message, from), fix: "check that kit.remote can be fetched from here and still holds kit.commit" }] };
  }
  try {
    const want = hashFiles(vendorFiles(src.dir));
    const kitRoot = resolve(root, KIT_DIR);
    /** @type {string[]} */
    const links = [];
    const have = hashFiles(Object.fromEntries(walkFiles(kitRoot, { links }).map((f) => [f, join(kitRoot, f)])));
    const fix = "run npm run kit:sync -- --ref " + commit + " --force to restore the upstream bytes, and review how the difference got in";
    if (src.version !== lock.kit.version) problems.push({ kind: "upstream", file: LOCK_FILE, message: "kit.version is " + JSON.stringify(lock.kit.version) + " but the kit at " + commit + " is " + src.version, fix });
    for (const file of [...new Set([...Object.keys(want), ...Object.keys(have), ...Object.keys(lock.files), ...links])].sort()) {
      const up = want[file];
      if (links.includes(file)) problems.push({ kind: "upstream", file, message: "is a symlink, which the upstream kit never contains", fix });
      else if (up === undefined) problems.push({ kind: "upstream", file, message: "is not in the upstream kit at " + commit, fix });
      else if (have[file] !== up) problems.push({ kind: "upstream", file, message: have[file] === undefined ? "upstream file is missing from src/kit" : "differs from the upstream kit at " + commit, fix });
      else if (lock.files[file] !== up) problems.push({ kind: "upstream", file, message: "the hash in " + LOCK_FILE + " differs from the upstream kit at " + commit, fix });
    }
  } finally {
    src.cleanup();
  }
  return { commit, remote, problems };
}

/**
 * @param {Problem[]} problems
 * @returns {string[]} lines to print
 */
export function formatProblems(problems) {
  // File names come from kit.lock.json and the disk: never print a control character from them.
  const clean = (/** @type {string} */ s) => String(s).replace(/[\u0000-\u001f\u007f-\u009f]/g, "?");
  return problems.map((p) => "  " + clean(p.file) + ": " + clean(p.message) + ". Fix: " + clean(p.fix) + ".");
}
