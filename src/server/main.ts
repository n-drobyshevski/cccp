import { inlineBootJson } from "../vendor/gas_shared/server/inlineBoot";
import { bootstrap } from "./api";

export function doGet(_e: GoogleAppsScript.Events.DoGet): GoogleAppsScript.HTML.HtmlOutput {
  const template = HtmlService.createTemplateFromFile("index");
  // The bootstrap rides in the page; "" when it cannot be computed, and the client then asks.
  template.bootJson = inlineBootJson(() => bootstrap());
  return template
    .evaluate()
    .setTitle("CCCP")
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** Used from index.html scriptlets. */
export function include(filename: string): string {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
