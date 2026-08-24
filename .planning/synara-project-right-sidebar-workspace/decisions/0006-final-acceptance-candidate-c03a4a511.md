# Decision 0006 — Final-acceptance reassessment of candidate c03a4a511

- **Status:** Binding Reassessment — accepted
- **Trigger:** Owner-authorized final-acceptance reassessment after Decision 0005 remediation
- **Candidate:** `c03a4a511`
- **Write set:** none
- **Date:** 2026-08-24

## Question

May exact candidate `c03a4a511` be accepted as the complete integrated Project-owned Right-sidebar workspace feature after closing Decision 0005’s committed Desktop Project-deletion gap?

## Governing references

- `../PROJECT.md`
- `../IMPLEMENTATION-PLAN.md`
- `0002-explicit-project-ownership-and-legacy-migration.md`
- `0003-final-acceptance-candidate-8b4a1bc63.md`
- `0004-desktop-authoritative-lazy-project-workspace-activation.md`
- `0005-final-acceptance-reassessment-candidate-9dd2fd5db.md`
- `0001-one-time-synara-work-cleanup.md`, for the no-cleanup boundary only

Project ownership, one-winner/all-slices migration, marker-last publication, real identifier semantics, archive retention, settle-before-delete, retained v1 data, and the no-cleanup boundary are not reopened.

## Evidence

Candidate `c03a4a511` adds the production committed-deletion chain from the authoritative `project-removed` shell event through the acknowledged Web Project Browser method, shared IPC contracts, preload, and Desktop IPC handler using the real `ProjectId`.

The Desktop deletion boundary synchronously fences activation, serializes with in-flight activation, persists a per-Project tombstone, atomically removes only that Project’s v2 staged slices, publication marker, and diagnostic, clears only that Project’s activation bookkeeping and live manager state, and preserves other Projects and retained v1 inputs. Tombstones prevent startup collection, reads, migration, staging, publication, manager application, and later activation. Restart cannot restore the deleted workspace.

Focused tests cover production IPC routing, activation/deletion races, Project isolation, durable tombstones, v1 retention, and restart rejection.

Exact-candidate verification:

- Desktop migration and activation: 20/20
- Web EventRouter: 14/14
- lint: 0 warnings/errors over 2,624 files
- typecheck: 7/7
- full test command: 8/8 tasks
  - server: 5,051 pass / 18 expected skips
  - Web: 3,971 pass
  - Desktop: 627 pass / 5 expected skips
  - scripts: 150 pass
  - contracts: 327 pass
  - shared: 602 pass / 1 expected skip
- clean worktree

## Reassessment

Decision 0005’s sole remaining defect is closed. Its six remediation criteria now have production source and test evidence.

All Project Contract scenarios 1–8 pass. Decision 0002 obligations 1–14 pass. Decision 0004 item 8 passes at the integrated production boundary. Owner-only cleanup remains unexecuted.

## Binding verdict

Accept exact candidate `c03a4a511` as the complete integrated Project-owned Right-sidebar workspace feature.

This supersedes Decision 0005’s rejection and removes Decision 0003’s inherited blocking effect for this exact candidate. Decisions 0003 and 0005 remain historically correct for their rejected candidates. Decisions 0002 and 0004 remain authoritative.

Candidate `c03a4a511` may be marked accepted and complete. This verdict does not itself authorize cleanup, push, deployment, or another external side effect.

## Rejected alternatives

An uncalled deletion method, in-memory-only clearing, global Desktop workspace deletion, an activation/deletion race without a terminal fence, Browser unmount/navigation/hide/restart, owner-only cleanup, or a new server Project-list subsystem cannot substitute for the accepted production lifecycle.

## Assumptions and non-blocking risks

- The supplied clean candidate and exact verification outputs correspond to `c03a4a511`.
- The shell event is emitted only for committed Project deletion.
- Recreating a Project with the same `ProjectId` would require a separate tombstone retirement policy.
- Web treats Desktop removal as optional and suppresses rejected IPC promises. Delivery observability/retry could be strengthened later.
- Tombstone corruption follows the existing malformed-store diagnostic policy rather than an append-only journal.
- Expected skips do not cover a Project-workspace acceptance criterion.

## Failure and rollback

Before tombstone persistence, a failure leaves the durable publication intact and must not claim successful invalidation. After persistence, deletion is terminal. Rollback must preserve tombstones and v1 data unless separately reviewed. Reverting only the production event caller reintroduces Decision 0005’s defect.

## Downstream effect

The Project-owned Right-sidebar workspace feature is accepted and complete at exact candidate `c03a4a511`. Cleanup, push, and deployment remain separate actions.

## Reopening conditions

Reopen if committed deletion does not reach Desktop; a deletion race publishes/applies after the fence; a valid tombstone permits activation; deletion removes another Project or v1 data; evidence is stale or from another tree; same-ID Project recreation is approved; or the owner changes the Project Contract.
