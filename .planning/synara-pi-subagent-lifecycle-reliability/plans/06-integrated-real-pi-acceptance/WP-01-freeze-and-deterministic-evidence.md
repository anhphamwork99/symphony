# WP-01 — renewed 19-file deterministic evidence at frozen candidate

**State:** PASS — renewed WP-01 completed at the exact frozen candidate with
19/19 files and 296/296 tests, zero failures, and zero skips. WP-02 is ready
for exactly one full renewed five-file attempt, subject to its own authorization
and gates.

## Renewed result

- **Candidate:** `ffd45bd867e94c9003415f5f2e937cc9c616e399`.
- **Parent:** sole parent `12fd6686edc26a3fa0382e8bdeb83a1be8045539`.
- **Base→candidate delta:** exactly two files, and no others:
  `apps/server/src/provider/piSubagentRealPiAcceptanceHelpers.ts` and
  `apps/server/src/provider/piSubagentRealPiAcceptance.test.ts`.
- **Producer worktree:** `/tmp/symphony-t06` at the exact candidate HEAD. It is
  branch-attached, not detached: `git status -b --short` reported
  `## t06-candidate-correction-20260828-1642`. Its tracked worktree is clean.
  This branch-attached state is recorded truthfully and is not relabeled as
  detached.
- **Unit producer:** exit `0`; 18/18 files, 256/256 tests, 0 failed, 0
  skipped; Vitest duration `16.59s`. Log:
  `evidence/WP-01-renewed-deterministic.log` (SHA-256
  `cc2bd34c59bf1826230f5862c3ae3b6979f2d331f0587135ef203dda228d52ba`).
- **Contracts producer:** exit `0`; 1/1 file, 40/40 tests, 0 failed, 0
  skipped; Vitest duration `198ms`. Log:
  `evidence/WP-01-renewed-contracts.log` (SHA-256
  `9d174a4257a89db2d7929db2f12688e9cf4ff08a494d331c4d34f858996a3686`).
- **Aggregate:** 19/19 files, 296/296 tests, 0 failed, 0 skipped.
- **No tests were rerun while recording this evidence transaction.** The
  renewed logs are the completed producer outputs copied byte-for-byte from
  the canonical evidence location.

## Provenance and zero-delta result

- Production coordinator and server configuration are unchanged from the
  historical base through the candidate and this evidence record. The
  recorded SHA-256 values remain:
  - `apps/server/src/provider/piSubagentCompletionCoordinator.ts`:
    `baded01d075a988e6402c5d603e1a7cddfe1a8e6aca9d95ef0a5f5f85d276dc8`;
  - `apps/server/vitest.config.ts`:
    `8d865bcfb7ae4bdbcf33c4eaaba2dbb4b1036032fb23d7054c4e4b3bbba687e0`.
- From the frozen candidate through this evidence transaction, the
  Ticket-06 acceptance source surface has zero delta. No production,
  configuration, manifest, lockfile, test, or Alfie path was changed by
  WP-01.
- Controlled Alfie remains pinned at exact HEAD
  `3fe340b401ca86bcbe8b55abd4de107e1d93482e`, package
  `@alfie/pi-subagents@0.15.0-alfie.6`; `/tmp/alfie-t06` is detached and
  clean. Its ignored extension-local `node_modules` is retained and is not a
  tracked change.
- The protected owner WIP remains unstaged in the canonical main checkout:
  `apps/web/package.json`, `apps/web/src/main.tsx`, and `bun.lock`. Its exact
  aggregate diff hash is
  `ab8f8f54fe818819721f737aa337156ed6348c7410c55083ce3a67785bb7eaa8`.
  These paths are absent from this transaction's index and commit.

## Objective and the closed 19-file set

The renewed D-class proof is one serialized 18-file unit invocation plus the
contracts suite at the candidate worktree. The exact closed set is:

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

## Exact producer commands and outcomes

Unit producer, cwd `/tmp/symphony-t06/apps/server`:

```bash
set -o pipefail
bun run ../../node_modules/vitest/vitest.mjs run \
  --project unit \
  --maxWorkers=1 \
  --no-file-parallelism \
  src/provider/piSubagentCancellationCoordinator.test.ts \
  src/provider/piSubagentWatchdogEscalation.test.ts \
  src/provider/piSubagentProcessTeardown.test.ts \
  src/provider/piSubagentWatchdogSweep.test.ts \
  src/provider/piSubagentProcessTeardownSweep.test.ts \
  src/provider/piSubagentBridge.test.ts \
  src/provider/piSubagentLiveLifecycleContainment.test.ts \
  src/provider/piSubagentChildOwnerTeardownWiring.test.ts \
  src/provider/piSubagentTeardownWiring.test.ts \
  src/provider/piSubagentCanonicalRouting.test.ts \
  src/orchestration/Layers/piSubagentExecutionCardSurface.test.ts \
  src/provider/piSubagentRestartReconciliation.test.ts \
  src/provider/piSubagentStartupRecoveryOrder.test.ts \
  src/provider/piSubagentResumeCoordinator.test.ts \
  src/provider/piSubagentTerminalLifecycle.test.ts \
  src/provider/piSubagentCompletionOutbox.test.ts \
  src/wsSnapshotLiveStream.test.ts \
  src/provider/piSubagentExecutionReadBoundary.test.ts \
  2>&1 | tee /Users/anhpham99/symphony/.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-01-renewed-deterministic.log
status=${PIPESTATUS[0]}
exit "$status"
```

Observed producer exit: `0`. The renewed log records Vitest `v4.1.10`,
18/18 files, 256/256 tests, and duration `16.59s`.

Contracts producer, cwd `/tmp/symphony-t06/packages/contracts`:

```bash
set -o pipefail
bun run test src/piSubagents.test.ts \
  2>&1 | tee /Users/anhpham99/symphony/.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-01-renewed-contracts.log
status=${PIPESTATUS[0]}
exit "$status"
```

Observed producer exit: `0`. The renewed log records Vitest `v4.1.10`, 1/1
file, 40/40 tests, and duration `198ms`.

## AC / diagnostic matrix

`evidence/WP-01-renewed-ac-diagnostic-matrix.md` records the D-class rows for
T06-AC2, T06-AC3, T06-AC4, T06-AC5, and T06-AC7. Each criterion has executed
positive cases paired with material failure/diagnostic cases and a per-file
inventory totaling 256 + 40 = 296. The matrix cites only the renewed logs and
candidate SHA for this current run. R-class real-Pi legs remain explicitly
pending WP-02; no R or M claim is made here.

## Gate result and routing

- Candidate identity: PASS — exact SHA and sole parent recorded.
- Candidate correction scope: PASS — exact two-file base→candidate delta.
- Candidate worktree: PASS — exact HEAD, branch-attached truth recorded, clean
  tracked tree before/after the already-completed producers.
- Alfie: PASS — exact pin, package identity, detached clean tree, ignored local
  dependency only.
- Protected WIP: PASS — exact aggregate hash unchanged and unstaged.
- Source delta: PASS — empty Ticket-06 acceptance source surface after the
  candidate; production coordinator/configuration unchanged.
- Producers: PASS — 19/19 files, 296/296 tests, zero failed, zero skipped.
- Index and scope: PASS — no protected WIP staged; this transaction stages
  exactly the six paths listed below.

WP-01 is **PASS**. WP-02 is **ready** for exactly one full renewed five-file
non-destructive real-Pi attempt after its required authorization. This record
does not authorize or execute WP-02, WP-03, WP-04, manual, quality, or review
work.

## Commit boundary

Commit message:

```text
test(pi): record renewed Ticket 06 deterministic evidence
```

The commit contains exactly these six paths:

```text
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/PLAN.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-01-freeze-and-deterministic-evidence.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-01-renewed-worktree-provenance.txt
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-01-renewed-deterministic.log
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-01-renewed-contracts.log
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-01-renewed-ac-diagnostic-matrix.md
```

No source implementation, test, configuration, Alfie, protected-WIP, WP-02,
manual, quality, or review path is part of this transaction.
