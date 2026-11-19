// Extracted from the author's production Apps Script apps; adapted.
// The build id: a build-time define (__BUILD_ID__) stamped by the bundler, "dev" when unset.

declare const __BUILD_ID__: string | undefined;

/** The build id, read at call time so a test can set the define. */
export function buildId(): string {
  return typeof __BUILD_ID__ !== "undefined" && __BUILD_ID__ ? String(__BUILD_ID__) : "dev";
}
