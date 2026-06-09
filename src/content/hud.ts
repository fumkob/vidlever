// HUD renderer (overview.md §8).
// A single semi-transparent overlay pinned to the top-left of the target video.
// It persistently shows the playback rate plus mute/loop icons, and briefly
// flashes action feedback in place of the rate readout. All styling is inline
// so it neither leaks into nor inherits from the host page (overview.md §11).

import type { HudSettings } from "../shared/types.ts";

/** Max signed 32-bit int: floats above any site overlay (overview.md §8.2). */
const MAX_Z_INDEX = 2147483647;

/** Inset from the video's top-left corner, in CSS pixels (overview.md §8.2). */
const INSET_PX = 16;

/** Format a playback rate for the persistent readout, e.g. `1.00x` (§8.3). */
function formatRate(rate: number): string {
  return `${rate.toFixed(2)}x`;
}

/**
 * The on-screen HUD. One instance per frame; `attach()` points it at the
 * current target video, `flashOverlay()` shows transient feedback, and
 * `detach()` parks it when no video remains.
 */
export class Hud {
  private readonly root: HTMLDivElement;
  private readonly readout: HTMLSpanElement;
  private readonly muteIcon: HTMLSpanElement;
  private readonly loopIcon: HTMLSpanElement;

  private settings: HudSettings;
  private video: HTMLVideoElement | null = null;
  private rafId: number | null = null;
  private overlayTimer: ReturnType<typeof setTimeout> | null = null;
  private hovered = false;

  // Last-applied layout/state, cached so the per-frame loop only writes to the
  // DOM when something actually changed (avoids layout thrashing).
  private lastLeft = Number.NaN;
  private lastTop = Number.NaN;
  private lastVisible: boolean | null = null;
  private lastReadout = "";
  private lastMuted: boolean | null = null;
  private lastLoop: boolean | null = null;

  constructor(settings: HudSettings) {
    this.settings = settings;

    this.root = document.createElement("div");
    this.root.style.cssText = [
      "all: initial", // reset all host-page inheritance, then opt back in below
      "position: fixed",
      `z-index: ${MAX_Z_INDEX}`,
      "display: none",
      "box-sizing: border-box",
      "align-items: center",
      "gap: 6px",
      "padding: 3px 9px",
      "border-radius: 999px",
      "background: rgba(0, 0, 0, 0.62)",
      "color: #ffffff",
      "font-family: ui-sans-serif, system-ui, -apple-system, sans-serif",
      "font-size: 14px",
      "font-weight: 600",
      "line-height: 1.2",
      "white-space: nowrap",
      "pointer-events: none", // never intercept clicks; keeps video hover intact
      "user-select: none",
      `opacity: ${settings.opacityRest}`,
      "transition: opacity 0.15s ease",
    ].join("; ");

    this.readout = document.createElement("span");
    this.muteIcon = this.createIcon("🔇");
    this.loopIcon = this.createIcon("🔁");
    this.root.append(this.readout, this.muteIcon, this.loopIcon);

    document.addEventListener("fullscreenchange", this.onFullscreenChange);
  }

  /** Point the HUD at a video, (re)mount it, and start the render loop. */
  attach(video: HTMLVideoElement): void {
    if (this.video === video) return;
    this.detachVideoListeners();
    this.video = video;
    video.addEventListener("mouseenter", this.onEnter);
    video.addEventListener("mouseleave", this.onLeave);
    this.hovered = false;
    this.applyOpacity();
    this.mount();
    // Re-sync the top layer: fullscreenchange only fires on transitions, so a
    // video swapped in while already fullscreen (e.g. ad↔content under a site's
    // native fullscreen) would otherwise leave the HUD in normal flow, painted
    // behind the fullscreened element. Idempotent — a no-op when not fullscreen.
    this.setTopLayer(document.fullscreenElement !== null);
    this.startLoop();
  }

  /** Park the HUD when no video remains in the frame. */
  detach(): void {
    this.detachVideoListeners();
    this.video = null;
    this.stopLoop();
    this.clearOverlayTimer();
    this.setTopLayer(false);
    this.root.style.display = "none";
    this.lastVisible = false;
  }

  /** Flash transient feedback in place of the rate readout for §8.4's window. */
  flashOverlay(text: string): void {
    if (!this.settings.enabled) return;
    this.readout.textContent = text;
    this.lastReadout = text;
    this.clearOverlayTimer();
    this.overlayTimer = setTimeout(() => {
      this.overlayTimer = null;
      // Force refreshState() to repaint the live rate on the next frame.
      this.lastReadout = "";
    }, this.settings.overlayDurationMs);
  }

  /** Apply edited settings (opacity, enabled) from the options page / sync. */
  setSettings(settings: HudSettings): void {
    this.settings = settings;
    this.applyOpacity();
    this.lastVisible = null; // re-evaluate visibility on the next frame
  }

  /** Tear down completely (listeners + DOM node). */
  destroy(): void {
    this.detach();
    document.removeEventListener("fullscreenchange", this.onFullscreenChange);
    this.root.remove();
  }

  private createIcon(glyph: string): HTMLSpanElement {
    const span = document.createElement("span");
    span.textContent = glyph;
    span.style.cssText = "display: none; font-size: 12px";
    return span;
  }

  private readonly onEnter = (): void => {
    this.hovered = true;
    this.applyOpacity();
  };

  private readonly onLeave = (): void => {
    this.hovered = false;
    this.applyOpacity();
  };

  private readonly onFullscreenChange = (): void => {
    this.setTopLayer(document.fullscreenElement !== null);
  };

  // Keep the HUD visible over a fullscreened video (§8.2). The browser only
  // paints the fullscreen element's subtree, so a body-mounted HUD would vanish.
  // Instead we float it into the top layer via the Popover API, which paints
  // over the fullscreened video even when the target is the bare <video>
  // element (a replaced element that can't host rendered children).
  //
  // `popover="manual"` opts out of light dismiss and focus management, so it
  // never steals interaction from the page. Idempotent: enters or exits the
  // top layer only when the current state differs from `active`.
  private setTopLayer(active: boolean): void {
    const open = this.root.matches(":popover-open");
    if (active && !open) {
      this.root.setAttribute("popover", "manual");
      try {
        this.root.showPopover();
      } catch {
        // Element not connected — leave it in normal flow.
      }
    } else if (!active && open) {
      try {
        this.root.hidePopover();
      } catch {
        // Already hidden; nothing to do.
      }
      this.root.removeAttribute("popover");
    }
    // Re-evaluate display on the next frame now that the layer changed.
    this.lastVisible = null;
  }

  private applyOpacity(): void {
    const target = this.hovered ? this.settings.opacityHover : this.settings.opacityRest;
    this.root.style.opacity = String(target);
  }

  private mount(): void {
    // The HUD always lives in body; it rides the top layer for fullscreen
    // (see onFullscreenChange / setTopLayer) rather than being reparented.
    if (this.root.parentNode !== document.body) {
      document.body.appendChild(this.root);
    }
  }

  private detachVideoListeners(): void {
    if (!this.video) return;
    this.video.removeEventListener("mouseenter", this.onEnter);
    this.video.removeEventListener("mouseleave", this.onLeave);
  }

  private startLoop(): void {
    if (this.rafId !== null) return;
    const tick = (): void => {
      this.reposition();
      this.refreshState();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private clearOverlayTimer(): void {
    if (this.overlayTimer !== null) {
      clearTimeout(this.overlayTimer);
      this.overlayTimer = null;
    }
  }

  /** Track the video's box each frame; `hud.enabled === false` hides it (§8.5). */
  private reposition(): void {
    const video = this.video;
    if (!video) return;
    const rect = video.getBoundingClientRect();
    const visible = this.settings.enabled && rect.width > 0 && rect.height > 0;
    if (visible !== this.lastVisible) {
      this.root.style.display = visible ? "flex" : "none";
      this.lastVisible = visible;
    }
    if (!visible) return;
    const left = rect.left + INSET_PX;
    const top = rect.top + INSET_PX;
    if (left !== this.lastLeft || top !== this.lastTop) {
      this.root.style.left = `${left}px`;
      this.root.style.top = `${top}px`;
      this.lastLeft = left;
      this.lastTop = top;
    }
  }

  /** Refresh the persistent readout + icons (overview.md §8.3). */
  private refreshState(): void {
    const video = this.video;
    if (!video) return;
    // Don't clobber an active overlay; it restores the rate when it expires.
    if (this.overlayTimer === null) {
      const text = formatRate(video.playbackRate);
      if (text !== this.lastReadout) {
        this.readout.textContent = text;
        this.lastReadout = text;
      }
    }
    if (video.muted !== this.lastMuted) {
      this.muteIcon.style.display = video.muted ? "inline" : "none";
      this.lastMuted = video.muted;
    }
    if (video.loop !== this.lastLoop) {
      this.loopIcon.style.display = video.loop ? "inline" : "none";
      this.lastLoop = video.loop;
    }
  }
}
