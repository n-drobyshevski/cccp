/* Extracted from the author's production Apps Script apps; adapted.
   Evaluating one gallery example: the example expression runs with the component exports in scope and
   must return SafeHtml. A throw, or any other result, becomes an error card (role=alert), never a
   blank card. */
import { html, isSafe } from "@gas-kit/client";

/** @param {string} message */
export function errorCard(message) {
  return html`<div class="gal-error" role="alert"><strong>This example failed.</strong> ${message}</div>`;
}

/**
 * @param {string} code the example expression
 * @param {Record<string, any>} scope names the expression may use
 */
export function evaluate(code, scope) {
  const keys = Object.keys(scope);
  const fn = new Function(keys.join(","), "return (" + code + "\n);");
  const out = fn.apply(null, keys.map((k) => scope[k]));
  if (!isSafe(out)) throw new Error("the example did not return SafeHtml");
  return out;
}

/** The view of one example; never throws. @param {string} code @param {Record<string, any>} scope */
export function exampleView(code, scope) {
  try {
    return evaluate(code, scope);
  } catch (e) {
    return errorCard(String((/** @type {any} */ (e)) && (/** @type {any} */ (e)).message || e));
  }
}
