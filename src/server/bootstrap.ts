// The bootstrap, split in two.
//
// CORE: cached, identical for every viewer, keyed by DATA_VERSION and CFG_GEN. It holds only
// what everyone may see: the source facts, the public settings and the shared views.
// LIVE: computed on every call and never cached: who is asking, the role flags, the service
// URL, the build id, today in the Sheet's time zone and the settings generation.
// REGISTER: attached only when it is already warm in the cache and at most 600 KB, so the page
// never pays a cold read for it; otherwise the client asks api_getRegister.
//
// Pattern from sidekick gas_devsecops/src/server/bootCore.ts at commit 77bcf22: nothing
// per-viewer may ever enter the core. test/server/bootstrap.test.ts pins it with a key
// allowlist and a scan of the cache for the viewers' addresses.

import {
  buildPublicSettings, payloadBytes, REGISTER_INLINE_MAX_BYTES, SCHEMA_VERSION,
  type BootstrapCore, type BootstrapLive, type BootstrapResponse,
} from "../domain/payload";
import type { FieldKey } from "../domain/types";
import { FIELD_KEYS } from "../domain/fields";
import { BUILD_ID } from "../vendor/gas_shared/server/buildInfo";
import * as access from "./access";
import { peekRegisterEntry, registerEntry } from "./registerStore";
import { cached, cfgGen } from "./serverCache";
import { listSharedViews } from "./sharedViews";
import { loadSettings } from "./settingsStore";

const CORE = "core";

function buildCore(): { core: BootstrapCore; ttlSec: number } {
  const settings = loadSettings();
  const entry = registerEntry();
  const unmapped = new Set<string>(entry.meta.issues.unmapped.map((u) => u.field));
  const noSource = settings.source.sheetId === "";
  const mapped = {} as Record<FieldKey, boolean>;
  for (const k of FIELD_KEYS) mapped[k] = !noSource && !unmapped.has(k);
  return {
    core: {
      schemaVersion: SCHEMA_VERSION,
      sourceMeta: entry.meta,
      publicSettings: buildPublicSettings(settings, mapped),
      sharedViews: listSharedViews(),
    },
    ttlSec: settings.source.cacheMinutes * 60,
  };
}

/** The viewer-free core, from the cache when warm. */
export function getCore(): BootstrapCore {
  let ttl = 600;
  return cached<BootstrapCore>(CORE, undefined, () => {
    const b = buildCore();
    ttl = b.ttlSec;
    return b.core;
  }, () => ttl, "cfg");
}

function todayIn(tz: string): string {
  const now = new Date();
  try {
    return Utilities.formatDate(now, tz, "yyyy-MM-dd");
  } catch (_e) {
    return Utilities.formatDate(now, "Etc/GMT", "yyyy-MM-dd");
  }
}

/** The per-viewer part. Never cached. */
export function getLive(core: BootstrapCore): BootstrapLive {
  const url = access.serviceUrl() ?? "";
  return {
    viewer: {
      email: access.check().email,
      role: access.role() ?? "viewer",
      canEditSettings: access.canEditSettings(),
      canEditAdmins: access.canEditAdmins(),
      canEditSource: access.canEditSource(),
      canEditMode: access.canEditMode(),
    },
    serviceUrl: url,
    buildId: BUILD_ID,
    today: todayIn(core.sourceMeta.tz),
    cfgGen: cfgGen(),
  };
}

export function getBootstrap(): BootstrapResponse {
  const core = getCore();
  const res: BootstrapResponse = { core, live: getLive(core) };
  const warm = peekRegisterEntry();
  if (warm && payloadBytes(warm.register) <= REGISTER_INLINE_MAX_BYTES) res.register = warm.register;
  return res;
}
