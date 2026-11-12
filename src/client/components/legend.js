// The status legend of the Overview: one square per status with its word, in the order the
// mockup shows. The 'No data' square is dashed, so the legend never relies on colour alone.
import { html } from "../lib/html.js";
import { STATUS_WORD } from "../../domain/facets";

export const LEGEND_ORDER = ["ok", "warn", "bad", "none"];

export function legend() {
  return html`<div class="legend" role="group" aria-label="Status legend">${LEGEND_ORDER.map((k) => html`<span><i class="sq ls-${k}" aria-hidden="true"></i>${STATUS_WORD[k]}</span>`)}</div>`;
}
