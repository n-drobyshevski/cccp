// The gas-kit CLI's commands as one table: each command's name, group, one-line summary, positional
// arguments and flags (a value hint and one line each), the lines of its usage text, and the exit codes
// and environment variables the CLI reads. args.mjs builds COMMAND_SPECS (the parser's specs) from it,
// bin.mjs renders USAGE from it, help.mjs renders its groups from it, and the docs site generates the
// CLI reference page from it, so the four cannot drift. Static data only; internal module (no dependencies).

/**
 * @typedef {object} CommandFlag
 * @property {string} name the flag without its dashes
 * @property {string} [hint] the value it takes ("<app dir>", "list|org"); no hint means an on or off switch
 * @property {boolean} [negatable] also accepts --no-<name> (drawn as [--name | --no-name])
 * @property {boolean} [required] drawn without brackets: the command needs it
 * @property {string} desc one line, plain words
 */

/**
 * @typedef {object} Positional
 * @property {string} name as drawn between angle brackets
 * @property {boolean} [optional] drawn as [<name>]
 * @property {string} desc one line
 */

/**
 * @typedef {object} Command
 * @property {string} name what is typed after npm run kit --
 * @property {"Everyday" | "Advanced" | "Migrate"} group
 * @property {string} summary one line, lower case, no full stop (help's text for it)
 * @property {Positional[]} positionals
 * @property {CommandFlag[]} flags
 * @property {string} [inherits] another command whose flags this one also takes (listed in its usage as [init flags])
 * @property {string[]} synopsis the usage lines that show the call: {flag} is the flag's token, {flag:hint} the token with a shorter hint
 * @property {string[]} notes the usage lines under it, verbatim
 */

const APP_DIR = "<app dir>";

/** --root, the app folder a command works in. @param {string} [hint] @returns {CommandFlag} */
const root = (hint = APP_DIR) => ({ name: "root", hint, desc: "the folder to work in (default: the current one)" });

/** The create flags migrate:init passes on to create. @type {CommandFlag[]} */
const CREATE_PASSED = [
  { name: "name", hint: "<slug>", desc: "the app's short name, lower case with dashes" },
  { name: "product", hint: "<name>", desc: "the name people see in the header" },
  { name: "prefix", hint: "<prefix.>", desc: "the start of every localStorage key, ending in a dot" },
  { name: "accent", hint: "<#hex>", desc: "the main colour, #rrggbb" },
  { name: "access", hint: "list|org", desc: "who may open the app: the people on a list, or everyone in the organisation" },
  { name: "tz", hint: "<IANA>", desc: "the time zone, for example UTC or Europe/Berlin" },
  { name: "confidential", desc: "the app holds confidential data (list access, owner PIN, no data in the page, admin-only exports, an audit sheet)" },
  { name: "e2e", negatable: true, desc: "add the browser tests, or leave them out" },
  { name: "git", desc: "make the new folder a git repository with a first commit" },
  { name: "kit-remote", hint: "<git URL> | none", desc: "the kit repository teammates fetch from, remembered in kit.lock.json (none: no remote, on purpose)" },
];
const passed = (/** @type {string} */ n) => /** @type {CommandFlag} */ (CREATE_PASSED.find((f) => f.name === n));

/** Every command, in the order of the usage text. @type {Command[]} */
export const COMMANDS = [
  {
    name: "create",
    group: "Advanced",
    summary: "make a new app (flags skip the questions)",
    positionals: [{ name: "dir", optional: true, desc: "the folder for the new app (asked for on a terminal)" }],
    flags: [
      { name: "yes", desc: "ask nothing: take the flags and the defaults" },
      passed("name"),
      passed("product"),
      passed("prefix"),
      passed("accent"),
      passed("access"),
      passed("confidential"),
      { name: "source", hint: "none|sheet", desc: "where the data comes from: nothing yet, or a Google Sheet" },
      passed("tz"),
      passed("e2e"),
      passed("git"),
      passed("kit-remote"),
      { name: "force", desc: "write into a folder that is not empty" },
    ],
    synopsis: [
      "  create [<dir>] {yes} {name} {product} {prefix} {accent}",
      "               {access} {confidential} {source} {tz} {e2e}",
      "               {git} {kit-remote} {force}",
    ],
    notes: [
      "      with no --yes, on a terminal, create asks in plain words for what no flag gave (a <dir> is then optional),",
      "      shows a summary and writes nothing until you confirm; a flag always wins over its question",
      "      --confidential: the app holds confidential data (dataClass confidential: list access only, the",
      "                      owner pin required, no data in the page, admin-only exports, an audit sheet).",
      "                      Without it the question asks (default no); --yes keeps internal",
      "      --kit-remote: the kit repository teammates fetch from, remembered in kit.lock.json",
      "                    (default: the origin of the kit clone this runs from, when others can reach it)",
    ],
  },
  {
    name: "doctor",
    group: "Everyday",
    summary: "check that this computer and app are ready",
    positionals: [],
    flags: [
      root(),
      { name: "json", desc: "print the report for a machine: { version, ok, summary, checks }" },
      { name: "offline", desc: "do not look for a newer kit" },
      { name: "yes", desc: "only report: do not offer to run the fixes" },
    ],
    synopsis: ["  doctor {root} {json} {offline} {yes}"],
    notes: [
      "      checks Node, git, the app's tools, the kit files, the kit remote, a newer kit, the Google sign-in and",
      "      the linked Apps Script project; one row each, the fix under every problem, exit 1 when one fails.",
      "      --json: the report for a machine ({ version, ok, summary, checks }); --offline: do not look for a newer kit",
      "      on a terminal (no --yes) it offers to run the fixes (npm install, clasp login, link), asking before each one",
    ],
  },
  {
    name: "link",
    group: "Everyday",
    summary: "connect the app to an Apps Script project",
    positionals: [],
    flags: [
      { name: "script", hint: "<project address | id>", desc: "the project's editor address or its bare id; then nothing is asked" },
      { name: "force", desc: "replace a different script id already in .clasp.json" },
      root(),
      { name: "yes", desc: "ask nothing (then --script is needed)" },
    ],
    synopsis: ["  link {script} {force} {root} {yes}"],
    notes: [
      "      connects the app to an Apps Script project: writes the script id into .clasp.json (other keys kept).",
      "      on a terminal it checks the Google sign-in, offers to open script.google.com/create and asks you to paste",
      "      the project's web address; with --script (an editor address or the bare id) it asks nothing.",
      "      --force: replace a different script id already in .clasp.json (without it a terminal asks, a pipe refuses)",
    ],
  },
  {
    name: "update",
    group: "Everyday",
    summary: "bring in a newer kit version, step by step",
    positionals: [],
    flags: [
      { name: "to", hint: "<version>", desc: "apply this release and ask nothing" },
      { name: "from", hint: "<git URL>", desc: "take the releases from this kit repository instead of the remembered one" },
      root(),
      { name: "yes", desc: "ask nothing: with no --to, only list the newer versions" },
      { name: "accept-looser", desc: "go ahead with a release that makes the kit's checks looser (a longer allow list), once you have read it" },
    ],
    synopsis: ["  update {to} {from} {root} {yes} {accept-looser}"],
    notes: [
      "      lists the release versions (tags vX.Y.Z or X.Y.Z) of the kit remote remembered in kit.lock.json that are newer",
      "      than your kit, shows what changes for your app (from the kit's CHANGELOG.md) and which template files to review,",
      "      then updates: needs a clean git tree for src/kit and kit.lock.json, syncs the commit it showed, checks it",
      "      against the remote and runs npm run check. Undo: git checkout -- src/kit kit.lock.json",
      "      on a terminal it asks which version and whether to update; --to <version> asks nothing and applies that release;",
      "      with no terminal, or --yes, and no --to it only lists the versions and changes nothing;",
      "      a release that makes the kit's checks looser (a longer allow list) stops until you read it and add --accept-looser",
    ],
  },
  {
    name: "ui",
    group: "Everyday",
    summary: "the same in your browser",
    positionals: [],
    flags: [
      root(),
      { name: "port", hint: "<number>", desc: "a fixed port (default: a free one; in Cloud Shell 8080, else 8081 to 8084)" },
      { name: "no-open", desc: "only print the address, do not open a browser" },
      { name: "no-web-preview", desc: "in Cloud Shell, local addresses only (no Web Preview address)" },
    ],
    synopsis: ["  ui {root} {port} {no-open} {no-web-preview}"],
    notes: [
      "      opens a control panel in your browser: the same checks as doctor, and buttons for check, preview, put online,",
      "      connect to Google and update. It listens on 127.0.0.1 only, prints an address with a secret token and stops on",
      "      Ctrl-C or after 30 minutes unused. --port: a fixed port (default: a free one); --no-open: only print the address",
      "      in Cloud Shell it takes port 8080 (else 8081 to 8084), also answers to that port's Web Preview address and",
      "      prints the preview link; --no-web-preview: local addresses only",
    ],
  },
  {
    name: "kit:verify",
    group: "Advanced",
    summary: "check that the kit files were not edited",
    positionals: [],
    flags: [
      root(),
      { name: "upstream", desc: "also fetch kit.remote at the locked commit and fail on any difference (run it in CI)" },
    ],
    synopsis: ["  kit:verify {root} {upstream}"],
    notes: [
      "      --upstream: also fetch kit.remote at the full kit.commit and fail on any difference from src/kit",
      "                  or from the lock's hashes (run it in CI: the lock alone cannot vouch for itself)",
    ],
  },
  {
    name: "kit:sync",
    group: "Advanced",
    summary: "take the kit from a source, no questions",
    positionals: [],
    flags: [
      { name: "from", hint: "<kit checkout | git URL#ref>", desc: "the kit to take (default: GAS_KIT, else the remote in kit.lock.json)" },
      { name: "ref", hint: "<branch | tag | commit>", desc: "the point in the kit's history to take; 7 to 64 hex digits is always a commit" },
      { name: "remote", hint: "<git URL> | none", desc: "remember this git URL in kit.lock.json (none: no remote, on purpose)" },
      root(),
      { name: "force", desc: "overwrite kit files that were edited by hand" },
      { name: "scripts-only", desc: "only add the missing kit scripts to package.json: fetch and change no kit files" },
    ],
    synopsis: ["  kit:sync {from} {ref}", "           {remote} {root} {force} {scripts-only}"],
    notes: [
      "      after a sync, package.json gets any missing kit, kit:verify, kit:sync and kit:diff script (one with another",
      "      value is never changed: it is reported) and a check script without kit:verify gets \" && npm run kit:verify\"",
    ],
  },
  {
    name: "kit:diff",
    group: "Advanced",
    summary: "show what a newer kit would change",
    positionals: [],
    flags: [
      { name: "from", hint: "<kit checkout | git URL#ref>", desc: "the kit to compare with (default: GAS_KIT, else the remote in kit.lock.json)" },
      { name: "ref", hint: "<branch | tag | commit>", desc: "the point in the kit's history to compare with" },
      root(),
      { name: "exit-code", desc: "exit 1 when anything differs, as git diff does" },
    ],
    synopsis: ["  kit:diff {from} {ref} {root} {exit-code}"],
    notes: [
      "      --exit-code: exit 1 when anything differs (as git diff does)",
      "      the kit source, first that applies: --from; the GAS_KIT environment variable (a kit checkout or",
      "      a git URL#ref); the git URL remembered in kit.lock.json (its default branch, or --ref)",
      "      --remote: remember this git URL in kit.lock.json (none records that there is no remote, on purpose)",
      "                and, with no --from or GAS_KIT, sync from it; --from <git URL> remembers that URL too; a",
      "                directory or GAS_KIT never replaces a remembered remote, but fills one in when the lock",
      "                has none and the directory is the top of a checkout with a shareable origin (kit:diff",
      "                says what a sync would remember)",
      "      --ref: a branch, a tag, or a commit (7 to 64 hex digits, always a commit, never a branch name);",
      "             git URLs are fetched over https or ssh (a file: URL only as --from or GAS_KIT)",
    ],
  },
  {
    name: "migrate:doctor",
    group: "Migrate",
    summary: "read-only checks of a source app before a migration",
    positionals: [{ name: "source", desc: "the folder of the existing Apps Script app" }],
    flags: [{ name: "shared", hint: "<dir,dir>", desc: "folders of shared code the source uses, comma separated" }],
    synopsis: ["  migrate:doctor <source> {shared}"],
    notes: ["      read-only: Node, the git state, the clasp and manifest shapes, and a score per source profile"],
  },
  {
    name: "migrate:init",
    group: "Migrate",
    summary: "scaffold the target from the source's settings and write .migrate/",
    positionals: [
      { name: "source", desc: "the folder of the existing Apps Script app" },
      { name: "target", desc: "the folder of the new app" },
    ],
    flags: [
      { name: "fidelity", hint: "preserve|reskin", required: true, desc: "preserve keeps the app's CSS and class names; reskin moves it onto kit components and tokens" },
      { name: "profile", hint: "auto|kit-shaped|el-builder|classic", desc: "the kind of source app (default: auto, the best score)" },
      { name: "shared", hint: "<dir,dir>", desc: "folders of shared code the source uses, comma separated" },
      passed("name"),
      passed("product"),
      passed("prefix"),
      passed("accent"),
      passed("access"),
      passed("tz"),
      passed("confidential"),
      passed("e2e"),
      { name: "git", desc: "make the target a git repository and commit the scaffold and .migrate (apply --commit needs one)" },
      passed("kit-remote"),
      { name: "shell", hint: "kit|bare", desc: "the page frame: the kit's sidebar and header, or a bare skeleton (default: bare for preserve, kit for reskin)" },
      { name: "yes", desc: "accepted for scripts; a migration never asks" },
    ],
    synopsis: [
      "  migrate:init <source> <target> {fidelity} {profile}",
      "               {shared} {name:..} {product:..} {prefix:..} {accent:..} {access}",
      "               {tz:..} {confidential} {e2e} {git} {kit-remote:..} {yes}",
    ],
    notes: [
      "      scaffolds <target> with the source's settings (access list unless --access), then writes .migrate/",
      "      --confidential: the person says the app holds confidential data (create's data class; never guessed)",
      "      --git: make the target a git repository and commit the scaffold and .migrate (apply --commit needs one)",
      "      --shell kit|bare: bare (the default for preserve) draws a bare page skeleton instead of the kit's sidebar and header; kit is the default for reskin",
      "      --fidelity is the person's choice: preserve keeps the app's CSS and class names (pixel diff),",
      "                 reskin moves it onto kit components and tokens (aria snapshots and keyboard specs)",
    ],
  },
  {
    name: "migrate:inventory",
    group: "Migrate",
    summary: "re-scan the source",
    positionals: [],
    flags: [
      root("<target>"),
      { name: "shared", hint: "<dir,dir>", desc: "folders of shared code the source uses, comma separated" },
      { name: "profile", hint: "auto|kit-shaped|el-builder|classic", desc: "the kind of source app" },
    ],
    synopsis: ["  migrate:inventory {root} {shared} {profile:..}    re-scan the source"],
    notes: [],
  },
  {
    name: "migrate:plan",
    group: "Migrate",
    summary: "re-plan; done and skipped steps and edited maps are kept",
    positionals: [],
    flags: [root("<target>"), { name: "shell", hint: "kit|bare", desc: "the page frame: the kit's sidebar and header, or a bare skeleton" }],
    synopsis: ["  migrate:plan {root} {shell}    re-plan; done and skipped steps and edited maps are kept"],
    notes: [],
  },
  {
    name: "migrate:apply",
    group: "Migrate",
    summary: "run the pending tool steps",
    positionals: [],
    flags: [
      root("<target>"),
      { name: "step", hint: "<id>", desc: "run this step only" },
      { name: "dry-run", desc: "show what would change, write nothing" },
      { name: "force", desc: "overwrite outputs edited since a step wrote them" },
      { name: "commit", desc: "make one commit per step (migrate <id>: <title>)" },
    ],
    synopsis: ["  migrate:apply {root} {step} {dry-run} {force} {commit}"],
    notes: [
      "      runs the pending tool steps; --force overwrites outputs edited since a step wrote them;",
      "      --commit makes one commit per step (migrate <id>: <title>)",
    ],
  },
  {
    name: "migrate:done",
    group: "Migrate",
    summary: "run an agent step's verify entries, then mark it done",
    positionals: [{ name: "step id", desc: "the agent step to mark done" }],
    flags: [root("<target>")],
    synopsis: ["  migrate:done <step id> {root}    runs an agent step's verify entries, then marks it done"],
    notes: [],
  },
  {
    name: "migrate:status",
    group: "Migrate",
    summary: "write .migrate/report.md",
    positionals: [],
    flags: [
      root("<target>"),
      { name: "json", desc: "print the status for a machine" },
      { name: "exit-code", desc: "exit 3 while any step is open" },
    ],
    synopsis: ["  migrate:status {root} {json} {exit-code}    writes .migrate/report.md"],
    notes: ["      --exit-code: exit 3 while any step is open"],
  },
  {
    name: "migrate:serve",
    group: "Migrate",
    summary: "serve the source read-only and offline, as the visual baseline",
    positionals: [{ name: "source", desc: "the folder of the existing Apps Script app" }],
    flags: [
      { name: "harness", hint: "<file>", required: true, desc: "the page that loads the source" },
      { name: "shared", hint: "<dir,dir>", desc: "folders of shared code the source uses, comma separated" },
      { name: "port", hint: "<n>", desc: "a fixed port" },
    ],
    synopsis: ["  migrate:serve <source> {harness} {shared} {port}"],
    notes: ["      serves the source read-only and offline, as the visual baseline"],
  },
  {
    name: "migrate",
    group: "Migrate",
    summary: "init, then apply, then status",
    positionals: [
      { name: "source", desc: "the folder of the existing Apps Script app" },
      { name: "target", desc: "the folder of the new app" },
    ],
    inherits: "migrate:init",
    flags: [
      { name: "commit", desc: "make one commit per step" },
      { name: "exit-code", desc: "exit 3 while any step is open" },
    ],
    synopsis: ["  migrate <source> <target> {fidelity} [init flags] {commit} {exit-code}"],
    notes: ["      init, then apply, then status"],
  },
];

/** The flags help shows for every command; they go before or after it. @type {CommandFlag[]} */
export const GLOBAL_FLAGS = [
  { name: "verbose", desc: "show the technical detail of an error" },
  { name: "plain", desc: "no colour, no animation (NO_COLOR and --no-color switch colour off too)" },
  { name: "no-color", desc: "no colour; shapes and words still carry every status" },
];

/** help's first row: the menu, which has no name to type. */
export const MENU_ROW = { label: "(no command)", summary: "the menu: what to do next" };

/** The groups help shows, and its order inside them (the table's order is the usage text's). */
export const HELP_GROUPS = /** @type {const} */ (["Everyday", "Advanced"]);
export const HELP_ORDER = ["doctor", "link", "update", "ui", "kit:verify", "kit:diff", "kit:sync", "create"];

/** What each exit code means. */
export const EXIT_CODES = [
  { code: 0, meaning: "done; also help, and Esc on the home menu" },
  { code: 1, meaning: "something failed: a doctor check, a kit:verify problem, a refused sync, or kit:diff --exit-code found a difference" },
  { code: 2, meaning: "the command was not understood: an unknown command, flag or help topic, or no command when there is no terminal (the usage is printed)" },
  { code: 3, meaning: "a migration step is still open (migrate:status --exit-code, or migrate --exit-code)" },
  { code: 130, meaning: "cancelled with Ctrl-C or Esc; nothing was changed" },
];

/** The environment variables the CLI reads, and what each does. */
export const ENV_VARS = [
  { name: "GAS_KIT", meaning: "a kit checkout or a git URL#ref that kit:sync, kit:diff and update take when --from is not given" },
  { name: "GAS_KIT_DOCS_URL", meaning: "the docs site address for help's Docs: line, the menu and the panel; it wins over docsUrl in app.config.mjs. Only an https script.google.com address is shown" },
  { name: "CI", meaning: "set (and not 0 or false): never ask, print the technical detail of an error, and doctor fails while clasp is not signed in" },
  { name: "NO_COLOR", meaning: "set: no colour, as --no-color" },
  { name: "TERM", meaning: "dumb: no questions, no colour, no animation" },
  { name: "COLORTERM", meaning: "truecolor or 24bit: the app's own accent colour is drawn in the menu" },
  { name: "CLOUD_SHELL", meaning: "set by Cloud Shell: the panel takes port 8080 (else 8081 to 8084) and answers its Web Preview address, and Google sign-in gives a link to open elsewhere" },
  { name: "WEB_HOST", meaning: "set by Cloud Shell: the host name the panel's Web Preview link is built on" },
  { name: "SSH_CONNECTION", meaning: "set (over ssh) with neither DISPLAY nor WAYLAND_DISPLAY: Google sign-in gives a link to open elsewhere and no browser is opened" },
  { name: "INIT_CWD", meaning: "set by npm: the folder npm run started in, where create puts a relative app folder" },
  { name: "GIT_*", meaning: "GIT_DIR, GIT_WORK_TREE, GIT_CONFIG_* and the like are dropped for every git command the CLI runs, so git cannot be pointed at another repository; GIT_TERMINAL_PROMPT=0 and GIT_ALLOW_PROTOCOL are set instead" },
];

/** A command by name. @param {string} name @returns {Command | undefined} */
export function commandOf(name) {
  return COMMANDS.find((c) => c.name === name);
}

/** A command's flags, the inherited ones first. @param {Command} cmd @returns {CommandFlag[]} */
export function flagsOf(cmd) {
  const base = cmd.inherits ? commandOf(cmd.inherits) : undefined;
  return [...(base ? flagsOf(base) : []), ...cmd.flags];
}

/** How a flag is drawn in the usage text. @param {CommandFlag} f @param {string} [hint] a shorter hint */
export function flagToken(f, hint = f.hint) {
  const body = f.negatable ? "--" + f.name + " | --no-" + f.name : "--" + f.name + (hint ? " " + hint : "");
  return f.required ? body : "[" + body + "]";
}

/** A command's usage lines: the synopsis with its flag tokens filled in, then the notes. @param {Command} cmd @returns {string[]} */
export function commandUsage(cmd) {
  const flags = flagsOf(cmd);
  const fill = (/** @type {string} */ line) =>
    line.replace(/\{([a-z0-9-]+)(?::([^}]*))?\}/g, (_m, name, hint) => {
      const f = flags.find((x) => x.name === name);
      if (!f) throw new Error("commands.mjs: " + cmd.name + " has no flag " + name);
      return flagToken(f, hint ?? f.hint);
    });
  return [...cmd.synopsis.map(fill), ...cmd.notes];
}

/**
 * The whole usage text, as bin.mjs prints it.
 * @param {string[]} topics the help topics, in order
 * @returns {string[]}
 */
export function usageLines(topics) {
  return [
    "usage: gas-kit " + GLOBAL_FLAGS.map((f) => flagToken(f)).join(" ") + " <command>",
    "  (no command, on a terminal: opens a menu of what to do next; npm run kit in an app and in the kit repository)",
    "  help [<topic>]  the commands grouped (" + HELP_GROUPS.join(", ") + "), or a few plain lines on a word: " + topics.join(", "),
    ...GLOBAL_FLAGS.map((f) => "  " + ("--" + f.name).padEnd(12) + f.desc),
    "  (the global flags go before or after the command; Ctrl-C or Esc cancels with exit code 130; Esc on the home menu just quits with 0)",
    ...COMMANDS.flatMap(commandUsage),
  ];
}

/**
 * The commands help shows, grouped, the menu first.
 * @returns {Array<[string, Array<[string, string]>]>}
 */
export function helpGroups() {
  return HELP_GROUPS.map((g) => {
    /** @type {Array<[string, string]>} */
    const rows = g === "Everyday" ? [[MENU_ROW.label, MENU_ROW.summary]] : [];
    for (const name of HELP_ORDER) {
      const c = commandOf(name);
      if (c && c.group === g) rows.push([c.name, c.summary]);
    }
    return /** @type {[string, Array<[string, string]>]} */ ([g, rows]);
  });
}
