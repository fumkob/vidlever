// Playback-rate bounds editor (overview.md §7).
// Min / max / decimals. The handlers preserve the schema invariants the storage
// validator enforces (min > 0, max ≥ min); committing on `change` (blur) rather
// than every keystroke avoids fighting the user mid-edit when a value is briefly
// out of range. See schema.ts `validateSpeedLimits`.

import type { SpeedLimits as SpeedLimitsConfig } from "../../shared/types.ts";
import styles from "../styles.module.css";

type Props = {
  value: SpeedLimitsConfig;
  onChange: (value: SpeedLimitsConfig) => void;
};

/** Smallest rate we let either bound take — schema requires min > 0. */
const FLOOR = 0.05;

export function SpeedLimits({ value, onChange }: Props) {
  function setMin(n: number): void {
    if (!Number.isFinite(n)) return;
    const min = Math.max(FLOOR, n);
    onChange({ ...value, min, max: Math.max(min, value.max) });
  }

  function setMax(n: number): void {
    if (!Number.isFinite(n)) return;
    const max = Math.max(FLOOR, n);
    onChange({ ...value, max, min: Math.min(value.min, max) });
  }

  return (
    <div class={styles.grid}>
      <label class={styles.field}>
        <span class={styles.fieldLabel}>Minimum rate</span>
        <input
          class={styles.num}
          type="number"
          min={FLOOR}
          step={0.05}
          value={value.min}
          onChange={(e) => setMin(e.currentTarget.valueAsNumber)}
        />
      </label>

      <label class={styles.field}>
        <span class={styles.fieldLabel}>Maximum rate</span>
        <input
          class={styles.num}
          type="number"
          min={FLOOR}
          step={0.05}
          value={value.max}
          onChange={(e) => setMax(e.currentTarget.valueAsNumber)}
        />
      </label>

      <label class={styles.field}>
        <span class={styles.fieldLabel}>Rounding</span>
        <select
          class={styles.select}
          value={String(value.decimals)}
          onChange={(e) => onChange({ ...value, decimals: e.currentTarget.value === "1" ? 1 : 2 })}
        >
          <option value="1">1 decimal (0.1 steps)</option>
          <option value="2">2 decimals (0.01 steps)</option>
        </select>
      </label>
    </div>
  );
}
