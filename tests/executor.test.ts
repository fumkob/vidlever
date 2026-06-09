// T5.2 — action dispatch (overview.md §3, §7, §8.4).
// Verifies the speed clamp/round math and every action's side effects plus the
// overlay descriptor it returns. executeAction is pure dispatch over `video`
// and `document` fullscreen/PiP state, so we pin those and assert directly.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeAction } from "../src/content/executor.ts";
import { DEFAULT_SPEED_LIMITS } from "../src/shared/defaults.ts";
import type { ActionSpec, Binding, SpeedLimits } from "../src/shared/types.ts";

type VideoState = {
  paused?: boolean;
  muted?: boolean;
  loop?: boolean;
  currentTime?: number;
  playbackRate?: number;
  duration?: number;
};

/**
 * Build a <video> with pinned state and stubbed side-effecting methods.
 * happy-dom doesn't implement play/pause/fullscreen/PiP, and `paused`/`duration`
 * are read-only getters, so we shadow them and spy on the methods executor calls.
 */
function makeVideo({
  paused = true,
  muted = false,
  loop = false,
  currentTime = 0,
  playbackRate = 1,
  duration = 100,
}: VideoState = {}): HTMLVideoElement {
  const video = document.createElement("video");
  Object.defineProperty(video, "paused", { value: paused, configurable: true });
  Object.defineProperty(video, "duration", { value: duration, configurable: true });
  video.muted = muted;
  video.loop = loop;
  video.currentTime = currentTime;
  video.playbackRate = playbackRate;
  video.play = vi.fn(() => Promise.resolve());
  video.pause = vi.fn();
  video.requestFullscreen = vi.fn(() => Promise.resolve());
  video.requestPictureInPicture = vi.fn(() => Promise.resolve({} as PictureInPictureWindow));
  return video;
}

/** Compose a full Binding from an action spec (executor ignores id/enabled/key). */
function bind(spec: ActionSpec): Binding {
  return { id: "test", enabled: true, key: null, ...spec };
}

/** Override a read-only Document property (fullscreenElement / pictureInPictureElement). */
function setDocProp(
  prop: "fullscreenElement" | "pictureInPictureElement",
  el: Element | null,
): void {
  Object.defineProperty(document, prop, { value: el, configurable: true });
}

const LIMITS = DEFAULT_SPEED_LIMITS; // { min: 0.25, max: 4.0, decimals: 2 }

beforeEach(() => {
  setDocProp("fullscreenElement", null);
  setDocProp("pictureInPictureElement", null);
  document.exitFullscreen = vi.fn(() => Promise.resolve());
  document.exitPictureInPicture = vi.fn(() => Promise.resolve());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("playPause", () => {
  it("plays and reports hudPlay when paused", () => {
    const video = makeVideo({ paused: true });
    const overlay = executeAction(bind({ action: "playPause" }), video, LIMITS);
    expect(video.play).toHaveBeenCalledOnce();
    expect(video.pause).not.toHaveBeenCalled();
    expect(overlay).toEqual({ key: "hudPlay" });
  });

  it("pauses and reports hudPause when playing", () => {
    const video = makeVideo({ paused: false });
    const overlay = executeAction(bind({ action: "playPause" }), video, LIMITS);
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.play).not.toHaveBeenCalled();
    expect(overlay).toEqual({ key: "hudPause" });
  });
});

describe("skipForward / skipBackward", () => {
  it("advances currentTime by the bound seconds and reports the offset", () => {
    const video = makeVideo({ currentTime: 50 });
    const overlay = executeAction(
      bind({ action: "skipForward", params: { seconds: 10 } }),
      video,
      LIMITS,
    );
    expect(video.currentTime).toBe(60);
    expect(overlay).toEqual({ key: "hudSkipForward", subs: ["10"] });
  });

  it("rewinds currentTime by the bound seconds and reports the offset", () => {
    const video = makeVideo({ currentTime: 50 });
    const overlay = executeAction(
      bind({ action: "skipBackward", params: { seconds: 10 } }),
      video,
      LIMITS,
    );
    expect(video.currentTime).toBe(40);
    expect(overlay).toEqual({ key: "hudSkipBackward", subs: ["10"] });
  });

  it("passes non-integer skip seconds through to the overlay substitution", () => {
    const video = makeVideo({ currentTime: 0 });
    const overlay = executeAction(
      bind({ action: "skipForward", params: { seconds: 2.5 } }),
      video,
      LIMITS,
    );
    expect(video.currentTime).toBe(2.5);
    expect(overlay).toEqual({ key: "hudSkipForward", subs: ["2.5"] });
  });
});

describe("speedDelta / speedSet (clamp + round, §7)", () => {
  it("applies a delta to the current rate and returns no overlay", () => {
    const video = makeVideo({ playbackRate: 1 });
    const overlay = executeAction(
      bind({ action: "speedDelta", params: { delta: 0.1 } }),
      video,
      LIMITS,
    );
    expect(video.playbackRate).toBe(1.1);
    expect(overlay).toBeNull();
  });

  it("rounds away float drift across repeated +0.1 steps", () => {
    // Naive 1.0 + 0.1 ten times lands on 1.9999999999999998; rounding each step
    // to 2 decimals keeps the rate on a clean 0.1 grid (overview.md §7).
    const video = makeVideo({ playbackRate: 1 });
    const delta = bind({ action: "speedDelta", params: { delta: 0.1 } });
    const expected = [1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0];
    for (const want of expected) {
      executeAction(delta, video, LIMITS);
      expect(video.playbackRate).toBe(want);
    }
  });

  it("clamps to max and never exceeds it", () => {
    const video = makeVideo({ playbackRate: 3.95 });
    executeAction(bind({ action: "speedDelta", params: { delta: 0.1 } }), video, LIMITS);
    expect(video.playbackRate).toBe(4.0);
    // A further increase is a silent no-op at the ceiling.
    executeAction(bind({ action: "speedDelta", params: { delta: 0.1 } }), video, LIMITS);
    expect(video.playbackRate).toBe(4.0);
  });

  it("clamps to min and never drops below it", () => {
    const video = makeVideo({ playbackRate: 0.3 });
    executeAction(bind({ action: "speedDelta", params: { delta: -0.1 } }), video, LIMITS);
    expect(video.playbackRate).toBe(0.25);
    executeAction(bind({ action: "speedDelta", params: { delta: -0.1 } }), video, LIMITS);
    expect(video.playbackRate).toBe(0.25);
  });

  it("speedSet jumps to an exact in-range rate", () => {
    const video = makeVideo({ playbackRate: 1 });
    const overlay = executeAction(
      bind({ action: "speedSet", params: { rate: 2.5 } }),
      video,
      LIMITS,
    );
    expect(video.playbackRate).toBe(2.5);
    expect(overlay).toBeNull();
  });

  it("speedSet clamps out-of-range targets to the limits", () => {
    const high = makeVideo({ playbackRate: 1 });
    executeAction(bind({ action: "speedSet", params: { rate: 10 } }), high, LIMITS);
    expect(high.playbackRate).toBe(4.0);

    const low = makeVideo({ playbackRate: 1 });
    executeAction(bind({ action: "speedSet", params: { rate: 0.1 } }), low, LIMITS);
    expect(low.playbackRate).toBe(0.25);
  });

  it("rounds to the configured decimal places (1 vs 2)", () => {
    const oneDecimal: SpeedLimits = { min: 0.25, max: 4.0, decimals: 1 };
    const a = makeVideo({ playbackRate: 1 });
    executeAction(bind({ action: "speedSet", params: { rate: 1.26 } }), a, oneDecimal);
    expect(a.playbackRate).toBe(1.3);

    const b = makeVideo({ playbackRate: 1 });
    executeAction(bind({ action: "speedSet", params: { rate: 1.236 } }), b, LIMITS);
    expect(b.playbackRate).toBe(1.24);
  });
});

describe("muteToggle", () => {
  it("mutes and reports hudMuted when unmuted", () => {
    const video = makeVideo({ muted: false });
    const overlay = executeAction(bind({ action: "muteToggle" }), video, LIMITS);
    expect(video.muted).toBe(true);
    expect(overlay).toEqual({ key: "hudMuted" });
  });

  it("unmutes and reports hudUnmuted when muted", () => {
    const video = makeVideo({ muted: true });
    const overlay = executeAction(bind({ action: "muteToggle" }), video, LIMITS);
    expect(video.muted).toBe(false);
    expect(overlay).toEqual({ key: "hudUnmuted" });
  });
});

describe("fullscreenToggle", () => {
  it("requests fullscreen on the wrapper so the HUD overlay stays renderable", () => {
    const wrapper = document.createElement("div");
    wrapper.requestFullscreen = vi.fn(() => Promise.resolve());
    const video = makeVideo();
    wrapper.appendChild(video);
    const overlay = executeAction(bind({ action: "fullscreenToggle" }), video, LIMITS);
    expect(wrapper.requestFullscreen).toHaveBeenCalledOnce();
    expect(video.requestFullscreen).not.toHaveBeenCalled();
    expect(document.exitFullscreen).not.toHaveBeenCalled();
    expect(overlay).toBeNull();
  });

  it("falls back to the video itself when it has no parent element", () => {
    const video = makeVideo();
    const overlay = executeAction(bind({ action: "fullscreenToggle" }), video, LIMITS);
    expect(video.requestFullscreen).toHaveBeenCalledOnce();
    expect(document.exitFullscreen).not.toHaveBeenCalled();
    expect(overlay).toBeNull();
  });

  it("exits fullscreen when an element is already fullscreen", () => {
    const video = makeVideo();
    setDocProp("fullscreenElement", video);
    const overlay = executeAction(bind({ action: "fullscreenToggle" }), video, LIMITS);
    expect(document.exitFullscreen).toHaveBeenCalledOnce();
    expect(video.requestFullscreen).not.toHaveBeenCalled();
    expect(overlay).toBeNull();
  });
});

describe("pipToggle", () => {
  it("requests PiP and reports hudPipOn when this video is not in PiP", () => {
    const video = makeVideo();
    const overlay = executeAction(bind({ action: "pipToggle" }), video, LIMITS);
    expect(video.requestPictureInPicture).toHaveBeenCalledOnce();
    expect(overlay).toEqual({ key: "hudPipOn" });
  });

  it("exits PiP and reports hudPipOff when this video already holds PiP", () => {
    const video = makeVideo();
    setDocProp("pictureInPictureElement", video);
    const overlay = executeAction(bind({ action: "pipToggle" }), video, LIMITS);
    expect(document.exitPictureInPicture).toHaveBeenCalledOnce();
    expect(video.requestPictureInPicture).not.toHaveBeenCalled();
    expect(overlay).toEqual({ key: "hudPipOff" });
  });

  it("transfers PiP (requests on our target) when a different video holds it", () => {
    const other = makeVideo();
    const target = makeVideo();
    setDocProp("pictureInPictureElement", other);
    const overlay = executeAction(bind({ action: "pipToggle" }), target, LIMITS);
    expect(target.requestPictureInPicture).toHaveBeenCalledOnce();
    expect(document.exitPictureInPicture).not.toHaveBeenCalled();
    expect(overlay).toEqual({ key: "hudPipOn" });
  });
});

describe("seekToStart / seekToEnd", () => {
  it("seeks to 0 and reports hudSeekStart", () => {
    const video = makeVideo({ currentTime: 50 });
    const overlay = executeAction(bind({ action: "seekToStart" }), video, LIMITS);
    expect(video.currentTime).toBe(0);
    expect(overlay).toEqual({ key: "hudSeekStart" });
  });

  it("seeks to duration and reports hudSeekEnd for a finite duration", () => {
    const video = makeVideo({ currentTime: 10, duration: 100 });
    const overlay = executeAction(bind({ action: "seekToEnd" }), video, LIMITS);
    expect(video.currentTime).toBe(100);
    expect(overlay).toEqual({ key: "hudSeekEnd" });
  });

  it("leaves currentTime untouched on a live stream (non-finite duration) but still reports hudSeekEnd", () => {
    const video = makeVideo({ currentTime: 10, duration: Number.POSITIVE_INFINITY });
    const overlay = executeAction(bind({ action: "seekToEnd" }), video, LIMITS);
    expect(video.currentTime).toBe(10);
    expect(overlay).toEqual({ key: "hudSeekEnd" });
  });
});

describe("loopToggle", () => {
  it("enables loop and reports hudLoopOn when off", () => {
    const video = makeVideo({ loop: false });
    const overlay = executeAction(bind({ action: "loopToggle" }), video, LIMITS);
    expect(video.loop).toBe(true);
    expect(overlay).toEqual({ key: "hudLoopOn" });
  });

  it("disables loop and reports hudLoopOff when on", () => {
    const video = makeVideo({ loop: true });
    const overlay = executeAction(bind({ action: "loopToggle" }), video, LIMITS);
    expect(video.loop).toBe(false);
    expect(overlay).toEqual({ key: "hudLoopOff" });
  });
});
