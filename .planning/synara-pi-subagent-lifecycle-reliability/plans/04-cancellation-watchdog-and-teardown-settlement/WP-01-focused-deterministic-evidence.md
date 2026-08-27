# WP-01 — focused deterministic T04 evidence

**State:** completed — final; frozen candidate `08b65ebb466470d71814c4467d74e68f43991138`, evidence commit `bab07af82d31c7fc128fd561fc0dc06eed0f7300`

**Result:** producer exit 0; Vitest 4.1.10 focused deterministic run: **11/11 test files passed, 177/177 tests passed** in 15.86s (`evidence/WP-01-focused-deterministic.log`, tail block L4–L8; totals at L5–L6). Criterion-level matrix `evidence/WP-01-ac-diagnostic-matrix.md` proves T04-AC1–AC5 normal and material failure/diagnostic surfaces from actual named cases at candidate HEAD, records bands 90/92, 70–74, 75/76/77/78, proves only 76 fences, records duplicate/replay effect counts, and distinguishes owner-death conjunction boundaries, persistence/dispatch/ack/stage failure diagnostics, teardown absent/thrown/timeout/malformed/mismatched-owner cases, survivor cap 16, non-terminal survivors/owner-unproven behavior, graceful skip, late terminals, and retired/cleared responses. Evidence files: `evidence/WP-01-workspace-state.txt` (candidate, all 11 paths, owner-file exclusions, command, exit 0), `evidence/WP-01-focused-deterministic.log`, `evidence/WP-01-ac-diagnostic-matrix.md`. **Residual note:** the `stopProviderSession` promise-rejection (`"failed"`) sub-branch has no dedicated named case in the focused set; it shares its entire proven code path with the timeout branch (`piSubagentWatchdogEscalation.ts:560`) proven by T15-AC6, and is carried forward to WP-02/the Implementation Report as residual uncertainty — no AC is left unsupported.

**Dependencies:** plan persisted; candidate and workspace snapshot captured; evidence consumed by WP-02 and WP-03 at Ticket 04 closure.

## Objective and observable outcome

At a frozen Symphony candidate, execute the existing deterministic cancellation/watchdog/teardown/containment suites, capture unmasked command exits, and produce a criterion-level matrix proving T04-AC1–T04-AC5 without changing source or tests.

## Bounded read set

- `apps/server/package.json`
- `apps/server/scripts/run-tests.ts`
- `apps/server/vitest.config.ts`
- `apps/server/src/provider/piSubagentCancellationCoordinator.test.ts`
- `apps/server/src/provider/piSubagentWatchdogEscalation.test.ts`
- `apps/server/src/provider/piSubagentProcessTeardown.test.ts`
- `apps/server/src/provider/piSubagentWatchdogSweep.test.ts`
- `apps/server/src/provider/piSubagentProcessTeardownSweep.test.ts`
- `apps/server/src/provider/piSubagentBridge.test.ts`
- `apps/server/src/provider/piSubagentLiveLifecycleContainment.test.ts`
- `apps/server/src/provider/piSubagentChildOwnerTeardownWiring.test.ts`
- `apps/server/src/provider/piSubagentTeardownWiring.test.ts`
- `apps/server/src/provider/piSubagentCanonicalRouting.test.ts`
- `apps/server/src/orchestration/Layers/piSubagentExecutionCardSurface.test.ts`
- Ticket 04 issue, Project Home, Decision 0006, inherited Decisions 0025/0027/0028/0033/0034, and the accepted scout report.

## Exact allowed write set

- `.planning/synara-pi-subagent-lifecycle-reliability/plans/04-cancellation-watchdog-and-teardown-settlement/evidence/WP-01-workspace-state.txt`
- `.planning/synara-pi-subagent-lifecycle-reliability/plans/04-cancellation-watchdog-and-teardown-settlement/evidence/WP-01-focused-deterministic.log`
- `.planning/synara-pi-subagent-lifecycle-reliability/plans/04-cancellation-watchdog-and-teardown-settlement/evidence/WP-01-ac-diagnostic-matrix.md`
- `.planning/synara-pi-subagent-lifecycle-reliability/plans/04-cancellation-watchdog-and-teardown-settlement/WP-01-focused-deterministic-evidence.md` — state/result fields only after evidence is frozen.

## Prohibited changes

Every path under `apps/`, `packages/`, migrations, root/package manifests, lockfiles, Alfie, decisions, Ticket issue, Project Home, and other projects. In particular, do not touch or stage `apps/web/package.json`, `apps/web/src/main.tsx`, or `bun.lock`.

## Execution instructions

1. Record `git rev-parse HEAD`, `git status --short`, `git diff --name-status 83620ab07..HEAD`, `git diff --name-only`, Bun/Node versions, and the existence of every test path into `WP-01-workspace-state.txt`.
2. Stop/challenge if the committed delta since `83620ab07` or the working tree changes a Ticket 04 production/test/contract/manifest seam. Unrelated Whiteboard planning and the three named owner files are recorded but excluded.
3. From `apps/server`, run this focused deterministic command with pipefail:

```bash
cd apps/server
set -o pipefail
bun run ../../node_modules/vitest/vitest.mjs run \
  --project unit --maxWorkers=1 --no-file-parallelism \
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
  2>&1 | tee ../../.planning/synara-pi-subagent-lifecycle-reliability/plans/04-cancellation-watchdog-and-teardown-settlement/evidence/WP-01-focused-deterministic.log
status=${PIPESTATUS[0]}
exit "$status"
```

4. Do not substitute `bun run test <paths>`: the current package runner ignores positional filters and would execute the complete package plan. Never use `bun test`.
5. Build `WP-01-ac-diagnostic-matrix.md` from named test cases and actual outcomes. For each T04 criterion record: test file/case, normal-path assertion, failure/diagnostic assertion, fixed diagnostic code(s), aggregate state/fence effect, duplicate/replay effect count, command exit, and evidence-log line reference.
6. Include explicit rows for: cancellation persistence/dispatch/ack timeout; owner-death conjunction boundary; watchdog persistence and each stage timeout; stop failed/timeout/uncertain; teardown owner absent/thrown/timeout/malformed/mismatched; survivors bounded at 16; survivors/owner-unproven remaining cancelling; late terminal before/after proven fence; graceful skip; duplicate sweeps; retired/cleared response.

## Verification contract

- Feature proof: all listed deterministic files pass in one invocation at the frozen candidate.
- Failure/diagnostic proof: the matrix contains at least one concrete failure-path case for each AC and proves no fabricated cancellation.
- Identity/band proof: matrix distinguishes 90/92, 70–74, and 75/76/77/78 and records that only 76 fences.
- Idempotency proof: duplicate intent/stage/request/outcome rows and dispatch/effect counts are recorded.
- Artifact proof: `git diff --check` passes; evidence files contain the candidate SHA and producer exit status.

## Produced/consumed contract

Produces the frozen candidate, deterministic log, and AC/diagnostic matrix. WP-02 consumes all three; WP-03 may not close from inherited totals alone.

## Commit boundary

```text
test(pi): record Ticket 04 deterministic settlement evidence
```

Stage only the four allowed WP-01 paths.

## Escalation

- `blocked`: missing dependencies, runner cannot start, resource/environment failure, or evidence cannot be written.
- `challenge`: any criterion-level failure, unexpected provider/process side effect, changed lifecycle seam, or required fix. Stop before source/test edits and invoke PLAN §9.
