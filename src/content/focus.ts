// Text-input focus guard (overview.md §6.3).
// While the user is typing into a field, Vidlever must do nothing — no action,
// no preventDefault — so that searches, comment boxes, and rich-text editors on
// pages that also host video keep working normally.

/** `<input>` types that are not text entry and so should NOT suppress shortcuts. */
const NON_TEXT_INPUT_TYPES = new Set(["checkbox", "radio", "range", "button", "submit"]);

/**
 * Resolve the element that truly holds focus, descending through open shadow
 * roots. `document.activeElement` only reports the shadow *host* at each level,
 * so the actually focused node lives in nested `shadowRoot.activeElement`
 * (overview.md §6.3 — "Shadow-DOM descendants of any of the above").
 */
function deepActiveElement(doc: Document): Element | null {
  let active = doc.activeElement;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active;
}

/** True when `el` is a text-entry control we must not steal keys from. */
function isTextEntry(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(el.type);
  // `isContentEditable` covers contenteditable="" / "true" and editability
  // inherited inside a contenteditable subtree, while staying false for
  // contenteditable="false".
  return el instanceof HTMLElement && el.isContentEditable;
}

/**
 * Whether keyboard shortcuts should be suppressed because the user is typing.
 * Accepts an explicit `doc` for testability; defaults to the ambient document.
 */
export function isTextInputFocused(doc: Document = document): boolean {
  const active = deepActiveElement(doc);
  return active !== null && isTextEntry(active);
}
