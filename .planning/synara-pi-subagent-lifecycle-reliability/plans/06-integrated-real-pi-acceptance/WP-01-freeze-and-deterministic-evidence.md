# WP-01 — freeze at 12fd6686 and 19-file deterministic integrated evidence

**State:** pending

**Owner role:** implementation worker

**Dependencies:** plan persisted; Ticket 06 routed `ready-for-agent`; no
unresolved challenge; protected WIP unstaged.

## Objective and observable outcome

Freeze the behavioral candidate at Symphony
`12fd6686edc26a3fa0382e8bdeb83a1be8045539` inside an isolated detached
worktree and prove the integrated deterministic seam (D evidence) with one
serialized 18-file unit run plus the contracts suite — 19 files total — each
criterion carrying positive and material failure/diagnostic rows.

## The 19 files and their derivation

Union of the Ticket 04 (11-file) and Ticket 05 (9-file) focused deterministic
sets, plus the Ticket 02 read-boundary suite and the contracts suite:

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

(Files appearing in both prior sets — WatchdogEscalation, ProcessTeardown,
ExecutionCardSurface — are counted once.)

## Bounded read set

- PLAN §2, §3, §6, §7, §9; governing decisions 0002/0006 and inherited
  0031–0034.
- The 19 test files and their direct production seams.
- `apps/server/vitest.config.ts`, `apps/server/scripts/wallclock-tests.ts`.
- Git state of the main checkout and both worktrees.

## Exact allowed write set

```text
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-01-worktree-provenance.txt
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-01-deterministic.log
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-01-contracts.log
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-01-ac-diagnostic-matrix.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-01-freeze-and-deterministic-evidence.md
```

## Prohibited changes

Everything else — especially any path under `apps/` or `packages/` in the
main checkout or the worktree, both worktrees' checked-out files, Alfie, the
three protected owner WIP paths, decisions/reviews/issue/PROJECT.md (issue
and PROJECT.md are WP-07's), and any other plan directory.

## Exact commands (cwd and env explicit)

Worktree setup (once):

```bash
cd /Users/anhpham99/symphony
git worktree add --detach /tmp/symphony-t06 12fd6686edc26a3fa0382e8bdeb83a1be8045539
git -C /Users/anhpham99/alfie worktree add --detach /tmp/alfie-t06 3fe340b401ca86bcbe8b55abd4de107e1d93482e
cd /tmp/symphony-t06 && bun install
```

Unit producer (18 files, serialized) — cwd `/tmp/symphony-t06/apps/server`:

```bash
cd /tmp/symphony-t06/apps/server
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
  2>&1 | tee /Users/anhpham99/symphony/.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-01-deterministic.log
status=${PIPESTATUS[0]}
exit "$status"
```

Contracts producer — cwd `/tmp/symphony-t06/packages/contracts`:

```bash
cd /tmp/symphony-t06/packages/contracts
set -o pipefail
bun run test src/piSubagents.test.ts \
  2>&1 | tee /Users/anhpham99/symphony/.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-01-contracts.log
status=${PIPESTATUS[0]}
exit "$status"
```

## Evidence artifact fields

- `WP-01-worktree-provenance.txt`: both worktree SHAs (Symphony `12fd6686…`
  detached; Alfie `3fe340b4…` detached), `git status --short` of both, Alfie
  provenance fixture hash comparison, toolchain versions, protected WIP diff
  hash `ab8f8f54…`, zero-delta gate output, producer exits.
- `WP-01-ac-diagnostic-matrix.md`: per-criterion rows for T06-AC2, AC3, AC4,
  AC5, AC7 (D class) with named test cases and file:line locators; every
  positive row paired with its material failure/diagnostic row; explicit note
  of which AC legs remain for R evidence (WP-02).

## Verification contract

- Both producers exit 0; no skipped-but-required rows.
- Zero-delta gate on the Pi acceptance surface passes before and after runs.
- Protected WIP hash unchanged; nothing staged at any point.
- Matrix cites only executed cases from the two logs.

## Commit boundary

```text
test(pi): record Ticket 06 deterministic integrated evidence
```

Stage only the five allowed WP-01 paths with explicit paths.

## Escalation

- `blocked`: worktree creation/install failure; provenance mismatch.
- `challenge`: any failing test or missing failure-leg; any apparent need for
  a source/test change; zero-delta or WIP-hash violation.
