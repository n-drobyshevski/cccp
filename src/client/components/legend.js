// The status legend of the list head: one dot per status with its word, in the order the
// mockup shows. The 'No data' dot is dashed, so the legend never relies on colour alone.
import { html } from "../lib/html.js";
import { STATUS_WORD } from "../../domain/facets";
import { dot } from "./dots.js";

export const LEGEND_ORDER = ["ok", "warn", "bad", "none"];

export function legend() {
  return html`<div class="legend" role="group" aria-label="Status legend">${LEGEND_ORDER.map((k) => html`<span>${dot(k)}${STATUS_WORD[k]}</span>`)}</div>`;
}
