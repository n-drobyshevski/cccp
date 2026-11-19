// The app's kit scripts in package.json: one table used by create (placeholders.mjs), by kit:sync (which adds
// what an app that adopted the kit in place, or was made before the menu existed, lacks) and by doctor.
// Nothing here fetches or deletes anything. A script that already has another value is never overwritten.
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The scripts every gas-kit app has, in the order they are written. */
export const KIT_SCRIPTS = Object.freeze({
  kit: "node src/kit/cli/src/bin.mjs",
  "kit:verify": "node src/kit/cli/src/bin.mjs kit:verify",
  "kit:sync": "node src/kit/cli/src/bin.mjs kit:sync",
  "kit:diff": "node src/kit/cli/src/bin.mjs kit:diff",
});

/** What a person types to run the ensure step, also when the kit script itself is missing. */
export const ENSURE_COMMAND = "node src/kit/cli/src/bin.mjs kit:sync --scripts-only";

const VERIFY_STEP = " && npm run kit:verify";

/**
 * Which kit scripts a package object lacks or has with another value.
 * @param {unknown} pkg a parsed package.json
 * @returns {{ missing: string[], different: { name: string, have: string, want: string }[], checkLacksVerify: boolean }}
 */
export function planScripts(pkg) {
  const scripts = pkg && typeof pkg === "object" && /** @type {any} */ (pkg).scripts && typeof /** @type {any} */ (pkg).scripts === "object" ? /** @type {Record<string, unknown>} */ (/** @type {any} */ (pkg).scripts) : {};
  /** @type {string[]} */
  const missing = [];
  /** @type {{ name: string, have: string, want: string }[]} */
  const different = [];
  for (const [name, want] of Object.entries(KIT_SCRIPTS)) {
    const have = scripts[name];
    if (have === undefined) missing.push(name);
    else if (have !== want) different.push({ name, have: String(have), want });
  }
  const check = scripts["check"];
  return { missing, different, checkLacksVerify: typeof check === "string" && !/kit:verify/.test(check) };
}

/**
 * Add the kit scripts to a package object (in place) and, when check exists without kit:verify, append it.
 * A script with another value is left alone. This is create's rewrite too.
 * @param {Record<string, any>} pkg
 * @returns {{ added: string[], checkChanged: boolean }}
 */
export function applyScripts(pkg, { touchCheck = true } = {}) {
  const plan = planScripts(pkg);
  if (plan.missing.length && (typeof pkg.scripts !== "object" || pkg.scripts === null)) pkg.scripts = {};
  for (const name of plan.missing) pkg.scripts[name] = /** @type {Record<string, string>} */ (KIT_SCRIPTS)[name];
  const checkChanged = touchCheck && plan.checkLacksVerify;
  if (checkChanged) pkg.scripts.check += VERIFY_STEP;
  return { added: plan.missing, checkChanged };
}

/** True when package.json in root is a symbolic link (the kit never writes through one). @param {string} root */
export function packageIsLink(root) {
  try {
    return lstatSync(join(root, "package.json")).isSymbolicLink();
  } catch {
    return false;
  }
}

/** The indent of a JSON text: a tab, or the spaces of its first indented line (2 when there is none). @param {string} text */
export function indentOf(text) {
  const m = /^([ \t]+)\S/m.exec(text);
  return m ? (m[1] ?? "  ").startsWith("\t") ? "\t" : (m[1] ?? "  ") : "  ";
}

/**
 * Make the app's package.json carry the kit scripts. Adds what is missing, keeps what is equal, only reports
 * what differs, and appends kit:verify to an existing check script that lacks it. Keeps key order and indent.
 * Never writes through a symbolic link. Returns lines to print; ok is false when nothing could be done.
 * @param {string} root the app root
 * @returns {{ ok: boolean, lines: string[] }}
 */
export function ensureKitScripts(root) {
  if (packageIsLink(root)) return { ok: false, lines: ["package.json is a symbolic link, so the kit scripts were not added (the kit does not write through links). Replace it with a real file, then run npm run kit:sync again."] };
  const file = join(root, "package.json");
  let text;
  /** @type {Record<string, any>} */
  let pkg;
  try {
    text = readFileSync(file, "utf8");
    pkg = JSON.parse(text);
    if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) throw new Error("not an object");
  } catch (e) {
    return { ok: false, lines: ["package.json could not be read as JSON (" + /** @type {Error} */ (e).message + "), so the kit scripts were not added."] };
  }
  const plan = planScripts(pkg);
  /** @type {string[]} */
  const lines = [];
  for (const d of plan.different) lines.push("note: package.json script " + d.name + " is " + JSON.stringify(d.have) + ", not left changed; the kit expects " + JSON.stringify(d.want) + ". Edit it by hand if you want the menu and the checks to work.");
  const { added, checkChanged } = applyScripts(pkg);
  if (added.length || checkChanged) {
    writeFileSync(file, JSON.stringify(pkg, null, indentOf(text)) + (text.endsWith("\n") ? "\n" : ""));
    if (added.length) lines.unshift("package.json: added the kit script" + (added.length === 1 ? "" : "s") + " " + added.join(", ") + ".");
    if (checkChanged) lines.push("package.json: appended \"" + VERIFY_STEP.slice(4) + "\" to the check script, so npm run check also proves src/kit is untouched.");
  }
  return { ok: true, lines };
}
