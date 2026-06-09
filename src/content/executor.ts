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
 * Snap a rate to the configured decimal grid: round(rate * 10^decimals) /
 * 10^decimals (overview.md §7). Rounding first prevents floating-point drift
 * after repeated ±0.1 steps.
 */
function roundRate(rate: number, limits: SpeedLimits): number {
  const factor = 10 ** limits.decimals;
  return Math.round(rate * factor) / factor;
}

/**
 * The exact rate a speed action lands the video on (overview.md §7): snap to
 * the grid, then clamp to [min, max]. `speedSet` compares against and remembers
 * this *resolved* value rather than the raw target, so its toggle still works
 * when the target is out of range — an out-of-range raw target never equals the
 * clamped rate the video actually reaches, which would otherwise make the
 * "already at target → restore" branch unreachable.
 */
function resolveRate(rate: number, limits: SpeedLimits): number {
  const rounded = roundRate(rate, limits);
  return Math.min(Math.max(rounded, limits.min), limits.max);
}

/** Apply the resolved (rounded + clamped) rate to the video (overview.md §7). */
function applyRate(video: HTMLVideoElement, rawRate: number, limits: SpeedLimits): void {
  video.playbackRate = resolveRate(rawRate, limits);
}

/**
 * The rate `speedSet` replaced last time it fired on a given video, so pressing
 * the same "set to X" key again toggles *back* to where you were — and pressing
 * once more returns to X (overview.md §7). Keyed on the element via a WeakMap so
 * each video remembers independently and the entry is released when the element
 * is GC'd; module-scoped state, not a chrome dependency, so the executor stays
 * unit-testable in isolation (overview.md §10.3).
 */
const rateBeforeSet = new WeakMap<HTMLVideoElement, number>();

/**
 * Run a single binding's action against the target video and report the overlay
 * to flash (or `null` for none). Pure dispatch: it touches only `video`,
 * `document` fullscreen/PiP state, the module-scoped `rateBeforeSet` toggle
 * memory (see above), and the returned descriptor — never the HUD or
 * chrome.i18n — so the action effects stay unit-testable in isolation
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
      // Toggle: at the target rate already (with something to restore) → jump
      // back to the rate we replaced; otherwise remember the current rate and
      // jump to the target. Compare on the *resolved* (rounded + clamped) rate
      // so a rate the user nudged onto the target with ±0.1 steps — and an
      // out-of-range target that lands on a clamped value — both count as
      // "at target", and the remembered value is one we can actually restore.
      const current = resolveRate(video.playbackRate, limits);
      const target = resolveRate(binding.params.rate, limits);
      const previous = rateBeforeSet.get(video);
      if (current === target && previous !== undefined) {
        applyRate(video, previous, limits);
      } else {
        // Only overwrite the memory when we're actually leaving a different
        // rate, so repeated toggles keep bouncing off the same remembered value.
        if (current !== target) rateBeforeSet.set(video, current);
        applyRate(video, target, limits);
      }
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
