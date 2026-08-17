# Decision 43: Antigravity desktop release final acceptance

**Status:** Binding — Accepted
**Date:** 2026-08-16
**Identifier:** `synara-pi-mcp-decision-43`
**Trigger:** Final acceptance (the only final acceptance invocation for this ticket)
**Supersedes:** None. Decision 42 remains in force.

## Question

Does the integrated release ticket — Antigravity late-CLI-failure settlement,
`.bg-shell` runtime-state hygiene, and Symphony desktop
`v0.7.2-symphony.2` — satisfy the owner's personal-use goal with Pi/MCP
boundaries intact, given the owner's explicit acceptance of the broad
Antigravity recovery predicate?

## Governing references

- Authoritative: `.planning/synara-pi-coding-agent-mcp/PROJECT.md`.
- Authoritative: candidate source and release tag
  `3605c636b705e850610db13e98bbecd1cc220774`.
- Authoritative: owner direction in the current request to put the reviewed
  commits on `main` and rebuild.
- Authoritative: `AGENTS.md` completion-command constraints.
- Supporting: exactly one independent reviewer package, verdict
  `PASS WITH GAPS` with high confidence.
- Supporting: GitHub release `v0.7.2-symphony.2`.

## Evaluated candidate and evidence

- Remote `main`, release branch, and annotated release tag resolve to source
  commit `3605c636b705e850610db13e98bbecd1cc220774`.
- The release delta contains the byte-faithful Antigravity fix, `.bg-shell`
  ignore/untracking, and release-version alignment.
- `apps/server`, `apps/desktop`, `apps/web`, `packages/contracts`, and their
  `bun.lock` workspace entries report `0.7.2-symphony.2`.
- Publish-mode provenance preflight passed with lockfile SHA-256
  `289a3ffa5e8de49cc27e3d35036b343ab8cc77ac77305b08ed1cb5b0098ab9e2`.
- Focused Antigravity tests passed 25/25; release smoke and scripts typecheck
  passed; full production build and all packaging/post-processing gates
  completed successfully.
- The DMG passed `hdiutil verify` and has SHA-256
  `0fad8eceaa855a986aef2a8a63165363f13f30a5d2722e3a771f8ee63978eef6`.
- `/Applications/Synara.app` reports `0.7.2-symphony.2`, is native `arm64`,
  launches its packaged backend, and presents one desktop window.
- The public release contains DMG, update ZIP, and `latest-mac.yml`; the
  latest-manifest URL returns HTTP 200 and matches the built manifest.
- The release delta does not change Pi/MCP boundary modules, opt-in behavior,
  authorization, lifecycle, or recovery semantics.

## Criterion verdicts

| Criterion                            | Verdict                          | Basis                                                                                                                              |
| ------------------------------------ | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Clean integration into remote `main` | pass                             | Three-commit fast-forward at `3605c636`; release branch and tag aligned.                                                           |
| Antigravity late-failure recovery    | pass with accepted residual risk | Non-zero exit after output becomes completed with a visible `runtime.warning`; silent failures remain failed.                      |
| Partial-output genuine failure       | non-blocking gap                 | Current predicate can classify truncated output or tool-start-only failures as completed; no focused test covers this middle case. |
| `.bg-shell` hygiene                  | pass                             | Volatile PID/timestamp/path manifest is untracked and ignored.                                                                     |
| Release-version alignment            | pass                             | Four release package manifests and lockfile workspace entries use `.2`.                                                            |
| Provenance/build/install/update      | pass                             | Preflight, full build, DMG validation, launch, uploaded assets, and updater manifest verified.                                     |
| Pi/MCP boundaries                    | pass                             | Boundary source is unchanged by the release delta.                                                                                 |
| Signing/notarization                 | non-blocking for personal use    | No Apple identity exists; unsigned scope remains explicitly disclosed and locally launchable.                                      |

## Decision

Accept Symphony desktop release `v0.7.2-symphony.2` for the owner's personal
use.

The broad Antigravity recovery predicate is an accepted residual risk. It
targets a real observed failure in which the CLI exits after output was
delivered, remains diagnosable through `runtime.warning` and raw stderr, and is
isolated to Antigravity turn settlement. The owner accepted the breadth after
it was explained and directed the merge and rebuild.

The missing partial-output plus genuine-error test is a documented,
non-blocking gap for this release, not permission to treat the ambiguity as
resolved.

Full workspace `fmt`, `lint`, and `typecheck` were not run because project
rules prohibit running them without an explicit request in the current
conversation. Focused tests, release smoke, scripts typecheck, provenance
preflight, and the full production build provide the acceptance evidence for
this release.

## Rejected alternatives

- Rejecting the release solely for the broad recovery predicate: stricter
  than the owner-approved risk boundary.
- Silently accepting without a follow-up obligation: loses the reassessment
  anchor for mid-stream failures.
- Running forbidden full-workspace commands without owner authorization:
  conflicts with `AGENTS.md`.

## Downstream obligations

Before the next release:

1. Add a focused test for partial assistant/tool output followed by a genuine
   non-timeout CLI failure.
2. Evaluate narrowing recovery to stronger evidence of terminal assistant
   completion rather than first output or tool start.
3. Reconcile local `main` with `origin/main` before further work; the local
   `main` ref still points to an obsolete divergent lineage.
4. Run full workspace `fmt`, `lint`, and `typecheck` if the owner explicitly
   requests those gates.

## Reopening conditions

Reassess this decision if:

- a masked mid-stream Antigravity failure causes real misdiagnosis;
- main/tag/build/update provenance is contradicted;
- the update feed serves mismatched artifacts;
- a Pi/MCP boundary regression is attributed to this release;
- the owner expands scope to third-party distribution; or
- owner-requested full workspace gates fail.
