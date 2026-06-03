// Content script entry — wires every module together (overview.md §4, §6.3, §10.3).
//
// Lifecycle:
//   1. Load settings, build the HUD.
//   2. A MutationObserver toggles the capture-phase keydown listener based on
//      whether any <video> exists in this frame (overview.md §4): zero handlers
//      on pages without video, attached on the first insertion.
//   3. On keydown: ignore text-input focus, match a binding, resolve the target
//      video, execute, update the HUD, then override site/browser defaults with
//      preventDefault + stopImmediatePropagation (overview.md §6.3).
//
// Runs in every frame (all_frames); each frame operates only on its own videos.

import { loadSettings } from "../shared/storage.ts";
import { executeAction } from "./executor.ts";
import { isTextInputFocused } from "./focus.ts";
import { Hud } from "./hud.ts";
import { matchBinding } from "./keymap.ts";
import { resolveTargetVideo } from "./resolver.ts";

async function init(): Promise<void> {
  let settings = await loadSettings();
  const hud = new Hud(settings.hud);

  /** Re-point the HUD at whichever video is currently the target. */
  function refreshTarget(): void {
    const target = resolveTargetVideo();
    if (target) hud.attach(target);
  }

  function onKeydown(event: KeyboardEvent): void {
    // Typing into a field → do nothing at all, not even preventDefault (§6.3).
    if (isTextInputFocused()) return;

    const binding = matchBinding(settings.bindings, event);
    if (!binding) return; // unbound key: let the site/browser handle it

    const video = resolveTargetVideo();
    if (!video) return;

    const overlay = executeAction(binding, video, settings.speedLimits);
    hud.attach(video);
    if (overlay !== null) hud.flashOverlay(overlay);

    // A bound key always overrides site and browser defaults (§6.3): the
    // capture-phase listener has run first, so stop the rest of the chain.
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  let listening = false;
  function syncListener(): void {
    const hasVideo = document.querySelector("video") !== null;
    if (hasVideo && !listening) {
      window.addEventListener("keydown", onKeydown, { capture: true });
      listening = true;
      refreshTarget();
    } else if (!hasVideo && listening) {
      window.removeEventListener("keydown", onKeydown, { capture: true });
      listening = false;
      hud.detach();
    }
  }

  // play/pause flips which video wins priority, so re-resolve the target. These
  // events don't bubble — listen in the capture phase to catch them at document.
  const onPlaybackChange = (): void => {
    if (listening) refreshTarget();
  };
  document.addEventListener("play", onPlaybackChange, true);
  document.addEventListener("pause", onPlaybackChange, true);

  // Attach/detach the key listener as videos come and go (overview.md §4).
  const observer = new MutationObserver(syncListener);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  syncListener();

  // Keep settings live when edited in the options page or synced from another
  // device. Reloading the whole object is the simplest always-correct approach.
  chrome.storage.onChanged.addListener((_changes, areaName) => {
    if (areaName !== "sync") return;
    void loadSettings().then((next) => {
      settings = next;
      hud.setSettings(next.hud);
    });
  });
}

// In sandboxed / cross-origin frames `chrome.storage` may be unavailable, which
// rejects loadSettings(); swallow it so the frame fails quietly rather than
// logging an unhandled rejection — it has no storage access to operate anyway.
void init().catch(() => {});
