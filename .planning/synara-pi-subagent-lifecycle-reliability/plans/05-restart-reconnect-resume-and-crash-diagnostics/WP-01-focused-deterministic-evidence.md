# WP-01 — focused deterministic T05 evidence

**State:** completed

**Owner role:** implementation worker

**Dependencies:** persisted Ticket 05 plan; Project Home routes Ticket 05
`ready-for-agent`; no Ticket 05 source/test/contract/configuration/migration/
manifest/lockfile/Alfie delta.

**Result (WP-01 execution, 2026-08-28):**

- **Candidate frozen at Symphony `7521b92c7cb8a614346f994e963aa379175f540b`**
  (HEAD). Committed delta `fa02c58e..candidate` = exactly the six Ticket 05
  planning/routing files (commit `7521b92c7` "docs(planning): plan Ticket 05
  lifecycle recovery evidence"); no measured Ticket 05 production/test/
  contract/config/manifest/lockfile/Alfie seam changed since the planning
  baseline. Owner WIP `apps/web/package.json`, `apps/web/src/main.tsx`,
  `bun.lock` preserved byte-identical (diff hash
  `ab8f8f54fe818819721f737aa337156ed6348c7410c55083ce3a67785bb7eaa8`,
  re-verified pre- and post-run), modified-unstaged, never staged.
- **Producer (exact WP command):** one serialized invocation —
  `bun run ../../node_modules/vitest/vitest.mjs run --project unit
  --maxWorkers=1 --no-file-parallelism` over the nine listed files, run from
  `apps/server`. **`Test Files 9 passed (9)`, `Tests 118 passed (118)`,
  producer exit 0** (Vitest 4.1.10, Bun 1.3.12, Node v24.14.1; duration
  13.90s). Log: `evidence/WP-01-focused-deterministic.log`.
- **Evidence artifacts:** `evidence/WP-01-workspace-state.txt` (frozen
  candidate, status, committed delta, staged/working paths, toolchain
  versions, nine test-path existence checks, owner diff hash + producer
  command, producer exit), `evidence/WP-01-ac-seam-diagnostic-matrix.md`
  (AC1–AC6 with positive + material-failure rows built from actual named
  cases; reconnect/cursor/resume/crash matrices; zero work-creation
  counters; 64/512 bounds and redaction verification),
  `evidence/WP-01-no-replay-structural-proof.md` (six structural claims from
  imports/caller traces/gating order, not comments).
- **AC traceability:** AC1 reconnect bounded/no-dispatch (cursor snapshot
  cases + zero counters), AC2 restart terminal/live/orphan truth (recovery
  order + orphan diagnostic), AC3 stale evidence counted/history-only
  (T07-AC4/T10-AC5/T14-AC2/T08-AC6/T16 stale rows), AC4 explicit Resume with
  provider-inactive denial preceding adapter/coordinator (ProviderService
  `allowRecovery:false` + `!routed.isActive` before adapter call), AC5 stage/
  evidence-gap crash diagnostics with bounded/redacted metadata (512/512
  caps, prompt/progressJson/transcript/result exclusions), AC6 no-replay
  structural proof (sole explicit Resume chain; no Resume imports in
  startup/hydration/watchdog/reconciliation/cleanup). Stale terminal is
  counted and history-only; every required work-creation counter is zero on
  reconnect/restart-projection paths.
- **Write-set audit:** only the five allowed WP-01 paths changed (four
  evidence files + this WP file's `State`/`Result` fields); `git diff
  --check` clean; nothing staged during execution. Commit boundary remains
  `test(pi): record Ticket 05 deterministic recovery evidence`, staging only
  the five allowed paths.

## Objective and observable outcome

Freeze the evidence-only production candidate and prove T05-AC1–AC6 from the
current deterministic feature, failure, diagnostic, bounds, stale-fence, and
structural no-replay seams.

## Bounded read set

- `apps/server/src/provider/piSubagentRestartReconciliation.ts`
- `apps/server/src/provider/piSubagentRestartReconciliation.test.ts`
- `apps/server/src/provider/piSubagentStartupRecoveryOrder.test.ts`
- `apps/server/src/provider/piSubagentResumeCoordinator.ts`
- `apps/server/src/provider/piSubagentResumeCoordinator.test.ts`
- `apps/server/src/provider/Layers/ProviderService.ts`
- `apps/server/src/provider/Layers/PiAdapter.ts`
- `apps/server/src/provider/piSubagentTerminalLifecycle.test.ts`
- `apps/server/src/provider/piSubagentWatchdogEscalation.test.ts`
- `apps/server/src/provider/piSubagentProcessTeardown.test.ts`
- `apps/server/src/provider/piSubagentCompletionOutbox.test.ts`
- `apps/server/src/orchestration/Layers/piSubagentExecutionCardSurface.test.ts`
- `apps/server/src/wsSnapshotLiveStream.test.ts`
- `apps/server/src/persistence/Layers/PiSubagentExecutionRepository.ts`
- `apps/server/src/persistence/Services/PiSubagentExecutionRepository.ts`
- `packages/contracts/src/piSubagents.ts`
- Ticket 05 issue, Project Home, PLAN, and governing decisions.

## Exact allowed write set

```text
.planning/synara-pi-subagent-lifecycle-reliability/plans/05-restart-reconnect-resume-and-crash-diagnostics/evidence/WP-01-workspace-state.txt
.planning/synara-pi-subagent-lifecycle-reliability/plans/05-restart-reconnect-resume-and-crash-diagnostics/evidence/WP-01-focused-deterministic.log
.planning/synara-pi-subagent-lifecycle-reliability/plans/05-restart-reconnect-resume-and-crash-diagnostics/evidence/WP-01-ac-seam-diagnostic-matrix.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/05-restart-reconnect-resume-and-crash-diagnostics/evidence/WP-01-no-replay-structural-proof.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/05-restart-reconnect-resume-and-crash-diagnostics/WP-01-focused-deterministic-evidence.md
```

Only this WP's `State`/`Result` fields may change.

## Prohibited changes

Every path under `apps/` and `packages/`; migrations; configuration; manifests;
lockfiles; Alfie; decisions; reviews; Supervisor records; Ticket issue;
Project Home; Ticket 06; unrelated planning. Do not touch or stage
`apps/web/package.json`, `apps/web/src/main.tsx`, or `bun.lock`.

## Execution instructions

1. Record candidate SHA, status, committed delta from `fa02c58e`, working and
   staged paths, Bun/Node/Vitest versions, every test-path existence check, the
   protected-owner diff hash, and producer exit in `WP-01-workspace-state.txt`.
2. Stop/challenge if committed or working changes touch a measured Ticket 05
   production/test/contract/configuration/manifest seam.
3. Run:

```bash
cd apps/server
set -o pipefail
bun run ../../node_modules/vitest/vitest.mjs run \
  --project unit \
  --maxWorkers=1 \
  --no-file-parallelism \
  src/provider/piSubagentRestartReconciliation.test.ts \
  src/provider/piSubagentStartupRecoveryOrder.test.ts \
  src/provider/piSubagentResumeCoordinator.test.ts \
  src/provider/piSubagentTerminalLifecycle.test.ts \
  src/provider/piSubagentWatchdogEscalation.test.ts \
  src/provider/piSubagentProcessTeardown.test.ts \
  src/provider/piSubagentCompletionOutbox.test.ts \
  src/orchestration/Layers/piSubagentExecutionCardSurface.test.ts \
  src/wsSnapshotLiveStream.test.ts \
  2>&1 | tee ../../.planning/synara-pi-subagent-lifecycle-reliability/plans/05-restart-reconnect-resume-and-crash-diagnostics/evidence/WP-01-focused-deterministic.log
status=${PIPESTATUS[0]}
exit "$status"
```

4. Build `WP-01-ac-seam-diagnostic-matrix.md` from actual named cases and log
   lines. Each row records AC, source symbol, normal behavior, material failure,
   fixed code/message, durable state, attempt/generation effect, dispatch/launch
   count, bounds/redaction, test result, and producer exit.
5. Build `WP-01-no-replay-structural-proof.md` from source callers/references,
   not comments alone.

## Required reconnect/snapshot/cursor matrix

- durable card hydration with no in-memory Agent row;
- fresh subscriber/client over the same isolated durable state;
- cap 64 and oldest-overflow omission;
- progress/diagnostic cap 512;
- prompt/raw `progressJson`/full transcript/result/`agentId`/PID exclusion;
- valid cursor exact-gap replay with no snapshot;
- excessive gap, cursor ahead, deleted subject, and unbounded attach gap
  resnapshot behavior;
- before/after counts for execution rows, attempts, generations, sequence-80
  rows, admissions, launch calls, and provider dispatches; every work-creation
  count stays unchanged.

## Required Resume matrix

- active managed provider + orphan + all gates pass → same `executionId`, one
  new attempt/generation, one sequence-80 row before one launcher;
- duplicate explicit command → no second attempt/child;
- provider inactive → exact ProviderService validation operation/message, zero
  adapter/coordinator/sequence-80/attempt/launcher effects, no bootstrap;
- unsupported/unmanaged/missing launcher/snapshot/thread → denial, zero child;
- unknown/non-orphaned/stale aggregate → bounded denial, zero stale launch;
- authorization/active-turn/quota/admission denial → zero attempt/child;
- persistence failure → `pi_subagent_resume_persistence_failed`, zero child;
- post-settlement child-launch failure → honest durable queued attempt, no
  running/terminal fabrication;
- success → `pi_subagent_resumed`, prior-attempt evidence preserved.

## Required crash diagnostic matrix

For each row record lifecycle stage, trigger, durable evidence present, missing
evidence, fixed code/message, aggregate/attempt/generation effect, public
projection, bound, redaction exclusions, and forbidden claim.

Minimum rows:

- terminal ingest/persistence/outbox delivery;
- startup terminal recovery and stale terminal marker;
- exact live-owner refresh and owner/terminal absence;
- late old-generation terminal;
- watchdog stage timeout and cleanup uncertainty;
- teardown requested, survivors, owner unproven, and proven;
- provider-inactive Resume;
- Resume persistence failure and child-launch failure;
- bounded execution-card projection.

Metadata may contain only bounded public identity/lifecycle data. Exclude raw
prompts, progress JSON, complete transcript/result content, provider-local
identity, environment/secrets, arbitrary exceptions, PID trees, and commands.

## Structural no-replay proof

Prove:

1. `reconcilePiSubagentExecutions` has no spawn, Resume, Agent launcher, or
   delegation-dispatch dependency.
2. Startup orders outbox recovery → no-owner teardown evidence → restart
   reconciliation and never imports/invokes Resume.
3. Snapshot/card/cursor paths read projection/replay state only.
4. Watchdog and cleanup modules do not import/invoke Resume.
5. The sole production Resume consumer is the explicit ProviderService →
   PiAdapter path.
6. Provider-inactive denial precedes adapter/coordinator access.

## Verification contract

- All nine listed files pass in one serialized unit invocation.
- Every T05 AC has both positive and material failure/diagnostic proof.
- Stale evidence is counted and history-only.
- Reconnect/no-replay counters show zero work creation.
- Diagnostic bounds/redaction pass.
- `git diff --check` passes and every evidence artifact records candidate SHA
  plus producer exit.

## Commit boundary

```text
test(pi): record Ticket 05 deterministic recovery evidence
```

Stage only the five allowed WP-01 paths.

## Escalation

- `blocked`: missing runner/dependency, environment/resource failure, or
  evidence cannot be written.
- `challenge`: any criterion failure, changed measured seam, unexpected work
  creation/provider effect, bound/redaction failure, or required source/test/
  contract/configuration/migration/Alfie change. Stop before remediation and
  invoke PLAN §9.
