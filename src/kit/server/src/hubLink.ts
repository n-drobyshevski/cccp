// Extracted from the author's production Apps Script apps; adapted.
// An optional launcher link kept in a Script Property. Only https is accepted.
//
// The asymmetry is on purpose: a save THROWS (the admin needs a visible error), a read returns
// "" for a bad value (the page must not die; no link is shown).

export const HUB_URL_KEY = "HUB_URL";
const HUB_URL_MAX = 2000;
const HTTPS_PREFIX = ["https:", "", ""].join("/");

/** A validated https URL, or "" for blank. Throws for anything else, non-strings first. */
export function normalizeHubUrl(raw: unknown): string {
  if (typeof raw !== "string") throw new Error("The launcher link must be text.");
  const v = raw.trim();
  if (v === "") return "";
  if (v.length > HUB_URL_MAX) throw new Error("The launcher link is too long.");
  if (/[\u0000-\u001f\u007f-\u009f]/.test(v)) throw new Error("The launcher link must not contain control characters.");
  if (/\s/.test(v)) throw new Error("The launcher link must not contain spaces.");
  if (v.indexOf(HTTPS_PREFIX) !== 0 || v.length <= HTTPS_PREFIX.length) {
    throw new Error("The launcher link must start with https.");
  }
  const host = v.slice(HTTPS_PREFIX.length).split(/[/?#]/)[0]!;
  const m = /^([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*)(?::(\d{1,5}))?$/.exec(host);
  if (!m || (m[2] !== undefined && (Number(m[2]) < 1 || Number(m[2]) > 65535))) {
    throw new Error("The launcher link needs a plain host name.");
  }
  return v;
}

/** The configured launcher URL, or "" when unset or invalid. Never throws. */
export function hubUrl(props: { get(key: string): string | null }, key: string = HUB_URL_KEY): string {
  try {
    return normalizeHubUrl(props.get(key) ?? "");
  } catch {
    return "";
  }
}

/** Validate and store a launcher URL (blank clears it). Throws on a bad value. */
export function saveHubUrl(
  props: { set(key: string, value: string): void; delete?(key: string): void },
  raw: unknown,
  key: string = HUB_URL_KEY,
): string {
  const v = normalizeHubUrl(raw);
  if (v === "" && props.delete) props.delete(key);
  else props.set(key, v);
  return v;
}
