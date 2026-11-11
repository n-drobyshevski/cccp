// The html tagged template: every interpolation is escaped into SafeHtml. Literal template
// text is trusted markup; raw() is the one reviewed escape hatch.

class SafeHtml {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
// A backtick is not escaped: views always quote attribute values, and a literal backtick
// would trip the build guard that keeps the served bundle free of them.

export function escapeHtml(v) {
  return String(v).replace(/[&<>"']/g, (c) => ESC[c]);
}

export function isSafe(v) {
  return v instanceof SafeHtml;
}

/** Mark a string as already-safe markup. Needs review at every call site. */
export function raw(s) {
  return new SafeHtml(s == null ? "" : String(s));
}

function render(v) {
  if (v == null || v === false) return "";
  if (v instanceof SafeHtml) return v.s;
  if (Array.isArray(v)) return v.map(render).join("");
  return escapeHtml(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}
