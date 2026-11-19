// The one icon the kit's set (@gas-kit/client icons.js) does not have: the "!" mark inside the
// Attention glyph (a stem and a dot, with no outline, unlike the kit's "alert" triangle). Same
// svg wrapper as the kit's icon(), so it draws identically. Every other icon comes from the kit.
import { raw } from "@gas-kit/client/html.js";

/** The "!" mark as SafeHtml. */
export function bangIcon() {
  // raw() is safe: a static literal with no interpolated data.
  return raw('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 5v9M12 19h.01"/></svg>');
}
