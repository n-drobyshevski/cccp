// kit:sync and kit:diff.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { UsageError } from "./args.mjs";
import { FriendlyError } from "./errors.mjs";
import { diffAgainst } from "./diff.mjs";
import { KIT_DIR, LOCK_FILE, hashFiles, parseLock, vendorFiles, walkFiles } from "./hash.mjs";
import { HEX_REF, checkRef, isFullCommit, isGitUrl, lockedRemote, originOf, printable, remoteFromFlag, resolveSource, shareableRemote, splitSource } from "./source.mjs";
import { ensureKitScripts, packageIsLink } from "./scripts.mjs";
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
 * @property {string | null | false} remote what kit.lock.json remembers as kit.remote after a sync from this
 *   source: a URL, null (none known, a later sync from a checkout may adopt one) or false (a deliberate
 *   "no remote", from --remote none, which a checkout never replaces)
 * @property {{ url: string, dir: string } | null} [adopted] set when remote was filled in from the origin
 *   of the checkout directory dir (the lock named none)
 */

/**
 * Where kit:sync and kit:diff take the kit from. In order: --from; the GAS_KIT environment variable
 * (a checkout directory or a git URL with an optional #ref); the git URL given with --remote; the
 * remote remembered in kit.lock.json (its default branch, or --ref).
 *
 * What is remembered afterwards: --remote when given ("none" records false, a deliberate "no remote");
 * else the URL of a --from that is a shareable git URL, without its ref; else what the lock already
 * had. A directory and GAS_KIT never replace it, so an app that syncs from a checkout next to it does
 * not churn. One exception fills a gap and nothing else: when the lock remembers no remote (null, "" or
 * absent, not false) and the source is a directory (--from or GAS_KIT), the run adopts
 * shareableRemote(originOf(dir)) when that is non-null, the same checks as --remote. originOf is null
 * unless the directory is the top of a checkout. The result carries adopted so the run says so.
 *
 * The lock's kit.remote passes the same checks as --remote (a git URL over https or ssh, no #ref, no
 * credentials or query, not this machine only) whenever it is used, or this is a UsageError naming
 * --remote: a one-line lock edit must not redirect a later bare kit:sync.
 * @param {Record<string, string | boolean>} flags from, ref and remote are read
 * @param {{ kit?: { remote?: string | null | false } } | null} lock the app's lock, when it has one
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
      throw new UsageError("--ref: " + /** @type {Error} */ (e).message, { title: "That ref cannot be used", why: /** @type {Error} */ (e).message, fix: "Use a name such as main or v0.2.0, for example --ref v0.2.0.", more: "npm run kit -- help ref" });
    }
  }
  const remoteFlag = str("remote");
  const override = remoteFlag === null ? undefined : remoteFromFlag("--remote", remoteFlag);
  // With --remote given the lock's value is replaced, so it is neither used nor checked.
  const had = override === undefined ? lockedRemote(lock?.kit?.remote) : null;
  // False in the lock is a deliberate "no remote": it stays false unless --remote or --from <git URL> says otherwise.
  /** @type {string | null | false} */
  const kept = had ?? (lock?.kit?.remote === false ? false : null);
  /** The remote after a run from a directory: --remote, else what the lock had, else the checkout's origin (fill only). @param {string} dir @returns {{ remote: string | null | false, adopted?: KitFrom["adopted"] }} */
  const fromDir = (dir) => {
    if (override !== undefined) return { remote: override };
    if (kept !== null) return { remote: kept };
    const url = shareableRemote(originOf(resolve(dir)));
    return url ? { remote: url, adopted: { url, dir } } : { remote: null };
  };
  /** A ref from --ref goes on a git URL that names none. @param {string} what @param {string} value */
  const withRef = (what, value) => {
    if (ref === null) return value;
    if (!isGitUrl(value)) throw new UsageError("--ref does not apply to a directory: " + what + " " + printable(value) + " is used as it is on disk. Check the ref out there, or name a git URL", { title: "--ref only works with a git address", why: printable(value) + " is a folder, so gas-kit takes it as it is on disk and there is no ref to pick.", fix: "Check the ref out in that folder, or give a git URL with --from.", more: "npm run kit -- help ref" });
    const split = splitSource(value);
    if (split.ref !== null) throw new UsageError("the ref was given twice: --ref " + ref + " and #" + printable(split.ref) + " after " + what + ". Give one of them", { title: "The ref was given twice", why: "--ref and the # after the address both name one.", fix: "Keep one of them.", more: "npm run kit -- help ref" });
    return split.url + "#" + ref;
  };
  const flagFrom = str("from");
  if (flagFrom !== null) {
    if (!flagFrom) throw new UsageError("--from needs a value", { title: "--from needs a kit address", why: "The flag was given with nothing after it.", fix: "Write --from <kit checkout | git URL>.", more: "npm run kit -- help kit" });
    const from = withRef("--from", flagFrom);
    if (!isGitUrl(flagFrom)) return { from, via: "--from", ...fromDir(flagFrom) };
    return { from, via: "--from", remote: override !== undefined ? override : (shareableRemote(flagFrom) ?? kept) };
  }
  const envFrom = (env["GAS_KIT"] ?? "").trim();
  if (envFrom) {
    const from = withRef("GAS_KIT", envFrom);
    return { from, via: "GAS_KIT", ...(isGitUrl(envFrom) ? { remote: override !== undefined ? override : kept } : fromDir(envFrom)) };
  }
  if (typeof override === "string") return { from: withRef("--remote", override), via: "--remote", remote: override };
  if (had !== null) return { from: ref === null ? had : had + "#" + ref, via: "the remembered remote", remote: had };
  const noRemote = lock?.kit?.remote === false;
  const message =
    "no kit source: pass --from <kit checkout | git URL#ref>, or set GAS_KIT=<kit checkout | git URL#ref>, or remember the kit's git URL in " +
    LOCK_FILE +
    " with npm run kit:sync -- --remote <git URL> (later runs then need no flag)" +
    (noRemote ? ". " + LOCK_FILE + " records no remote on purpose (kit.remote false); --remote <git URL> re-enables it" : "");
  throw new UsageError(message, {
    title: "Can't update the kit: no kit source",
    why: "gas-kit doesn't know where to get the kit from." + (noRemote ? " " + LOCK_FILE + " records no remote on purpose (kit.remote false); --remote <git URL> re-enables it." : ""),
    fix: ["npm run kit:sync -- --remote <git URL>   (remembered, so later runs need no flag)", "or: npm run kit:sync -- --from <kit checkout | git URL#ref>"],
    more: ["GAS_KIT=<kit checkout | git URL#ref> works too.", "npm run kit -- help remote"],
  });
}

/** " (from GAS_KIT)" when a default named the source, nothing for --from. @param {KitFrom} want */
function viaNote(want) {
  return want.via === "--from" ? "" : " (from " + want.via + ")";
}

/** The one line saying why a remote was adopted. @param {KitFrom} want */
function adoptedReason(want) {
  return want.adopted ? " (adopted from the origin of " + printable(want.adopted.dir) + ", since the lock named none)" : "";
}

/**
 * What a sync records about kit.remote, as lines (none when nothing changes).
 * @param {KitFrom} want
 * @param {string | null} had the lock's kit.remote before this run
 * @param {boolean} hadOptOut the lock already said false
 * @returns {string[]}
 */
function rememberLines(want, had, hadOptOut) {
  if (want.remote) {
    return want.remote === had ? [] : ["Kit source remembered: " + printable(want.remote) + " (kit.remote in " + LOCK_FILE + ")." + adoptedReason(want)];
  }
  if (had) return ["Kit source forgotten: " + LOCK_FILE + " no longer names a remote" + (want.remote === false ? " (kit.remote false: later syncs from a checkout will not adopt one)" : "") + "."];
  if (want.remote === false && !hadOptOut) return ["Kit source: " + LOCK_FILE + " now records no remote on purpose (kit.remote false: later syncs from a checkout will not adopt one; --remote <git URL> re-enables it)."];
  return [];
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
  if (!existsSync(join(root, "package.json"))) throw new UsageError(root + " is not an app directory (no package.json); pass --root <app dir>", { title: "This folder is not an app", why: "There is no package.json in " + printable(root) + ".", fix: "Run it from your app's folder, or pass --root <app dir>.", more: "npm run kit -- help kit" });
  // Before anything is read or deleted: a linked src, src/kit or lock would be written through.
  const linked = linkedPaths(root);
  if (linked.length) {
    return { code: 1, lines: ["kit:sync refused: " + linked.join(", ") + (linked.length === 1 ? " is a symbolic link" : " are symbolic links") + ", and kit:sync would delete or write outside the app through it. Replace it with a real file or directory (--force does not override this)."] };
  }
  if (packageIsLink(root)) return { code: 1, lines: ["kit:sync refused: package.json is a symbolic link, and kit:sync adds the kit scripts to it. Replace it with a real file (--force does not override this)."] };
  if (parsed.flags["scripts-only"] === true) {
    const r = ensureKitScripts(root);
    return { code: r.ok ? 0 : 1, lines: r.lines.length ? r.lines : ["package.json already has the kit scripts."] };
  }
  const lock = readLock(root);
  const want = resolveFrom(parsed.flags, lock, env);
  const had = typeof lock?.kit?.remote === "string" && lock.kit.remote ? lock.kit.remote : null;
  /** @type {string[]} */
  const lines = [];
  if (existsSync(join(root, LOCK_FILE)) || existsSync(join(root, KIT_DIR))) {
    const { problems } = verifyApp(root);
    if (problems.length && !force) {
      throw new FriendlyError({
        title: "kit:sync refused: src/kit does not match its lock",
        why: "A sync would overwrite those files, and kit:verify fails first.",
        fix: ["To keep your work, move it out of src/kit, then sync again.", "To discard it and restore the kit, run npm run kit:sync -- --force."],
        more: [...formatProblems(problems).map((l) => l.trim()), "npm run kit -- help lock"],
        detail: "kit:sync refused: kit:verify fails first, and a sync would overwrite those files. Fix them, or pass --force to overwrite src/kit anyway.",
        exitCode: 1,
      });
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
    lines.push(...rememberLines(want, had, lock?.kit?.remote === false));
    lines.push(sum.added.length + " added, " + sum.changed.length + " changed, " + sum.removed.length + " removed, " + (Object.keys(after).length - sum.added.length - sum.changed.length) + " unchanged.");
    for (const f of sum.added) lines.push("  + " + f);
    for (const f of sum.changed) lines.push("  ~ " + f);
    for (const f of sum.removed) lines.push("  - " + f);
    // Not in the kit repository itself (its package.json is not an app's); the site is an app and gets them.
    if (!existsSync(join(root, "packages", "cli", "src", "bin.mjs"))) lines.push(...ensureKitScripts(root).lines);
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
  if (!existsSync(join(root, KIT_DIR))) throw new UsageError(root + " has no src/kit; pass --root <app dir>", { title: "This app has no kit files yet", why: "There is no src/kit in " + printable(root) + ", so there is nothing to compare.", fix: "Run it from your app's folder, or pass --root <app dir>.", more: "npm run kit -- help kit" });
  const want = resolveFrom(parsed.flags, readLock(root), env);
  const { lines, changed, commit } = diffAgainst(root, want.from, { label: want.via });
  // kit:diff writes nothing, but says what a kit:sync from here would remember.
  const note = want.adopted ? ["kit:sync would remember " + printable(want.adopted.url) + " (kit.remote in " + LOCK_FILE + ")." + adoptedReason(want)] : [];
  // The resolved commit is part of the summary, so a reviewer can pin exactly what was shown (a tag can move).
  const source = printable(want.from) + viaNote(want) + (commit ? " at " + commit : "");
  if (!changed.length) return { code: 0, lines: ["No differences: src/kit matches " + source + ".", ...note] };
  // --exit-code: like git diff, 1 when anything differs, so a CI step can fail on it.
  const compared = want.via === "--from" && !commit ? "" : " Compared with " + source + ".";
  return { code: parsed.flags["exit-code"] === true ? 1 : 0, lines: [...lines, "", changed.length + " file" + (changed.length === 1 ? "" : "s") + " differ." + compared, ...note] };
}
