// Action dispatch (overview.md §3, §7, §8.4).
// Each action mutates the target <video> and returns the transient HUD overlay
// to flash — or `null` when the change needs no overlay (speed changes are
// already reflected in the persistent readout; fullscreen is self-evident).

import type { HudMessageKey } from "../shared/i18n.ts";
import { applyRate, resolveRate } from "../shared/rate.ts";
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
 * The rate `speedSet` replaced last time it fired on a given video, so pressing
 * the same "set to X" key again toggles *back* to where you were — and pressing
 * once more returns to X (overview.md §7). Keyed on the element via a WeakMap so
 * each video remembers independently and the entry is released when the element
 * is GC'd; module-scoped state, not a chrome dependency, so the executor stays
 * unit-testable in isolation (overview.md §10.3).
 */
const rateBeforeSet = new WeakMap<HTMLVideoElement, number>();

/**
 * Sites that draw their own controls (seek bar, volume, …) render them as
 * siblings of the <video> inside a player container. Fullscreening the bare
 * video element would leave those controls outside the fullscreen subtree —
 * invisible — so this resolves the element the site's own fullscreen button
 * would target instead: the nearest ancestor that still hugs the video's box
 * (with room for a docked control bar) *and* contains a seek bar, falling back
 * to one containing any button. Most players (YouTube, video.js, Vimeo, …)
 * sync their fullscreen layout off `fullscreenchange` on exactly that element.
 * When no such ancestor exists the page has no custom controls to preserve,
 * and the video itself — with the browser's native fullscreen controls — is
 * the right target.
 */
export function findFullscreenTarget(video: HTMLVideoElement): Element {
  const videoRect = video.getBoundingClientRect();
  // Hidden or pre-layout video: no geometry to compare wrappers against.
  if (videoRect.width === 0 || videoRect.height === 0) return video;

  // A wrapper still counts as "the player" when it exceeds the video by at
  // most 10% + 32px per axis — enough for a docked control bar, small enough
  // to reject page-level columns that happen to share the video's width.
  const fits = (rect: DOMRect): boolean =>
    rect.width <= videoRect.width * 1.1 + 32 && rect.height <= videoRect.height * 1.1 + 32;

  // Player-sized ancestors, nearest first. Walks the composed tree (slots,
  // then shadow hosts) so players that keep the video or its chrome inside a
  // shadow root are followed to their real root; stops at <body> —
  // fullscreening the whole page is never what the user meant. Oversized
  // intermediates (a full-page positioning layer) and box-less wrappers
  // (display: contents) are climbed *through* but never collected: the former
  // aren't the player, and requestFullscreen on the latter silently fails.
  const wrappers: Element[] = [];
  let node: Element = video;
  for (;;) {
    const root = node.getRootNode();
    const parent =
      node.assignedSlot ?? node.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
    if (!parent || parent === document.body || parent === document.documentElement) break;
    const rect = parent.getBoundingClientRect();
    if (fits(rect) && rect.width > 0 && rect.height > 0) wrappers.push(parent);
    node = parent;
  }

  // Prefer the wrapper owning the seek bar — the control this exists to keep
  // visible — over one that merely holds a button (e.g. a play overlay), so an
  // inner overlay wrapper doesn't shadow the real control chrome above it.
  const hasSeekBar = (el: Element): boolean =>
    el.querySelector('[role="slider"], input[type="range"]') !== null;
  const hasButton = (el: Element): boolean => el.querySelector('button, [role="button"]') !== null;
  return wrappers.find(hasSeekBar) ?? wrappers.find(hasButton) ?? video;
}

/**
 * Sites auto-hide their controls after a few idle seconds (always in
 * fullscreen), and our key handling is consumed at the capture phase so the
 * page never sees the activity — a keyboard seek would land with the seek bar
 * hidden, leaving the user blind to where they jumped. Replaying a small
 * pointer movement over the video wakes the player's user-activity tracker —
 * the same signal a real mouse wiggle sends — so the site briefly shows its
 * seek bar after each seek.
 */
let wakeJitter = 0;
function wakeControls(video: HTMLVideoElement): void {
  const rect = video.getBoundingClientRect();
  // Alternate the position by a pixel so players that drop stationary pointer
  // events still register movement on every repeated keypress.
  wakeJitter = wakeJitter === 0 ? 1 : 0;
  const init: MouseEventInit = {
    bubbles: true,
    composed: true,
    view: window,
    clientX: rect.left + rect.width / 2 + wakeJitter,
    clientY: rect.top + rect.height / 2 + wakeJitter,
  };
  // pointermove for players on pointer events, mousemove for the rest.
  video.dispatchEvent(new PointerEvent("pointermove", init));
  video.dispatchEvent(new MouseEvent("mousemove", init));
}

/**
 * Run a single binding's action against the target video and report the overlay
 * to flash (or `null` for none). Pure dispatch: it touches only `video`,
 * `document` fullscreen/PiP state, the module-scoped `rateBeforeSet` toggle
 * memory (see above), the synthetic activity events seeks replay on the video
 * (see wakeControls), and the returned descriptor — never the HUD or
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
      wakeControls(video);
      return { key: "hudSkipForward", subs: [String(seconds)] };
    }
    case "skipBackward": {
      const { seconds } = binding.params;
      video.currentTime -= seconds;
      wakeControls(video);
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
        // Fullscreen the player container, not the bare video, so the site's
        // own seek bar and controls stay visible (see findFullscreenTarget).
        void findFullscreenTarget(video)
          .requestFullscreen()
          .catch(() => {});
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
      wakeControls(video);
      return { key: "hudSeekStart" };
    }
    case "seekToEnd": {
      // Live streams report a non-finite duration; jumping there is meaningless.
      if (Number.isFinite(video.duration)) video.currentTime = video.duration;
      wakeControls(video);
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
