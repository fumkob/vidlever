// Ordered binding editor (overview.md §6.1, §6.4).
// Owns every array-level transform — add, duplicate, delete, reorder, per-row
// update — and emits the new list upward. Order is meaningful: it is the
// priority used to resolve duplicate key combos (overview.md §6.1), so drag
// reordering is a first-class operation here.

import { useState } from "preact/hooks";
import { t } from "../../shared/i18n.ts";
import type { Binding } from "../../shared/types.ts";
import styles from "../styles.module.css";
import { BindingRow } from "./BindingRow.tsx";

type Props = {
  bindings: Binding[];
  onChange: (bindings: Binding[]) => void;
};

/** A fresh, unbound binding for the "Add" button — user picks the key next. */
function newBinding(): Binding {
  return { id: crypto.randomUUID(), enabled: true, key: null, action: "playPause" };
}

export function BindingList({ bindings, onChange }: Props) {
  // Drag state stays local: `dragIndex` is the row being dragged, `overIndex`
  // the row it is hovering, used purely to render the drop indicator.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  function replaceAt(index: number, next: Binding): void {
    const copy = bindings.slice();
    copy[index] = next;
    onChange(copy);
  }

  function duplicate(index: number): void {
    const source = bindings[index];
    if (!source) return;
    // Clone with a fresh id and drop it right after the original so the user
    // can immediately tweak the copy (e.g. another skipForward, different secs).
    const clone: Binding = { ...structuredClone(source), id: crypto.randomUUID() };
    const copy = bindings.slice();
    copy.splice(index + 1, 0, clone);
    onChange(copy);
  }

  function remove(index: number): void {
    onChange(bindings.filter((_, i) => i !== index));
  }

  function reorder(from: number, to: number): void {
    if (from === to) return;
    const copy = bindings.slice();
    const [moved] = copy.splice(from, 1);
    if (!moved) return;
    copy.splice(to, 0, moved);
    onChange(copy);
  }

  function finishDrop(index: number): void {
    if (dragIndex !== null) reorder(dragIndex, index);
    setDragIndex(null);
    setOverIndex(null);
  }

  return (
    <div>
      {bindings.length === 0 ? (
        <p class={styles.empty}>{t("optEmptyShortcuts")}</p>
      ) : (
        <ul class={styles.list}>
          {bindings.map((binding, index) => (
            <BindingRow
              key={binding.id}
              binding={binding}
              dragging={dragIndex === index}
              dragOver={overIndex === index && dragIndex !== index}
              onChange={(next) => replaceAt(index, next)}
              onDuplicate={() => duplicate(index)}
              onDelete={() => remove(index)}
              onDragStart={() => setDragIndex(index)}
              onDragOver={() => {
                if (overIndex !== index) setOverIndex(index);
              }}
              onDrop={() => finishDrop(index)}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
            />
          ))}
        </ul>
      )}
      <button
        type="button"
        class={styles.addBtn}
        onClick={() => onChange([...bindings, newBinding()])}
      >
        {t("optAddShortcut")}
      </button>
    </div>
  );
}
