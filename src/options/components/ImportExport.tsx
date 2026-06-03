// Export / Import / Reset (overview.md §9.5).
// Export downloads the full StoredSettings as JSON. Import never trusts its
// input — the file is parsed and run through schema.ts before it is applied.
// Reset confirms first, then overwrites with shipped defaults.

import { useRef, useState } from "preact/hooks";
import { parseSettings } from "../../shared/schema.ts";
import type { StoredSettings } from "../../shared/types.ts";
import styles from "../styles.module.css";

type Props = {
  settings: StoredSettings;
  onImport: (settings: StoredSettings) => void;
  onReset: () => void;
};

const EXPORT_FILENAME = "vidlever-settings.json";

/** At most one feedback line shows at a time, so error and success are one state. */
type Message = { kind: "error" | "success"; text: string } | null;

export function ImportExport({ settings, onImport, onReset }: Props) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [message, setMessage] = useState<Message>(null);

  function exportSettings(): void {
    const json = JSON.stringify(settings, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = EXPORT_FILENAME;
    a.click();
    URL.revokeObjectURL(url);
    setMessage({ kind: "success", text: `Exported ${EXPORT_FILENAME}.` });
  }

  async function importFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = ""; // reset so the same file can be re-picked later
    if (!file) return;
    setMessage(null);

    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      setMessage({ kind: "error", text: "That file isn't valid JSON." });
      return;
    }

    const result = parseSettings(data);
    if (!result.ok) {
      setMessage({ kind: "error", text: `Invalid settings file: ${result.error}` });
      return;
    }
    onImport(result.value);
    setMessage({ kind: "success", text: "Settings imported." });
  }

  function reset(): void {
    const ok = window.confirm(
      "Reset all settings to defaults? This overwrites your current shortcuts, speed limits, and HUD configuration.",
    );
    if (!ok) return;
    onReset();
    setMessage({ kind: "success", text: "Settings reset to defaults." });
  }

  return (
    <div>
      <div class={styles.btnRow}>
        <button type="button" class={styles.btn} onClick={exportSettings}>
          Export
        </button>
        <button type="button" class={styles.btn} onClick={() => fileInput.current?.click()}>
          Import…
        </button>
        <button type="button" class={`${styles.btn} ${styles.btnDanger}`} onClick={reset}>
          Reset to defaults
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          class={styles.hiddenFile}
          onChange={(e) => {
            void importFile(e.currentTarget);
          }}
        />
      </div>
      {message !== null && (
        <p class={message.kind === "error" ? styles.error : styles.success}>{message.text}</p>
      )}
    </div>
  );
}
