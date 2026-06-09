# Vidlever

Keyboard-driven playback control for **every** HTML5 `<video>` on the web — a Chrome extension (Manifest V3).

Play/pause, seek, change speed, mute, fullscreen, Picture-in-Picture, and loop any video with one consistent set of shortcuts, no matter which site you're on. Bindings are fully customizable and sync across machines via `chrome.storage.sync`.

> Distributed as an **unpacked extension** for local installation. It is not published to the Chrome Web Store.

## Why

Every video site ships its own shortcuts, and they're inconsistent or incomplete. Vidlever treats keyboard shortcuts as a *lever* — a precise control that's always within reach — and applies the same keymap everywhere: YouTube, Udemy, Vimeo, lecture recordings, internal training platforms, and any other page that uses the `<video>` element.

The core design bet: **shortcut bindings are data, not code.** Each binding is an `(action, parameters, key)` tuple you can create, edit, duplicate, disable, or delete. Vidlever is a configuration UI on top of a small, fixed library of actions rather than a hard-coded keymap.

## Features

- **Works on any video** — content scripts are injected into all frames (`<all_urls>` / `all_frames`), so embedded iframes and videos inside Shadow DOM are covered too.
- **Stays out of your way while typing** — keys are never intercepted while an `<input>`, `<textarea>`, or `contenteditable` element is focused (focus guard).
- **Only active when there's video** — the `keydown` listener attaches only when a `<video>` exists in the document or frame, and detaches when none remain. On pages without video, the extension is invisible and registers zero handlers.
- **Smart target selection** — when a page has multiple videos, it picks one: currently playing → largest rendered area → first in DOM order.
- **HUD overlay** — a persistent badge in the top-left of the video shows current speed / mute / loop state, plus a 1.5s transient overlay on each action.
- **Fully configurable** — the options page lets you reassign, duplicate, reorder (priority for duplicate keys), enable/disable, and delete bindings, tune speed limits and rounding, and adjust the HUD's appearance. Settings can be imported, exported, and reset.

## Default key bindings

| Key | Action | Description |
|---|---|---|
| `Space` | playPause | Play / pause |
| `x` | skipForward | Skip forward 10s |
| `z` | skipBackward | Skip backward 10s |
| `d` | speedDelta | Speed +0.1 |
| `s` | speedDelta | Speed −0.1 |
| `r` | speedSet | Reset speed to 1.0× |
| `f` | fullscreenToggle | Toggle fullscreen |

The actions `muteToggle`, `pipToggle`, `seekToStart`, `seekToEnd`, and `loopToggle` are **unbound by default** — add keys for them on the options page as needed.

### All actions (11)

| Action | Parameter | Description |
|---|---|---|
| `playPause` | — | Toggle play / pause |
| `skipForward` | `seconds` | Advance `currentTime` by N seconds |
| `skipBackward` | `seconds` | Rewind `currentTime` by N seconds |
| `speedDelta` | `delta` | Adjust `playbackRate` relatively (clamped + rounded) |
| `speedSet` | `rate` | Set `playbackRate` to an exact value; pressing again restores the previous rate |
| `muteToggle` | — | Toggle mute |
| `fullscreenToggle` | — | Enter / exit fullscreen on the target video |
| `pipToggle` | — | Enter / exit Picture-in-Picture |
| `seekToStart` | — | Jump to the start |
| `seekToEnd` | — | Jump to the end |
| `loopToggle` | — | Toggle looping |

Playback speed is clamped to the configured limits (default `0.25`–`4.0`) and rounded to the configured number of decimals (default 2).

## Install (unpacked)

```bash
pnpm install
pnpm build        # produces dist/
```

1. Open `chrome://extensions/` in Chrome.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select the `dist/` directory.
4. Open any page with a video and try the keys above.

To update, re-run `pnpm build` and click the reload icon on the extension card.

> Vidlever targets Chrome (Manifest V3). Other Chromium browsers (Edge, Brave) will likely work without changes but aren't officially supported. Firefox and Safari are out of scope.

## Configuration

Open the options page from the extension icon in the toolbar, or from the extension's details in `chrome://extensions/`.

- **Bindings** — assign keys via capture, enable/disable, duplicate, delete, and drag to reorder (reorder sets the priority for duplicate keys).
- **Speed** — min / max / rounding decimals (1 or 2).
- **HUD** — show/hide, idle and hover opacity, transient overlay duration.
- **Import / Export / Reset** — round-trip settings through `vidlever-settings.json`. Imports are schema-validated before being written.

## Development

```bash
pnpm dev          # Vite dev server (HMR)
pnpm test         # Vitest (unit tests)
pnpm typecheck    # tsc --noEmit
pnpm lint         # Biome check
pnpm format       # Biome check --write
```

Stack: Vite + `vite-plugin-web-extension` · TypeScript (strict) · Preact (options page) · Biome · Vitest + happy-dom.

The canonical design reference is [`docs/design/overview.md`](docs/design/overview.md).

## Extension ID & key management

To sync settings across two or more machines via `chrome.storage.sync`, the **Extension ID must match** on every machine. The ID is derived from the `key` field (a public key) in `manifest.json`.

This repository commits a `key` so the original author's installs share one ID. **If you fork or build your own copy, generate your own key** so your Extension ID doesn't collide with anyone else's, then replace the `key` field in `src/manifest.json`:

```bash
# Generate a 2048-bit RSA private key — keep this file secret, never commit it
openssl genrsa -out vidlever-key.pem 2048

# Derive the public key in the format Chrome's `key` field expects (DER → Base64)
openssl rsa -in vidlever-key.pem -pubout -outform DER | openssl base64 -A
```

Notes:

- `vidlever-key.pem` is your **private key**. It is excluded by `.gitignore` (`*.pem`) and must **never** be committed. Back it up in a password manager or encrypted storage.
- The `key` committed to `manifest.json` is a **public key** and is safe to share. The private key is not needed to load or run the extension — only to re-derive the public key.
- If you lose the `.pem`, regenerate it, accept the new Extension ID, and re-sync settings manually (export your settings beforehand while the old install can still read them).

To set up a second machine: clone the repo, place your `vidlever-key.pem` at the project root, run `pnpm build`, and load `dist/` unpacked. Because the public `key` is committed, you get the same Extension ID and your settings sync.

## License

[MIT](LICENSE) © Fumiaki Kobayashi
