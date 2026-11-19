// The recent-errors log: the kit's ring buffer bound to CCCP's Script Properties (the kit keeps it
// in RECENT_ERRORS, the property CCCP always used, so stored entries carry over). One instance for
// the whole app, so a thrown value is recorded once however many layers catch it. Every message
// it stores goes through the kit's redactTokens, so a bearer token or an API key inside a service
// error never reaches the property.
import { createErrorLog, deleteProp, getProp, redactTokens, setProp } from "@gas-kit/server";

export const errorLog = createErrorLog({ get: getProp, set: setProp, delete: deleteProp }, { redact: redactTokens });
