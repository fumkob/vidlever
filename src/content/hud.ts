// HUD renderer (overview.md §8).
// A single semi-transparent overlay pinned to the top-left of the target video.
// It persistently shows the playback rate plus mute/loop icons, and briefly
// flashes action feedback in place of the rate readout. Tapping the pill opens
// a speed panel — readout, − / slider / + row, and preset buttons — anchored
// below it. All styling is inline so it neither leaks into nor inherits from
// the host page (overview.md §11).

import { t } from "../shared/i18n.ts";
import { applyRate, resolveRate } from "../shared/rate.ts";
import type { HudSettings, SpeedLimits } from "../shared/types.ts";

/** Max signed 32-bit int: floats above any site overlay (overview.md §8.2). */
const MAX_Z_INDEX = 2147483647;

/** Inset from the video's top-left corner, in CSS pixels (overview.md §8.2). */
const INSET_PX = 16;

/**
 * Candidate rates for the speed panel's preset row. Each is shown only when it
 * survives `resolveRate` unchanged — i.e. it sits on the configured rounding
 * grid and inside [min, max] — so the row adapts to the user's speed limits.
 */
const PRESET_RATES = [1, 1.25, 1.5, 2, 3];

// Panel button palette. `refreshPanel` swaps preset buttons between the rest
// and active pairs at runtime, so they must match the built-in style exactly.
const BUTTON_REST_BG = "rgba(255, 255, 255, 0.15)";
const BUTTON_REST_FG = "#ffffff";
const BUTTON_ACTIVE_BG = "#ffffff";
const BUTTON_ACTIVE_FG = "#000000";

/** Look shared by every panel button; size/shape declarations come per kind. */
const BUTTON_BASE_CSS = [
  "border: none",
  `background: ${BUTTON_REST_BG}`,
  `color: ${BUTTON_REST_FG}`,
  "font: inherit",
  "cursor: pointer",
];

/** Pill look for the panel's preset buttons (rest state). */
const PRESET_BUTTON_CSS = [
  ...BUTTON_BASE_CSS,
  "border-radius: 999px",
  "padding: 6px 14px",
  "font-size: 13px",
  "line-height: 1.2",
].join("; ");

/** Format a playback rate for the persistent readout, e.g. `1.00x` (§8.3). */
function formatRate(rate: number): string {
  return `${rate.toFixed(2)}x`;
}

/** Format a preset rate for its button, e.g. `1.0`, `1.25`, `2.0`. */
function formatPresetRate(rate: number): string {
  return rate.toFixed(2).replace(/0$/, "");
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
  private readonly panel: HTMLDivElement;
  private readonly panelReadout: HTMLSpanElement;
  private readonly slider: HTMLInputElement;
  private readonly presetsRow: HTMLDivElement;
  private presetButtons: { rate: number; button: HTMLButtonElement }[] = [];

  private settings: HudSettings;
  private limits: SpeedLimits;
  private video: HTMLVideoElement | null = null;
  private rafId: number | null = null;
  private overlayTimer: ReturnType<typeof setTimeout> | null = null;
  private hovered = false;
  private panelOpen = false;

  // Last-applied layout/state, cached so the per-frame loop only writes to the
  // DOM when something actually changed (avoids layout thrashing).
  private lastLeft = Number.NaN;
  private lastTop = Number.NaN;
  private lastVisible: boolean | null = null;
  private lastReadout = "";
  private lastMuted: boolean | null = null;
  private lastLoop: boolean | null = null;
  private lastPanelRate = Number.NaN;

  constructor(settings: HudSettings, limits: SpeedLimits) {
    this.settings = settings;
    this.limits = limits;

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
      "font-weight: 400",
      "line-height: 1.2",
      "white-space: nowrap",
      // The pill is tappable (it toggles the speed panel), so it does intercept
      // pointer events over its own small footprint; video hover state is kept
      // intact by mirroring mouseenter/mouseleave on the root (see constructor).
      "pointer-events: auto",
      "cursor: pointer",
      "user-select: none",
      `opacity: ${settings.opacityRest}`,
      "transition: opacity 0.15s ease",
    ].join("; ");

    this.readout = document.createElement("span");
    this.muteIcon = this.createIcon("🔇");
    this.loopIcon = this.createIcon("🔁");

    this.panel = document.createElement("div");
    this.panel.style.cssText = [
      "position: absolute", // anchored below the fixed-position pill
      "top: calc(100% + 10px)",
      "left: 0",
      "display: none",
      "flex-direction: column",
      "gap: 14px",
      "box-sizing: border-box",
      "padding: 16px",
      "border-radius: 16px",
      "background: rgba(0, 0, 0, 0.85)",
      "cursor: default",
    ].join("; ");

    this.panelReadout = document.createElement("span");
    this.panelReadout.style.cssText = [
      "display: block",
      "text-align: center",
      "font-size: 18px",
      "font-weight: 600",
    ].join("; ");

    this.slider = document.createElement("input");
    this.slider.type = "range";
    // `step: any` so the thumb can sit on whatever rate the video actually
    // has. A numeric step would be anchored at `min` (valid positions are
    // min + n*step), and range inputs snap *assigned* values onto that grid —
    // with a min off the §7 rounding grid the thumb could never render the
    // real rate and would fight the per-frame write-back.
    this.slider.step = "any";
    this.slider.setAttribute("aria-label", t("speedPanelSlider"));
    this.slider.style.cssText = [
      "flex: 1",
      "width: 160px", // intrinsic width; flex grows it to fill the row
      "margin: 0",
      "accent-color: #ffffff",
      "cursor: pointer",
    ].join("; ");
    this.slider.addEventListener("input", () => {
      this.setRate(Number(this.slider.value));
    });

    const sliderRow = document.createElement("div");
    sliderRow.style.cssText = "display: flex; align-items: center; gap: 10px";
    sliderRow.append(this.createStepButton(-1), this.slider, this.createStepButton(1));

    this.presetsRow = document.createElement("div");
    this.presetsRow.style.cssText = "display: flex; align-items: flex-start; gap: 8px";

    this.panel.append(this.panelReadout, sliderRow, this.presetsRow);
    this.applyLimits();

    this.root.append(this.readout, this.muteIcon, this.loopIcon, this.panel);

    // The pill is also the keyboard path to the panel: a focusable button
    // toggled by Enter/Space. Bound keys pass through untouched while focus is
    // inside the HUD (index.ts skips interception via containsNode), so the
    // panel's native widgets keep their own keyboard behavior too.
    this.root.tabIndex = 0;
    this.root.setAttribute("role", "button");
    this.root.setAttribute("aria-haspopup", "true");
    this.root.setAttribute("aria-expanded", "false");
    this.root.setAttribute("aria-label", t("speedPanelToggle"));

    // Toggle the panel on pill taps; swallow the event either way so the host
    // page's own document-level click handlers don't react to HUD interaction.
    this.root.addEventListener("click", (event) => {
      event.stopPropagation();
      if (this.panel.contains(event.target as Node)) return; // panel widgets handle themselves
      this.setPanelOpen(!this.panelOpen);
    });
    this.root.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    this.root.addEventListener("keydown", (event) => {
      if (event.target !== this.root) return; // panel widgets keep their native keys
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      this.setPanelOpen(!this.panelOpen);
    });
    // `all: initial` wipes the UA focus ring, so paint one back for keyboard
    // focus; :focus-visible keeps it away from plain pointer taps.
    this.root.addEventListener("focus", () => {
      if (this.root.matches(":focus-visible")) {
        this.root.style.outline = "2px solid #ffffff";
        this.root.style.outlineOffset = "2px";
      }
    });
    this.root.addEventListener("blur", () => {
      this.root.style.outline = "none";
    });
    // Keep the pill bright while the pointer is on it: entering the pill fires
    // mouseleave on the video underneath, which would otherwise dim the HUD at
    // the exact moment the user reaches for it.
    this.root.addEventListener("mouseenter", this.onEnter);
    this.root.addEventListener("mouseleave", this.onLeave);

    document.addEventListener("fullscreenchange", this.onFullscreenChange);
  }

  /** Point the HUD at a video, (re)mount it, and start the render loop. */
  attach(video: HTMLVideoElement): void {
    if (this.video === video) return;
    // The panel's controls target one video; carrying it open across a swap
    // (ad↔content, another video starting) would silently retarget a possibly
    // mid-interaction slider at the new element.
    this.setPanelOpen(false);
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
    this.setPanelOpen(false);
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

  /** Apply edited settings (opacity, enabled, speed limits) from options / sync. */
  setSettings(settings: HudSettings, limits: SpeedLimits): void {
    this.settings = settings;
    const previous = this.limits;
    this.limits = limits;
    // Re-range the slider / rebuild the presets only when the limits actually
    // changed: storage sync lands here on *every* settings edit, and an
    // unconditional rebuild would yank a preset button out from under an
    // in-flight press and snap a mid-drag slider thumb.
    if (
      limits.min !== previous.min ||
      limits.max !== previous.max ||
      limits.decimals !== previous.decimals
    ) {
      this.applyLimits();
    }
    this.applyOpacity();
    this.lastVisible = null; // re-evaluate visibility on the next frame
  }

  /**
   * Whether `node` lives inside the HUD (pill or panel). The keydown wiring
   * (index.ts) uses this to leave keys aimed at the HUD's own widgets alone —
   * intercepting them would hijack Space/arrows from the very controls the
   * extension rendered.
   */
  containsNode(node: Node): boolean {
    return this.root.contains(node);
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

  /** Build one of the panel's circular − / + stepper buttons. */
  private createStepButton(direction: -1 | 1): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = direction < 0 ? "−" : "+";
    button.setAttribute(
      "aria-label",
      t(direction < 0 ? "speedPanelDecrease" : "speedPanelIncrease"),
    );
    button.style.cssText = [
      ...BUTTON_BASE_CSS,
      "flex: none",
      "width: 32px",
      "height: 32px",
      "border-radius: 50%",
      "font-size: 18px",
      "line-height: 1",
    ].join("; ");
    button.addEventListener("click", () => {
      // setRate's resolution rounds the sum onto the same grid point that
      // resolving first would reach, since the step is a whole grid multiple.
      if (this.video) this.setRate(this.video.playbackRate + direction * this.stepSize());
    });
    return button;
  }

  /** Stepper (− / +) increment: one grid notch coarse enough to feel tactile. */
  private stepSize(): number {
    return this.limits.decimals === 1 ? 0.1 : 0.05;
  }

  /** Land the video on the configured grid, same as keyboard speed actions. */
  private setRate(rawRate: number): void {
    if (this.video) applyRate(this.video, rawRate, this.limits);
  }

  /** Re-range the slider and rebuild the preset row from `this.limits`. */
  private applyLimits(): void {
    this.slider.min = String(this.limits.min);
    this.slider.max = String(this.limits.max);
    this.lastPanelRate = Number.NaN; // re-sync the panel widgets on the next frame
    this.rebuildPresets();
  }

  private rebuildPresets(): void {
    this.presetButtons = [];
    this.presetsRow.replaceChildren();
    for (const rate of PRESET_RATES) {
      // Off-grid or out-of-range candidates don't survive resolution — skip
      // them rather than showing a button that lands somewhere else.
      if (resolveRate(rate, this.limits) !== rate) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = formatPresetRate(rate);
      button.style.cssText = PRESET_BUTTON_CSS;
      button.addEventListener("click", () => {
        this.setRate(rate);
      });
      // Only the 1.0 preset carries a caption; the others need no wrapper.
      if (rate === 1) {
        const item = document.createElement("span");
        item.style.cssText = "display: flex; flex-direction: column; align-items: center; gap: 4px";
        const caption = document.createElement("span");
        caption.textContent = t("speedPanelNormal");
        caption.style.cssText = "font-size: 11px; color: rgba(255, 255, 255, 0.6)";
        item.append(button, caption);
        this.presetsRow.append(item);
      } else {
        this.presetsRow.append(button);
      }
      this.presetButtons.push({ rate, button });
    }
  }

  private setPanelOpen(open: boolean): void {
    if (this.panelOpen === open) return;
    this.panelOpen = open;
    this.panel.style.display = open ? "flex" : "none";
    this.root.setAttribute("aria-expanded", String(open));
    // Close on any press outside the HUD. Capture phase so a site handler's
    // stopPropagation can't strand the panel open.
    if (open) {
      document.addEventListener("pointerdown", this.onOutsidePointerDown, true);
    } else {
      document.removeEventListener("pointerdown", this.onOutsidePointerDown, true);
    }
    this.applyOpacity();
  }

  private readonly onOutsidePointerDown = (event: PointerEvent): void => {
    if (this.root.contains(event.target as Node)) return;
    this.setPanelOpen(false);
  };

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
    // An open panel pins the HUD fully opaque — the user is interacting with
    // it, and pointer position (over panel, not video) shouldn't dim it.
    const target = this.panelOpen
      ? 1
      : this.hovered
        ? this.settings.opacityHover
        : this.settings.opacityRest;
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
    if (!visible) {
      // The panel can't outlive a visible HUD, whatever hid it (settings
      // toggle, collapsed video box). Closing here — where visibility is
      // decided — also drops the document-level outside-press listener.
      this.setPanelOpen(false);
      return;
    }
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
    this.refreshPanel(video);
  }

  /**
   * Keep the panel's readout, slider, and preset highlight in lockstep with the
   * live rate — including keyboard-driven changes made while the panel is open.
   * While open, the raw-rate cache makes the usual no-change frame a single
   * float compare.
   */
  private refreshPanel(video: HTMLVideoElement): void {
    // Closed ⇒ dirty: re-asserting the invalidation every hidden frame means
    // any path that reveals the panel repaints it on its first open frame.
    if (!this.panelOpen) {
      this.lastPanelRate = Number.NaN;
      return;
    }
    const rate = video.playbackRate;
    if (rate === this.lastPanelRate) return;
    this.lastPanelRate = rate;
    // The panel readout always shows the live rate; unlike the pill readout it
    // is never borrowed for transient overlay flashes.
    this.panelReadout.textContent = formatRate(rate);
    const current = resolveRate(rate, this.limits);
    this.slider.value = String(current);
    for (const { rate: preset, button } of this.presetButtons) {
      const active = preset === current;
      button.style.background = active ? BUTTON_ACTIVE_BG : BUTTON_REST_BG;
      button.style.color = active ? BUTTON_ACTIVE_FG : BUTTON_REST_FG;
    }
  }
}
