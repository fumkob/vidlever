// Playback-rate domain math (overview.md §7): the rounding grid and bounds
// every speed change lands on. Shared by the executor's keyboard actions and
// the HUD's speed panel so every write to `video.playbackRate` resolves
// through the identical grid.

import type { SpeedLimits } from "./types.ts";

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
export function resolveRate(rate: number, limits: SpeedLimits): number {
  const rounded = roundRate(rate, limits);
  return Math.min(Math.max(rounded, limits.min), limits.max);
}

/** Apply the resolved (rounded + clamped) rate to the video (overview.md §7). */
export function applyRate(video: HTMLVideoElement, rawRate: number, limits: SpeedLimits): void {
  video.playbackRate = resolveRate(rawRate, limits);
}
