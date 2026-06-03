// Video target selection (overview.md §5).
// When a shortcut fires, exactly one <video> is chosen as the operation target.

/** Rendered area of a video in CSS pixels (0 when not laid out / hidden). */
function renderedArea(video: HTMLVideoElement): number {
  const rect = video.getBoundingClientRect();
  return rect.width * rect.height;
}

/**
 * Pick the single target video (overview.md §5):
 *
 *   1. A currently playing video (`!paused && !ended`). If several play at
 *      once, the size/DOM tiebreakers below are applied within that set.
 *   2. Otherwise the largest rendered video by bounding-box area.
 *   3. DOM order is the final deterministic tiebreaker.
 *
 * `videos` defaults to this frame's live document but is injectable for tests.
 * Returns `null` only when there are no videos at all.
 */
export function resolveTargetVideo(
  videos: ArrayLike<HTMLVideoElement> = document.querySelectorAll("video"),
): HTMLVideoElement | null {
  const all = Array.from(videos);
  const playing = all.filter((video) => !video.paused && !video.ended);
  const pool = playing.length > 0 ? playing : all;

  // Single pass: measure each video's area once (getBoundingClientRect forces
  // layout, so never re-measure). `pool` is in DOM order and the strict `>`
  // never replaces on a tie, so the earliest element wins — priority (3). An
  // empty pool (no videos at all) leaves `best` null.
  let best: HTMLVideoElement | null = null;
  let bestArea = Number.NEGATIVE_INFINITY;
  for (const video of pool) {
    const area = renderedArea(video);
    if (area > bestArea) {
      best = video;
      bestArea = area;
    }
  }
  return best;
}
