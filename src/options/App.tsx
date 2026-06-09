// Options app root (overview.md §10.1).
// Loads StoredSettings once, holds it in state, and persists edits back to
// chrome.storage.sync. Writes are debounced so rapid edits (typing, dragging,
// sliders) don't hammer sync's write-rate quota; import/reset flush immediately.
// The content script re-reads on chrome.storage.onChanged, so saving is all the
// wiring the live extension needs.

import { useEffect, useRef, useState } from "preact/hooks";
import { DEFAULT_SETTINGS } from "../shared/defaults.ts";
import { t } from "../shared/i18n.ts";
import { loadSettings, saveSettings } from "../shared/storage.ts";
import type { StoredSettings } from "../shared/types.ts";
import { BindingList } from "./components/BindingList.tsx";
import { HudSettings } from "./components/HudSettings.tsx";
import { ImportExport } from "./components/ImportExport.tsx";
import { SpeedLimits } from "./components/SpeedLimits.tsx";
import styles from "./styles.module.css";

const SAVE_DEBOUNCE_MS = 300;

export function App() {
  const [settings, setSettings] = useState<StoredSettings | null>(null);
  // Distinguishes "still reading" (null) from "read failed" so the page can
  // show an error instead of hanging on the loading placeholder forever.
  const [loadFailed, setLoadFailed] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The most recent edit still waiting out the debounce, so it can be flushed
  // if the page is hidden/closed before the timer fires.
  const pending = useRef<StoredSettings | null>(null);

  useEffect(() => {
    // chrome.storage can reject (e.g. extension context invalidated after a
    // reload); surface that rather than leaving the page stuck loading.
    void loadSettings().then(setSettings, () => setLoadFailed(true));

    // Closing or switching away from the options tab fires visibilitychange but
    // not a Preact unmount, so a pending debounced edit would be lost. Persist
    // it the moment the page goes hidden (and on unmount as a backstop).
    const flush = (): void => {
      if (saveTimer.current !== null) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      if (pending.current !== null) {
        void saveSettings(pending.current);
        pending.current = null;
      }
    };
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, []);

  /**
   * Apply edited settings: update the UI immediately, then persist. `immediate`
   * skips the debounce for one-shot actions (import, reset) that should land at
   * once rather than waiting out the timer.
   */
  function commit(next: StoredSettings, immediate = false): void {
    setSettings(next);
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    if (immediate) {
      saveTimer.current = null;
      pending.current = null;
      void saveSettings(next);
      return;
    }
    pending.current = next;
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      pending.current = null;
      void saveSettings(next);
    }, SAVE_DEBOUNCE_MS);
  }

  if (loadFailed) {
    return <div class={styles.loading}>{t("optLoadError")}</div>;
  }
  if (settings === null) {
    return <div class={styles.loading}>{t("optLoading")}</div>;
  }

  return (
    <div class={styles.app}>
      <header class={styles.header}>
        <div class={styles.brand}>
          <span class={styles.dot} />
          <h1 class={styles.h1}>Vidlever</h1>
        </div>
        <p class={styles.tagline}>{t("optTagline")}</p>
      </header>

      <section class={styles.card}>
        <div class={styles.cardHead}>
          <h2 class={styles.cardTitle}>{t("optShortcutsTitle")}</h2>
          <p class={styles.cardDesc}>{t("optShortcutsDesc")}</p>
        </div>
        <BindingList
          bindings={settings.bindings}
          onChange={(bindings) => commit({ ...settings, bindings })}
        />
      </section>

      <section class={styles.card}>
        <div class={styles.cardHead}>
          <h2 class={styles.cardTitle}>{t("optSpeedTitle")}</h2>
          <p class={styles.cardDesc}>{t("optSpeedDesc")}</p>
        </div>
        <SpeedLimits
          value={settings.speedLimits}
          onChange={(speedLimits) => commit({ ...settings, speedLimits })}
        />
      </section>

      <section class={styles.card}>
        <div class={styles.cardHead}>
          <h2 class={styles.cardTitle}>{t("optHudTitle")}</h2>
          <p class={styles.cardDesc}>{t("optHudDesc")}</p>
        </div>
        <HudSettings value={settings.hud} onChange={(hud) => commit({ ...settings, hud })} />
      </section>

      <section class={styles.card}>
        <div class={styles.cardHead}>
          <h2 class={styles.cardTitle}>{t("optBackupTitle")}</h2>
          <p class={styles.cardDesc}>{t("optBackupDesc")}</p>
        </div>
        <ImportExport
          settings={settings}
          onImport={(next) => commit(next, true)}
          onReset={() => commit(structuredClone(DEFAULT_SETTINGS), true)}
        />
      </section>

      <footer class={styles.footer}>{t("optFooter", [String(settings.version)])}</footer>
    </div>
  );
}
