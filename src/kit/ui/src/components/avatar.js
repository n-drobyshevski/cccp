// Anatomy and styling ported from shadcn/ui new-york v4 (MIT; see THIRD_PARTY_NOTICES.md).
import { html, attrs, isSafeUrl } from "@gas-kit/client/html.js";

/**
 * Up to two initials from a name: the first letters of the first and last words.
 * @param {unknown} name
 * @returns {string}
 * @internal
 */
export function initials(name) {
  const words = String(name == null ? "" : name).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const first = Array.from(words[0])[0];
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] : "";
  return (first + last).toUpperCase();
}

/**
 * @component avatar
 * @title Avatar
 * @category Data display
 * @summary A round picture of a person or account, with initials when there is no picture.
 * @param {{name: string, src?: string, size?: "sm"|"default"|"lg", k?: string}} p
 * `name` is required: it is the accessible name and the source of the initials (first and last word, at most two letters; "?" when empty). `src` is an https image URL; anything else (http, relative, data: or an unsafe scheme) is ignored and the initials show. The image is requested with referrerpolicy="no-referrer". The image sits over the initials with empty alt text, so a picture that fails to load leaves the initials visible. Pass `src` in an app to show a picture, for example avatar({ name: "Ada Lovelace", src: user.photoUrl }); the examples omit it so the gallery makes no image request. Sizes are 24, 32 and 40px.
 * @emits none
 * @states initials, sm, lg
 * @a11y The wrapper is role="img" with the name as aria-label, and both the initials and the picture are hidden from assistive tech, so the person is announced once by name.
 * @example initials: avatar({ name: "Ada Lovelace" })
 * @example sm: avatar({ name: "Acme Support", size: "sm" })
 * @example lg: avatar({ name: "Grace", size: "lg" })
 */
export function avatar(p) {
  const q = p || { name: "" };
  const size = q.size === "sm" || q.size === "lg" ? q.size : "default";
  // https only, so the picture is never fetched in clear text, and no referrer, so the host of
  // the picture does not learn which app page showed it.
  const img = q.src != null && q.src !== "" && isSafeUrl(q.src) && /^https:/i.test(String(q.src));
  return html`<span ${attrs({ class: "gk-avatar is-" + size, role: "img", "aria-label": q.name != null && q.name !== "" ? q.name : "Unknown", "data-k": q.k != null && q.k !== "" ? q.k : null })}><span class="gk-avatar__fallback" aria-hidden="true">${initials(q.name)}</span>${img ? html`<img ${attrs({ class: "gk-avatar__image", src: q.src, alt: "", "aria-hidden": "true", loading: "lazy", referrerpolicy: "no-referrer" })}>` : ""}</span>`;
}
