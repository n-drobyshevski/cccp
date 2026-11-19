// The text to show for a failed call. The server answers an unexpected fault with one fixed sentence
// that asks the person to quote a reference, and the kit's RpcError carries that reference as `ref`
// (only for such a fault), so it is appended here wherever a message is shown. Any other error is
// its own message, unchanged.

/** @param {any} e @param {string} [fallback] */
export function errorText(e, fallback) {
  const msg = (e && e.message) || fallback || "";
  return e && typeof e.ref === "string" && e.ref ? msg + " Reference: " + e.ref + "." : msg;
}
