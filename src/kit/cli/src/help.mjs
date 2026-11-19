// "help" for the gas-kit CLI: the commands grouped for people who are not developers, and a short glossary
// of the words that leak through (kit, lock, remote, version and ref ...). Static text only: nothing from
// a lock, a file or the network reaches it, except the docs address, which docsUrlOf has already validated.
// Internal module (no dependencies).
import { UsageError } from "./args.mjs";
import { helpGroups } from "./commands.mjs";

/** Topic name to its lines (3 to 8, plain words). */
export const TOPICS = {
  kit: [
    "The kit is gas-kit itself: the shared code and styles every app is built from.",
    "Your app keeps its own copy in src/kit, so the app works without anything else installed.",
    "Do not edit src/kit by hand: the checks fail while it differs, and only --force overwrites it.",
    "Make changes in your own code, or in the kit, and update to get them.",
  ],
  lock: [
    "kit.lock.json is the app's record of which kit it holds: the version, where it came from, and a",
    "fingerprint of every kit file. It is why gas-kit can tell when a kit file was changed by hand.",
    "Commit it with the rest of your app. Never edit it yourself: kit:sync and update write it.",
    "npm run kit:verify checks the files against it.",
  ],
  remote: [
    "The remote is the web address (a git URL) of the kit repository your app takes new kit versions from.",
    "It is remembered in kit.lock.json, so update and kit:sync need no extra words.",
    "It must start with https:// or ssh: gas-kit refuses plain http for safety.",
    "Change it with npm run kit:sync -- --remote <git URL>.",
  ],
  version: [
    "A version is a release of the kit, named like 0.2.0 (a tag in the kit repository, vX.Y.Z).",
    "A ref is any name for a point in the kit's history: a branch, a tag, or a commit id.",
    "Releases are the safe choice: update only offers releases that are newer than yours.",
    "A branch name moves over time, so --ref with a branch can give different code tomorrow.",
  ],
  confidential: [
    "A confidential app holds data that must not leak: personal or business records, say.",
    "It admits listed people only, asks for the owner PIN, keeps data out of the page,",
    "limits exports to admins and keeps an audit sheet.",
    "Choose it when you create the app (--confidential); when unsure, say yes.",
  ],
  access: [
    "Access decides who may open the app once it is online.",
    "list: only the people on the access list. org: everyone in your Google organisation.",
    "A confidential app always uses a list.",
    "Set it when you create the app (--access list or --access org).",
  ],
  link: [
    "Linking connects this app to one Apps Script project on script.google.com.",
    "It saves the project's id in .clasp.json, so putting the app online knows where to send it.",
    "You paste the project's web address; gas-kit pulls the id out.",
    "Run npm run kit -- link, or use Connect to Google in the menu.",
  ],
  update: [
    "Update brings a newer kit version into your app, step by step.",
    "It shows what changes for your app first, and needs your work saved in git (a clean src/kit).",
    "It then replaces src/kit, checks it against the release and runs npm run check.",
    "If a release makes the kit's own checks looser (a longer allow list), it stops and shows what grew; read it, then add --accept-looser.",
    "To undo it: git checkout -- src/kit kit.lock.json.",
    "Run npm run kit -- update.",
  ],
};

/** Other names a topic is asked for by. */
export const ALIASES = { ref: "version", versions: "version", release: "version", "kit.lock.json": "lock", "kit.lock": "lock", "kit-address": "remote", address: "remote", url: "remote" };

/** The commands, grouped: rendered from the command table (commands.mjs). */
const GROUPS = helpGroups();

/**
 * The lines of "help": commands grouped, then the topics, then "Docs: <url>" when there is a docs address.
 * @param {string | null} [docsUrl] an address docsUrlOf returned (validated), else nothing is added
 */
export function overview(docsUrl = null) {
  /** @type {string[]} */
  const lines = ["gas-kit: start with npm run kit (a menu); every command also works with flags.", ""];
  for (const [name, rows] of GROUPS) {
    lines.push(name + ":");
    for (const [cmd, what] of rows) lines.push("  " + cmd.padEnd(13) + what);
    lines.push("");
  }
  lines.push("Words explained: npm run kit -- help <topic>", "  " + Object.keys(TOPICS).join(", "), "");
  if (docsUrl) lines.push("Docs: " + docsUrl, "");
  lines.push("Every flag:");
  return lines;
}

/**
 * The lines of "help <topic>"; a UsageError that lists the topics when there is no such topic.
 * @param {string} name
 * @returns {string[]}
 */
export function topicLines(name) {
  const key = /** @type {Record<string, string>} */ (ALIASES)[name.toLowerCase()] ?? name.toLowerCase();
  const lines = /** @type {Record<string, string[]>} */ (TOPICS)[key];
  if (!Object.hasOwn(TOPICS, key) || !lines) {
    throw new UsageError("unknown help topic " + JSON.stringify(name), {
      title: "There is no help topic " + JSON.stringify(name.replace(/[\u0000-\u001f\u007f-\u009f]/g, "?")),
      why: "The topics are: " + Object.keys(TOPICS).join(", ") + ".",
      fix: "npm run kit -- help <topic>",
      more: "npm run kit -- help   (lists the commands too)",
    });
  }
  return [key + ":", ...lines.map((l) => "  " + l)];
}
