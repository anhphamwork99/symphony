# WP-01 — deterministic evidence at frozen Decision 0008 candidate2

**State:** **READY** for producer collection; no current D PASS.
**Candidate:** `2afef48b008527685658801d8f0d84c79e24827d`, the sole-parent child
of `ffd45bd867e94c9003415f5f2e937cc9c616e399`.
**Authority:** [Decision 0008](../../decisions/0008-reassessment-live-control-post-await-retirement-classification.md)
is Authoritative for the exact containment correction; Decision 0007 remains
authoritative for the historical fixture correction/rebaseline.

## Objective

Rerun the same closed 19-file deterministic set at frozen candidate2. Retain
the historical 296-test baseline and collect the six new focused cases for an
expected aggregate of `296 + 6 = 302`. The actual producer-collected count must
be confirmed and recorded before this WP can become D PASS.

The focused containment logs are preserved implementation evidence only:

- red: 24 tests, 6 failed / 18 passed, exit 1, SHA-256
  `665e0bbaf0a9a25d1908c9767d2bd7ff2947d4e1844a6df80d84622300b16e3b`;
- green: 24/24, exit 0, SHA-256
  `84feb4814b891ce69472c74dd5596f04c9bf753fa65de18c7d31b352dd95f43b`.

These focused logs do not substitute for the closed-set producer collection.
No producer ran in this planning transaction.

## Required candidate and provenance

- Candidate2 is the sole-parent child of `ffd45bd`; its exact delta from ffd is
  only:
  `apps/server/src/provider/piSubagentLiveLifecycleContainment.ts` and
  `apps/server/src/provider/piSubagentLiveLifecycleContainment.test.ts`.
- Its total delta from `12fd6686` is exactly four paths: the two containment
  paths plus `apps/server/src/provider/piSubagentRealPiAcceptance.test.ts` and
  `apps/server/src/provider/piSubagentRealPiAcceptanceHelpers.ts`, the two
  Decision 0007 fixture paths.
- The main merge `44249d81c49172e192dcf0f09ddfadc702a4b34c` is integration
  provenance only. The producer identity is candidate2, never the merge.
- Alfie remains pinned at
  `3fe340b401ca86bcbe8b55abd4de107e1d93482e` /
  `@alfie/pi-subagents@0.15.0-alfie.6`.
- Protected owner WIP remains untouched and unstaged with required aggregate
  hash `ab8f8f54fe818819721f737aa337156ed6348c7410c55083ce3a67785bb7eaa8`.

## Closed 19-file set

```text
apps/server/src/provider/piSubagentCancellationCoordinator.test.ts
apps/server/src/provider/piSubagentWatchdogEscalation.test.ts
apps/server/src/provider/piSubagentProcessTeardown.test.ts
apps/server/src/provider/piSubagentWatchdogSweep.test.ts
apps/server/src/provider/piSubagentProcessTeardownSweep.test.ts
apps/server/src/provider/piSubagentBridge.test.ts
apps/server/src/provider/piSubagentLiveLifecycleContainment.test.ts
apps/server/src/provider/piSubagentChildOwnerTeardownWiring.test.ts
apps/server/src/provider/piSubagentTeardownWiring.test.ts
apps/server/src/provider/piSubagentCanonicalRouting.test.ts
apps/server/src/orchestration/Layers/piSubagentExecutionCardSurface.test.ts
apps/server/src/provider/piSubagentRestartReconciliation.test.ts
apps/server/src/provider/piSubagentStartupRecoveryOrder.test.ts
apps/server/src/provider/piSubagentResumeCoordinator.test.ts
apps/server/src/provider/piSubagentTerminalLifecycle.test.ts
apps/server/src/provider/piSubagentCompletionOutbox.test.ts
apps/server/src/wsSnapshotLiveStream.test.ts
apps/server/src/provider/piSubagentExecutionReadBoundary.test.ts
packages/contracts/src/piSubagents.test.ts
```

## Required evidence and gates

Record the actual producer count, all positive and material failure rows,
exact candidate SHA, zero source delta after freeze, Alfie pin, protected-WIP
hash, and explicit staging paths. Any failure, unexpected skip, provenance
drift, candidate-surface delta, or protected-WIP/staging drift stops the route.
Do not run WP-02, WP-03, WP-04, quality, review, or Supervisor work in WP-01.
The historical ffd WP-01 PASS and focused red/green logs are supporting only.

## Commit boundary

Future WP-01 evidence has its own producer transaction. It is not part of this
planning freeze commit.
