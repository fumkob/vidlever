// T5.3 — import validation (overview.md §9.5).
// Import never trusts its input, so parseSettings is the choke point: it must
// accept every well-formed StoredSettings and reject malformed ones with a
// precise, stable error message.

import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/shared/defaults.ts";
import { parseSettings } from "../src/shared/schema.ts";

/** A fresh valid settings object with the given top-level keys overridden. */
function settings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...structuredClone(DEFAULT_SETTINGS), ...overrides };
}

describe("parseSettings — valid input", () => {
  it("passes the shipped defaults through unchanged (same reference)", () => {
    const input = structuredClone(DEFAULT_SETTINGS);
    const result = parseSettings(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(input);
  });

  it("accepts an unbound binding (key: null)", () => {
    const input = settings({
      bindings: [{ id: "b1", enabled: false, key: null, action: "muteToggle" }],
    });
    expect(parseSettings(input).ok).toBe(true);
  });

  it("accepts a key combo carrying modifiers", () => {
    const input = settings({
      bindings: [
        {
          id: "b1",
          enabled: true,
          key: { key: "k", shift: true, ctrl: true, alt: false, meta: false },
          action: "playPause",
        },
      ],
    });
    expect(parseSettings(input).ok).toBe(true);
  });

  it("accepts an empty bindings list", () => {
    expect(parseSettings(settings({ bindings: [] })).ok).toBe(true);
  });

  it("accepts decimals: 1", () => {
    expect(parseSettings(settings({ speedLimits: { min: 0.25, max: 4, decimals: 1 } })).ok).toBe(
      true,
    );
  });

  it("ignores stray params on a param-less action", () => {
    // playPause carries no param field, so extra params are simply not inspected.
    const input = settings({
      bindings: [
        { id: "b1", enabled: true, key: { key: "p" }, action: "playPause", params: { foo: 1 } },
      ],
    });
    expect(parseSettings(input).ok).toBe(true);
  });
});

describe("parseSettings — invalid input", () => {
  const cases: Array<{ name: string; build: () => unknown; error: string }> = [
    // ----- top-level shape -----
    { name: "null", build: () => null, error: "settings must be a JSON object" },
    { name: "an array", build: () => [], error: "settings must be a JSON object" },
    { name: "a string", build: () => "{}", error: "settings must be a JSON object" },
    { name: "a number", build: () => 42, error: "settings must be a JSON object" },
    // ----- version -----
    {
      name: "a future version",
      build: () => settings({ version: 2 }),
      error: "unsupported version: 2 (expected 1)",
    },
    {
      name: "a missing version",
      build: () => settings({ version: undefined }),
      error: "unsupported version: undefined (expected 1)",
    },
    // ----- bindings container -----
    {
      name: "non-array bindings",
      build: () => settings({ bindings: "nope" }),
      error: "bindings must be an array",
    },
    {
      name: "a non-object binding",
      build: () => settings({ bindings: ["x"] }),
      error: "bindings[0] must be an object",
    },
    // ----- binding fields -----
    {
      name: "a missing binding id",
      build: () => settings({ bindings: [{ enabled: true, key: null, action: "muteToggle" }] }),
      error: "bindings[0].id must be a non-empty string",
    },
    {
      name: "an empty binding id",
      build: () =>
        settings({ bindings: [{ id: "", enabled: true, key: null, action: "muteToggle" }] }),
      error: "bindings[0].id must be a non-empty string",
    },
    {
      name: "a non-boolean enabled",
      build: () =>
        settings({ bindings: [{ id: "b1", enabled: "yes", key: null, action: "muteToggle" }] }),
      error: "bindings[0].enabled must be a boolean",
    },
    {
      name: "a non-object, non-null key",
      build: () =>
        settings({ bindings: [{ id: "b1", enabled: true, key: "Space", action: "muteToggle" }] }),
      error: "bindings[0].key must be an object or null",
    },
    {
      name: "an empty key.key",
      build: () =>
        settings({
          bindings: [{ id: "b1", enabled: true, key: { key: "" }, action: "muteToggle" }],
        }),
      error: "bindings[0].key.key must be a non-empty string",
    },
    {
      name: "a non-boolean modifier",
      build: () =>
        settings({
          bindings: [
            { id: "b1", enabled: true, key: { key: "k", shift: "x" }, action: "muteToggle" },
          ],
        }),
      error: "bindings[0].key.shift must be a boolean",
    },
    {
      name: "a non-string action",
      build: () => settings({ bindings: [{ id: "b1", enabled: true, key: null, action: 7 }] }),
      error: "bindings[0].action must be a string",
    },
    {
      name: "an unknown action",
      build: () =>
        settings({ bindings: [{ id: "b1", enabled: true, key: null, action: "frobnicate" }] }),
      error: 'bindings[0].action "frobnicate" is not a known action',
    },
    {
      // Object.hasOwn guards against inherited Object.prototype names slipping through.
      name: "a prototype method name as action",
      build: () =>
        settings({ bindings: [{ id: "b1", enabled: true, key: null, action: "toString" }] }),
      error: 'bindings[0].action "toString" is not a known action',
    },
    {
      name: "missing required params",
      build: () =>
        settings({
          bindings: [{ id: "b1", enabled: true, key: { key: "x" }, action: "skipForward" }],
        }),
      error: 'bindings[0].params is required for "skipForward"',
    },
    {
      name: "a non-finite param value",
      build: () =>
        settings({
          bindings: [
            {
              id: "b1",
              enabled: true,
              key: { key: "x" },
              action: "skipForward",
              params: { seconds: Number.NaN },
            },
          ],
        }),
      error: "bindings[0].params.seconds must be a finite number",
    },
    {
      name: "a missing param field",
      build: () =>
        settings({
          bindings: [
            { id: "b1", enabled: true, key: { key: "x" }, action: "skipForward", params: {} },
          ],
        }),
      error: "bindings[0].params.seconds must be a finite number",
    },
    // ----- speedLimits -----
    {
      name: "non-object speedLimits",
      build: () => settings({ speedLimits: 1 }),
      error: "speedLimits must be an object",
    },
    {
      name: "a non-positive min",
      build: () => settings({ speedLimits: { min: 0, max: 4, decimals: 2 } }),
      error: "speedLimits.min must be a number > 0",
    },
    {
      name: "a non-finite max",
      build: () =>
        settings({ speedLimits: { min: 0.25, max: Number.POSITIVE_INFINITY, decimals: 2 } }),
      error: "speedLimits.max must be a finite number",
    },
    {
      name: "max below min",
      build: () => settings({ speedLimits: { min: 2, max: 1, decimals: 2 } }),
      error: "speedLimits.max must be ≥ speedLimits.min",
    },
    {
      name: "decimals other than 1 or 2",
      build: () => settings({ speedLimits: { min: 0.25, max: 4, decimals: 3 } }),
      error: "speedLimits.decimals must be 1 or 2",
    },
    // ----- hud -----
    {
      name: "non-object hud",
      build: () => settings({ hud: null }),
      error: "hud must be an object",
    },
    {
      name: "a non-boolean hud.enabled",
      build: () =>
        settings({
          hud: { enabled: 1, opacityRest: 0.4, opacityHover: 0.9, overlayDurationMs: 1500 },
        }),
      error: "hud.enabled must be a boolean",
    },
    {
      name: "opacityRest out of [0,1]",
      build: () =>
        settings({
          hud: { enabled: true, opacityRest: 1.5, opacityHover: 0.9, overlayDurationMs: 1500 },
        }),
      error: "hud.opacityRest must be a number between 0 and 1",
    },
    {
      name: "opacityHover out of [0,1]",
      build: () =>
        settings({
          hud: { enabled: true, opacityRest: 0.4, opacityHover: -0.1, overlayDurationMs: 1500 },
        }),
      error: "hud.opacityHover must be a number between 0 and 1",
    },
    {
      name: "a negative overlayDurationMs",
      build: () =>
        settings({
          hud: { enabled: true, opacityRest: 0.4, opacityHover: 0.9, overlayDurationMs: -1 },
        }),
      error: "hud.overlayDurationMs must be a number ≥ 0",
    },
  ];

  it.each(cases)("rejects $name", ({ build, error }) => {
    expect(parseSettings(build())).toEqual({ ok: false, error });
  });
});
