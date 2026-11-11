// Bundle root: everything exported here lands on the GAS global `Server`
// (see build/esbuild.config.mjs and src/gas/entry.js).
export { doGet, include } from "./main";
export { setup } from "./setup";
export * as access from "./access";
export * as api from "./api";
