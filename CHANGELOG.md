# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Keyboard seek actions now wake the site player's auto-hidden controls, so the seek bar stays visible when skipping — including in fullscreen.

### Fixed

- Fullscreen now targets the player container instead of the bare video element, so site seek bars and controls stay visible in fullscreen on most sites.

## [0.1.0] - 2026-06-10

First public release. Vidlever is a Chrome extension (Manifest V3) that brings
one consistent set of keyboard shortcuts to every HTML5 `<video>` on the web,
distributed as an unpacked extension via GitHub Releases.

### Added

- Keyboard-driven playback control with a library of 11 actions: `playPause`,
  `skipForward`, `skipBackward`, `speedDelta`, `speedSet`, `muteToggle`,
  `fullscreenToggle`, `pipToggle`, `seekToStart`, `seekToEnd`, and `loopToggle`
- Default key bindings: `Space` (play/pause), `x` / `z` (skip ±10s),
  `d` / `s` (speed ±0.1), `r` (reset speed to 1.0×, press again to restore the
  previous rate), `f` (fullscreen)
- Bindings-as-data model: every binding is an `(action, parameters, key)` tuple
  that can be created, edited, duplicated, reordered, disabled, or deleted from
  the options page
- Works in all frames (`<all_urls>` / `all_frames`), covering embedded iframes
  and videos inside Shadow DOM
- Focus guard: keys are never intercepted while an `<input>`, `<textarea>`, or
  `contenteditable` element is focused
- Lazy activation: the `keydown` listener attaches only while a `<video>`
  exists in the document or frame, and detaches when none remain
- Smart target selection when a page has multiple videos: currently playing →
  largest rendered area → first in DOM order
- HUD overlay: a persistent badge showing current speed / mute / loop state,
  plus a 1.5s transient overlay on each action, with configurable visibility,
  idle/hover opacity, and overlay duration
- Speed clamping and rounding with configurable limits (default 0.25–4.0,
  2 decimals)
- Settings sync across machines via `chrome.storage.sync`, with a pinned
  Extension ID (manifest `key`) so installs share one ID
- Settings import / export / reset round-tripping through
  `vidlever-settings.json`, schema-validated on import
- Options page built with Preact, localized via `_locales` (English)

[Unreleased]: https://github.com/fumkob/vidlever/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/fumkob/vidlever/releases/tag/v0.1.0
