// kit:sync and kit:diff.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { UsageError } from "./args.mjs";
import { diffAgainst } from "./diff.mjs";
import { KIT_DIR, LOCK_FILE, hashFiles, parseLock, vendorFiles, walkFiles } from "./hash.mjs";
import { HEX_REF, checkRef, isFullCommit, isGitUrl, lockedRemote, printable, remoteFromFlag, resolveSource, shareableRemote, splitSource } from "./source.mjs";
import { formatProblems, linkedPaths, verifyApp } from "./verify.mjs";
import { writeVendored } from "./vendor.mjs";

/**
 * Added, changed and removed paths between the files on disk and the incoming set.
 * @param {Record<string, string>} before path to sha256
 * @param {Record<string, string>} after path to sha256
 */
export function summarize(before, after) {
  const added = Object.keys(after).filter((k) => !(k in before)).sort();
  const removed = Object.keys(before).filter((k) => !(k in after)).sort();
  const changed = Object.keys(after).filter((k) => k in before && before[k] !== after[k]).sort();
  return { added, changed, removed };
}

/**
 * The app's lock, or null when it is missing or unreadable (kit:verify is what reports that).
 * @param {string} root the app root
 * @returns {import("./hash.mjs").Lock | null}
 */
export function readLock(root) {
  try {
    return parseLock(readFileSync(join(root, LOCK_FILE), "utf8"));
  } catch {
    return null;
  }
}

/**
 * @typedef {object} KitFrom
 * @property {string} from a kit checkout directory, or a git URL with an optional #ref. It may carry
 *   credentials: print it through printable (redactUrl) only.
 * @property {"--from" | "GAS_KIT" | "--remote" | "the remembered remote"} via what named the source
 * @property {string | null} remote what kit.lock.json remembers as kit.remote after a sync from this source
 */

/**
 * Where kit:sync and kit:diff take the kit from. In order: --from; the GAS_KIT environment variable
 * (a checkout directory or a git URL with an optional #ref); the git URL given with --remote; the
 * remote remembered in kit.lock.json (its default branch, or --ref).
 *
 * What is remembered afterwards: --remote when given ("none" clears it); else the URL of a --from
 * that is a shareable git URL, without its ref; else what the lock already had. A directory and
 * GAS_KIT never change it, so an app that syncs from a checkout next to it does not churn.
 *
 * The lock's kit.remote passes the same checks as --remote (a git URL over https or ssh, no #ref, no
 * credentials or query, not this machine only) whenever it is used, or this is a UsageError naming
 * --remote: a one-line lock edit must not redirect a later bare kit:sync.
 * @param {Record<string, string | boolean>} flags from, ref and remote are read
 * @param {{ kit?: { remote?: string | null } } | null} lock the app's lock, when it has one
 * @param {Record<string, string | undefined>} [env]
 * @returns {KitFrom}
 */
export function resolveFrom(flags, lock, env = process.env) {
  /** @param {string} k */
  const str = (k) => (typeof flags[k] === "string" ? /** @type {string} */ (flags[k]) : null);
  const ref = str("ref");
  if (ref !== null) {
    try {
      checkRef(ref);
    } catch (e) {
      throw new UsageError("--ref: " + /** @type {Error} */ (e).message);
    }
  }
  const remoteFlag = str("remote");
  const override = remoteFlag === null ? undefined : remoteFromFlag("--remote", remoteFlag);
  // With --remote given the lock's value is replaced, so it is neither used nor checked.
  const had = override === undefined ? lockedRemote(lock?.kit?.remote) : null;
  /** A ref from --ref goes on a git URL that names none. @param {string} what @param {string} value */
  const withRef = (what, value) => {
    if (ref === null) return value;
    if (!isGitUrl(value)) throw new UsageError("--ref does not apply to a directory: " + what + " " + printable(value) + " is used as it is on disk. Check the ref out there, or name a git URL");
    const split = splitSource(value);
    if (split.ref !== null) throw new UsageError("the ref was given twice: --ref " + ref + " and #" + printable(split.ref) + " after " + what + ". Give one of them");
    return split.url + "#" + ref;
  };
  const flagFrom = str("from");
  if (flagFrom !== null) {
    if (!flagFrom) throw new UsageError("--from needs a value");
    return { from: withRef("--from", flagFrom), via: "--from", remote: override !== undefined ? override : (shareableRemote(flagFrom) ?? had) };
  }
  const envFrom = (env["GAS_KIT"] ?? "").trim();
  if (envFrom) return { from: withRef("GAS_KIT", envFrom), via: "GAS_KIT", remote: override !== undefined ? override : had };
  if (typeof override === "string") return { from: withRef("--remote", override), via: "--remote", remote: override };
  if (had !== null) return { from: ref === null ? had : had + "#" + ref, via: "the remembered remote", remote: had };
  throw new UsageError(
    "no kit source: pass --from <kit checkout | git URL#ref>, or set GAS_KIT=<kit checkout | git URL#ref>, or remember the kit's git URL in " +
      LOCK_FILE +
      " with npm run kit:sync -- --remote <git URL> (later runs then need no flag)",
  );
}

/** " (from GAS_KIT)" when a default named the source, nothing for --from. @param {KitFrom} want */
function viaNote(want) {
  return want.via === "--from" ? "" : " (from " + want.via + ")";
}

/**
 * What a run is about to fetch, and the warnings that go with it, printed before the fetch: the URL
 * (without credentials) and the ref; a warning when a git URL is fetched with no ref (whatever its
 * default branch holds now) and when the run changes or forgets the remembered remote.
 * @param {KitFrom} want
 * @param {string | null} had the lock's kit.remote before this run
 * @returns {string[]}
 */
export function preamble(want, had) {
  /** @type {string[]} */
  const out = [];
  if (isGitUrl(want.from)) {
    // The ref is split off after the credentials are gone: a # can sit in a password.
    const { url, ref } = splitSource(want.from);
    out.push("Fetching the kit from " + printable(url) + viaNote(want) + " at " + (ref === null ? "its default branch" : (HEX_REF.test(ref) ? "commit " : "") + printable(ref)) + ".");
    if (ref === null) out.push("warning: no pinned ref, so this takes whatever the default branch holds now. Pin a release with --ref <tag | full commit>.");
  } else {
    out.push("Taking the kit from the checkout " + printable(want.from) + viaNote(want) + ".");
  }
  // had comes from kit.lock.json unchecked (a --remote replaces it): print it redacted, without control characters.
  if (had !== null && want.remote !== had) {
    out.push(want.remote ? "warning: this run changes the remembered kit remote from " + printable(had) + " to " + printable(want.remote) + "." : "warning: this run forgets the remembered kit remote " + printable(had) + ".");
  }
  return out;
}

/**
 * The warning of a kit:sync whose named ref (a branch or tag, not hex) now resolves to another commit
 * than the one the lock recorded for the same ref: a tag moved since the last sync (or since the
 * kit:diff that was reviewed), or a branch moved on. Null when the ref is a commit id, when there is no
 * ref, or when the lock recorded no full commit for that ref.
 * @param {{ kit?: { source?: unknown, commit?: unknown } } | null} lock the lock before this run
 * @param {string} from the source of this run
 * @param {string | null} commit the commit this run resolved
 * @returns {string | null}
 */
export function movedRef(lock, from, commit) {
  if (!commit || !isGitUrl(from)) return null;
  const ref = splitSource(from).ref;
  if (ref === null || HEX_REF.test(ref)) return null;
  const was = typeof lock?.kit?.source === "string" ? splitSource(lock.kit.source).ref : null;
  const before = lock?.kit?.commit;
  if (was !== ref || !isFullCommit(before) || String(before).toLowerCase() === commit.toLowerCase()) return null;
  return (
    "warning: " + printable(ref) + " now resolves to " + commit + ", but " + LOCK_FILE + " recorded " + String(before).toLowerCase() +
    " for it: the ref moved since the last sync. Check the change with kit:diff, and pin a release with --ref <full commit>."
  );
}

/**
 * @param {{ flags: Record<string, string | boolean> }} parsed
 * @param {Record<string, string | undefined>} [env]
 * @param {(line: string) => void} [say] prints a line at once (the preamble, before the fetch); without
 *   it those lines open the returned lines
 * @returns {{ lines: string[], code: number }}
 */
export function runSync(parsed, env = process.env, say) {
  const root = resolve(typeof parsed.flags["root"] === "string" ? parsed.flags["root"] : ".");
  const force = parsed.flags["force"] === true;
  if (!existsSync(join(root, "package.json"))) throw new UsageError(root + " is not an app directory (no package.json); pass --root <app dir>");
  // Before anything is read or deleted: a linked src, src/kit or lock would be written through.
  const linked = linkedPaths(root);
  if (linked.length) {
    return { code: 1, lines: ["kit:sync refused: " + linked.join(", ") + (linked.length === 1 ? " is a symbolic link" : " are symbolic links") + ", and kit:sync would delete or write outside the app through it. Replace it with a real file or directory (--force does not override this)."] };
  }
  const lock = readLock(root);
  const want = resolveFrom(parsed.flags, lock, env);
  const had = typeof lock?.kit?.remote === "string" && lock.kit.remote ? lock.kit.remote : null;
  /** @type {string[]} */
  const lines = [];
  if (existsSync(join(root, LOCK_FILE)) || existsSync(join(root, KIT_DIR))) {
    const { problems } = verifyApp(root);
    if (problems.length && !force) {
      return { code: 1, lines: ["kit:sync refused: kit:verify fails first, and a sync would overwrite those files.", ...formatProblems(problems), "Fix them, or pass --force to overwrite src/kit anyway."] };
    }
    if (problems.length) lines.push("--force: overwriting src/kit although kit:verify failed (" + problems.length + " problem" + (problems.length === 1 ? "" : "s") + ").");
  }
  for (const l of preamble(want, had)) {
    if (say) say(l);
    else lines.push(l);
  }
  const src = resolveSource(want.from, { label: want.via });
  try {
    const kitRoot = join(root, KIT_DIR);
    /** @type {Record<string, string>} */
    const before = hashFiles(Object.fromEntries(walkFiles(kitRoot, { links: [] }).map((f) => [f, join(kitRoot, f)])));
    const after = hashFiles(vendorFiles(src.dir));
    const sum = summarize(before, after);
    writeVendored(root, { ...src, remote: want.remote });
    const moved = movedRef(lock, want.from, src.commit);
    if (moved) lines.push(moved);
    lines.push("Synced src/kit from " + printable(src.source) + viaNote(want) + (src.commit ? " at " + src.commit : "") + " (kit " + printable(src.version) + ").");
    if (want.remote !== had) lines.push(want.remote ? "Kit source remembered: " + printable(want.remote) + " (kit.remote in " + LOCK_FILE + ")." : "Kit source forgotten: " + LOCK_FILE + " no longer names a remote.");
    lines.push(sum.added.length + " added, " + sum.changed.length + " changed, " + sum.removed.length + " removed, " + (Object.keys(after).length - sum.added.length - sum.changed.length) + " unchanged.");
    for (const f of sum.added) lines.push("  + " + f);
    for (const f of sum.changed) lines.push("  ~ " + f);
    for (const f of sum.removed) lines.push("  - " + f);
    return { code: 0, lines };
  } finally {
    src.cleanup();
  }
}

/**
 * @param {{ flags: Record<string, string | boolean> }} parsed
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ lines: string[], code: number }}
 */
export function runDiff(parsed, env = process.env) {
  const root = resolve(typeof parsed.flags["root"] === "string" ? parsed.flags["root"] : ".");
  if (!existsSync(join(root, KIT_DIR))) throw new UsageError(root + " has no src/kit; pass --root <app dir>");
  const want = resolveFrom(parsed.flags, readLock(root), env);
  const { lines, changed, commit } = diffAgainst(root, want.from, { label: want.via });
  // The resolved commit is part of the summary, so a reviewer can pin exactly what was shown (a tag can move).
  const source = printable(want.from) + viaNote(want) + (commit ? " at " + commit : "");
  if (!changed.length) return { code: 0, lines: ["No differences: src/kit matches " + source + "."] };
  // --exit-code: like git diff, 1 when anything differs, so a CI step can fail on it.
  const compared = want.via === "--from" && !commit ? "" : " Compared with " + source + ".";
  return { code: parsed.flags["exit-code"] === true ? 1 : 0, lines: [...lines, "", changed.length + " file" + (changed.length === 1 ? "" : "s") + " differ." + compared] };
}
