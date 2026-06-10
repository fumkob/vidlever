// Content script entry — wires every module together (overview.md §4, §6.3, §10.3).
//
// Lifecycle:
//   1. Register the capture-phase keydown listener *synchronously* at
//      document_start — before settings load and before any <video> exists.
//   2. Load settings, build the HUD; a MutationObserver re-points the HUD at the
//      current target as videos come and go.
//   3. On keydown: ignore text-input focus, match a binding, resolve the target
//      video, execute, update the HUD, then override site/browser defaults with
//      preventDefault + stopImmediatePropagation (overview.md §6.3).
//
// Why register so early: spacebar is the one shortcut sites also bind on the
// *window* in the capture phase (to suppress page-scroll), e.g. YouTube during
// player boot. Among listeners on the same target+phase, firing order is
// registration order — so a video-gated, post-storage attach would register
// *after* the site's and fire *second*, double-toggling Space back to no-op.
// Registering at document_start, ahead of the page's own scripts, lets our
// stopImmediatePropagation actually suppress the site's handler. (Shortcuts the
// site binds lower than window — f/k/j/l, etc. — we already win by hierarchy.)
//
// Runs in every frame (all_frames); each frame operates only on its own videos.

import { t } from "../shared/i18n.ts";
import { loadSettings } from "../shared/storage.ts";
import type { Binding, StoredSettings } from "../shared/types.ts";
import { executeAction } from "./executor.ts";
import { isTextInputFocused } from "./focus.ts";
import { Hud } from "./hud.ts";
import { matchBinding } from "./keymap.ts";
import { resolveTargetVideo } from "./resolver.ts";

async function init(): Promise<void> {
  // Populated once storage resolves; until then keydown is a no-op (the page
  // has no video to control yet anyway).
  let settings: StoredSettings | null = null;
  let hud: Hud | null = null;

  /**
   * Resolve the binding + target this event would drive, or `null` if it should
   * pass through. Shared by keydown (which acts) and keyup/keypress (which only
   * suppress), so all three make the identical intercept decision.
   */
  function intercepted(
    event: KeyboardEvent,
  ): { binding: Binding; video: HTMLVideoElement; settings: StoredSettings } | null {
    if (!settings) return null; // settings not loaded yet
    // Typing into a field → do nothing at all, not even preventDefault (§6.3).
    if (isTextInputFocused()) return null;
    const binding = matchBinding(settings.bindings, event);
    if (!binding) return null; // unbound key: let the site/browser handle it
    const video = resolveTargetVideo();
    if (!video) return null; // nothing to control: let the key through
    return { binding, video, settings };
  }

  function onKeydown(event: KeyboardEvent): void {
    const hit = intercepted(event);
    if (!hit) return;

    const overlay = executeAction(hit.binding, hit.video, hit.settings.speedLimits);
    hud?.attach(hit.video);
    if (overlay !== null) hud?.flashOverlay(t(overlay.key, overlay.subs));

    // A bound key always overrides site and browser defaults (§6.3): we ran
    // first in the capture phase, so stop the rest of the chain.
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  // The action runs once on keydown; the matching keypress/keyup must still be
  // swallowed. Some controls activate on *keyup* rather than keydown — notably a
  // focused player button toggled by Space — so an un-suppressed keyup would
  // re-fire play/pause and undo our keydown (the "blip pause then resume" bug).
  // We suppress without executing, mirroring keydown's intercept decision.
  function onFollowUp(event: KeyboardEvent): void {
    if (!intercepted(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  // Register synchronously, before the first await — this is the document_start
  // tick, ahead of the page's own scripts (see the header note on Space).
  window.addEventListener("keydown", onKeydown, { capture: true });
  window.addEventListener("keypress", onFollowUp, { capture: true });
  window.addEventListener("keyup", onFollowUp, { capture: true });

  settings = await loadSettings();
  hud = new Hud(settings.hud);

  /** Point the HUD at the current target video, or park it if none remain. */
  function refreshTarget(): void {
    const target = resolveTargetVideo();
    if (target) hud?.attach(target);
    else hud?.detach();
  }

  // play/pause flips which video wins priority, so re-resolve the target. These
  // events don't bubble — listen in the capture phase to catch them at document.
  const onPlaybackChange = (): void => refreshTarget();
  document.addEventListener("play", onPlaybackChange, true);
  document.addEventListener("pause", onPlaybackChange, true);

  // Re-point the HUD only when video presence flips (cheap check per mutation).
  let hadVideo = false;
  const observer = new MutationObserver(() => {
    const hasVideo = document.querySelector("video") !== null;
    if (hasVideo === hadVideo) return;
    hadVideo = hasVideo;
    refreshTarget();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  hadVideo = document.querySelector("video") !== null;
  refreshTarget();

  // Keep settings live when edited in the options page or synced from another
  // device. Reloading the whole object is the simplest always-correct approach.
  chrome.storage.onChanged.addListener((_changes, areaName) => {
    if (areaName !== "sync") return;
    // If the re-read fails (e.g. storage briefly unavailable), keep the current
    // settings and stay quiet — matches init()'s catch — rather than logging an
    // unhandled rejection.
    void loadSettings()
      .then((next) => {
        settings = next;
        hud?.setSettings(next.hud);
      })
      .catch(() => {});
  });
}

// In sandboxed / cross-origin frames `chrome.storage` may be unavailable, which
// rejects loadSettings(); swallow it so the frame fails quietly rather than
// logging an unhandled rejection — it has no storage access to operate anyway.
void init().catch(() => {});
