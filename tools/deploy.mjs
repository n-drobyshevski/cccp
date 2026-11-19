// Push and redeploy the existing web-app deployment in place (DEPLOYMENT_ID is required).
import { APP_ROOT, kitImport } from "./kitPaths.mjs";

const { deploy } = await kitImport("tooling", "build/deploy.mjs");
process.exit(deploy({ root: APP_ROOT }));
