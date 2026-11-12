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
import { TAB_KEYS, type FieldKey, type Issues } from "../domain/types";
import { FIELD_KEYS } from "../domain/fields";
import type { SourceMeta } from "../domain/payload";
import { BUILD_ID } from "../vendor/gas_shared/server/buildInfo";
import * as access from "./access";
import { peekRegisterEntry, registerEntry } from "./registerStore";
import { cached, cfgGen } from "./serverCache";
import { listSharedViews } from "./sharedViews";
import { loadSettings } from "./settingsStore";

const CORE = "core";

const DEGRADED_TTL_SEC = 30;

function unreachableMeta(): SourceMeta {
  const issues: Issues = { missingHeaders: [], missingTabs: TAB_KEYS.slice(), unmatched: [], duplicateIds: [], unparseable: [], unmapped: [] };
  return { title: "", url: "", tz: "Etc/GMT", loadedAt: "", dataVersion: 0, tabs: [], issues };
}

function buildCore(): { core: BootstrapCore; ttlSec: number } {
  const settings = loadSettings();
  const noSource = settings.source.sheetId === "";
  let meta: SourceMeta;
  let degraded = false;
  try {
    meta = registerEntry().meta;
  } catch (e) {
    // An unopenable source must not lock the owner out of Settings: serve an empty core.
    console.warn("Bootstrap core without the source: " + e);
    meta = unreachableMeta();
    degraded = true;
  }
  const unmapped = new Set<string>(meta.issues.unmapped.map((u) => u.field));
  const mapped = {} as Record<FieldKey, boolean>;
  for (const k of FIELD_KEYS) mapped[k] = !noSource && !degraded && !unmapped.has(k);
  return {
    core: {
      schemaVersion: SCHEMA_VERSION,
      sourceMeta: meta,
      publicSettings: buildPublicSettings(settings, mapped),
      sharedViews: listSharedViews(),
    },
    ttlSec: degraded ? DEGRADED_TTL_SEC : settings.source.cacheMinutes * 60,
  };
}

/** The viewer-free core, from the cache when warm. */
export function getCore(): BootstrapCore {
  let ttl = 600;
  const core = cached<BootstrapCore>(CORE, undefined, () => {
    const b = buildCore();
    ttl = b.ttlSec;
    return b.core;
  }, () => ttl, "cfg");
  // The two entries expire on their own; the freshest source facts win.
  const warm = peekRegisterEntry();
  return warm && core.sourceMeta.title !== "" ? { ...core, sourceMeta: warm.meta } : core;
}

export function todayIn(tz: string): string {
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
