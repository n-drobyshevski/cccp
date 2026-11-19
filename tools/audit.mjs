// The dependency audit over this app's package-lock.json: the kit's deps/audit.mjs, which holds
// npm's advisories (dev tools included) to a level and the dated exceptions in audit-allow.json.
//
//   npm run audit                      level moderate; exit 1 on a finding, 2 when it cannot run
//   npm run audit -- --level high      what npm run push holds it to
import { APP_ROOT, kitImport } from "./kitPaths.mjs";

const { main } = await kitImport("tooling", "deps/audit.mjs");
process.exit(main(process.argv.slice(2), { cwd: APP_ROOT }));
