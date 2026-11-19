// What a migration maps onto the kit: per profile, which source modules are the kit's own (the
// module map), which old CSS custom properties are the kit's tokens (the token map), and whether a
// source module's exports fit the kit module it would be replaced by. Also the small helpers the
// profile files share to describe a step. The kit's file names are read from the kit checkout that
// runs the CLI; a specifier is checked before it becomes a path.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { scanJs } from "./scan/js.mjs";

/** @typedef {"kit-shaped"|"el-builder"|"classic"} ProfileName */

/** The kit's browser modules a source's lib/<x>.js may map onto (each is packages/client/src/<x>.js). */
export const KIT_CLIENT_MODULES = [
  "clipboard", "codec", "csv", "dom", "download", "format", "html", "icons", "islands", "motion", "router",
  "rpc", "splash", "storage", "store", "swr", "tabKeys", "theme", "timing", "tip", "tipPlace", "url", "xlsx", "zip",
];

/**
 * A kit-shaped app's server module (basename) to the kit server file that covers it
 * (packages/server/src/<x>.ts). The specifier a rewritten import uses is the barrel, which is how
 * the template imports the server kernel.
 * @type {Record<string, string>}
 */
export const SERVER_FILE_FOR = {
  props: "props",
  locks: "lock",
  lock: "lock",
  pageShell: "page",
  errors: "envelope",
  envelope: "envelope",
  inlineBoot: "boot",
  errorLog: "errorLog",
  buildInfo: "buildInfo",
  snapshotCodec: "codec",
};

/** The specifier of the server kernel, as the template imports it. */
export const SERVER_SPECIFIER = "@gas-kit/server";

/**
 * Source module patterns (relative paths, a "@<shared>/" prefix for a shared root) to the kit
 * specifier that replaces them.
 * @param {ProfileName | string} profile
 * @returns {Record<string, string>}
 */
export function moduleMap(profile) {
  /** @type {Record<string, string>} */
  const m = {};
  if (profile === "kit-shaped") {
    for (const x of KIT_CLIENT_MODULES) m["src/client/lib/" + x + ".js"] = "@gas-kit/client/" + x + ".js";
    for (const x of Object.keys(SERVER_FILE_FOR)) m["src/server/" + x + ".ts"] = SERVER_SPECIFIER;
  } else if (profile === "el-builder") {
    m["@shared/api.js"] = "@gas-kit/client/rpc.js";
    // the shared store is a stale-while-revalidate cache with a boot payload: the kit's swr (and its
    // store for the boot answer), never the router
    m["@shared/store.js"] = "@gas-kit/client/swr.js";
    m["@shared/ui/dom.js"] = "@gas-kit/client/dom.js";
  }
  return m;
}

/**
 * Old custom property to the kit token that stands in for it. Only names that exist in
 * tokens.base.css. Classic apps have literals, not variables: the tokens step lifts them.
 * @param {ProfileName | string} profile
 * @returns {Record<string, string>}
 */
export function tokenMap(profile) {
  if (profile === "kit-shaped") {
    return {
      "--bg": "--bg",
      "--surface": "--surface",
      "--surface2": "--surface-2",
      "--line": "--border",
      "--line2": "--border-strong",
      "--fg": "--text",
      "--muted": "--text-muted",
      "--accent": "--accent",
      "--on-accent": "--accent-ink",
      "--ok": "--ok-fg",
      "--warn": "--warn-fg",
      "--bad": "--bad-fg",
      "--sans": "--font-sans",
      "--mono": "--font-mono",
      "--r": "--radius",
      "--rc": "--card-radius",
      "--shadow": "--shadow-sm",
    };
  }
  if (profile === "el-builder") {
    return {
      "--ink": "--text",
      "--text-2": "--text-muted",
      "--text-3": "--text-muted",
      "--page": "--bg",
      "--surface": "--surface",
      "--surface-2": "--surface-2",
      "--hairline": "--border",
      "--hairline-strong": "--border-strong",
      "--font": "--font-sans",
      "--font-mono": "--font-mono",
      "--sev-high": "--bad-fg",
      "--sev-low": "--ok-fg",
      "--accent": "--accent",
      "--accent-text": "--accent-ink",
      "--on-accent": "--accent-ink",
    };
  }
  return {};
}

const SPEC = /^@gas-kit\/(client|server|ui)((?:\/[A-Za-z0-9_.-]+)*)$/;

/**
 * The kit file a specifier names: a client or ui module by its path, the server barrel by
 * index.ts, a server module by its name. Null for anything else (a specifier never leaves the
 * package's src directory).
 * @param {string} kitRoot @param {string} specifier
 * @returns {string | null}
 */
function kitFile(kitRoot, specifier) {
  const m = SPEC.exec(specifier);
  if (!m) return null;
  const pkg = /** @type {string} */ (m[1]);
  const rest = m[2] ? m[2].slice(1) : "";
  if (rest.split("/").some((p) => p === "." || p === "..")) return null;
  const src = join(kitRoot, "packages", pkg, "src");
  if (!rest) return pkg === "server" ? join(src, "index.ts") : pkg === "client" ? join(src, "index.js") : null;
  return pkg === "server" ? join(src, rest.replace(/\.ts$/, "") + ".ts") : join(src, rest);
}

/**
 * The names a kit module exports, following "export * from" one level at a time (the barrel).
 * An unknown or missing module has none.
 * @param {string} kitRoot @param {string} specifier
 * @returns {string[]}
 */
export function kitExports(kitRoot, specifier) {
  const file = kitFile(kitRoot, specifier);
  if (!file) return [];
  /** @type {Set<string>} */
  const out = new Set();
  /** @type {Set<string>} */
  const seen = new Set();
  /** @param {string} f */
  const visit = (f) => {
    if (seen.has(f) || !existsSync(f)) return;
    seen.add(f);
    const text = readFileSync(f, "utf8");
    for (const n of scanJs(text).exports) out.add(n);
    for (const m of text.matchAll(/^\s*export\s*\*\s*from\s*["'](\.[^"']+)["']/gm)) {
      const base = join(f, "..", /** @type {string} */ (m[1]));
      const next = [base, base + ".ts", base + ".js"].find((c) => /\.(?:ts|js)$/.test(c) && existsSync(c));
      if (next) visit(next);
    }
  };
  visit(file);
  return [...out].sort();
}

/**
 * Whether a source module can be replaced by a kit module: every export it has is one the kit has.
 * @param {string[]} sourceExports @param {string[]} kit
 */
export function fitsKit(sourceExports, kit) {
  const have = new Set(kit);
  return sourceExports.every((e) => have.has(e));
}

/**
 * A pending step descriptor with the defaults every profile shares.
 * @param {Partial<import("./schema.mjs").Step> & { id: string, kind: "tool"|"agent", title: string }} s
 * @returns {import("./schema.mjs").Step}
 */
export function makeStep(s) {
  return {
    id: s.id,
    kind: s.kind,
    ...(s.run ? { run: s.run } : {}),
    title: s.title,
    after: s.after ?? [],
    ...(s.page ? { page: s.page } : {}),
    ...(s.pilot ? { pilot: true } : {}),
    files: s.files ?? { reads: [], writes: [] },
    verify: s.verify ?? ["check"],
    status: s.status ?? "pending",
    ...(s.why ? { why: s.why } : {}),
    attempts: 0,
    outputs: {},
  };
}

/**
 * Target paths for source keys: each key's part after fromPrefix, below toPrefix.
 * @param {string[]} keys @param {string} fromPrefix @param {string} toPrefix
 */
export function moved(keys, fromPrefix, toPrefix) {
  return keys.map((k) => toPrefix + (k.startsWith(fromPrefix) ? k.slice(fromPrefix.length) : k.replace(/^@/, "shared/")));
}

/**
 * Source keys of an inventory under a prefix (and of the given kinds), in key order.
 * @param {import("./schema.mjs").Inventory} inv @param {string} prefix @param {string[]} [kinds]
 */
export function keysUnder(inv, prefix, kinds) {
  return inv.files.filter((f) => f.key.startsWith(prefix) && (!kinds || kinds.includes(f.kind))).map((f) => f.key);
}

/**
 * A page or route name as a step-id and page-field safe slug, or null.
 * @param {string} s
 */
export function kebab(s) {
  const k = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return k || null;
}
