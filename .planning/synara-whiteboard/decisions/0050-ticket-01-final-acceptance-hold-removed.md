# Decision 0050: Ticket 01 final-acceptance hold removed after repository completion gate restoration

Status: Binding — Ticket 01 accepted
Date: 2026-08-26
Trigger: Material new evidence / Reassessment of Decision 0049
Prior decision disposition: Supersedes Decision 0049's final-acceptance hold and routing restriction
Reopens Decisions 0048 or 0047: No

Decision 0049 remains authoritative historical evidence for AC1–AC6 PASS and for the reason acceptance was previously held.

## Question

Does the exact Reassessment candidate satisfy Decision 0049's reopening conditions sufficiently to remove Ticket 01's repository completion-gate hold, accept Ticket 01, and advance Project routing to Ticket 02?

## Governing references

Authoritative:

1. `.planning/synara-whiteboard/PROJECT.md`
2. `.planning/synara-whiteboard/decisions/0049-ticket-01-final-acceptance-held.md`
3. `.planning/synara-whiteboard/issues/01-prove-excalidraw-integration-boundary.md`
4. `.planning/synara-whiteboard/decisions/0048-ticket-01-excalidraw-feasibility-boundary.md`
5. `.planning/synara-whiteboard/decisions/0047-testing-strategy-governance-reassessment.md`
6. `.planning/synara-whiteboard/spec.md`
7. `.planning/synara-whiteboard/PRODUCT-CONTRACT.md`
8. Repository completion requirement that root formatting, lint, and typecheck pass before task completion.

Supporting:

- Consolidated independent review and bounded Reassessment addendum at commit `7dfeaa07f`.
- Final retained logs under `/tmp/synara-whiteboard-ticket01-reassessment-final-gate/`.

Decisions 0048 and 0047 remain accepted and are not reopened.

## Candidate, review, and evidence scope

- Exact Reassessment source candidate: `f9f73f2a5f698841a04d4926cb1e7b7e3c87d9b1`.
- Accepted Ticket 01 source baseline: `87b86fb57e1797c516c3a94f3ea141d266a30468`.
- Remediated source from which accepted evidence was measured: `0a8f095b43c701ce3c7e2ad0236bf427c9d0c52a`.
- Accepted clean evidence commit: `632e55dd964de2664cbf1c1fe49d0f41e420747d`.
- Consolidated independent review and Reassessment addendum: `7dfeaa07f`.
- Final gate logs: `/tmp/synara-whiteboard-ticket01-reassessment-final-gate/`.
- Protected Agentation working-tree changes remain excluded.
- The Reassessment is bounded to the previously unsatisfied repository completion gate and maintenance no-impact proof. It does not reopen unchanged AC1–AC6.

## Decision 0049 reopening conditions

| Reopening condition                                        | Verdict           | Evidence                                                                                                                                                            |
| ---------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact candidate retains accepted Whiteboard implementation | **PASS**          | Diff from `87b86fb57` to `f9f73f2a5` contains zero Ticket source, measurement runner, accepted evidence, Excalidraw package/lock, or web build-configuration paths. |
| Repository-wide `bun run typecheck` succeeds               | **PASS**          | 7 successful Turbo tasks out of 7, zero failed, exit 0.                                                                                                             |
| Candidate worktree is clean                                | **PASS**          | Final evidence records `final_dirty_count=0` at exact HEAD `f9f73f2a5`.                                                                                             |
| Bounded addendum proves maintenance no impact              | **PASS**          | Independent review confirms no Ticket source, dependency resolution, evidence, runner, or Whiteboard build seam changed.                                            |
| Rerun affected Ticket browser proofs when required         | **Not triggered** | No Ticket or materially shared Excalidraw/Whiteboard runtime or build seam changed.                                                                                 |

## Repository completion gate

The exact candidate satisfies the repository completion gate:

- frozen install: **PASS**;
- root `bun run fmt`: **PASS**, identifying 29 unrelated baseline paths and zero Ticket or maintenance-relevant paths;
- post-format diff check: **PASS**;
- root `bun run lint`: **PASS**, 0 errors and 21 warnings;
- root `bun run typecheck`: **PASS**, 7/7 Turbo tasks;
- final worktree: **clean**.

Warnings are not errors and do not invalidate the successful lint result. Disposable formatting output does not alter the exact candidate or accepted Ticket boundary.

## Maintenance no-impact assessment

The intervening maintenance restored repository type correctness without changing:

- `apps/web/src/components/whiteboard/ticket01/**`;
- the Ticket 01 measurement runner;
- accepted Ticket evidence;
- exact `@excalidraw/excalidraw` dependency or lock resolution;
- web build configuration relevant to Ticket 01;
- approved Excalidraw adapter behavior or browser harness.

RightDock, ChatView, execution-card, repository-test, and Pi artifact-tooling changes remain outside Ticket 01. No evidence requires attributing them to Ticket 01 or rerunning unchanged Ticket acceptance criteria.

## PiAdapter residual-risk assessment

The PiAdapter change is a real production runtime seam and was reviewed as such:

- production-decoded snapshots continue to require a valid `threads` array;
- projection-query precedence remains preserved;
- the admission path already depends on the same valid snapshot shape;
- snapshot-query failures remain fail-closed as `pi_subagent_read_denied`;
- no valid-input production behavior change affecting Ticket 01 was identified.

Some Pi-focused results were retained as worker-reported summaries rather than all being present in the final-gate directory. This is a non-blocking Pi-maintenance evidence advisory, not an unmet Decision 0049 reopening condition. Repository-wide typecheck is retained and passing, and PiAdapter is neither a Ticket 01 path nor a materially shared Whiteboard runtime or build seam.

## Binding verdict

Decision 0049 held Ticket 01 solely because repository-wide typecheck was non-green. New exact-candidate evidence satisfies every reopening condition and resolves that hold without changing the accepted Ticket implementation.

The preserved criterion findings remain:

- AC1: **PASS**
- AC2: **PASS**
- AC3: **PASS**
- AC4: **PASS**
- AC5: **PASS**
- AC6: **PASS**
- Decision 0048 compliance: **PASS**
- Decision 0047 compliance: **PASS**
- No Ticket 01 rollback or remediation required.

**TICKET 01 FINAL OUTCOME: ACCEPTED.**

This Reassessment removes the repository completion-gate hold. It is not a second final-acceptance consultation and does not claim acceptance of Ticket 02's exact one-event AI Undo/Redo behavior.

## Rejected alternatives

1. Keeping Ticket 01 held despite typecheck exit 0 is rejected because no reopening condition remains unmet.
2. Rerunning unchanged AC1–AC6 is rejected because Decision 0049 permits carry-forward when maintenance does not touch the Ticket boundary.
3. Treating lint warnings as errors is rejected because lint completed with zero errors.
4. Treating disposable unrelated formatting output as a Ticket change is rejected because zero relevant paths were touched and the final worktree is clean.
5. Reopening Decisions 0048 or 0047 is rejected because no evidence contradicts either direction.
6. Requiring Ticket 01 to absorb PiAdapter or repository-maintenance work is rejected because those seams are independently scoped.

## Residual advisories

1. Baseline validation does not internally recompute median/P95, although independent recomputation confirmed the committed summaries.
2. Provenance dirty-state collection ignores untracked files; reviewed evidence checkouts had none.
3. Runtime asset readiness uses a document-global `.excalidraw` selector; instance scoping is preferable before production multi-canvas reuse.
4. AC6 memory evidence is coarse process-level telemetry rather than precise per-canvas retained memory.
5. Ticket 02 must prove Synara-owned exact one-event Undo/Redo for completed, Take-Over-interrupted, and failed partial AI edit batches using the pinned real Excalidraw package.
6. Future Pi maintenance acceptance should retain all material focused-test logs rather than rely partly on worker summaries.

None blocks Ticket 01 acceptance or Ticket 02 routing.

## Routing consequence

Project routing is authorized to:

1. mark `.planning/synara-whiteboard/issues/01-prove-excalidraw-integration-boundary.md` done/accepted;
2. remove Decision 0049's Ticket 01 hold;
3. advance `.planning/synara-whiteboard/PROJECT.md` to `.planning/synara-whiteboard/issues/02-prove-ai-batch-undo-redo.md`;
4. treat Ticket 02 as formally unblocked by Ticket 01.

Ticket 02 receives only the proven Excalidraw integration boundary and feasibility findings. Its own criteria, especially exact one-event AI batch Undo/Redo, remain wholly unaccepted.

## Further evidence and reopening

No further evidence is required to accept Ticket 01 or advance routing to Ticket 02.

Reassess only if later evidence shows that the candidate changed the accepted Ticket source, dependency resolution, evidence, or a materially shared Whiteboard seam; the retained gate evidence was measured against another candidate; a blocking incompatibility is discovered; Ticket 02 proves exact AI recovery impossible without violating Decision 0048; or owner-approved governance changes materially.

No rollback is indicated.
