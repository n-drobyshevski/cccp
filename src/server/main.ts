// The web-app entry point. doGet is called by src/gas/entry.js after the denial check. It never
// opens the source sheet: the bootstrap is inlined only when the core is already cached, so a
// cold open serves the page at once (an empty boot slot) and the client asks the bootstrap RPC
// behind its splash. A throw also renders the empty slot.
import { inlineIfWarm, renderIndex } from "@gas-kit/server";
import { bootstrapIfWarm } from "./bootstrap";
import { PRODUCT } from "./config";

export function doGet(_e?: unknown): GoogleAppsScript.HTML.HtmlOutput {
  return renderIndex({ title: PRODUCT, bootJson: inlineIfWarm(() => bootstrapIfWarm()) });
}
