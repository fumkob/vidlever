// A single binding row (overview.md §6.4).
// Renders the drag handle, enable toggle, action selector, optional numeric
// param, key capture, and the duplicate/delete icons. Building a new `Binding`
// when the action changes is the one subtle part: the discriminated union means
// each action carries its own (or no) params, so the transforms below are
// written as exhaustive switches that the type checker keeps honest.

import type { ActionType, Binding } from "../../shared/types.ts";
import { ACTION_PARAM_FIELD } from "../../shared/types.ts";
import styles from "../styles.module.css";
import { KeyCapture } from "./KeyCapture.tsx";

type Props = {
  binding: Binding;
  dragging: boolean;
  dragOver: boolean;
  onChange: (binding: Binding) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
};

/**
 * Action labels and <select> order in one place. The `Record<ActionType, …>`
 * makes the compiler require an entry for every action, and the declaration
 * order doubles as the dropdown order (insertion order is preserved for string
 * keys), so there is no separate list to keep in sync (§6.2).
 */
const ACTION_LABELS: Record<ActionType, string> = {
  playPause: "Play / Pause",
  skipForward: "Skip forward",
  skipBackward: "Skip backward",
  speedDelta: "Speed by delta",
  speedSet: "Set speed",
  muteToggle: "Mute / Unmute",
  fullscreenToggle: "Fullscreen",
  pipToggle: "Picture-in-Picture",
  seekToStart: "Seek to start",
  seekToEnd: "Seek to end",
  loopToggle: "Loop",
};

const ACTION_ORDER = Object.keys(ACTION_LABELS) as ActionType[];

/** Suffix shown after a param input, keyed by the action's param field. */
const PARAM_UNIT: Record<"seconds" | "delta" | "rate", string> = {
  seconds: "sec",
  delta: "Δ",
  rate: "×",
};

/** The single numeric param a binding carries, or null for param-less actions. */
function paramValueOf(b: Binding): number | null {
  if (!("params" in b)) return null;
  // Read the field ACTION_PARAM_FIELD designates for this action rather than
  // positionally (Object.values()[0]), so it stays correct if a param object
  // ever gains a second field.
  const field = ACTION_PARAM_FIELD[b.action];
  return (b.params as Record<string, number>)[field] ?? null;
}

/**
 * Rebuild a binding for a newly chosen action, keeping id/enabled/key. When the
 * param field name is unchanged (skipForward ⇄ skipBackward both use `seconds`)
 * the prior value carries over; otherwise it falls back to a sensible default.
 */
function buildBinding(b: Binding, action: ActionType): Binding {
  if (action === b.action) return b;
  const base = { id: b.id, enabled: b.enabled, key: b.key };
  const prevField = ACTION_PARAM_FIELD[b.action];
  const prev = paramValueOf(b);
  const seconds = prevField === "seconds" ? (prev ?? 10) : 10;
  const delta = prevField === "delta" ? (prev ?? 0.1) : 0.1;
  const rate = prevField === "rate" ? (prev ?? 1) : 1;

  switch (action) {
    case "skipForward":
      return { ...base, action: "skipForward", params: { seconds } };
    case "skipBackward":
      return { ...base, action: "skipBackward", params: { seconds } };
    case "speedDelta":
      return { ...base, action: "speedDelta", params: { delta } };
    case "speedSet":
      return { ...base, action: "speedSet", params: { rate } };
    case "playPause":
      return { ...base, action: "playPause" };
    case "muteToggle":
      return { ...base, action: "muteToggle" };
    case "fullscreenToggle":
      return { ...base, action: "fullscreenToggle" };
    case "pipToggle":
      return { ...base, action: "pipToggle" };
    case "seekToStart":
      return { ...base, action: "seekToStart" };
    case "seekToEnd":
      return { ...base, action: "seekToEnd" };
    case "loopToggle":
      return { ...base, action: "loopToggle" };
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

/** Write a new numeric param into a binding that has one (no-op otherwise). */
function setParamValue(b: Binding, value: number): Binding {
  switch (b.action) {
    case "skipForward":
      return { ...b, params: { seconds: value } };
    case "skipBackward":
      return { ...b, params: { seconds: value } };
    case "speedDelta":
      return { ...b, params: { delta: value } };
    case "speedSet":
      return { ...b, params: { rate: value } };
    default:
      return b;
  }
}

export function BindingRow({
  binding,
  dragging,
  dragOver,
  onChange,
  onDuplicate,
  onDelete,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: Props) {
  const paramField = ACTION_PARAM_FIELD[binding.action];
  const paramValue = paramValueOf(binding);

  const rowClass = [styles.row, dragging ? styles.rowDragging : "", dragOver ? styles.rowOver : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <li
      class={rowClass}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
    >
      <button
        type="button"
        class={styles.handle}
        title="Drag to reorder"
        aria-label="Drag to reorder"
        draggable
        onDragStart={(e) => {
          e.dataTransfer?.setData("text/plain", binding.id);
          onDragStart();
        }}
        onDragEnd={onDragEnd}
      >
        ⠿
      </button>

      <label class={styles.switch} title={binding.enabled ? "Enabled" : "Disabled"}>
        <input
          type="checkbox"
          checked={binding.enabled}
          onChange={(e) => onChange({ ...binding, enabled: e.currentTarget.checked })}
        />
        <span class={styles.track} />
      </label>

      <select
        class={styles.select}
        value={binding.action}
        onChange={(e) => onChange(buildBinding(binding, e.currentTarget.value as ActionType))}
      >
        {ACTION_ORDER.map((a) => (
          <option key={a} value={a}>
            {ACTION_LABELS[a]}
          </option>
        ))}
      </select>

      {paramField !== null ? (
        <label class={styles.param}>
          <input
            class={styles.num}
            type="number"
            step={paramField === "seconds" ? 1 : 0.05}
            value={paramValue ?? 0}
            onChange={(e) => {
              const n = e.currentTarget.valueAsNumber;
              if (Number.isFinite(n)) onChange(setParamValue(binding, n));
            }}
          />
          <span class={styles.unit}>{PARAM_UNIT[paramField]}</span>
        </label>
      ) : (
        <span class={styles.paramSpacer} />
      )}

      <KeyCapture combo={binding.key} onChange={(key) => onChange({ ...binding, key })} />

      <button
        type="button"
        class={styles.iconBtn}
        title="Duplicate"
        aria-label="Duplicate"
        onClick={onDuplicate}
      >
        ⧉
      </button>
      <button
        type="button"
        class={`${styles.iconBtn} ${styles.danger}`}
        title="Delete"
        aria-label="Delete"
        onClick={onDelete}
      >
        🗑
      </button>
    </li>
  );
}
