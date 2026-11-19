// Extracted from the author's production Apps Script apps; adapted.
// Diagnostics: a list of checks run one by one. A throwing check never takes the report down.

import { buildId } from "./buildInfo";
import { PROP_MAX_BYTES, getProp, utf8ByteLength } from "./props";
import { dailyTriggerSignature } from "./triggers";

export interface CheckResult { name: string; ok: boolean; detail: string }
/** A check; `checkName` (or the function's own name) labels it when it throws. */
export type Check = (() => CheckResult) & { checkName?: string };

/** Give a check a name that survives a throw, so the failure is not reported as "check N". */
export function namedCheck(name: string, fn: () => CheckResult): Check {
  const c: Check = () => fn();
  c.checkName = name;
  return c;
}
export interface DiagnosticsReport {
  generatedAt: string;
  ok: boolean;
  checks: CheckResult[];
}

export function createDiagnostics(checks: Check[]) {
  function report(): DiagnosticsReport {
    const results: CheckResult[] = checks.map((c, i) => {
      try {
        const r = c();
        return { name: String(r.name), ok: !!r.ok, detail: String(r.detail ?? "") };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { name: c.checkName || c.name || "check " + (i + 1), ok: false, detail: "failed: " + msg.slice(0, 200) };
      }
    });
    return { generatedAt: new Date().toISOString(), ok: results.every((r) => r.ok), checks: results };
  }
  function text(): string {
    try {
      const r = report();
      return [
        "Diagnostics " + (r.ok ? "OK" : "FAILED") + " at " + r.generatedAt,
        ...r.checks.map((c) => (c.ok ? "ok      " : "WARNING ") + c.name + ": " + c.detail),
      ].join("\n");
    } catch (e) {
      return "Diagnostics failed: " + String(e);
    }
  }
  return { report, text };
}

/** The build id the running bundle was stamped with. */
export function buildIdCheck(): Check {
  return namedCheck("build", () => ({ name: "build", ok: true, detail: buildId() }));
}

/** The cache epoch in force. Bumping it invalidates every cached payload at once. */
export function epochCheck(epoch: string | number): Check {
  return namedCheck("epoch", () => ({ name: "epoch", ok: String(epoch) !== "", detail: String(epoch) }));
}

/** Every named property measured in UTF-8 bytes against the cap; over the cap is a failure. */
export function propSizesCheck(
  keys: string[],
  read: (key: string) => string | null = getProp,
  max: number = PROP_MAX_BYTES,
): Check {
  return namedCheck("property sizes", () => {
    const parts: string[] = [];
    let ok = true;
    for (const k of keys) {
      const bytes = utf8ByteLength(read(k) ?? "");
      if (bytes > max) ok = false;
      parts.push(k + "=" + bytes + (bytes > max ? " (over " + max + ")" : ""));
    }
    return { name: "property sizes", ok, detail: parts.join(", ") || "none" };
  });
}

/** The stored trigger signature matches the wanted schedule and exactly one trigger exists. */
export function triggerSignatureCheck(spec: {
  handler: string; tz: string; hour: number; sigProp: string;
  read?: (key: string) => string | null;
}): Check {
  return namedCheck("daily trigger", () => {
    const read = spec.read ?? getProp;
    const want = dailyTriggerSignature(spec.tz, spec.hour);
    const have = read(spec.sigProp);
    const count = ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === spec.handler).length;
    const ok = count === 1 && have === want;
    return {
      name: "daily trigger",
      ok,
      detail: count + " installed, signature " + (have ?? "unset") + (ok ? "" : ", wanted " + want),
    };
  });
}

/** Whether the app can reach its data source. The hook throws or returns false when it cannot. */
export function sourceReachableCheck(hook: () => boolean | void): Check {
  return namedCheck("source", () => {
    try {
      const r = hook();
      return r === false
        ? { name: "source", ok: false, detail: "not reachable" }
        : { name: "source", ok: true, detail: "reachable" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { name: "source", ok: false, detail: "not reachable: " + msg.slice(0, 200) };
    }
  });
}

const shortMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 200);

/**
 * The owner address is pinned (from the editor). The getter returns the pin or null; the
 * address itself is not printed.
 */
export function ownerPinnedCheck(pinned: () => string | null): Check {
  return namedCheck("owner pin", () => {
    const v = String(pinned() ?? "").trim();
    return v
      ? { name: "owner pin", ok: true, detail: "pinned" }
      : { name: "owner pin", ok: false, detail: "not pinned: pin the owner from the Apps Script editor, or set the OWNER_EMAIL Script Property" };
  });
}

/**
 * The web app URL is a versioned deployment (ending in /exec). A test deployment (/dev) runs the
 * latest saved code for editors only and is a warning; no URL at all is a failure too.
 */
export function serviceUrlIsExecCheck(url: () => string = () => ScriptApp.getService().getUrl()): Check {
  return namedCheck("service url", () => {
    const u = String(url() ?? "").trim().replace(/[?#].*$/, "");
    if (/\/exec$/.test(u)) return { name: "service url", ok: true, detail: "a versioned deployment (/exec)" };
    if (/\/dev$/.test(u)) return { name: "service url", ok: false, detail: "a test deployment (/dev): deploy a version and use its /exec URL" };
    return { name: "service url", ok: false, detail: u ? "not a web app deployment URL" : "no web app deployment" };
  });
}

/**
 * Every scope in the manifest is granted (ScriptApp.requireAllScopes in FULL mode). Skipped, and
 * reported ok, where the method does not exist.
 */
export function scopesGrantedCheck(): Check {
  return namedCheck("scopes", () => {
    const app = typeof ScriptApp === "undefined" ? undefined : (ScriptApp as Partial<GoogleAppsScript.Script.ScriptApp>);
    if (!app || typeof app.requireAllScopes !== "function" || !app.AuthMode) {
      return { name: "scopes", ok: true, detail: "skipped: requireAllScopes is not available" };
    }
    try {
      app.requireAllScopes(app.AuthMode.FULL);
      return { name: "scopes", ok: true, detail: "all granted" };
    } catch (e) {
      return { name: "scopes", ok: false, detail: "not all granted: run setup() from the Apps Script editor to authorise (" + shortMessage(e) + ")" };
    }
  });
}

/**
 * The audit sheet is configured and the probe can reach it. The probe throws or returns false
 * when it cannot. The id is never printed: it is replaced by "<id>" in a probe's message.
 */
export function auditSheetReachableCheck(sheetId: () => string | null, probe: (id: string) => boolean | void): Check {
  return namedCheck("audit sheet", () => {
    const id = String(sheetId() ?? "").trim();
    if (!id) return { name: "audit sheet", ok: false, detail: "not configured: run setup() from the Apps Script editor" };
    try {
      return probe(id) === false
        ? { name: "audit sheet", ok: false, detail: "not reachable" }
        : { name: "audit sheet", ok: true, detail: "reachable" };
    } catch (e) {
      return { name: "audit sheet", ok: false, detail: "not reachable: " + shortMessage(e).split(id).join("<id>") };
    }
  });
}
