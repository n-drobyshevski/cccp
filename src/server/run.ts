// The one wrapper every endpoint body runs in: the role check comes first, an expected refusal
// (ApiError) keeps its kind and its message, and anything else is recorded in the error log under
// a short reference. The caller sees a fixed sentence and that reference; an admin or the owner
// also gets the fault's text as `detail`, so they can act on it without opening the logs. A
// refusal line in the log names the caller.
// Every message run() hands out, and every text the error log stores, goes through the kit's
// redactTokens first, so a bearer token or an API key inside a service error never reaches an
// envelope's detail or the RECENT_ERRORS property.
// It lives outside api.ts because every export of api.ts is an endpoint.
import { createRoleGate, createRun, redactTokens, roleAllows } from "@gas-kit/server";
import { access } from "./access";
import { ERROR_DETAIL_ROLE } from "./config";
import { errorLog } from "./errorLog";
import { ENDPOINT_ROLES } from "./roles";

const gate = createRoleGate(ENDPOINT_ROLES, () => access.role(), { who: () => access.decide().email });

export const run = createRun({
  requireRole: gate.requireRole,
  recordError: (op, err, ref) => errorLog.recordError(op, err, ref),
  detailFor: () => roleAllows(access.role(), ERROR_DETAIL_ROLE),
  redact: redactTokens,
});
