// Runtime validation for imported settings (overview.md §9.5).
// Import must never trust its input: the JSON is validated against the
// StoredSettings shape before it is written to storage.

import { SCHEMA_VERSION } from "./defaults.ts";
import type { ActionType, StoredSettings } from "./types.ts";
import { ACTION_PARAM_FIELD } from "./types.ts";

export type ParseResult = { ok: true; value: StoredSettings } | { ok: false; error: string };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Prototype-safe membership test that also narrows `s` to `ActionType`. */
function isActionType(s: string): s is ActionType {
  return Object.hasOwn(ACTION_PARAM_FIELD, s);
}

function validateKeyCombo(v: unknown): string | null {
  if (!isObject(v)) return "key must be an object or null";
  if (typeof v.key !== "string" || v.key.length === 0) {
    return "key.key must be a non-empty string";
  }
  for (const mod of ["shift", "ctrl", "alt", "meta"] as const) {
    if (Object.hasOwn(v, mod) && typeof v[mod] !== "boolean") {
      return `key.${mod} must be a boolean`;
    }
  }
  return null;
}

function validateBinding(v: unknown, i: number): string | null {
  if (!isObject(v)) return `bindings[${i}] must be an object`;
  if (typeof v.id !== "string" || v.id.length === 0) {
    return `bindings[${i}].id must be a non-empty string`;
  }
  if (typeof v.enabled !== "boolean") return `bindings[${i}].enabled must be a boolean`;

  if (v.key !== null) {
    const keyErr = validateKeyCombo(v.key);
    if (keyErr) return `bindings[${i}].${keyErr}`;
  }

  if (typeof v.action !== "string") return `bindings[${i}].action must be a string`;
  if (!isActionType(v.action)) {
    return `bindings[${i}].action "${v.action}" is not a known action`;
  }
  const paramField = ACTION_PARAM_FIELD[v.action];

  if (paramField !== null) {
    if (!isObject(v.params)) return `bindings[${i}].params is required for "${v.action}"`;
    if (!isFiniteNumber(v.params[paramField])) {
      return `bindings[${i}].params.${paramField} must be a finite number`;
    }
  }

  return null;
}

function validateSpeedLimits(v: unknown): string | null {
  if (!isObject(v)) return "speedLimits must be an object";
  if (!isFiniteNumber(v.min) || v.min <= 0) return "speedLimits.min must be a number > 0";
  if (!isFiniteNumber(v.max)) return "speedLimits.max must be a finite number";
  if (v.max < v.min) return "speedLimits.max must be ≥ speedLimits.min";
  if (v.decimals !== 1 && v.decimals !== 2) return "speedLimits.decimals must be 1 or 2";
  return null;
}

function validateHud(v: unknown): string | null {
  if (!isObject(v)) return "hud must be an object";
  if (typeof v.enabled !== "boolean") return "hud.enabled must be a boolean";
  for (const field of ["opacityRest", "opacityHover"] as const) {
    const n = v[field];
    if (!isFiniteNumber(n) || n < 0 || n > 1) {
      return `hud.${field} must be a number between 0 and 1`;
    }
  }
  if (!isFiniteNumber(v.overlayDurationMs) || v.overlayDurationMs < 0) {
    return "hud.overlayDurationMs must be a number ≥ 0";
  }
  return null;
}

/**
 * Validate arbitrary parsed JSON as a {@link StoredSettings} object.
 * Returns a discriminated result so callers (ImportExport) can surface
 * a precise error without a try/catch.
 */
export function parseSettings(data: unknown): ParseResult {
  if (!isObject(data)) return { ok: false, error: "settings must be a JSON object" };
  if (data.version !== SCHEMA_VERSION) {
    return {
      ok: false,
      error: `unsupported version: ${String(data.version)} (expected ${SCHEMA_VERSION})`,
    };
  }
  if (!Array.isArray(data.bindings)) return { ok: false, error: "bindings must be an array" };
  for (let i = 0; i < data.bindings.length; i++) {
    const err = validateBinding(data.bindings[i], i);
    if (err) return { ok: false, error: err };
  }

  const speedErr = validateSpeedLimits(data.speedLimits);
  if (speedErr) return { ok: false, error: speedErr };

  const hudErr = validateHud(data.hud);
  if (hudErr) return { ok: false, error: hudErr };

  return { ok: true, value: data as unknown as StoredSettings };
}
