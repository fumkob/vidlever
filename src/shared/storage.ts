// Typed wrapper over chrome.storage.sync (overview.md §9.1, §9.3).
// Settings are persisted under the `vl.` key namespace.

import { DEFAULT_SETTINGS, SCHEMA_VERSION } from "./defaults.ts";
import { parseSettings } from "./schema.ts";
import type { Binding, HudSettings, SpeedLimits, StoredSettings } from "./types.ts";

/** chrome.storage.sync keys, namespaced under `vl.` (overview.md §9.2). */
const KEY = {
  version: "vl.version",
  bindings: "vl.bindings",
  speedLimits: "vl.speedLimits",
  hud: "vl.hud",
} as const;

/** Every storage key, materialized once for the batched read. */
const ALL_KEYS = Object.values(KEY);

/**
 * Read the full settings object from chrome.storage.sync.
 *
 * - Missing version ⇒ first install: defaults are written and returned.
 * - Equal version ⇒ used as-is (per-key fallback to defaults if a key
 *   is somehow absent).
 * - Lower version ⇒ migrate (none defined in v1; see §9.3).
 */
export async function loadSettings(): Promise<StoredSettings> {
  const raw = await chrome.storage.sync.get(ALL_KEYS);

  const version = raw[KEY.version] as number | undefined;

  // First install: nothing stored yet — seed defaults.
  if (version === undefined) {
    const fresh = structuredClone(DEFAULT_SETTINGS);
    await saveSettings(fresh);
    return fresh;
  }

  // Future schema migrations land here:
  //   if (version < SCHEMA_VERSION) { /* migrate raw → current */ }
  // v1 defines none.

  // Sync storage is an untrusted channel — other devices or older builds can
  // write malformed or partial data — so validate the assembled object before
  // handing it to callers, falling back to defaults if its shape is corrupt.
  const candidate: StoredSettings = {
    version: SCHEMA_VERSION,
    bindings:
      (raw[KEY.bindings] as Binding[] | undefined) ?? structuredClone(DEFAULT_SETTINGS.bindings),
    speedLimits:
      (raw[KEY.speedLimits] as SpeedLimits | undefined) ??
      structuredClone(DEFAULT_SETTINGS.speedLimits),
    hud: (raw[KEY.hud] as HudSettings | undefined) ?? structuredClone(DEFAULT_SETTINGS.hud),
  };

  const parsed = parseSettings(candidate);
  return parsed.ok ? parsed.value : structuredClone(DEFAULT_SETTINGS);
}

/** Write the full settings object to chrome.storage.sync under `vl.*`. */
export async function saveSettings(settings: StoredSettings): Promise<void> {
  await chrome.storage.sync.set({
    [KEY.version]: settings.version,
    [KEY.bindings]: settings.bindings,
    [KEY.speedLimits]: settings.speedLimits,
    [KEY.hud]: settings.hud,
  });
}
