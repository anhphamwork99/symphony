# WP-02 — controlled provider disposition and Implementation Report

**State:** completed — WP-01 PASS evidence consumed; controlled-provider provenance verified; current-session non-destructive real-Pi run authorized, executed (cancellation 2/2, watchdog 2/2, producer exit 0), and dispositioned; Implementation Report complete.

**Result:** Produced `evidence/WP-02-controlled-provider-provenance.txt`, `evidence/WP-02-nondestructive-real-pi-disposition.md`, preserved raw `evidence/WP-02-nondestructive-real-pi.log`, and completed the issue Implementation Report (issue status unchanged: `ready-for-agent`). Consumed by WP-03.

**Dependencies:** WP-01 evidence committed; frozen candidate unchanged; no Ticket 04 source/test delta.

## Objective and observable outcome

Verify the controlled-Alfie boundary, decide and record whether current-session non-destructive real-Pi evidence is runnable, and complete the Ticket 04 issue Implementation Report without claiming or requiring destructive manual execution.

## Bounded read set

- WP-01 evidence and frozen candidate.
- `/Users/anhpham99/alfie/package.json`, Alfie git metadata, and controlled extension provenance surfaces, read-only.
- `apps/server/scripts/wallclock-tests.ts`
- `apps/server/src/provider/piSubagentCancellationAcceptance.test.ts`
- `apps/server/src/provider/piSubagentWatchdogAcceptance.test.ts`
- Ticket 03 accepted report/review evidence cited by Project Home.
- Decisions 0028, 0033, and 0034.

## Exact allowed write set

- `.planning/synara-pi-subagent-lifecycle-reliability/plans/04-cancellation-watchdog-and-teardown-settlement/evidence/WP-02-controlled-provider-provenance.txt`
- `.planning/synara-pi-subagent-lifecycle-reliability/plans/04-cancellation-watchdog-and-teardown-settlement/evidence/WP-02-nondestructive-real-pi-disposition.md`
- `.planning/synara-pi-subagent-lifecycle-reliability/plans/04-cancellation-watchdog-and-teardown-settlement/evidence/WP-02-nondestructive-real-pi.log` — only if the conditional run executes.
- `.planning/synara-pi-subagent-lifecycle-reliability/issues/04-cancellation-watchdog-and-teardown-settlement.md` — Implementation Report section only; do not change status.
- `.planning/synara-pi-subagent-lifecycle-reliability/plans/04-cancellation-watchdog-and-teardown-settlement/WP-02-controlled-provider-and-implementation-report.md` — state/result fields only.

## Prohibited changes

No Symphony or Alfie source/tests/contracts/manifests/lockfile/migrations/config/decisions; no Project Home or ticket status; no destructive process test; no PID enumeration/signalling; no new manual recipe; no review/Supervisor artifact.

## Controlled-provider verification

Record, without modifying Alfie:

```bash
git -C /Users/anhpham99/alfie rev-parse HEAD
git -C /Users/anhpham99/alfie status --short
git -C /Users/anhpham99/alfie diff -- package.json src/index.ts src/agent-manager.ts
node -p "require('/Users/anhpham99/alfie/package.json').name + '@' + require('/Users/anhpham99/alfie/package.json').version"
```

Required result: exact commit `3fe340b401ca86bcbe8b55abd4de107e1d93482e`, package `@alfie/pi-subagents@0.15.0-alfie.6`, and no tracked provenance-surface delta. If the checkout is dirty or mismatched, return `blocked`; do not clean, reset, checkout, or re-pin it.

## Conditional non-destructive real-Pi evidence

The deterministic WP-01 result remains authoritative. A current-session rerun is allowed only when all conditions hold:

1. the owner/current session authorizes provider operation;
2. `ALFIE_REPO_DIR=/Users/anhpham99/alfie` is the exact clean controlled checkout;
3. tests use isolated temporary state and their existing cleanup hooks;
4. only the existing cancellation and watchdog acceptance suites run;
5. no destructive teardown/manual child-process claim is made.

If authorized, run each wallclock file standalone from `apps/server`:

```bash
cd apps/server
set -o pipefail
{
  ALFIE_REPO_DIR=/Users/anhpham99/alfie \
    bun run ../../node_modules/vitest/vitest.mjs run --project wallclock \
    --maxWorkers=1 --no-file-parallelism \
    src/provider/piSubagentCancellationAcceptance.test.ts
  first=$?
  if [ "$first" -ne 0 ]; then exit "$first"; fi

  ALFIE_REPO_DIR=/Users/anhpham99/alfie \
    bun run ../../node_modules/vitest/vitest.mjs run --project wallclock \
    --maxWorkers=1 --no-file-parallelism \
    src/provider/piSubagentWatchdogAcceptance.test.ts
} 2>&1 | tee ../../.planning/synara-pi-subagent-lifecycle-reliability/plans/04-cancellation-watchdog-and-teardown-settlement/evidence/WP-02-nondestructive-real-pi.log
status=${PIPESTATUS[0]}
exit "$status"
```

If any condition is absent, do not run. In `WP-02-nondestructive-real-pi-disposition.md`, record `not run`, the missing authorization/environment condition, inherited accepted evidence citations, and that Decisions 0028/0034 make deterministic fixtures authoritative and destructive real-Pi isolated/manual. Do not claim a run.

The package-wide test command, if separately requested, is exactly `bun run test` from `apps/server`; it is not part of this focused WP and is not authorized by default. Never use `bun test`.

## Implementation Report fields

Replace every issue placeholder with concrete content:

1. router baseline, execution candidate, evidence/report commits, and controlled Alfie/Pi SDK provenance;
2. no-source-change assertion with `83620ab07..candidate` and working-tree disposition;
3. inherited decision/invariant matrix, including exact tuple before provider access;
4. band/state matrix for 90/92, 70–74, and 75–78, identifying the sole 76 fence;
5. T04-AC1–AC5 test matrix with named cases, exits, evidence paths, and normal/failure proof;
6. owned-only endpoint, no-fallback, survivor cap, retry escalation, and retained-owner proof;
7. fixed diagnostic matrix for persistence, dispatch, timeout, owner loss, survivor, late terminal, unavailable/outcome-unknown/stale;
8. replay/duplicate-effect and graceful-path evidence;
9. evidence-class separation: deterministic, controlled-Alfie, conditional non-destructive real-Pi, and destructive manual;
10. manual-run record: explicitly `not run for Ticket 04` unless an owner-operated destructive run actually occurred; cite Decisions 0028/0034 and never refresh the claim by inference;
11. owner-death reachability disposition: coordinator/restart evidence is accepted; live cancel adapters intentionally pass `isOwnerGenerationDead: false`; no new live adapter authority is invented;
12. ticket-level review/Supervisor disposition: intentionally not activated; reserved for integrated project;
13. heavyweight checks: `not authorized/not run` unless current-session owner separately authorized them, with exact results if run;
14. residual uncertainty and reopening/challenge conditions;
15. conclusion for each AC: PASS only from recorded evidence, otherwise fail closed.

## Verification contract

- Provenance file proves the controlled boundary or WP returns blocked.
- Implementation Report has no empty placeholder and links every AC to WP-01 evidence.
- Any real-Pi statement identifies whether it is current-run, inherited, or not run.
- No destructive current-run claim exists absent an operator/environment record.
- `git diff --check` passes and the issue status remains `ready-for-agent`.

## Produced/consumed contract

Produces the completed issue report, provenance evidence, and honest non-destructive disposition. WP-03 consumes them.

## Commit boundary

```text
docs(planning): complete Ticket 04 implementation report
```

## Escalation

Return `blocked` for dirty/mismatched/unavailable controlled Alfie or missing WP-01 artifacts. Return `challenge` if report completion would require source/test/Alfie edits, destructive automation, new authority, or a criterion claim unsupported by deterministic evidence.
