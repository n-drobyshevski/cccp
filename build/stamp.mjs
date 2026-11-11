// Thin wrapper over the vendored buildStamp, which covers src/ including src/vendor.
import { buildStamp } from "../src/vendor/gas_shared/build/buildStamp.mjs";

export function stampFor(root) {
  return buildStamp(root);
}
