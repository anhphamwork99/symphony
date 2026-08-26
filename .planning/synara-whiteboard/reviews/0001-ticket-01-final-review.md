# Ticket 01 final independent review — Excalidraw integration boundary

Status: PASS
Date: 2026-08-26
Reviewer role: independent feature-level reviewer
Candidate: `632e55dd964de2664cbf1c1fe49d0f41e420747d`
Remediated source measured: `0a8f095b43c701ce3c7e2ad0236bf427c9d0c52a`

## Final recommendation

**PASS.** Ticket 01 satisfies AC1–AC6 and the accepted Decision 0048 / Decision 0047 boundaries. No blocking incompatibility was observed. Exact one-event AI Undo remains Ticket 02 scope and is not accepted by this review.

## Prior finding closure

| Prior finding                      | Closure evidence                                                                                                                                                                                                                | Status                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| AC2 original → first normalization | Real browser test compares `EXCALIDRAW_TICKET01_FIXTURE` directly to the first mounted snapshot before serialization (`SynaraExcalidrawAdapter.acceptance.browser.tsx`).                                                        | Closed                        |
| Restore loss detection             | Semantic comparator detects missing/unexpected elements and files, image data loss, relationship loss, and ordering changes; negative fixture tests cover these cases.                                                          | Closed                        |
| SVG/PNG validity                   | Adapter validates SVG root, dimensions and rendered children; PNG MIME, signature and Chromium decodability.                                                                                                                    | Closed                        |
| Structured failures                | Loader, API-not-ready, hydration, update, export, viewport, selection-timeout and unstable-selection diagnostics use the structured AC/phase/version/scenario/expected/observed schema.                                         | Closed                        |
| Undo feasibility                   | Real Chromium probe proves progressive `captureUpdate: "NEVER"` work does not become an ordinary native Undo event; `undo-feasibility.md` records the absence of a public begin/end transaction and keeps Ticket 02 unaccepted. | Closed for Ticket 01          |
| Baseline self-validation           | Runner separately validates raw markers and generated baselines; candidate baseline validation passes.                                                                                                                          | Closed                        |
| Warm-up protocol                   | All eight repeatable scenarios execute and record two warm-ups and twelve raw samples.                                                                                                                                          | Closed                        |
| Measurement provenance             | Reports identify clean measured source `0a8f095b4`, dirty=false, and explain the separate evidence commit policy.                                                                                                               | Closed                        |
| Selection ordering/timeout         | IDs are canonicalized before deduplication; zero/non-zero delay, rapid replacement, timeout and unstable-selection cases pass.                                                                                                  | Closed                        |
| Font diagnostics                   | Fixture and semantic projection now include font/layout metadata; semantic round trip passes.                                                                                                                                   | Closed / no blocking residual |

## AC verdicts

| AC                                       | Verdict | Evidence                                                                                                                                                                                                                                                          |
| ---------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1 — exact official package loads       | PASS    | Exact `@excalidraw/excalidraw` `0.18.1` package and lock pin; lazy adapter/CSS boundary; real Chromium API-ready/canvas proof; production web build pass.                                                                                                         |
| AC2 — representative semantic round trip | PASS    | Six-element fixture with frame, group, bound text, reciprocal connector bindings, image/file data, custom data and ordering; official restore → real hydrate → serialize → restore → second hydrate → SVG/PNG; original→first and first→second semantic equality. |
| AC3 — ordered progressive updates        | PASS    | Public `updateScene`, contiguous sequence enforcement, intermediate state observation, stable mount/API identity and retained viewport; order-gap diagnostic.                                                                                                     |
| AC4 — lock with navigation               | PASS    | Real Delete is blocked under `viewModeEnabled`; wheel pan and Ctrl-wheel zoom work; mutation works after unlock.                                                                                                                                                  |
| AC5 — selection and viewport observation | PASS    | Raw/settled events, zero and non-zero delay, canonical deduplication, rapid replacement, timeout/stability diagnostics and viewport capture/restore.                                                                                                              |
| AC6 — measured baseline                  | PASS    | Eight scenarios, twelve samples each, two warm-ups each, visible/hidden retained canvases, eight visibility cycles, separate mount/unmount, image serialization/SVG/PNG, coarse-memory limitation and no blocking incompatibility.                                |

## Governance and boundary audit

- Exact official `0.18.1` package; no range, fork, patch or private source path.
- Package and CSS understanding stays in the Synara adapter leaf; the harness dynamically imports the adapter.
- Synara-owned public handle does not export raw Excalidraw element or app-state types.
- Actual Chromium and official restore/serialize/export/update APIs provide material proof; no editor/export mocks replace them.
- Lower seams are limited to deterministic loader failure, selection policy fault injection and package-independent semantic negative tests.
- No production RightDock, normal navigation, persistence, composer, agent operations, Take Over, dot grid, File-canvas or production Undo implementation was added.
- Hydration failures remain explicit and do not silently create an empty scene.
- No filesystem writes, network calls, dynamic evaluation, local storage or unsafe DOM injection were added by Ticket 01.

## Independent verification

Exact candidate checkout: `632e55dd964de2664cbf1c1fe49d0f41e420747d`

Environment:

- macOS Darwin 25.4.0, arm64
- Bun 1.3.11
- Node 24.14.1
- Vitest 4.1.10
- Headless Chromium 145.0.7632.6
- Vite 8.1.5

Commands and outcomes:

1. `/Users/anhpham99/.bun/bin/bun install --frozen-lockfile`
   - PASS; 2,887 packages installed.
2. Focused fixture/import tests.
   - PASS; 2 files, 16 tests.
3. Combined Chromium acceptance/performance on isolated port.
   - PASS; 2 files, 10 tests (9 acceptance + 1 performance).
4. Fresh Chromium acceptance rerun.
   - PASS; 1 file, 9 tests.
5. Generated baseline validation.
   - PASS.
6. Independent raw-marker validation.
   - PASS; exactly one marker and one performance test.
7. Web production build.
   - PASS; 8,839 modules transformed, existing non-blocking large-chunk warning only.
8. Candidate clean/diff checks.
   - PASS; clean worktree and `git diff --check` exit 0.

## AC6 summary

| Scenario           | Samples |    Median |       P95 |
| ------------------ | ------: | --------: | --------: |
| hydrate-empty      |      12 | 21.900 ms | 22.545 ms |
| hydrate-normal     |      12 | 22.200 ms | 22.735 ms |
| hydrate-image      |      12 | 22.100 ms | 22.790 ms |
| serialize-normal   |      12 |  0.000 ms |  0.100 ms |
| update-progressive |      12 |  0.000 ms |  0.100 ms |
| serialize-image    |      12 |  0.000 ms |  0.100 ms |
| export-svg-image   |      12 | 15.250 ms | 16.160 ms |
| export-png-image   |      12 |  9.300 ms | 11.330 ms |

Memory is explicitly coarse process-level `performance.memory.usedJSHeapSize`, not per-canvas retained memory. No product latency or memory budget is inferred.

## Non-blocking advisories

1. The baseline validator verifies finite summaries and sample counts but does not itself recompute median/P95. The reviewer independently recomputed all committed summaries and found them correct. Recomputing inside the validator is future evidence-pipeline hardening, not a current AC failure.
2. Provenance dirty-state collection ignores untracked files. The reviewed candidate had none, so dirty=false is accurate. Future policy may include untracked files.
3. Runtime asset readiness uses a document-global `.excalidraw` selector. The two-canvas proof passes; instance scoping is preferable before reusing the feasibility adapter in a production multi-canvas surface.

## Workspace checks outside Ticket acceptance

Workspace `fmt`, `lint` and `typecheck` were not run because repository policy requires explicit owner authorization. This is an authorized non-run, not evidence of pass and not a Ticket 01 code defect. Unrelated Pi/main baseline changes were excluded from the exact-candidate review.
