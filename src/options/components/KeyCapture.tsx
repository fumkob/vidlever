// Key-combo capture field (overview.md §6.4).
// Clicking the field enters "listening" mode; the next non-modifier keystroke
// becomes the combo. Escape cancels without changing anything. Clear sets
// `key: null` — unbound but retained, so the row's params survive (§6.1).

import { useEffect, useState } from "preact/hooks";
import type { KeyCombo } from "../../shared/types.ts";
import styles from "../styles.module.css";

type Props = {
  combo: KeyCombo | null;
  onChange: (combo: KeyCombo | null) => void;
};

/** Modifier keys are skipped while listening — we wait for the real key. */
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

/** Friendlier glyphs for keys whose `KeyboardEvent.key` name reads poorly. */
const KEY_DISPLAY: Record<string, string> = {
  " ": "Space",
  Space: "Space",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Escape: "Esc",
  Enter: "Enter",
  Tab: "Tab",
};

function displayKey(key: string): string {
  return KEY_DISPLAY[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}

function formatCombo(combo: KeyCombo): string {
  const parts: string[] = [];
  if (combo.ctrl) parts.push("Ctrl");
  if (combo.alt) parts.push("Alt");
  if (combo.shift) parts.push("Shift");
  if (combo.meta) parts.push("Meta");
  parts.push(displayKey(combo.key));
  return parts.join(" + ");
}

/**
 * Build a stored combo from an event. Mirrors keymap.ts: the space bar reports
 * " " on the DOM side but is stored as "Space". Only true modifiers are set, so
 * the persisted object stays minimal (matchers read each modifier as `?? false`).
 */
function comboFromEvent(e: KeyboardEvent): KeyCombo {
  const combo: KeyCombo = { key: e.key === " " ? "Space" : e.key };
  if (e.shiftKey) combo.shift = true;
  if (e.ctrlKey) combo.ctrl = true;
  if (e.altKey) combo.alt = true;
  if (e.metaKey) combo.meta = true;
  return combo;
}

export function KeyCapture({ combo, onChange }: Props) {
  const [listening, setListening] = useState(false);

  useEffect(() => {
    if (!listening) return;
    // Capture phase + preventDefault so the captured keystroke never reaches the
    // page (or triggers the options page's own controls) while we record it.
    function onKey(e: KeyboardEvent): void {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setListening(false);
        return;
      }
      if (MODIFIER_KEYS.has(e.key)) return;
      onChange(comboFromEvent(e));
      setListening(false);
    }
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [listening, onChange]);

  const label = listening ? "Press a key…" : combo ? formatCombo(combo) : "Unbound";
  const btnClass = [
    styles.keyBtn,
    listening ? styles.keyBtnListening : "",
    combo === null ? styles.keyBtnUnbound : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div class={styles.keyCapture}>
      <button
        type="button"
        class={btnClass}
        onClick={() => setListening((v) => !v)}
        // Leaving the button (clicking elsewhere, or another row's capture
        // button) cancels listening, so a keystroke aimed at another control is
        // never hijacked and two rows can't capture the same key at once.
        onBlur={() => setListening(false)}
      >
        {label}
      </button>
      <button
        type="button"
        class={styles.clearBtn}
        title="Unbind (keep the row)"
        disabled={combo === null && !listening}
        onClick={() => {
          setListening(false);
          onChange(null);
        }}
      >
        Clear
      </button>
    </div>
  );
}
