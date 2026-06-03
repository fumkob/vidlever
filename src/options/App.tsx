// Options app root (overview.md §10.1).
// Loads StoredSettings once, holds it in state, and persists edits back to
// chrome.storage.sync. Writes are debounced so rapid edits (typing, dragging,
// sliders) don't hammer sync's write-rate quota; import/reset flush immediately.
// The content script re-reads on chrome.storage.onChanged, so saving is all the
// wiring the live extension needs.

import { useEffect, useRef, useState } from "preact/hooks";
import { DEFAULT_SETTINGS } from "../shared/defaults.ts";
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
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The most recent edit still waiting out the debounce, so it can be flushed
  // if the page is hidden/closed before the timer fires.
  const pending = useRef<StoredSettings | null>(null);

  useEffect(() => {
    void loadSettings().then(setSettings);

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

  if (settings === null) {
    return <div class={styles.loading}>Loading settings…</div>;
  }

  return (
    <div class={styles.app}>
      <header class={styles.header}>
        <div class={styles.brand}>
          <span class={styles.dot} />
          <h1 class={styles.h1}>Vidlever</h1>
        </div>
        <p class={styles.tagline}>
          Keyboard-driven playback control for every HTML5 video. Changes save automatically and
          sync across every machine signed into your Chrome.
        </p>
      </header>

      <section class={styles.card}>
        <div class={styles.cardHead}>
          <h2 class={styles.cardTitle}>Shortcuts</h2>
          <p class={styles.cardDesc}>
            Bindings are matched top to bottom — on duplicate keys the first enabled match wins.
            Drag a row to change its priority.
          </p>
        </div>
        <BindingList
          bindings={settings.bindings}
          onChange={(bindings) => commit({ ...settings, bindings })}
        />
      </section>

      <section class={styles.card}>
        <div class={styles.cardHead}>
          <h2 class={styles.cardTitle}>Speed limits</h2>
          <p class={styles.cardDesc}>Bounds and rounding applied after every speed change.</p>
        </div>
        <SpeedLimits
          value={settings.speedLimits}
          onChange={(speedLimits) => commit({ ...settings, speedLimits })}
        />
      </section>

      <section class={styles.card}>
        <div class={styles.cardHead}>
          <h2 class={styles.cardTitle}>HUD</h2>
          <p class={styles.cardDesc}>
            The on-video overlay that shows the current speed plus mute and loop state.
          </p>
        </div>
        <HudSettings value={settings.hud} onChange={(hud) => commit({ ...settings, hud })} />
      </section>

      <section class={styles.card}>
        <div class={styles.cardHead}>
          <h2 class={styles.cardTitle}>Backup</h2>
          <p class={styles.cardDesc}>Export to a file, import a saved file, or reset everything.</p>
        </div>
        <ImportExport
          settings={settings}
          onImport={(next) => commit(next, true)}
          onReset={() => commit(structuredClone(DEFAULT_SETTINGS), true)}
        />
      </section>

      <footer class={styles.footer}>vidlever · settings · schema v{settings.version}</footer>
    </div>
  );
}
