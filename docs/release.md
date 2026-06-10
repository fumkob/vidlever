# Release Process & Tag Rules

Vidlever is not published to the Chrome Web Store. Distribution happens through
GitHub Releases: each release ships a zip of the built `dist/` directory, which
users load as an unpacked extension (see docs/design/overview.md §12–§13).

## Tag rules

- **Format**: `vX.Y.Z` (Semantic Versioning). Examples: `v0.2.0`, `v1.0.0`
- **Prereleases**: append a hyphenated suffix, e.g. `vX.Y.Z-beta.1`. CI marks
  these as prereleases on the GitHub Release automatically
- **Versions must agree**: the `X.Y.Z` part of the tag (prerelease suffix
  stripped) must match the `version` in both `package.json` and
  `src/manifest.json`. Example: tag `v1.0.0-beta.1` → both files say `1.0.0`.
  On a mismatch, the Release workflow fails before building
- Always tag a commit on the main branch

## CI overview

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `.github/workflows/ci.yml` | push / PR to main | lint → typecheck → test → build |
| `.github/workflows/release.yml` | push of a `v*.*.*` tag | version-consistency check → lint → typecheck → test → build → zip `dist/` → create GitHub Release (auto-generated notes) |

The release asset is `vidlever-vX.Y.Z.zip`. `manifest.json` sits at the zip
root, so users can unzip and load the folder directly via
`chrome://extensions/`.

## How to cut a release

1. Bump `version` in both `package.json` and `src/manifest.json`
   (don't forget either one — the manifest only accepts plain `X.Y.Z`, so even
   for a prerelease it stays `X.Y.Z` without the suffix)
2. Commit and merge to main
3. Tag and push:

   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```

4. Once the Release workflow finishes, the release with the zip attached
   appears on the Releases page

## Notes

- The `key` field in `src/manifest.json` is a public key and is safe to ship —
  it pins the Extension ID across machines (see overview.md §13). The private
  key `vidlever-key.pem` must never be committed or attached
- To redo a release, delete both the GitHub Release and the tag, then re-tag
