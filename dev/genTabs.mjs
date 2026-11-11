// Deterministic fake-workbook generator for the dev harness and the node tests.
//
// Derived from the distributions in mockups/build.py (the script that produced the approved
// mockup data), re-expressed over a seeded generator keyed by each application's UUID so the
// output is byte-identical on every run and on every machine. "Today" is fixed, never the clock.
//
// The Apps tab is the CSV: CCCP_SAMPLE_CSV, else the real anonymized export when present on
// this machine, else the committed synthetic file. The real file is never copied anywhere.
// The side tabs (CIAT, Audits, DRP, Platform) are generated, and carry the awkward shapes the
// importer must survive: an unmatched row, a duplicate id, a dd/MM/yyyy text date, a renamed
// header and blanks. FIXTURE_FACTS names each one so a test can assert on it.
//
// Dates are emitted as {"$wall": "yyyy-MM-dd"} cells. The SpreadsheetApp fake turns them into
// Date objects at midnight in the spreadsheet's time zone, exactly as Sheets does for a date cell.
//
//   node dev/genTabs.mjs            prints the workbook as JSON
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const REAL_CSV = "/home/user/Inventory_Mon_appli_map_anonymized.csv";
export const SYNTHETIC_CSV = join(here, "fixtures/apps.synthetic.csv");
export const TODAY = "2026-11-11";
export const SHEET_ID = "1CccpDevFixtureWorkbook000000000000000000";
export const SHEET_TZ = "Europe/Paris";

/** Which CSV feeds the Apps tab: CCCP_SAMPLE_CSV, then the real file when present, then synthetic. */
export function sampleCsvPath(env = process.env) {
  if (env.CCCP_SAMPLE_CSV) return env.CCCP_SAMPLE_CSV;
  return existsSync(REAL_CSV) ? REAL_CSV : SYNTHETIC_CSV;
}

// ------------------------------------------------------------------------------ csv
/** RFC 4180 parser: quoted fields, doubled quotes, embedded newlines. Returns string[][]. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
}

// ------------------------------------------------------------------------------ prng
function hash32(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    choice: (a2) => a2[Math.floor(next() * a2.length)],
    choices(items, weights) {
      let x = next() * weights.reduce((s, v) => s + v, 0);
      for (let i = 0; i < items.length; i++) { x -= weights[i]; if (x < 0) return items[i]; }
      return items[items.length - 1];
    },
  };
}

// ------------------------------------------------------------------------------ dates
const DAY = 86400000;
const todayMs = Date.parse(TODAY + "T00:00:00Z");
const wall = (daysAgo) => ({ $wall: new Date(todayMs - daysAgo * DAY).toISOString().slice(0, 10) });
const ddmmyyyy = (daysAgo) => {
  const d = new Date(todayMs - daysAgo * DAY).toISOString().slice(0, 10).split("-");
  return `${d[2]}/${d[1]}/${d[0]}`;
};

// ------------------------------------------------------------------------------ headers
export const HEADERS = {
  CIAT: [
    "UUID", "Confidentiality level", "Integrity Level", "Availability Level", "Traceability Level",
    "Personal Data", "Personal Sensitive Data", "Company Sensitive Data",
    "Date of Security Check", "Classification reviewed and validated by SO",
  ],
  Audits: ["UUID", "Last Pentest", "Pentest Findings", "Last Audit", "Audit Result"],
  // 'Recovery Time Objectives' is renamed here on purpose: the default mapping then reports it
  // as a missing header and the unmapped callout has something real to show.
  DRP: ["UUID", "Maximum Tolerable Downtime", "RTO (hours)", "Recovery Point Objectives", "Last DRP Test", "DRP Test Result"],
  Platform: [
    "UUID", "Hosting Type", "Single Sign-On - Availability", "How many internal users",
    "How many external users", "Application Front Is Exposed on Internet",
  ],
};
const TAB_ORDER = ["Apps", "CIAT", "Audits", "DRP", "Platform"];
const GIDS = { Apps: 0, CIAT: 1001, Audits: 1002, DRP: 1003, Platform: 1004 };

// ------------------------------------------------------------------------------ generate
/**
 * Build the workbook. Pure and deterministic: the same CSV text always gives the same result.
 * @param {{csvText?: string, csvPath?: string}} [opts]
 */
export function genWorkbook(opts = {}) {
  const csvPath = opts.csvPath || sampleCsvPath();
  const csv = parseCsv(opts.csvText ?? readFileSync(csvPath, "utf8"));
  const appsHeader = csv[0];
  const appRows = csv.slice(1).map((r) => appsHeader.map((_, i) => r[i] ?? ""));
  const col = (name) => appsHeader.indexOf(name);
  const cUuid = col("UUID"), cLc = col("Lifecycle"), cTy = col("Typology"), cTier = col("Tiering"), cSo = col("Security Officer Name");

  // Tiering is a number cell in Sheets; everything else on the Apps tab stays text.
  const apps = appRows.map((r) => r.map((v, i) => (i === cTier && /^\d+$/.test(v) ? Number(v) : v)));

  const side = { CIAT: [], Audits: [], DRP: [], Platform: [] };
  const facts = { unmatchedId: null, duplicateId: null, textDateRow: null, renamedHeader: "RTO (hours)", renamedFrom: "Recovery Time Objectives" };
  const blank = (r, p) => (r.next() < p ? "" : null);

  appRows.forEach((a, idx) => {
    const id = a[cUuid];
    const r = rng(hash32(id));
    const t = a[cTier] ? Number(a[cTier]) : 0;
    const p = { 1: 0.92, 2: 0.8, 3: 0.65, 4: 0.5, 0: 0.35 }[t] ?? 0.35;
    const ty = (a[cTy] || "").toLowerCase();
    const lc = a[cLc];
    const so = (a[cSo] || "").trim();

    // Cyber and compliance audits (one tab; pentest and audit are separate pick groups).
    const exposed = r.next() < 0.35;
    const pentest = r.next() < p * 0.8 ? r.int(30, 1000) : null;
    const findings = pentest == null ? "" : r.choices(["None", "1 medium", `${r.int(1, 3)} high`, "1 critical"], [0.6, 0.15, 0.15, 0.1]);
    const audit = r.next() < p * 0.6 ? r.int(40, 1100) : null;
    const auditRes = audit == null ? "" : r.choices(["Passed", "1 minor finding", "2 major findings"], [0.7, 0.2, 0.1]);
    if (pentest != null || audit != null) {
      side.Audits.push([id, pentest == null ? "" : wall(pentest), findings, audit == null ? "" : wall(audit), auditRes]);
      // A second, older audit row for some applications: "pick latest" has something to pick.
      if (r.next() < 0.12) {
        const older = (pentest ?? 200) + r.int(120, 500);
        side.Audits.push([id, wall(older), r.choice(["None", "1 medium"]), audit == null ? "" : wall(audit + r.int(100, 400)), "Passed"]);
      }
    }

    // Compliance: CIAT classification.
    const lo = t === 1 || t === 2 ? 2 : 1;
    const hasCiat = r.next() < p + 0.08;
    if (hasCiat) {
      const val = r.next() < p ? r.int(20, 1100) : null;
      const yn = (q) => (r.next() < q ? "Yes" : "No");
      side.CIAT.push([
        id, r.int(lo, 4), r.int(lo, 4), r.int(lo, 4), r.int(lo, 4),
        yn(0.3), yn(0.08), yn(0.2),
        val == null ? "" : wall(val), val == null ? "" : "Yes",
      ]);
    }

    // Continuity.
    const rtoPool = { 1: [1, 2, 4], 2: [4, 8, 24], 3: [24, 48], 4: [48, 72], 0: [8, 24, 48] }[t] || [8, 24, 48];
    const hasRto = r.next() < p + 0.05;
    if (hasRto) {
      const rto = r.choice(rtoPool);
      const rpo = r.choice([0, 1, 4, 24]);
      const mtd = rto * r.choice([1, 2]);
      const dt = r.next() < p * 0.75 ? r.int(20, 1100) : null;
      const dtr = dt == null ? "" : r.next() < 0.87 ? "Passed" : "Failed";
      side.DRP.push([id, mtd, rto, rpo, dt == null ? "" : wall(dt), dtr]);
    }

    // Platform.
    const hosting = r.choices(["Cloud", "SaaS", "On-premise", "Hybrid"], ty === "buy" ? [0.3, 0.5, 0.1, 0.1] : [0.7, 0.05, 0.15, 0.1]);
    const sso = r.next() < 0.85 ? "Yes" : "No";
    const iu = r.choice(["<20", "20-100", "100-500", "500+"]);
    const eu = r.choices(["0", "<20", "20-100", "500+"], [0.7, 0.1, 0.1, 0.1]);
    // Roughly one application in ten has no platform row at all; a few have blank cells.
    if (idx % 10 !== 9) {
      side.Platform.push([id, hosting, sso, blank(r, 0.05) ?? iu, blank(r, 0.1) ?? eu, exposed ? "Yes" : "No"]);
    }
    void lc; void so;
  });

  // Deliberate irregularities, placed at fixed positions so they are stable across CSV changes.
  const mid = (n) => Math.min(Math.max(Math.floor(n / 2), 1), Math.max(n - 1, 0));

  // 1. An unmatched row: a UUID that is not on the Apps tab.
  facts.unmatchedId = "00000000-0000-4000-8000-00000000dead";
  side.CIAT.splice(mid(side.CIAT.length), 0, [facts.unmatchedId, 2, 2, 3, 2, "No", "No", "No", wall(90), "Yes"]);

  // 2. A duplicate id: the same application appears twice on Platform with different values.
  if (side.Platform.length > 3) {
    const src = side.Platform[3];
    facts.duplicateId = src[0];
    side.Platform.splice(4, 0, [src[0], src[1] === "Cloud" ? "SaaS" : "Cloud", src[2] === "Yes" ? "No" : "Yes", "20-100", "0", "No"]);
  }

  // 3. A dd/MM/yyyy text date in a date column (a string, not a date cell).
  if (side.DRP.length > 5) {
    const row = side.DRP[5];
    row[4] = ddmmyyyy(200);
    if (!row[5]) row[5] = "Passed";
    facts.textDateRow = { tab: "DRP", id: row[0], header: "Last DRP Test", text: row[4] };
  }

  // 4. Blanks: whole rows with only the id, and trailing blank cells.
  if (side.Audits.length > 8) side.Audits[8] = [side.Audits[8][0], "", "", "", ""];
  if (side.DRP.length > 9) side.DRP[9] = [side.DRP[9][0], "", "", "", "", ""];

  const tabs = TAB_ORDER.map((name) => ({
    name,
    gid: GIDS[name],
    rows: name === "Apps" ? [appsHeader.slice(), ...apps] : [HEADERS[name].slice(), ...side[name]],
  }));
  return {
    id: SHEET_ID,
    name: "CCCP dev register",
    tz: SHEET_TZ,
    today: TODAY,
    source: opts.csvText != null ? "inline" : csvPath === SYNTHETIC_CSV ? "synthetic" : "csv",
    facts,
    tabs,
  };
}

/** The same workbook as a stable JSON string (key order is fixed by construction). */
export function workbookJson(opts) {
  return JSON.stringify(genWorkbook(opts));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.stdout.write(workbookJson() + "\n");
}
