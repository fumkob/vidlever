// Action dispatch (overview.md §3, §7, §8.4).
// Each action mutates the target <video> and returns the transient HUD overlay
// to flash — or `null` when the change needs no overlay (speed changes are
// already reflected in the persistent readout; fullscreen is self-evident).

import type { HudMessageKey } from "../shared/i18n.ts";
import type { Binding, SpeedLimits } from "../shared/types.ts";

/**
 * The transient HUD overlay an action asks to flash: an i18n message key plus
 * any positional substitutions. The wiring layer (index.ts) resolves it through
 * chrome.i18n before handing the finished string to the HUD, so the executor
 * itself stays a pure, chrome-free dispatch that unit tests can assert on
 * directly (overview.md §10.3).
 */
export type OverlayMessage = { key: HudMessageKey; subs?: string[] };

/**
 * Clamp + round a candidate playback rate (overview.md §7):
 *
 *   next = round(rate * 10^decimals) / 10^decimals, then clamp to [min, max].
 *
 * Rounding first prevents floating-point drift after repeated ±0.1 steps.
 */
function applyRate(video: HTMLVideoElement, rawRate: number, limits: SpeedLimits): void {
  const factor = 10 ** limits.decimals;
  const rounded = Math.round(rawRate * factor) / factor;
  video.playbackRate = Math.min(Math.max(rounded, limits.min), limits.max);
}

/**
 * Run a single binding's action against the target video and report the overlay
 * to flash (or `null` for none). Pure dispatch: it touches only `video`,
 * `document` fullscreen/PiP state, and the returned descriptor — never the HUD
 * or chrome.i18n — so the action effects stay unit-testable in isolation
 * (overview.md §10.3).
 */
export function executeAction(
  binding: Binding,
  video: HTMLVideoElement,
  limits: SpeedLimits,
): OverlayMessage | null {
  switch (binding.action) {
    case "playPause": {
      if (video.paused) {
        // play() rejects under autoplay policy or on a detached element; the
        // HUD just keeps showing the paused state if that happens.
        void video.play().catch(() => {});
        return { key: "hudPlay" };
      }
      video.pause();
      return { key: "hudPause" };
    }
    case "skipForward": {
      const { seconds } = binding.params;
      video.currentTime += seconds;
      return { key: "hudSkipForward", subs: [String(seconds)] };
    }
    case "skipBackward": {
      const { seconds } = binding.params;
      video.currentTime -= seconds;
      return { key: "hudSkipBackward", subs: [String(seconds)] };
    }
    case "speedDelta": {
      applyRate(video, video.playbackRate + binding.params.delta, limits);
      return null;
    }
    case "speedSet": {
      applyRate(video, binding.params.rate, limits);
      return null;
    }
    case "muteToggle": {
      video.muted = !video.muted;
      return video.muted ? { key: "hudMuted" } : { key: "hudUnmuted" };
    }
    case "fullscreenToggle": {
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => {});
      } else {
        void video.requestFullscreen().catch(() => {});
      }
      return null;
    }
    case "pipToggle": {
      // Toggle PiP for THIS video specifically. If a *different* video holds
      // PiP, requesting it on our target transfers PiP to it (the browser
      // closes the other) — checking the global element instead would just
      // close the other video's PiP and leave our target untouched.
      if (document.pictureInPictureElement === video) {
        void document.exitPictureInPicture().catch(() => {});
        return { key: "hudPipOff" };
      }
      void video.requestPictureInPicture().catch(() => {});
      return { key: "hudPipOn" };
    }
    case "seekToStart": {
      video.currentTime = 0;
      return { key: "hudSeekStart" };
    }
    case "seekToEnd": {
      // Live streams report a non-finite duration; jumping there is meaningless.
      if (Number.isFinite(video.duration)) video.currentTime = video.duration;
      return { key: "hudSeekEnd" };
    }
    case "loopToggle": {
      video.loop = !video.loop;
      return video.loop ? { key: "hudLoopOn" } : { key: "hudLoopOff" };
    }
    default: {
      // Exhaustiveness guard: a 12th action would make `binding` non-`never`.
      const exhaustive: never = binding;
      return exhaustive;
    }
  }
}
