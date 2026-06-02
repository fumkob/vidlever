// Core domain types and action metadata shared by the content script and the options page.
// Mirrors overview.md §6.1 (binding model) and §9.2 (storage schema).

/**
 * A single key combination. `key` follows `KeyboardEvent.key` naming
 * (e.g. "ArrowRight", "f", "."), with "Space" used for the space bar.
 * Modifiers are omitted when not required.
 */
export type KeyCombo = {
  key: string;
  shift?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  meta?: boolean;
};

/**
 * The fixed library of playback actions (overview.md §3, §6.1).
 * Discriminated on `action`; parameterized variants carry `params`.
 */
export type ActionSpec =
  | { action: "playPause" }
  | { action: "skipForward"; params: { seconds: number } }
  | { action: "skipBackward"; params: { seconds: number } }
  | { action: "speedDelta"; params: { delta: number } }
  | { action: "speedSet"; params: { rate: number } }
  | { action: "muteToggle" }
  | { action: "fullscreenToggle" }
  | { action: "pipToggle" }
  | { action: "seekToStart" }
  | { action: "seekToEnd" }
  | { action: "loopToggle" };

/** The `action` discriminant alone — handy for exhaustive switches. */
export type ActionType = ActionSpec["action"];

/**
 * The numeric param field a given action requires, derived straight from
 * `ActionSpec` so it cannot drift: param-carrying variants resolve to their
 * own field name, param-less variants to `null`.
 */
type ParamFieldOf<A extends ActionType> =
  Extract<ActionSpec, { action: A }> extends {
    params: infer P;
  }
    ? keyof P & string
    : null;

/**
 * Per-action metadata: the numeric param field each action requires, or
 * `null` for the param-less actions. Single source of truth that the import
 * validator (and, later, the executor and options UI) derive from. The
 * `satisfies { [A in ActionType]: ParamFieldOf<A> }` ties every entry back to
 * `ActionSpec`, so adding a 12th action — or naming the wrong field — is a
 * compile error here until it matches.
 */
export const ACTION_PARAM_FIELD = {
  playPause: null,
  skipForward: "seconds",
  skipBackward: "seconds",
  speedDelta: "delta",
  speedSet: "rate",
  muteToggle: null,
  fullscreenToggle: null,
  pipToggle: null,
  seekToStart: null,
  seekToEnd: null,
  loopToggle: null,
} as const satisfies { [A in ActionType]: ParamFieldOf<A> };

/**
 * One user-editable rule mapping a key combo to an action.
 * `key: null` keeps the entry inert but preserved; `enabled: false`
 * soft-disables without unbinding (overview.md §6.1).
 */
export type Binding = {
  id: string;
  enabled: boolean;
  key: KeyCombo | null;
} & ActionSpec;

/** Playback-rate bounds and rounding (overview.md §7). */
export type SpeedLimits = {
  min: number;
  max: number;
  decimals: 1 | 2;
};

/** HUD appearance and timing (overview.md §8). */
export type HudSettings = {
  enabled: boolean;
  opacityRest: number;
  opacityHover: number;
  overlayDurationMs: number;
};

/** The complete persisted settings object (overview.md §9.2). */
export type StoredSettings = {
  version: 1;
  bindings: Binding[];
  speedLimits: SpeedLimits;
  hud: HudSettings;
};
