import { inlineBootJson } from "../vendor/gas_shared/server/inlineBoot";
import { bootstrapIfWarm } from "./bootstrap";

export function doGet(_e: GoogleAppsScript.Events.DoGet): GoogleAppsScript.HTML.HtmlOutput {
  const template = HtmlService.createTemplateFromFile("index");
  // The bootstrap rides in the page only when the cache can build it: doGet never reads the
  // Sheet, so a cold open serves the page at once ("" here) and the client asks api_bootstrap
  // behind its splash. A throw also renders "".
  template.bootJson = inlineBootJson(() => {
    const data = bootstrapIfWarm();
    return data ? { ok: true, data } : { ok: false };
  });
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
