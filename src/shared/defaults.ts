// Values shipped on first install (overview.md §6.2, §7, §9.2).

import type { Binding, HudSettings, SpeedLimits, StoredSettings } from "./types.ts";

/** Current storage schema version (overview.md §9.2 / §9.3). */
export const SCHEMA_VERSION = 1;

/**
 * The seven default bindings (overview.md §6.2). Order matters: on
 * duplicate keys the first enabled match wins (overview.md §6.1). The
 * ids are stable strings so reorders and exports stay diffable across
 * installs rather than churning on every write.
 *
 * `muteToggle`, `pipToggle`, `seekToStart`, `seekToEnd`, and `loopToggle`
 * ship unbound — the user adds them in the options page when needed.
 */
export const DEFAULT_BINDINGS: Binding[] = [
  { id: "default-play-pause", enabled: true, key: { key: "Space" }, action: "playPause" },
  {
    id: "default-skip-forward",
    enabled: true,
    key: { key: "ArrowRight" },
    action: "skipForward",
    params: { seconds: 10 },
  },
  {
    id: "default-skip-backward",
    enabled: true,
    key: { key: "ArrowLeft" },
    action: "skipBackward",
    params: { seconds: 10 },
  },
  { id: "default-fullscreen", enabled: true, key: { key: "f" }, action: "fullscreenToggle" },
  {
    id: "default-speed-up",
    enabled: true,
    key: { key: ".", shift: true },
    action: "speedDelta",
    params: { delta: 0.1 },
  },
  {
    id: "default-speed-down",
    enabled: true,
    key: { key: ",", shift: true },
    action: "speedDelta",
    params: { delta: -0.1 },
  },
  {
    id: "default-speed-reset",
    enabled: true,
    key: { key: "r" },
    action: "speedSet",
    params: { rate: 1.0 },
  },
];

/** Default playback-rate bounds and rounding (overview.md §7). */
export const DEFAULT_SPEED_LIMITS: SpeedLimits = {
  min: 0.25,
  max: 4.0,
  decimals: 2,
};

/** Default HUD configuration (overview.md §8.2, §9.2). */
export const DEFAULT_HUD: HudSettings = {
  enabled: true,
  opacityRest: 0.4,
  opacityHover: 0.9,
  overlayDurationMs: 1500,
};

/** The full default settings object written on first install. */
export const DEFAULT_SETTINGS: StoredSettings = {
  version: SCHEMA_VERSION,
  bindings: DEFAULT_BINDINGS,
  speedLimits: DEFAULT_SPEED_LIMITS,
  hud: DEFAULT_HUD,
};
