# Decision 0049: Ticket 01 final acceptance held on repository typecheck gate

Status: Binding — Final acceptance rejected/held
Date: 2026-08-26
Trigger: Final acceptance, exactly once for Synara Whiteboard Ticket 01
Supersedes: None
Reopens Decisions 0048 or 0047: No

## Question

Does the complete integrated Ticket 01 candidate satisfy its contract and all applicable completion gates sufficiently to be accepted, marked done in Project routing, and unblock Ticket 02?

## Candidate, evidence, and review scope

- Canonical source candidate: `87b86fb57e1797c516c3a94f3ea141d266a30468`.
- Remediated source from which clean AC6 evidence was measured: `0a8f095b43c701ce3c7e2ad0236bf427c9d0c52a`.
- Clean evidence commit: `632e55dd964de2664cbf1c1fe49d0f41e420747d`.
- Sole consolidated independent feature-level review and format/final-check addendum: `5514c86bb`.
- Ticket implementation scope:
  - `apps/web/src/components/whiteboard/ticket01/**`
  - `apps/web/scripts/measure-excalidraw-ticket-01.mjs`
  - exact Excalidraw dependency and lock resolution
  - Ticket 01 evidence artifacts.
- Authorized final-check logs: `/tmp/synara-whiteboard-ticket01-final-candidate-checks/`.
- Unrelated Pi commits in the candidate snapshot were considered only when evaluating repository-wide check status, not as Ticket 01 implementation or acceptance evidence.
- Protected Agentation working-tree changes were excluded.

## Governing authorities

1. `.planning/synara-whiteboard/PROJECT.md`
2. `.planning/synara-whiteboard/issues/01-prove-excalidraw-integration-boundary.md`
3. `.planning/synara-whiteboard/decisions/0048-ticket-01-excalidraw-feasibility-boundary.md`
4. `.planning/synara-whiteboard/decisions/0047-testing-strategy-governance-reassessment.md`
5. `.planning/synara-whiteboard/spec.md`
6. `.planning/synara-whiteboard/PRODUCT-CONTRACT.md`
7. Repository completion requirement that `bun fmt`, `bun lint`, and `bun typecheck` must all pass before a task is considered completed.

Decisions 0048 and 0047 remain accepted and are not reopened.

## Criterion-level verdict

| Criterion                                                 | Verdict  | Basis                                                                                                                                                                                                                    |
| --------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC1 — pinned official package loads                       | **PASS** | Exact `@excalidraw/excalidraw` `0.18.1` pin and lock resolution, lazy adapter boundary, real Chromium load/API/canvas proof, and production build evidence.                                                              |
| AC2 — representative semantic round trip                  | **PASS** | Official restore, serialization, and export boundaries preserve bindings, bound text, groups, frames, image/file data, custom data, relationships, and ordering; SVG and PNG are validated.                              |
| AC3 — progressive updates without remount                 | **PASS** | Ordered public `updateScene` updates, intermediate-state evidence, stable mount/API identity, viewport retention, and explicit sequence-gap diagnostics.                                                                 |
| AC4 — lock while retaining navigation                     | **PASS** | Real Chromium proves mutation is blocked under `viewModeEnabled`, pan/zoom remain available, and mutation resumes after unlock.                                                                                          |
| AC5 — selection and viewport observability                | **PASS** | Raw and settled selection evidence, zero/non-zero delay, canonical deduplication, rapid replacement, timeout/instability diagnostics, and viewport capture/restoration.                                                  |
| AC6 — baseline measurements and incompatibility reporting | **PASS** | Eight scenarios, two warm-ups and twelve samples per repeatable scenario, visible/hidden canvases, visibility cycles, image operations, disclosed memory limitations, clean provenance, and no blocking incompatibility. |

No AC is failed or missing. Exact one-event AI Undo remains Ticket 02 scope and is not accepted by this decision.

## Decision 0048 and Decision 0047 compliance

Ticket 01 complies with both decisions:

- exact Excalidraw `0.18.1`, no fork, range, patch, or private source dependency;
- package-specific behavior isolated behind a Synara-owned lazy adapter;
- actual Chromium and official package utilities prove material behavior;
- progressive updates do not remount the editor;
- semantic fidelity is proven rather than inferred;
- lock/navigation, selection settlement, viewport behavior, exports, diagnostics, and AC6 instrumentation follow the accepted boundary;
- Undo feasibility is reported without claiming Ticket 02 acceptance;
- no production RightDock, persistence, composer, agent workflow, Take Over, dot grid, or File-canvas implementation was absorbed into Ticket 01;
- applicable success paths retain paired failure or diagnostic coverage.

## Authorized final-check disposition

| Check                                | Disposition                                                             |
| ------------------------------------ | ----------------------------------------------------------------------- |
| Frozen install                       | **PASS**                                                                |
| Root `bun run fmt`                   | **PASS**; 34 unrelated paths would be reformatted, zero Ticket 01 paths |
| `git diff --check` after formatting  | **PASS**                                                                |
| Root `bun run lint`                  | **PASS**; 0 errors, 21 warnings                                         |
| Baseline validation                  | **PASS**                                                                |
| Focused tests                        | **PASS**; 2 files, 16 tests                                             |
| Fresh Chromium acceptance            | **PASS**; 1 file, 9 tests                                               |
| Prior combined Chromium run          | **PASS**; 10/10                                                         |
| Prior second acceptance run          | **PASS**; 9/9                                                           |
| Production web build                 | **PASS**                                                                |
| Exact-candidate worktree cleanliness | **PASS**                                                                |
| Root `bun run typecheck`             | **FAIL**, exit 2                                                        |
| Direct web typecheck                 | **FAIL**, eight diagnostics outside Ticket 01                           |

The global typecheck failure is causally classified as unrelated to Ticket 01:

- `scripts/lib/piSubagentDevArtifactCache.ts` reports TS6307 because it imports a server file not listed by `scripts/tsconfig.json`.
- Direct web diagnostics occur only in:
  - `apps/web/src/components/chat/SingleChatSurface.tsx`
  - `apps/web/src/components/chat/useDockPaneRuntimeActivation.browser.tsx`
  - `apps/web/src/components/ChatView.browser.tsx`
  - `apps/web/src/lib/piSubagentExecutionCardPresentation.ts`.
- No Ticket 01 path appears in a typecheck diagnostic.
- Candidate formatting changed none of those files.

This proves that no Ticket 01 type defect is evidenced. It does not make the repository-wide typecheck a pass.

## Binding decision

**TICKET 01 FINAL ACCEPTANCE: REJECTED / HELD.**

This is a repository completion-gate hold, not a defect finding against the Whiteboard implementation or its AC evidence.

The repository rule requires all three heavyweight checks to pass before a task is considered complete. Decision 0047 structures the checks and allows ordinary tickets to own concrete test seams, but it does not waive or convert an unrelated global typecheck failure into a pass. Marking Ticket 01 done would therefore contradict a governing completion requirement.

## Rejected alternatives

1. Accepting by treating unrelated typecheck failures as a pass is rejected because the command exited non-zero.
2. Attributing the Pi/RightDock/ChatView failures to Ticket 01 is rejected because exact diagnostics and changed-path evidence show no causal relationship.
3. Requiring Ticket 01 to modify unrelated Pi or RightDock code is rejected because that would mix independent feature boundaries.
4. Reopening Decisions 0048 or 0047 is rejected because no evidence contradicts either accepted direction.
5. Discarding the passing AC1–AC6 evidence is rejected because it remains sufficient and reusable for a bounded Reassessment.

## Residual advisories

These do not block Ticket 01's technical boundary:

1. Baseline validation does not internally recompute median/P95, although independent recomputation found the committed summaries correct.
2. Provenance dirty-state collection ignores untracked files; the reviewed checkout had none.
3. Runtime asset readiness uses a document-global `.excalidraw` selector; instance scoping is preferred before production multi-canvas reuse.
4. AC6 memory evidence is coarse process-level telemetry, not precise per-canvas retained memory.
5. Ticket 02 must prove Synara-owned exact one-event AI Undo for completed, interrupted, and failed partial AI batches.

## Routing consequence

- Project routing must not mark Ticket 01 done while repository-wide typecheck remains non-green.
- Ticket 02 remains held at the formal acceptance boundary.
- The passing Ticket 01 source, evidence, and consolidated review remain valid inputs to a bounded Reassessment and need not be repeated merely because unrelated type errors are fixed, unless intervening changes touch or materially affect the Ticket 01 boundary.

## Minimum Reassessment evidence

Reassess when an exact candidate containing the same accepted Whiteboard implementation provides:

1. repository-wide `bun run typecheck` exit 0;
2. a clean worktree;
3. a bounded diff/addendum proving intervening fixes did not alter Ticket 01 source, dependency resolution, build behavior, or accepted evidence.

If intervening changes touch a Ticket 01 path or a materially shared runtime/build seam, rerun the affected focused and Chromium proofs. If changes remain unrelated, the existing AC1–AC6 evidence may be carried forward with a short independent addendum and the newly passing global typecheck.

An explicit owner-approved amendment to the repository completion requirement could also change this gate, but no such amendment currently exists.

## Rollback implication

No Ticket 01 rollback is indicated. The hold must be removed by restoring the repository completion gate or by an explicit owner-level policy amendment, not by weakening Ticket assertions, changing Excalidraw versions, introducing private APIs, or absorbing unrelated feature fixes into Ticket 01.
