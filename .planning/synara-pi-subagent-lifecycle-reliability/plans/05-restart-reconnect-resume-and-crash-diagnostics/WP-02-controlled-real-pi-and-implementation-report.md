# WP-02 — controlled real-Pi evidence and Implementation Report

**State:** completed (2026-08-28)

**Result (WP-02 execution):** Exact controlled provenance PASS — Alfie HEAD
`3fe340b401ca86bcbe8b55abd4de107e1d93482e`, origin
`https://github.com/anhphamwork99/alfie.git`, clean controlled status, zero
controlled diff, `@alfie/pi-subagents@0.15.0-alfie.6`, Pi SDK `0.83.0`, 5/5
fixture hashes exact (`evidence/WP-02-controlled-provider-provenance.txt`).
All three authorized behavioral legs pass with producer exit 0 — restart
1/1 in 10.74s (Bun), explicit Resume 1/1 in 4.26s (Bun), fresh production
boot 1 passed/9 skipped in 12.18s under the supported Node v24.14.1 producer
after the preserved Bun 1.3.12 `node:sqlite` pre-collection failure (0 tests,
exit 1 — environment evidence, not a behavior result)
(`evidence/WP-02-nondestructive-real-pi-disposition.md`; raw logs untouched).
Leg-3 truth: same execution/attempt identity, one honest orphan fence
generation 1→2 with `pi_subagent_owner_loss_orphaned`, zero new delegated
requests (delegated 1→1; the modelRequests 2→3 delta is non-delegated
startup/runtime traffic), fresh-server admissions 0, resume-requested 0,
parent effects 0, outbox 0. Runs used source-equivalent commits
`4090ccee8`/`d12e1a2e0` (zero apps/packages delta from the frozen candidate
`7521b92c7`). Issue 05 Implementation Report fully populated across all 17
contract fields with T05-AC1–AC6 mapped to executed evidence; status remains
`ready-for-agent`. No source/test/contract/config/migration/manifest/lockfile
or Alfie delta; owner WIP hash `ab8f8f54…eaa8` preserved; no destructive run,
PID enumeration/signalling, Ticket-level review, or Supervisor activation;
heavyweight checks (fmt/lint/typecheck) not authorized and not run; Ticket 06
frontier deferred to WP-03, which is next.

**Owner role:** implementation worker

**Dependencies:** WP-01 committed and PASS; same source-equivalent production
candidate; no unresolved challenge; active contract authorizes the named
non-destructive controlled-provider operations.

## Objective and observable outcome

Verify exact controlled provenance, run the isolated non-destructive real-Pi
restart/Resume/no-replay legs, and complete Ticket 05's Implementation Report
without runtime changes or Ticket-level review/Supervisor activation.

## Bounded read set

- PLAN and all WP-01 evidence.
- Ticket 05 issue and Project Home.
- `apps/server/src/provider/test-fixtures/piSubagentExtensionProvenance.json`
- `apps/server/src/provider/piSubagentRestartAcceptance.test.ts`
- `apps/server/src/provider/piSubagentResumeAcceptance.test.ts`
- `apps/server/src/provider/piSubagentRealPiAcceptance.test.ts`
- `apps/server/src/provider/piSubagentRealPiAcceptanceHelpers.ts`
- `apps/server/vitest.config.ts` and wallclock runner configuration.
- `/Users/anhpham99/alfie` Git/provenance surfaces, read-only.
- Governing testing, restart, Resume, teardown, and controlled-artifact
  authorities.

## Exact allowed write set

```text
.planning/synara-pi-subagent-lifecycle-reliability/plans/05-restart-reconnect-resume-and-crash-diagnostics/evidence/WP-02-controlled-provider-provenance.txt
.planning/synara-pi-subagent-lifecycle-reliability/plans/05-restart-reconnect-resume-and-crash-diagnostics/evidence/WP-02-restart-acceptance.log
.planning/synara-pi-subagent-lifecycle-reliability/plans/05-restart-reconnect-resume-and-crash-diagnostics/evidence/WP-02-resume-acceptance.log
.planning/synara-pi-subagent-lifecycle-reliability/plans/05-restart-reconnect-resume-and-crash-diagnostics/evidence/WP-02-production-restart-leg.log
.planning/synara-pi-subagent-lifecycle-reliability/plans/05-restart-reconnect-resume-and-crash-diagnostics/evidence/WP-02-nondestructive-real-pi-disposition.md
.planning/synara-pi-subagent-lifecycle-reliability/issues/05-restart-reconnect-resume-and-crash-diagnostics.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/05-restart-reconnect-resume-and-crash-diagnostics/WP-02-controlled-real-pi-and-implementation-report.md
```

The issue write is limited to the Implementation Report. Do not change status.

## Prohibited changes

No Symphony or Alfie source/tests/contracts/configuration/migrations/manifests/
lockfiles; no Project Home/routing; no destructive process-tree proof, PID
enumeration/signalling, manual recipe, decision/review/Supervisor artifact,
release/deploy/push, or Ticket 06 work.

## Controlled provenance

Record:

```bash
git -C /Users/anhpham99/alfie rev-parse HEAD
git -C /Users/anhpham99/alfie status --short
git -C /Users/anhpham99/alfie diff -- \
  package.json \
  agent/extensions/pi-subagents/package.json \
  agent/extensions/pi-subagents/src/index.ts \
  agent/extensions/pi-subagents/src/agent-manager.ts \
  agent/extensions/pi-subagents/src/agent-runner.ts \
  agent/extensions/pi-subagents/src/child-bash-supervisor.ts
```

Compare the checkout to
`apps/server/src/provider/test-fixtures/piSubagentExtensionProvenance.json`.
Required: exact commit `3fe340b4`, extension `0.15.0-alfie.6`, Pi SDK `0.83.0`,
clean tracked controlled surfaces, matching fixture hashes.

Dirty/mismatched controlled surfaces are `blocked`; do not reset, clean,
checkout, or re-pin.

## Standalone controlled real-Pi commands

### Restart acceptance

```bash
cd apps/server
set -o pipefail
ALFIE_REPO_DIR=/Users/anhpham99/alfie \
node ../../node_modules/vitest/vitest.mjs run \
  --project wallclock \
  --maxWorkers=1 \
  --no-file-parallelism \
  src/provider/piSubagentRestartAcceptance.test.ts \
  2>&1 | tee ../../.planning/synara-pi-subagent-lifecycle-reliability/plans/05-restart-reconnect-resume-and-crash-diagnostics/evidence/WP-02-restart-acceptance.log
status=${PIPESTATUS[0]}
exit "$status"
```

### Explicit Resume acceptance

```bash
cd apps/server
set -o pipefail
ALFIE_REPO_DIR=/Users/anhpham99/alfie \
bun run ../../node_modules/vitest/vitest.mjs run \
  --project wallclock \
  --maxWorkers=1 \
  --no-file-parallelism \
  src/provider/piSubagentResumeAcceptance.test.ts \
  2>&1 | tee ../../.planning/synara-pi-subagent-lifecycle-reliability/plans/05-restart-reconnect-resume-and-crash-diagnostics/evidence/WP-02-resume-acceptance.log
status=${PIPESTATUS[0]}
exit "$status"
```

### Fresh production boot on the same durable root

```bash
cd apps/server
set -o pipefail
ALFIE_REPO_DIR=/Users/anhpham99/alfie \
bun run ../../node_modules/vitest/vitest.mjs run \
  --project wallclock \
  --maxWorkers=1 \
  --no-file-parallelism \
  src/provider/piSubagentRealPiAcceptance.test.ts \
  -t "T17 slice 4 stage 5" \
  2>&1 | tee ../../.planning/synara-pi-subagent-lifecycle-reliability/plans/05-restart-reconnect-resume-and-crash-diagnostics/evidence/WP-02-production-restart-leg.log
status=${PIPESTATUS[0]}
exit "$status"
```

`piSubagentRealPiAcceptance.test.ts` imports `DatabaseSync` from
`node:sqlite`. The repository's supported Node runtime resolves that built-in;
Bun 1.3.12 does not. Preserve any Bun pre-collection failure (`0 tests`) in the
same log, then run the exact file/filter once with Node. Only the Node producer
may supply behavioral evidence for this leg; record both exits without
relabeling the Bun failure as a test failure.

The filtered leg must prove fresh production WebSocket composition over the
same isolated root/database after the old server is fully disposed; honest
orphan/generation fence; unchanged logical execution/attempt; and zero new
admissions, delegated model requests, Resume requests, parent effects, or
completion outbox entries.

If the title filter runs prerequisite-dependent or unrelated stages, stop as
an evidence gap. Do not broaden to the complete integrated Ticket 06 file
without a renewed contract.

## Evidence and manual boundary

`WP-02-nondestructive-real-pi-disposition.md` records commands, isolation,
totals, durations, exits, exact assertions, and evidence class. Ticket 05 does
not claim or require a new destructive zero-owned-child run. Record the
inherited manual leg as not rerun and not relabeled.

If the active contract does not authorize the controlled operations, do not
run them or fabricate logs; return `blocked` with the exact unexecuted commands.

## Implementation Report fields

Replace every placeholder with:

1. router baseline, plan commit, frozen candidate, WP commits;
2. exact Symphony/Alfie/Pi SDK provenance and dirty/hash result;
3. no-source/test/contract/configuration/migration/manifest/lockfile/Alfie
   assertion;
4. production startup composition/order;
5. reconnect isolated-root/fresh-client/card-cap/bounds/cursor evidence;
6. T05-AC1–AC6 matrix with named tests and evidence paths;
7. Resume authorization/denial matrix, including exact inactive-runtime
   operation/message and zero effects;
8. crash stage/evidence-gap/bounds/redaction matrix;
9. stale attempt/generation counters and history-only evidence;
10. structural no-replay proof and before/after effect counts;
11. real-Pi commands, isolation, totals, exits, and evidence class;
12. destructive manual disposition;
13. heavyweight-check authorization/result;
14. owner-WIP preservation and staged paths;
15. no Ticket 05 review/Supervisor activation;
16. residual uncertainty, challenge, and reopening conditions;
17. proposed Ticket 06 planning frontier only after WP-03.

## Verification contract

- Exact controlled provenance passes.
- Each executed wallclock file passes standalone with producer exit 0.
- Evidence never conflates fixture, controlled real-Pi, or inherited manual
  proof.
- Report has no empty placeholder and every AC cites current evidence.
- `git diff --check` passes; issue status remains `ready-for-agent`.

## Commit boundary

```text
test(pi): record Ticket 05 controlled recovery evidence
```

Stage only the allowed WP-02 paths that actually exist.

## Escalation

- `blocked`: missing active authorization, dirty/mismatched controlled Alfie,
  missing runtime dependency, or environment/access failure.
- `challenge`: controlled real-Pi contradicts deterministic truth; inactive
  Resume mutates/bootstraps; fresh boot creates work; existing pin is
  insufficient; any new authority/contract/source change appears necessary; or
  an unexecuted leg would be required to claim an AC.
