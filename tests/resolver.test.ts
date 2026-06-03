// T5.1 — video target selection (overview.md §5).
// Verifies the resolution priority (playing → largest → first) and every
// tiebreak. resolveTargetVideo takes an injectable video list, so each test
// pins the three inputs it reads — paused/ended state and rendered area.

import { afterEach, describe, expect, it } from "vitest";
import { resolveTargetVideo } from "../src/content/resolver.ts";

type VideoStub = { playing?: boolean; ended?: boolean; area?: number };

/**
 * Build a real <video> whose resolver-relevant state is pinned. happy-dom keeps
 * `paused` fixed and reports a zero-size box, so we shadow the prototype getters
 * for `paused`/`ended` and surface `area` as a width×1 bounding box (only the
 * width×height product matters to the resolver).
 */
function makeVideo({ playing = false, ended = false, area = 0 }: VideoStub = {}): HTMLVideoElement {
  const video = document.createElement("video");
  Object.defineProperty(video, "paused", { value: !playing, configurable: true });
  Object.defineProperty(video, "ended", { value: ended, configurable: true });
  video.getBoundingClientRect = () => ({ width: area, height: 1 }) as DOMRect;
  return video;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("resolveTargetVideo", () => {
  it("returns null when there are no videos", () => {
    expect(resolveTargetVideo([])).toBeNull();
  });

  it("returns the only video when exactly one is present", () => {
    const only = makeVideo({ area: 100 });
    expect(resolveTargetVideo([only])).toBe(only);
  });

  it("prefers a playing video over a larger paused one (priority 1 beats 2)", () => {
    const pausedLarge = makeVideo({ playing: false, area: 10_000 });
    const playingSmall = makeVideo({ playing: true, area: 1 });
    expect(resolveTargetVideo([pausedLarge, playingSmall])).toBe(playingSmall);
  });

  it("treats an ended video as not playing", () => {
    // paused === false but ended === true → excluded from the playing set, so
    // the genuinely-playing (and smaller) video still wins.
    const endedLarge = makeVideo({ playing: true, ended: true, area: 10_000 });
    const playingSmall = makeVideo({ playing: true, area: 1 });
    expect(resolveTargetVideo([endedLarge, playingSmall])).toBe(playingSmall);
  });

  it("picks the largest among multiple playing videos (priority 2 within the playing set)", () => {
    const small = makeVideo({ playing: true, area: 100 });
    const large = makeVideo({ playing: true, area: 9_000 });
    const medium = makeVideo({ playing: true, area: 500 });
    expect(resolveTargetVideo([small, large, medium])).toBe(large);
  });

  it("with nothing playing, picks the largest rendered video", () => {
    const small = makeVideo({ area: 100 });
    const large = makeVideo({ area: 9_000 });
    expect(resolveTargetVideo([small, large])).toBe(large);
  });

  it("breaks an area tie by DOM order (priority 3)", () => {
    const first = makeVideo({ area: 500 });
    const second = makeVideo({ area: 500 });
    expect(resolveTargetVideo([first, second])).toBe(first);
  });

  it("breaks an area tie within the playing set by DOM order", () => {
    const pausedHuge = makeVideo({ playing: false, area: 9_999 });
    const firstPlaying = makeVideo({ playing: true, area: 500 });
    const secondPlaying = makeVideo({ playing: true, area: 500 });
    expect(resolveTargetVideo([pausedHuge, firstPlaying, secondPlaying])).toBe(firstPlaying);
  });

  it("still returns the first video when every area is zero (nothing laid out)", () => {
    // display:none / not-yet-laid-out pages report zero-area boxes. The strict
    // `>` never replaces on a tie, so `best` is the first element, not null.
    const first = makeVideo({ area: 0 });
    const second = makeVideo({ area: 0 });
    expect(resolveTargetVideo([first, second])).toBe(first);
  });

  it("defaults to this document's <video> elements when no list is passed", () => {
    const small = makeVideo({ area: 100 });
    const large = makeVideo({ area: 9_000 });
    document.body.append(small, large);
    // No argument → falls back to document.querySelectorAll("video").
    expect(resolveTargetVideo()).toBe(large);
  });
});
