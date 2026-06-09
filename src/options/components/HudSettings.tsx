// HUD appearance editor (overview.md §8.5, §9.2).
// enabled / opacityRest / opacityHover / overlayDurationMs. Opacities are
// sliders (live feedback, can't escape 0–1); duration is a number committed on
// blur. Values stay within the ranges schema.ts `validateHud` enforces.

import type { MessageKey } from "../../shared/i18n.ts";
import { t } from "../../shared/i18n.ts";
import type { HudSettings as HudConfig } from "../../shared/types.ts";
import styles from "../styles.module.css";

type Props = {
  value: HudConfig;
  onChange: (value: HudConfig) => void;
};

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** A 0–1 opacity slider with a live readout; the two HUD opacities share it. */
function OpacitySlider({
  labelKey,
  current,
  onChange,
}: {
  labelKey: MessageKey;
  current: number;
  onChange: (n: number) => void;
}) {
  return (
    <label class={styles.field}>
      <span class={styles.fieldLabel}>
        {t(labelKey)} <b class={styles.rangeVal}>{current.toFixed(2)}</b>
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={current}
        onInput={(e) => onChange(clamp01(e.currentTarget.valueAsNumber))}
      />
    </label>
  );
}

export function HudSettings({ value, onChange }: Props) {
  return (
    <div class={styles.grid}>
      <label class={`${styles.field} ${styles.fieldInline}`}>
        <span class={styles.fieldLabel}>{t("optHudShow")}</span>
        <span class={styles.switch}>
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(e) => onChange({ ...value, enabled: e.currentTarget.checked })}
          />
          <span class={styles.track} />
        </span>
      </label>

      <OpacitySlider
        labelKey="optHudOpacityRest"
        current={value.opacityRest}
        onChange={(n) => onChange({ ...value, opacityRest: n })}
      />

      <OpacitySlider
        labelKey="optHudOpacityHover"
        current={value.opacityHover}
        onChange={(n) => onChange({ ...value, opacityHover: n })}
      />

      <label class={styles.field}>
        <span class={styles.fieldLabel}>{t("optHudDuration")}</span>
        <input
          class={styles.num}
          type="number"
          min={0}
          step={100}
          value={value.overlayDurationMs}
          onChange={(e) => {
            const n = e.currentTarget.valueAsNumber;
            if (Number.isFinite(n)) onChange({ ...value, overlayDurationMs: Math.max(0, n) });
          }}
        />
      </label>
    </div>
  );
}
