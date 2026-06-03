// keydown → binding match (overview.md §6.1, §6.3).

import type { Binding, KeyCombo } from "../shared/types.ts";

/**
 * Normalize a `KeyboardEvent.key` to the naming used by stored combos. Only the
 * space bar differs: the DOM reports `" "`, while bindings store `"Space"`
 * (overview.md §6.1 / types.ts `KeyCombo`).
 */
function normalizeKey(key: string): string {
  return key === " " ? "Space" : key;
}

/** Whether a stored combo matches an actual keydown event. */
export function comboMatches(combo: KeyCombo, event: KeyboardEvent): boolean {
  return (
    normalizeKey(event.key) === combo.key &&
    event.shiftKey === (combo.shift ?? false) &&
    event.ctrlKey === (combo.ctrl ?? false) &&
    event.altKey === (combo.alt ?? false) &&
    event.metaKey === (combo.meta ?? false)
  );
}

/**
 * Find the binding that should fire for an event. Bindings are scanned in list
 * order and the first enabled, bound match wins, so duplicate key combos are
 * resolved by user-controlled priority (overview.md §6.1). `enabled: false` and
 * `key: null` entries are skipped. Returns `null` when nothing matches.
 */
export function matchBinding(bindings: Binding[], event: KeyboardEvent): Binding | null {
  for (const binding of bindings) {
    if (!binding.enabled || binding.key === null) continue;
    if (comboMatches(binding.key, event)) return binding;
  }
  return null;
}
