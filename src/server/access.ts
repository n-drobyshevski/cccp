// Placeholder access module for the build skeleton. It fails closed: every call is denied
// until the real access model replaces this file.

export interface DenyResult {
  ok: false;
  error: string;
  errorKind: "forbidden";
}

const DENIED: DenyResult = { ok: false, error: "Access control is not installed", errorKind: "forbidden" };

/** A refusal envelope, or null when the active user may proceed. Always refuses here. */
export function denyResult(_what: string): DenyResult | null {
  return DENIED;
}

/** The page shown to a refused visitor, or null to continue. Always refuses here. */
export function deniedPage(): GoogleAppsScript.HTML.HtmlOutput | null {
  return HtmlService.createHtmlOutput("Access control is not installed");
}
