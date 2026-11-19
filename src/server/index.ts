// Bundle root: everything exported here lands on the GAS global `Server`
// (see tools/build.mjs and src/gas/entry.js).
export { doGet } from "./main";
// include serves only the kit's allow-listed partials (styles, js_app); beginExecution marks a new
// execution (entry.js calls it first in doGet and timedApi_), so no per-execution memo of the
// property store or the cache outlives its request.
export { include, beginExecution } from "@gas-kit/server";
// The fixed sentence src/gas/entry.js answers with when its own checks fail.
export { UNEXPECTED_ERROR_MESSAGE } from "@gas-kit/server";
export { setup } from "./setup";
export { diagnosticsText } from "./diagnostics";
export * as access from "./access";
export * as api from "./api";
