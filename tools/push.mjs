// Build, then check the fresh build, then clasp push --force. The order matters: the contracts
// test checks dist, so it must run after the build that is pushed (it fails instead of skipping
// when dist is absent in a push run, which this script marks with GAS_KIT_PUSH=1).
import { APP_ROOT, kitImport } from "./kitPaths.mjs";

const { push } = await kitImport("tooling", "build/push.mjs");
process.exit(push({ root: APP_ROOT }));
