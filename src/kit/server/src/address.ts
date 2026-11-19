// The plain-address check, shared by access.ts (the lists) and page.ts (a mailto action).
// Kept in its own module so page.ts need not import access.ts, which imports page.ts.

// A conservative ASCII address: local part of letters, digits and . _ % + - (no leading,
// trailing or doubled dot), then a dotted host of letters, digits and hyphens (no label starting
// or ending with a hyphen). Control, bidi, zero-width characters and markup cannot match.
const LOCAL_PART = /^[a-z0-9_%+-]+(?:\.[a-z0-9_%+-]+)*$/;
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** True for an address validateAddresses accepts (after trim and lowercase). */
export function isPlainAddress(email: string): boolean {
  const e = String(email ?? "").trim().toLowerCase();
  if (e.length > 254) return false;
  const at = e.indexOf("@");
  if (at < 1 || at !== e.lastIndexOf("@")) return false;
  const local = e.slice(0, at);
  const host = e.slice(at + 1);
  if (local.length > 64 || !LOCAL_PART.test(local)) return false;
  const labels = host.split(".");
  return labels.length >= 2 && labels.every((l) => HOST_LABEL.test(l));
}
