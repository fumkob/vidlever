// Typed wrapper over chrome.i18n (overview.md §10.1).
// Every user-facing string lives in _locales/<locale>/messages.json; this is the
// single choke point that reads it. English is the only locale shipped in v1,
// but routing all lookups through chrome.i18n means adding a locale is a pure
// data change — no code touches.

// Type-only import of the default-locale catalogue: it gives `MessageKey` its
// exhaustive key union (so a typo in a t() call is a compile error) and is fully
// erased at build time, so the JSON is never bundled into the runtime — Chrome
// loads it natively from _locales/. The file ships via public/ (the build copies
// publicDir to the extension root); this path only feeds the type checker.
import type enMessages from "../../public/_locales/en/messages.json";

/** Every message name declared in the default locale's messages.json. */
export type MessageKey = keyof typeof enMessages;

/** Keys for the transient HUD overlay flashes — the `hud*`-prefixed subset. */
export type HudMessageKey = Extract<MessageKey, `hud${string}`>;

/**
 * Resolve a message to its localized string. `substitutions` fills the message's
 * `$PLACEHOLDER$` slots positionally ($1, $2, …), matching chrome.i18n's
 * contract — pass them in the order the placeholders' `content` declares.
 */
export function t(key: MessageKey, substitutions?: string[]): string {
  return chrome.i18n.getMessage(key, substitutions);
}
