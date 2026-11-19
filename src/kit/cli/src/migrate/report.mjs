// The migration status report, .migrate/report.md: counts by status, the open agent steps with
// what each reads, writes and must pass (and its last failure, verbatim), the blocked and failed
// tool steps with why, and what the kit's guards make impossible for this source, each with its
// fallback (the source's hash links that would leave Apps Script's frame and its direct Script
// Properties reads among them). Pure: plan and inventory in, markdown out.
import { leaveReason, targetFix } from "./frameLinks.mjs";
import { termSafe } from "./steps/_common.mjs";

/** @typedef {import("./plan.mjs").Plan} Plan */
/** @typedef {import("./plan.mjs").PlanStep} PlanStep */
/** @typedef {import("./plan.mjs").Inventory} Inventory */

const STATUSES = /** @type {const} */ (["done", "skipped", "pending", "blocked", "failed"]);

/** @param {PlanStep} s */
const open = (s) => s.status !== "done" && s.status !== "skipped";

/**
 * A fenced block that no backtick run inside the text can close early.
 * @param {string} text
 */
function fence(text) {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const f = "`".repeat(Math.max(3, longest + 1));
  return [f, text, f];
}

/** Inline code that survives backticks in the text. @param {string} text */
function code(text) {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const f = "`".repeat(longest + 1);
  return f + (longest ? " " + text + " " : text) + f;
}

/** @param {number} n @param {string} one @param {string} [many] */
function count(n, one, many) {
  return n + " " + (n === 1 ? one : (many ?? one + "s"));
}

/** @param {Record<string, any> | undefined} o @returns {[string, any][]} */
function entries(o) {
  return o && typeof o === "object" ? Object.entries(o) : [];
}

/** @typedef {{ key: string, line: number, tag: string, href: string, target: string | null }} HashLinkFinding */

/**
 * The source's hash links that would leave Apps Script's frame (no target, or one other than
 * _self, under <base target="_top">), from the inventory's html and js findings, by file and line.
 * @param {Inventory} inv
 * @returns {HashLinkFinding[]}
 */
export function hashLinkFindings(inv) {
  /** @type {Map<string, HashLinkFinding>} */
  const out = new Map();
  for (const part of [inv.html, inv.js]) {
    for (const [key, f] of entries(part)) {
      for (const l of Array.isArray(f?.hashLinks) ? f.hashLinks : []) {
        if (!l || typeof l.line !== "number" || typeof l.href !== "string") continue;
        const one = { key, line: l.line, tag: typeof l.tag === "string" ? l.tag : "a", href: l.href, target: typeof l.target === "string" ? l.target : null };
        out.set(key + "\n" + l.line + "\n" + l.href + "\n" + one.target, one);
      }
    }
  }
  return [...out.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.line - b.line));
}

/**
 * One hash link finding as a line: the file and line, the link, and why it leaves the frame.
 * @param {HashLinkFinding} l
 */
export function hashLinkLine(l) {
  const kept = targetFix(l.target) === "keep" ? "; apply keeps this target: make it _self by hand unless it opens a new window on purpose" : "";
  return l.key + ":" + l.line + ": <" + l.tag + " " + (l.tag === "form" ? "action" : "href") + "=" + JSON.stringify(l.href) + "> " + leaveReason(l.target) + kept;
}

/** @typedef {{ key: string, line: number, tag: string, href: string, page: string | null, via: string | null }} RelativeLinkFinding */

/**
 * The source's relative, non-hash links (?page=x, a bare ?, other.html) and script navigation to
 * one, which resolve against Apps Script's frame address rather than the app's, from the inventory's
 * html and js findings, by file and line.
 * @param {Inventory} inv
 * @returns {RelativeLinkFinding[]}
 */
export function relativeLinkFindings(inv) {
  /** @type {Map<string, RelativeLinkFinding>} */
  const out = new Map();
  for (const part of [inv.html, inv.js]) {
    for (const [key, f] of entries(part)) {
      for (const l of Array.isArray(f?.relativeLinks) ? f.relativeLinks : []) {
        if (!l || typeof l.line !== "number" || typeof l.href !== "string") continue;
        const one = { key, line: l.line, tag: typeof l.tag === "string" ? l.tag : "a", href: l.href, page: typeof l.page === "string" ? l.page : null, via: typeof l.via === "string" ? l.via : null };
        out.set(key + "\n" + l.line + "\n" + one.tag + "\n" + l.href, one);
      }
    }
  }
  return [...out.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.line - b.line));
}

/**
 * One relative link finding as a line, in the hash link format: the file and line, the link, what it
 * does in the frame, and what apply does about it.
 * @param {RelativeLinkFinding} l
 */
export function relativeLinkLine(l) {
  const where = l.key + ":" + l.line + ": ";
  if (l.via === "script") return where + l.tag + " " + JSON.stringify(l.href) + " navigates to the frame's own address, not the app's; apply leaves it: navigate to the page's hash route instead (router.navigate, or location.hash), or reload the app through the service URL";
  const what = "<" + l.tag + " " + (l.tag === "form" ? "action" : "href") + "=" + JSON.stringify(l.href) + "> is relative, so under <base target=\"_top\"> it loads the frame's own address, not the app's, into the top window";
  if (l.page !== null) return where + what + "; apply makes it the hash route of page " + JSON.stringify(l.page) + " (target _self) when the app has that page, and marks it \"migrate: page link not rewritten\" when not";
  return where + what + "; apply leaves it: make it a hash route, or a full reload with the service URL and target _top";
}

/** @typedef {{ key: string, line: number, method: string }} ScriptPropFinding */

/** Tests, built bundles and installed packages: not server code a migration carries. */
const NOT_CARRIED = /(?:^|\/)(?:test|tests|__tests__|e2e|dist|build|node_modules)\/|\.(?:test|spec)\.[cm]?[jt]s$/;

/**
 * The source's direct reads of Script Properties (PropertiesService.getScriptProperties() and
 * getProperty, getProperties or getKeys) in the server code a migration carries, from the
 * inventory's js findings, by file and line. Reported only: migrate never rewrites them.
 * @param {Inventory} inv
 * @returns {ScriptPropFinding[]}
 */
export function scriptPropFindings(inv) {
  /** @type {Map<string, ScriptPropFinding>} */
  const out = new Map();
  for (const [key, f] of entries(inv.js)) {
    if (NOT_CARRIED.test(key.replace(/^@[^/]+\//, ""))) continue;
    for (const l of Array.isArray(f?.scriptProps) ? f.scriptProps : []) {
      if (!l || typeof l.line !== "number" || typeof l.method !== "string") continue;
      out.set(key + "\n" + l.line + "\n" + l.method, { key, line: l.line, method: l.method });
    }
  }
  return [...out.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.line - b.line));
}

/** What a person does about a direct Script Properties read. */
export const SCRIPT_PROP_ADVICE = "reads Script Properties directly; use the kit's getProp (one snapshot per execution), except keys another execution writes mid-request (job ids, cancel flags), which stay fresh reads; drop the snapshot after taking a lock before a read-modify-write";

/** Where the fast-load rules are written down. */
export const FAST_LOADS_RECIPE = "docs/recipes/fast-loads.md";

/**
 * One Script Properties finding as a line, in the hash link format: the file and line, the call, and
 * what to use instead.
 * @param {ScriptPropFinding} l
 */
export function scriptPropLine(l) {
  return l.key + ":" + l.line + ": " + l.method + " " + SCRIPT_PROP_ADVICE;
}

/** What migrate does about a relative link, and what a person does. */
export const PAGE_LINK_RULE = "A ?page= link becomes a hash route: migrate:apply rewrites ?page=x&k=v to #/x?k=v (target _self; the router hands the page k as ctx.query) when the app has page x, and leaves any other with a \"migrate: page link not rewritten\" marker. Another relative link and script navigation are reported, not rewritten. A full reload of the app uses the server-supplied service URL (serviceUrl in the template's live bootstrap, from access.serviceUrl() on the server) as an absolute link with target _top: attrs(linkAttrs(url)) gives it that.";

/** What migrate does about a hash link, and what a person does. */
export const HASH_LINK_RULE = "In-app links use linkAttrs (target _self), because of <base target=\"_top\"> in the frame: a hash link without it loads a blank top page instead of changing the route. migrate:apply gives every hash link it rewrites or carries target=\"_self\" (the classic pages, the bare shell, converted el() calls, copied html templates); a page ported by hand builds its links with attrs(linkAttrs(href)).";

/**
 * What the kit's guards make impossible for this source, and the fallback for each, as sentences.
 * Only the ones the inventory gives evidence for, plus the size budgets, which always apply.
 * @param {Inventory} inv
 * @returns {string[]}
 */
export function guardNotes(inv) {
  /** @type {string[]} */
  const notes = [];
  const js = entries(inv.js);
  const html = entries(inv.html);
  const css = entries(inv.css);
  /** @param {[string, any][]} list @param {(f: any) => number} pick */
  const tally = (list, pick) => {
    let n = 0;
    let files = 0;
    for (const [, f] of list) {
      const k = pick(f);
      n += k;
      if (k) files++;
    }
    return { n, files };
  };
  /** @param {any} v */
  const len = (v) => (Array.isArray(v) ? v.length : 0);

  const titles = tally([...js, ...html], (f) => len(f.titles));
  if (titles.n) notes.push("Title tooltips (" + count(titles.n, "place") + " in " + count(titles.files, "file") + ") become data-tip, which the kit shows on hover and on focus. The hover card looks and times differently from the browser's tooltip, and its text also goes into aria-label or visible text.");
  const sinks = tally(js, (f) => len(f.sinks));
  if (sinks.n) notes.push("innerHTML, outerHTML, insertAdjacentHTML and document.write (" + count(sinks.n, "use") + " in " + count(sinks.files, "file") + ") are not allowed: views are rewritten as html templates rendered by renderRegion.");
  const handlers = tally([...js, ...html], (f) => len(f.handlers));
  if (handlers.n) notes.push("Inline on* handlers (" + count(handlers.n, "handler") + ") are not allowed: they become data-act attributes with one delegate per event.");
  const scriptlets = tally(html, (f) => (Array.isArray(f.scriptlets) ? f.scriptlets.filter((/** @type {any} */ s) => !(s.kind === "raw" && /^\s*include\s*\(/.test(s.code ?? ""))).length : 0));
  if (scriptlets.n) notes.push("Scriptlets other than include (" + count(scriptlets.n, "scriptlet") + ") cannot run in a kit page: what they print becomes boot data from the server.");

  let external = 0;
  for (const [, f] of html) {
    for (const s of f.scripts ?? []) if (typeof s.src === "string" && s.src.includes("//")) external++;
    for (const l of f.links ?? []) if (typeof l.href === "string" && l.href.includes("//")) external++;
  }
  for (const [, f] of css) {
    for (const u of f.urls ?? []) if (typeof u.value === "string" && u.value.includes("//")) external++;
    for (const i of f.imports ?? []) if (typeof i === "string" && i.includes("//")) external++;
  }
  if (external) notes.push("External scripts, stylesheets and fonts (" + count(external, "URL") + ") are not loaded: a CDN script is vendored into the app, a font becomes a data: font-face within the 100 kB budget or falls back to the kit's font stack, and no double slash reaches served code.");

  const defines = css.flatMap(([, f]) => (Array.isArray(f.defines) ? f.defines : []));
  const colours = css.reduce((n, [, f]) => n + len(f.colours), 0);
  const dark = defines.some((/** @type {any} */ d) => /prefers-color-scheme\s*:\s*dark/i.test(d.media ?? "") || /dark/i.test(d.selector ?? ""));
  if ((defines.length || colours) && !dark) notes.push("The source has no dark theme: its dark values are derived from the light ones, and a person reviews them (the dark-mode step).");

  const userProps = /** @type {{ userProperties?: unknown }} */ (inv).userProperties;
  if ((Array.isArray(userProps) && userProps.length) || userProps === true) notes.push("UserProperties preferences cannot be carried: the kit never uses UserProperties (under a deployment that runs as the deployer it is the deployer's store). Saved preferences start fresh, or move to localStorage under the app's prefix.");

  const queryRoutes = (inv.routes ?? []).filter((r) => r.startsWith("?"));
  if (queryRoutes.length) notes.push("Query-string links (" + queryRoutes.slice(0, 3).join(", ") + (queryRoutes.length > 3 ? ", ..." : "") + ") and deep links made with google.script.history stay hash-based: a query link is translated to its hash route on arrival, and new links are #/ routes built with linkAttrs (target _self).");

  const links = hashLinkFindings(inv);
  if (links.length) notes.push(HASH_LINK_RULE + " The source has " + count(links.length, "hash link") + " that would leave the frame: " + links.slice(0, 5).map((l) => l.key + ":" + l.line).join(", ") + (links.length > 5 ? ", ..." : "") + " (migrate:doctor lists each).");
  const rel = relativeLinkFindings(inv);
  if (rel.length) notes.push(PAGE_LINK_RULE + " The source has " + count(rel.length, "relative link") + " that would break in the frame: " + rel.slice(0, 5).map((l) => l.key + ":" + l.line).join(", ") + (rel.length > 5 ? ", ..." : "") + " (migrate:doctor lists each).");

  const props = scriptPropFindings(inv);
  if (props.length) notes.push("Carried server code that " + SCRIPT_PROP_ADVICE + " (" + FAST_LOADS_RECIPE + "). The source has " + count(props.length, "direct read") + ": " + props.slice(0, 5).map((l) => l.key + ":" + l.line).join(", ") + (props.length > 5 ? ", ..." : "") + " (migrate:doctor lists each; migrate does not rewrite them).");

  notes.push("The kit's size budgets still apply to the built page, the client bundle and each font.");
  return notes;
}

/**
 * The open steps of a plan (neither done nor skipped).
 * @param {Plan} plan
 */
export function openSteps(plan) {
  return plan.steps.filter(open);
}

/**
 * Counts by status, for each kind.
 * @param {Plan} plan
 */
export function statusCounts(plan) {
  /** @type {Record<string, { tool: number, agent: number }>} */
  const c = {};
  for (const st of STATUSES) c[st] = { tool: 0, agent: 0 };
  for (const s of plan.steps) {
    const row = c[s.status] ?? (c[s.status] = { tool: 0, agent: 0 });
    row[s.kind]++;
  }
  return c;
}

/**
 * The report's markdown.
 * @param {Plan} plan
 * @param {Inventory | null} inv null when the inventory cannot be read (the guard notes are left out)
 */
export function renderReport(plan, inv) {
  const byId = new Map(plan.steps.map((s) => [s.id, s]));
  /** @param {PlanStep} s */
  const waits = (s) => s.after.filter((a) => open(/** @type {PlanStep} */ (byId.get(a) ?? s)));
  const counts = statusCounts(plan);
  /** @type {string[]} */
  const L = [
    "# Migration status",
    "",
    "Written by migrate:status. Profile " + plan.profile + ", fidelity " + plan.fidelity + ", " + count(plan.steps.length, "step") + ".",
    "",
    "## Summary",
    "",
    "| status | tool | agent |",
    "| --- | --- | --- |",
    ...STATUSES.map((st) => "| " + st + " | " + counts[st]?.tool + " | " + counts[st]?.agent + " |"),
    "",
  ];

  const agents = plan.steps.filter((s) => s.kind === "agent" && open(s));
  L.push("## Open agent steps", "");
  if (!agents.length) L.push("None.", "");
  for (const s of agents) {
    L.push("### " + code(s.id) + ": " + s.title, "");
    L.push("- status: " + s.status + (s.attempts ? " (" + count(s.attempts, "attempt") + ")" : ""));
    if (s.page) L.push("- page: " + s.page + (s.pilot ? " (the pilot)" : ""));
    const w = waits(s);
    if (w.length) L.push("- waits on: " + w.map(code).join(", "));
    if (s.files.reads.length) L.push("- reads: " + s.files.reads.map(code).join(", "));
    if (s.files.writes.length) L.push("- writes: " + s.files.writes.map(code).join(", "));
    L.push("- verify: " + (s.verify.length ? s.verify.map(code).join(", ") : "none listed"));
    L.push("- close it with: " + code("migrate:done " + s.id));
    if (s.status !== "pending" && s.why) L.push("", "Last failure:", "", ...fence(s.why));
    L.push("");
  }

  const blocked = plan.steps.filter((s) => s.status === "blocked");
  L.push("## Blocked steps", "");
  if (!blocked.length) L.push("None.", "");
  for (const s of blocked) L.push("- " + code(s.id) + (s.run ? " (steps/" + s.run + ".mjs)" : "") + ": " + (s.why ?? "no reason recorded"));
  if (blocked.length) L.push("");

  const failed = plan.steps.filter((s) => s.kind === "tool" && s.status === "failed");
  if (failed.length) {
    L.push("## Failed tool steps", "");
    for (const s of failed) L.push("### " + code(s.id) + ": " + s.title, "", ...fence(s.why ?? "no reason recorded"), "");
  }

  const waiting = plan.steps.filter((s) => s.kind === "tool" && s.status === "pending" && waits(s).length);
  if (waiting.length) {
    L.push("## Tool steps waiting", "");
    for (const s of waiting) L.push("- " + code(s.id) + " waits on " + waits(s).map(code).join(", "));
    L.push("");
  }

  if (inv) {
    L.push("## What the guards make impossible", "");
    for (const n of guardNotes(inv)) L.push("- " + n);
    L.push("");
  }
  // Notes, titles and reasons can carry source text: no control character reaches a terminal that shows the file.
  return termSafe(L.join("\n"));
}

/**
 * The short summary migrate:status prints.
 * @param {Plan} plan
 */
export function statusLines(plan) {
  const c = statusCounts(plan);
  /** @param {string} st */
  const both = (st) => (c[st]?.tool ?? 0) + (c[st]?.agent ?? 0);
  const openList = openSteps(plan);
  return [
    "Migration (" + plan.profile + ", " + plan.fidelity + "): " + both("done") + " done, " + both("skipped") + " skipped, " + both("pending") + " pending, " + both("blocked") + " blocked, " + both("failed") + " failed.",
    ...(openList.length ? ["Open: " + openList.map((s) => s.id + " (" + s.kind + ", " + s.status + ")").join(", ")] : ["Nothing is open: the migration is complete."]),
    "Report: .migrate/report.md",
  ];
}
