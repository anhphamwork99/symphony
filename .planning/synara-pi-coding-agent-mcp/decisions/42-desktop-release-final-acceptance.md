# Decision 42: Symphony desktop release final acceptance

**Status:** Binding — Accepted
**Date:** 2026-08-16
**Identifier:** `synara-pi-mcp-decision-42`
**Trigger:** Final acceptance (the only final acceptance invocation for this ticket)
**Supersedes:** None.

## Question

Does the integrated desktop-release ticket — GitHub fork
`anhphamwork99/symphony` and desktop release `v0.7.2-symphony.1` — satisfy the
owner's goal of managing the fork in a dedicated repository and having a
stable desktop app that can be opened, with Pi/MCP boundaries intact?

## Governing references

- Authoritative: `.planning/synara-pi-coding-agent-mcp/PROJECT.md`.
- Authoritative: source commit
  `2056311d9d30d2fdf47798ce4cdeb702443b07cf`.
- Authoritative: installed `/Applications/Synara.app` and local artifacts in
  `/Users/anhpham99/Downloads/Symphony`.
- Supporting: GitHub release `v0.7.2-symphony.1`.
- Supporting: exactly one independent reviewer package, verdict
  `PASS WITH GAPS` with high confidence.

## Evaluated candidate and evidence

- `origin` is `github.com/anhphamwork99/symphony.git`; `upstream` remains
  `Emanuele-web04/synara.git`.
- Remote `main` and annotated tag `v0.7.2-symphony.1` resolve to source commit
  `2056311d9d30d2fdf47798ce4cdeb702443b07cf`.
- The release range `ddcc6dbb..2056311d` contains one source commit. Its
  release-checker fix skips non-directory electron-builder dist entries
  before looking for the packaged `.app` and physical device-helper sources.
- Scripts typecheck passed; focused verification passed; the exact-provenance
  build completed through staging, native dependency rebuild, Electron
  packaging, device-helper validation, update-ZIP repacking, and manifest
  generation.
- The DMG passed `hdiutil verify`. The installed app reports version
  `0.7.2-symphony.1`, is native `arm64`, launches its packaged backend, and
  presents one desktop window.
- The public GitHub release contains the DMG, update ZIP, and
  `latest-mac.yml`; the latest-manifest URL returns HTTP 200 and is byte-equal
  to the built manifest.
- The packaged updater points to `anhphamwork99/symphony`, not upstream.
- The only source change after the accepted integration candidate is in the
  packaging script. No Pi, MCP, provider, authority, or lifecycle source was
  changed.

## Criterion verdicts

| Criterion | Verdict | Basis |
|---|---|---|
| Dedicated fork repository | pass | Fork, remotes, `main`, tag, description, and public release verified. |
| Reproducible source/artifact identity | pass with hygiene gap | Build pins source commit and lockfile hash; some package/runtime version constants remain `0.7.1`. |
| macOS Apple Silicon packaging | pass | DMG/ZIP/manifest generated; DMG checksum and structure validated. |
| Install and open as a normal app | pass | `/Applications/Synara.app` launches with one window and packaged backend. |
| Update feed owned by the fork | pass | Packaged update config and latest manifest target `anhphamwork99/symphony`. |
| Pi/MCP boundaries | pass | Packaging-only source delta; standing opt-in and authority boundaries unchanged. |
| Apple signing/notarization | non-blocking for personal use | No signing identity exists; limitation is disclosed and local launch succeeds. |

## Decision

Accept Symphony desktop release `v0.7.2-symphony.1` for the owner's personal
use.

The unsigned artifact is residual risk, not a blocker for the stated goal of
opening and using the app on the owner's machine. It becomes blocking if the
goal expands to third-party distribution or a claim of signed-publication
conformance.

The mixed version identity is a release-hygiene gap, not a functional blocker
for this release: Electron app metadata and updater metadata are
`0.7.2-symphony.1`, while some source package/runtime constants remain
`0.7.1`.

## Downstream obligations

Before the next release:

1. Align workspace package versions with
   `scripts/update-release-package-versions.ts`.
2. Run the repository's release source-provenance preflight.
3. Build from a clean tag with source, lockfile, package versions, app
   metadata, and updater metadata aligned.

If distribution to other users becomes a goal:

1. Obtain an Apple Developer signing identity.
2. Use the signed/notarized `SYNARA_DESKTOP_SIGNED` build lane.
3. Treat Gatekeeper and notarization validation as blocking release gates.

## Reopening conditions

Reassess this decision if:

- the owner expands the goal to third-party distribution;
- mixed `0.7.1` runtime constants cause update, migration, or diagnostic
  behavior;
- source/tag/build provenance is contradicted;
- the installed app no longer launches its window and packaged backend; or
- a Pi/MCP boundary regression is attributed to this release.
