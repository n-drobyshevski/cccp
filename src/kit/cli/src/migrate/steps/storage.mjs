// The storage step: the source's own localStorage keys keep working. The kit's createStorage prefixes
// every key and reads values as JSON; a source key that held a plain string (a theme "dark") needs the
// raw option, and a key outside the source's prefix (or an app with no usable prefix) needs the empty
// prefix. This writes src/client/migrated/legacyStorage.js with legacyStorage (createStorage over the
// source prefix, with the raw keys) and, when keys fall outside that prefix, legacyForeignStorage
// (createStorage("") over the full key names). No file when the source has no raw key and every key
// sits under a usable prefix. maps.storage.file records where it is for the pin-tests step.
import { checkPrefix } from "../../values.mjs";
import { jsHeader } from "./_common.mjs";

const OUT = "src/client/migrated/legacyStorage.js";

/**
 * What the source stores and how: the usable prefix, the keys under it (short names) and the rest
 * (full names), each with whether it holds a plain string.
 * @param {{ inv: import("../schema.mjs").Inventory, plan: import("../schema.mjs").Plan }} ctx
 */
export function storageModel({ inv, plan }) {
  const given = /** @type {Record<string, unknown>} */ (plan.maps.storage ?? {});
  const wanted = typeof given["prefix"] === "string" ? given["prefix"] : inv.config.prefix;
  const prefix = wanted && !checkPrefix(wanted) ? wanted : null;
  /** @type {Map<string, boolean>} full key -> holds a plain string */
  const full = new Map();
  for (const f of Object.values(inv.js ?? {})) for (const s of f.storage) if (s.key) full.set(s.key, (full.get(s.key) ?? false) || s.raw !== false);
  const rawList = Array.isArray(given["raw"]) ? /** @type {unknown[]} */ (given["raw"]).filter((k) => typeof k === "string") : (inv.config.rawKeys ?? []);
  /** @type {Set<string>} */
  const rawFull = new Set();
  for (const e of /** @type {string[]} */ (rawList)) rawFull.add(prefix && (full.has(prefix + e) || !full.has(e)) ? prefix + e : e);
  for (const [k, raw] of full) if (raw) rawFull.add(k);
  /** @type {{ name: string, raw: boolean }[]} */
  const inPrefix = [];
  /** @type {{ name: string, raw: boolean }[]} */
  const foreign = [];
  for (const k of [...new Set([...full.keys(), ...rawFull])].sort()) {
    const raw = rawFull.has(k);
    if (prefix && k.startsWith(prefix)) inPrefix.push({ name: k.slice(prefix.length), raw });
    else foreign.push({ name: k, raw });
  }
  return { prefix, inPrefix, foreign, needed: rawFull.size > 0 || (full.size > 0 && !prefix) };
}

/** @param {unknown} v */
const lit = (v) => JSON.stringify(v);

/** @param {import("../apply.mjs").StepContext} ctx */
export function run(ctx) {
  const m = storageModel(ctx);
  if (!m.needed) return { notes: ["no raw key and no key outside a usable prefix: no legacyStorage.js"] };
  const out = [
    jsHeader("storage", "the source's storage keys"),
    "// The source's own keys. createStorage reads JSON; the keys named in raw hold a plain string, as they did.\n",
    'import { createStorage } from "@gas-kit/client/storage.js";\n\n',
  ];
  const inRaw = m.inPrefix.filter((k) => k.raw).map((k) => k.name);
  if (m.prefix) {
    out.push("/** The keys under the source prefix, by short name. */\n");
    out.push("export const legacyStorage = createStorage(" + lit(m.prefix) + ", { raw: " + lit(inRaw) + " });\n");
    if (m.foreign.length) {
      out.push("\n/** Keys outside that prefix, by full name. */\n");
      out.push('export const legacyForeignStorage = createStorage("", { raw: ' + lit(m.foreign.filter((k) => k.raw).map((k) => k.name)) + " });\n");
    }
  } else {
    out.push("/** The source had no usable prefix: every key by its full name. */\n");
    out.push('export const legacyStorage = createStorage("", { raw: ' + lit(m.foreign.filter((k) => k.raw).map((k) => k.name)) + " });\n");
  }
  ctx.out.write(OUT, out.join(""));
  const notes = [m.prefix ? "legacyStorage keeps the prefix " + m.prefix : "the source prefix is missing or invalid: legacyStorage uses the empty prefix and the full key names"];
  if (m.prefix && m.foreign.length) notes.push(m.foreign.length + " key" + (m.foreign.length === 1 ? "" : "s") + " outside the prefix: legacyForeignStorage");
  return { notes, maps: { storage: { file: OUT, foreign: m.prefix ? m.foreign.map((k) => k.name) : [] } } };
}
