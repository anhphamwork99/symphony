# WP-01 — reset deterministic evidence at the new containment candidate

**State:** historical ffd WP-01 PASS only; current WP-01 is pending. The
historical 19-file/296-test result at `ffd45bd867e94c9003415f5f2e937cc9c616e399`
is supporting and cannot satisfy the reset gate.

**Authority:** [Decision 0008](../../decisions/0008-reassessment-live-control-post-await-retirement-classification.md)
is aspect-scoped Authoritative for the exact two-file containment correction;
[Decision 0007](../../decisions/0007-ticket-06-batching-fixture-causal-control-and-candidate-rebaseline.md)
remains authoritative only for the historical fixture correction/rebaseline.

## Objective

After the exact two-file implementation child of `ffd45bd` is frozen, rerun
the same closed 19-file deterministic set. Preserve the 296-test baseline and
record the exact number of implementation-added focused cases and resulting
aggregate only after implementation; do not guess a new expected total now.
The containment test may contain the focused additions, but no third file is
allowed.

## Required candidate/provenance

- New candidate SHA is recorded before this WP starts; it is the sole-parent
  child of `ffd45bd` with exactly these two additional paths:
  `apps/server/src/provider/piSubagentLiveLifecycleContainment.ts` and
  `apps/server/src/provider/piSubagentLiveLifecycleContainment.test.ts`.
- Total delta from `12fd6686` is exactly four paths, including the two Decision
  0007 fixture files. Coordinator/configuration/canonical expectations and
  Alfie remain unchanged/pinned.
- Producers use a fresh detached candidate worktree; no main-checkout producer.

## Closed test set and evidence

The existing 19-file set from the historical WP-01 remains closed and must be
rerun unchanged, including `piSubagentLiveLifecycleContainment.test.ts`:

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

Prove all eight Decision 0008 rows with causal barriers, exact registration /
epoch/session identity, acceptance markers, no-value/no-retry/second-action
negative assertions, and the existing failure/diagnostic matrix. Record D
logs, exact count, candidate SHA, zero source delta after freeze, protected-WIP
hash, and explicit staging paths.

## Gates and prohibited work

A failure, unexpected skip, provenance drift, candidate-surface delta, or
protected-WIP/staging drift stops the route. The historical ffd result is not a
retry or current PASS. Do not run real-Pi, manual destructive, quality, review,
or Supervisor work in WP-01. Do not modify any source/test file here.

## Commit boundary

```text
test(pi): record Ticket 06 deterministic evidence reset
```

This future WP stages only its explicitly named evidence/report paths. It is
not part of the current 12-path planning commit.
