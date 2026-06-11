// T5.2 — action dispatch (overview.md §3, §7, §8.4).
// Verifies the speed clamp/round math and every action's side effects plus the
// overlay descriptor it returns. executeAction is pure dispatch over `video`
// and `document` fullscreen/PiP state, so we pin those and assert directly.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeAction, findFullscreenTarget } from "../src/content/executor.ts";
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

/**
 * Pin an element's box — happy-dom returns an all-zero getBoundingClientRect
 * for everything, so geometry-sensitive helpers need their inputs stubbed.
 */
function size(el: Element, width: number, height: number, left = 0, top = 0): void {
  el.getBoundingClientRect = () =>
    ({
      width,
      height,
      left,
      top,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
    }) as DOMRect;
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
  // Tests that exercise the DOM-walking helpers mount real subtrees.
  document.body.innerHTML = "";
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

describe("speedSet toggle (overview.md §7)", () => {
  const reset = bind({ action: "speedSet", params: { rate: 1.0 } });

  it("toggles back to the replaced rate, then forward to the target again", () => {
    const video = makeVideo({ playbackRate: 1.5 });
    executeAction(reset, video, LIMITS); // 1.5 → 1.0 (remembers 1.5)
    expect(video.playbackRate).toBe(1.0);
    executeAction(reset, video, LIMITS); // 1.0 → 1.5 (restores)
    expect(video.playbackRate).toBe(1.5);
    executeAction(reset, video, LIMITS); // 1.5 → 1.0 again
    expect(video.playbackRate).toBe(1.0);
    executeAction(reset, video, LIMITS); // 1.0 → 1.5 again
    expect(video.playbackRate).toBe(1.5);
  });

  it("is a no-op when already at the target with nothing to restore", () => {
    const video = makeVideo({ playbackRate: 1.0 });
    const overlay = executeAction(reset, video, LIMITS);
    expect(video.playbackRate).toBe(1.0);
    expect(overlay).toBeNull();
  });

  it("re-captures the latest rate when toggled from a freshly changed speed", () => {
    const video = makeVideo({ playbackRate: 1.5 });
    executeAction(reset, video, LIMITS); // 1.5 → 1.0
    executeAction(bind({ action: "speedSet", params: { rate: 2.0 } }), video, LIMITS);
    expect(video.playbackRate).toBe(2.0);
    executeAction(reset, video, LIMITS); // 2.0 → 1.0 (remembers 2.0, not the stale 1.5)
    expect(video.playbackRate).toBe(1.0);
    executeAction(reset, video, LIMITS); // 1.0 → 2.0
    expect(video.playbackRate).toBe(2.0);
  });

  it("toggles correctly when the target rate is out of range (clamped)", () => {
    // rate 10 clamps to max 4.0. The toggle must compare/remember the resolved
    // (clamped) rate, not the raw target — otherwise the live rate (4.0) never
    // equals the raw target (10) and the restore branch is unreachable.
    const over = bind({ action: "speedSet", params: { rate: 10 } });
    const video = makeVideo({ playbackRate: 1.5 });
    executeAction(over, video, LIMITS); // 1.5 → 4.0 (remembers 1.5)
    expect(video.playbackRate).toBe(4.0);
    executeAction(over, video, LIMITS); // at clamped target → restore 1.5
    expect(video.playbackRate).toBe(1.5);
    executeAction(over, video, LIMITS); // 1.5 → 4.0 again
    expect(video.playbackRate).toBe(4.0);
  });

  it("remembers the replaced rate independently per video", () => {
    const a = makeVideo({ playbackRate: 1.5 });
    const b = makeVideo({ playbackRate: 3.0 });
    executeAction(reset, a, LIMITS); // a: 1.5 → 1.0
    executeAction(reset, b, LIMITS); // b: 3.0 → 1.0
    executeAction(reset, a, LIMITS); // a: → 1.5
    executeAction(reset, b, LIMITS); // b: → 3.0
    expect(a.playbackRate).toBe(1.5);
    expect(b.playbackRate).toBe(3.0);
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
  it("requests fullscreen on the video when none is active", () => {
    // A bare video with no fitting/controls-bearing ancestor — and a zero-size
    // rect under happy-dom — resolves to the video itself (see findFullscreenTarget).
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

describe("findFullscreenTarget", () => {
  // The helper walks parentElement and runs querySelector, so each tree must
  // be a real, connected DOM subtree with sizes pinned via `size`.
  const VIDEO = { width: 640, height: 360 };

  /** A 640×360 video, sized to match VIDEO. */
  function sizedVideo(): HTMLVideoElement {
    const video = makeVideo();
    size(video, VIDEO.width, VIDEO.height);
    return video;
  }

  it("returns the video when its rect is zero-sized", () => {
    // makeVideo leaves the default all-zero rect, which short-circuits the walk.
    const video = makeVideo();
    expect(findFullscreenTarget(video)).toBe(video);
  });

  it("returns the video when the only ancestor is much larger (page column)", () => {
    const page = document.createElement("div");
    const video = sizedVideo();
    page.append(video);
    size(page, 1200, 900); // far beyond video * 1.1 + 32 on both axes
    document.body.append(page);
    expect(findFullscreenTarget(video)).toBe(video);
  });

  it("returns a same-size player container that holds a seek bar sibling", () => {
    const player = document.createElement("div");
    const seekBar = document.createElement("div");
    seekBar.setAttribute("role", "slider");
    const video = sizedVideo();
    player.append(video, seekBar);
    size(player, VIDEO.width, VIDEO.height);
    document.body.append(player);
    expect(findFullscreenTarget(video)).toBe(player);
  });

  it("skips a controls-less direct parent and returns the grandparent with controls (YouTube-like)", () => {
    // #movie_player > .html5-video-container > video, with the seek bar living
    // on #movie_player alongside .html5-video-container.
    const moviePlayer = document.createElement("div");
    moviePlayer.id = "movie_player";
    const container = document.createElement("div");
    container.className = "html5-video-container";
    const seekBar = document.createElement("div");
    seekBar.setAttribute("role", "slider");
    const video = sizedVideo();
    container.append(video);
    moviePlayer.append(container, seekBar);
    size(container, VIDEO.width, VIDEO.height);
    size(moviePlayer, VIDEO.width, VIDEO.height);
    document.body.append(moviePlayer);
    expect(findFullscreenTarget(video)).toBe(moviePlayer);
  });

  it("prefers the wrapper owning the seek bar over an inner button-only overlay", () => {
    // outer (seek bar) > inner (play overlay button only) > video.
    const outer = document.createElement("div");
    const inner = document.createElement("div");
    const overlayButton = document.createElement("button");
    const seekBar = document.createElement("div");
    seekBar.setAttribute("role", "slider");
    const video = sizedVideo();
    inner.append(video, overlayButton);
    outer.append(inner, seekBar);
    size(inner, VIDEO.width, VIDEO.height);
    size(outer, VIDEO.width, VIDEO.height);
    document.body.append(outer);
    expect(findFullscreenTarget(video)).toBe(outer);
  });

  it("accepts a container taller than the video by a docked control bar", () => {
    const player = document.createElement("div");
    const controlBar = document.createElement("button");
    const video = sizedVideo();
    player.append(video, controlBar);
    // +50px height stays within video.height * 1.1 + 32 (360 * 1.1 + 32 = 428).
    size(player, VIDEO.width, VIDEO.height + 50);
    document.body.append(player);
    expect(findFullscreenTarget(video)).toBe(player);
  });

  it("rejects an ancestor that exceeds the video height by far more than 10% + 32px", () => {
    const player = document.createElement("div");
    const controlBar = document.createElement("button");
    const video = sizedVideo();
    player.append(video, controlBar);
    // 360 * 1.1 + 32 = 428; 600 blows past it, so the wrapper is rejected.
    size(player, VIDEO.width, 600);
    document.body.append(player);
    expect(findFullscreenTarget(video)).toBe(video);
  });

  it("never selects a box-less wrapper (display:contents-like) but climbs through it", () => {
    // player > ghost (zero rect, holds video AND seek bar) > video. The ghost
    // matches the seek-bar probe, but requestFullscreen on a box-less element
    // silently fails, so the sized player above it must win.
    const player = document.createElement("div");
    const ghost = document.createElement("div");
    const seekBar = document.createElement("div");
    seekBar.setAttribute("role", "slider");
    const video = sizedVideo();
    ghost.append(video, seekBar);
    player.append(ghost);
    size(ghost, 0, 0);
    size(player, VIDEO.width, VIDEO.height);
    document.body.append(player);
    expect(findFullscreenTarget(video)).toBe(player);
  });

  it("climbs past an oversized intermediate layer to reach the player root above it", () => {
    // player (video-sized, owns the seek bar) > overlay (full-page positioning
    // layer) > video. The oversized rung must be skipped, not end the walk.
    const player = document.createElement("div");
    const overlay = document.createElement("div");
    const seekBar = document.createElement("div");
    seekBar.setAttribute("role", "slider");
    const video = sizedVideo();
    overlay.append(video);
    player.append(overlay, seekBar);
    size(overlay, 1920, 1080);
    size(player, VIDEO.width, VIDEO.height);
    document.body.append(player);
    expect(findFullscreenTarget(video)).toBe(player);
  });

  it("fullscreenToggle requests fullscreen on the resolved container, not the video", () => {
    const player = document.createElement("div") as HTMLDivElement & {
      requestFullscreen: ReturnType<typeof vi.fn>;
    };
    const seekBar = document.createElement("div");
    seekBar.setAttribute("role", "slider");
    const video = sizedVideo();
    player.append(video, seekBar);
    size(player, VIDEO.width, VIDEO.height);
    player.requestFullscreen = vi.fn(() => Promise.resolve());
    document.body.append(player);

    const overlay = executeAction(bind({ action: "fullscreenToggle" }), video, LIMITS);
    expect(player.requestFullscreen).toHaveBeenCalledOnce();
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

describe("wakeControls (pointer/mouse nudge after seeks and play/pause)", () => {
  // Sites auto-hide controls; the seek and play/pause actions replay a small
  // pointer movement over the video so the player's user-activity tracker
  // re-shows the seek bar and on-player controls. We pin a non-zero box and
  // assert the synthetic pointer lands near its center. Listeners go on a
  // *parent* container to prove the events bubble out of the video.
  const RECT = { left: 100, top: 200, width: 640, height: 360 };
  const CENTER_X = RECT.left + RECT.width / 2; // 420
  const CENTER_Y = RECT.top + RECT.height / 2; // 380

  /**
   * Mount a sized video inside a parent container under document.body and
   * capture every pointermove/mousemove that bubbles up to the parent.
   */
  function withListeners(video?: HTMLVideoElement): {
    video: HTMLVideoElement;
    pointerMoves: Event[];
    mouseMoves: Event[];
  } {
    const v = video ?? makeVideo();
    size(v, RECT.width, RECT.height, RECT.left, RECT.top);
    const parent = document.createElement("div");
    parent.append(v);
    document.body.append(parent);
    const pointerMoves: Event[] = [];
    const mouseMoves: Event[] = [];
    parent.addEventListener("pointermove", (e) => pointerMoves.push(e));
    parent.addEventListener("mousemove", (e) => mouseMoves.push(e));
    return { video: v, pointerMoves, mouseMoves };
  }

  const WAKE_ACTIONS: [string, ActionSpec, VideoState][] = [
    ["skipForward", { action: "skipForward", params: { seconds: 10 } }, {}],
    ["skipBackward", { action: "skipBackward", params: { seconds: 10 } }, {}],
    ["seekToStart", { action: "seekToStart" }, {}],
    ["seekToEnd", { action: "seekToEnd" }, {}],
    ["playPause (paused → play)", { action: "playPause" }, { paused: true }],
    ["playPause (playing → pause)", { action: "playPause" }, { paused: false }],
  ];

  it.each(
    WAKE_ACTIONS,
  )("%s dispatches a pointermove and a mousemove that bubble to the parent, near the rect center", (_name, spec, state) => {
    const { video, pointerMoves, mouseMoves } = withListeners(makeVideo(state));
    executeAction(bind(spec), video, LIMITS);
    expect(pointerMoves).toHaveLength(1);
    expect(mouseMoves).toHaveLength(1);
    for (const e of [...pointerMoves, ...mouseMoves]) {
      const me = e as MouseEvent;
      // Jitter adds 0 or 1px; assert within 1px of the center on each axis.
      expect(me.clientX).toBeGreaterThanOrEqual(CENTER_X);
      expect(me.clientX).toBeLessThanOrEqual(CENTER_X + 1);
      expect(me.clientY).toBeGreaterThanOrEqual(CENTER_Y);
      expect(me.clientY).toBeLessThanOrEqual(CENTER_Y + 1);
    }
  });

  it("dispatched events bubble and are composed", () => {
    const { video, pointerMoves, mouseMoves } = withListeners();
    executeAction(bind({ action: "seekToStart" }), video, LIMITS);
    for (const e of [...pointerMoves, ...mouseMoves]) {
      expect(e.bubbles).toBe(true);
      expect(e.composed).toBe(true);
    }
  });

  it("alternates the jitter: two consecutive seeks land on different positions", () => {
    // The contract is "players that drop stationary pointer events still see
    // movement", not any particular offset — so assert the positions differ,
    // not the exact pixel delta. The counter is module-global and persists
    // across tests, hence comparing two back-to-back calls.
    const { video, pointerMoves } = withListeners();
    executeAction(bind({ action: "seekToStart" }), video, LIMITS);
    executeAction(bind({ action: "seekToStart" }), video, LIMITS);
    expect(pointerMoves).toHaveLength(2);
    const first = (pointerMoves[0] as MouseEvent).clientX;
    const second = (pointerMoves[1] as MouseEvent).clientX;
    expect(second).not.toBe(first);
  });

  it("non-wake actions (muteToggle, speedDelta, speedSet, loopToggle) do not dispatch pointermove/mousemove", () => {
    const { video, pointerMoves, mouseMoves } = withListeners(makeVideo({ muted: false }));
    executeAction(bind({ action: "muteToggle" }), video, LIMITS);
    executeAction(bind({ action: "speedDelta", params: { delta: 0.1 } }), video, LIMITS);
    executeAction(bind({ action: "speedSet", params: { rate: 2 } }), video, LIMITS);
    executeAction(bind({ action: "loopToggle" }), video, LIMITS);
    expect(pointerMoves).toHaveLength(0);
    expect(mouseMoves).toHaveLength(0);
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
