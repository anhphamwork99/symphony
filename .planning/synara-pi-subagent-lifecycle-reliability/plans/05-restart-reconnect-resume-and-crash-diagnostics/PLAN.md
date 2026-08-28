# Ticket 05 Plan — restart, reconnect, Resume, projection truth, and crash diagnostics

**Plan state:** completed — accepted and executed in full; Ticket 05 closed evidence-only and Ticket 06 is the sole `ready-for-planning` frontier

**Project Home:** [`../../PROJECT.md`](../../PROJECT.md)

**Issue:** [`../../issues/05-restart-reconnect-resume-and-crash-diagnostics.md`](../../issues/05-restart-reconnect-resume-and-crash-diagnostics.md)

**Planning baseline:** Symphony `fa02c58ed100242dcaab1ce2aabf0ec8d6a9cef2`

**Controlled provider boundary:** Alfie `3fe340b401ca86bcbe8b55abd4de107e1d93482e`, `@alfie/pi-subagents@0.15.0-alfie.6`; Pi SDK `@earendil-works/pi-coding-agent@0.83.0`

**Date:** 2026-08-28

## 1. Objective and planning conclusion

Prove that the current accepted production seams already make restart,
reconnect, explicit Resume, stale evidence, and crash diagnostics truthful
without adding replay or new recovery authority.

Grounding found one minimum production-ready direction: **evidence-first, no
initial source change**. Existing inherited seams provide bounded durable
snapshot hydration, cursor-safe replay, restart reconciliation to recovered
terminal/proven live owner/non-terminal orphan, explicit same-execution/new-
attempt Resume, stale generation fencing, and stable bounded diagnostics.

Provider-inactive Resume is intentionally fail-closed at
`ProviderService.resumePiSubagentExecution` with `allowRecovery: false`. That
truthful denial satisfies T05-AC4; it does not justify provider bootstrap.
Likewise, existing durable and projection evidence can explain crash
uncertainty without a crash guardian, durable post-restart owner receipt, or
orphan-terminal exception.

The initial execution candidate is therefore measured, not modified. Any
criterion failure stops at §9 and requires a newly persisted plan or material
decision before source/test/contract/configuration/migration/Alfie work.

## 2. Binding authorities and invariants

This plan preserves:

- local [Decision 0002](../../decisions/0002-canonical-execution-identity-and-result-read-contract.md):
  `executionId` is the public durable identity; Symphony authorizes and resolves
  the current tuple before provider access;
- local [Decision 0006](../../decisions/0006-live-lifecycle-containment-linearization-contract.md):
  exact live access is scoped to `(executionId, attemptId, generation,
  providerSessionInstance)` and fails closed without replay or reconstruction;
- inherited durable-subagents Decision 0014: restart restores applicable
  terminal truth, refreshes only a proven exact live owner, otherwise records
  non-terminal `orphaned`; stale events remain history and restart never
  replays;
- inherited Decision 0019: reconnect hydrates bounded execution cards through
  the existing snapshot/cursor surface;
- inherited Decision 0026: explicit Resume keeps `executionId`, creates one new
  attempt/generation, journals sequence `80` before launch, and has no implicit
  trigger;
- inherited Decisions 0027, 0033, and 0034: proof-before-fence, live-owner-only
  teardown authority, restart `owner_unproven`, no PID fallback, and the
  deterministic/non-destructive/manual real-Pi evidence split;
- inherited Decision 0001 testing governance: use the highest stable boundary,
  pair success with failure/diagnostic evidence, and never relabel fixture or
  unexecuted evidence.

Immutable constraints:

1. Terminal truth, cleanup proof, live-owner proof, provider availability, and
   Resume eligibility remain separate.
2. `cleanup_uncertain`, `survivors`, `owner_unproven`, timeout, session stop,
   and provider absence remain non-terminal evidence.
3. No startup, hydration, cursor replay, reconnect, watchdog, reconciliation,
   cleanup, or completion-recovery path may spawn, Resume, or replay a child.
4. No provider bootstrap, crash guardian, durable owner receipt,
   orphan-terminal exception, PID guessing, process-name kill, parent fallback,
   or Symphony process-kill authority.
5. No new public identity, diagnostic vocabulary, sequence band, schema,
   migration, configuration knob, capability, or Alfie runtime change.
6. Ticket-level review and Supervisor acceptance remain unused. One integrated
   project review and exactly one Supervisor final acceptance remain reserved
   for the complete Ticket 06/project candidate.

## 3. Grounded solution contract

### Reconnect and projection

- `ProjectionSnapshotQuery` reads execution cards directly from durable
  Pi-subagent tables through the shared row-to-card mapper.
- `PI_SUBAGENT_EXECUTION_CARD_MAX_PER_THREAD` caps each thread at 64 cards and
  drops the oldest overflow rows.
- Progress and diagnostic excerpts are capped at 512 characters.
- Cards exclude prompts, raw progress JSON, full transcripts/results,
  provider-local `agentId`, and process ownership details.
- A valid cursor replays only the bounded durable gap. Excessive/ahead/deleted
  subject or attach-gap cases resnapshot through the existing explicit
  recovery path.
- Snapshot and cursor paths are read-only with respect to attempts, generations,
  admissions, Resume sequence `80`, child launchers, and provider dispatch.

### Restart

Production startup runs after the server is live:

```text
recoverCompletionOutbox
  -> runPiSubagentProcessTeardown with no live owner endpoint
  -> reconcilePiSubagentExecutions(mode: "restart")
```

This preserves outbox recovery first, records bounded band-78
`owner_unproven` evidence before the owner-loss fence where applicable, kills
nothing at boot, then resolves each remaining non-terminal execution through:

1. exact current live-owner evidence → refresh only, same attempt/generation;
2. exact current terminal evidence → journal-first terminal restoration;
3. neither → non-terminal `orphaned`, one generation fence, stable
   `pi_subagent_owner_loss_orphaned` diagnostic.

The orphan diagnostic must state that partial external/workspace side effects
may already exist, recommend inspection before Resume, and state that the
execution was not automatically replayed.

### Explicit Resume

The sole production path is:

```text
thread.pi-subagent-execution.resume-requested
  -> ProviderCommandReactor
  -> ProviderService.resumePiSubagentExecution
  -> active exact provider adapter
  -> PiAdapter.resumePiSubagentExecution
  -> resumePiSubagentExecution coordinator
```

ProviderService resolves the current session with `allowRecovery: false`.
Inactive runtime returns:

```text
Cannot resume subagent execution '<executionId>' because the provider runtime is not active.
```

before adapter/coordinator access, sequence-80 persistence, attempt creation, or
child launch. A successful explicit command re-runs authorization/admission
gates, preserves `executionId`, persists exactly one new attempt/generation at
sequence `80`, then invokes exactly one captured managed launcher.

### Stale and crash evidence

- Late old-attempt/generation terminal evidence is journaled/accounted as stale,
  increments the stale-terminal counter, creates no current outbox effect, and
  cannot change current aggregate truth.
- Prior generic lifecycle/cancel/completion evidence remains history-only after
  Resume/restart fencing.
- Crash diagnostics identify the reached stage and missing evidence with fixed
  codes/messages and bounded safe metadata. They never invent owner receipts,
  terminal exceptions, cleanup proof, or arbitrary exception content.

## 4. Plan-persistence transaction and routing

This transaction creates the four plan files in this directory and changes only:

- `../../issues/05-restart-reconnect-resume-and-crash-diagnostics.md`
  - `blocked` → `ready-for-agent`;
  - add this plan link;
  - authorize only the serial evidence WPs below;
  - preserve the Implementation Report placeholder and material unlock gate.
- `../../PROJECT.md`
  - keep Ticket 05 the sole frontier;
  - change it from `ready-for-planning` to `ready-for-agent`;
  - state that initial execution is evidence-only and authorizes no
    source/test/contract/configuration/migration/manifest/lockfile/Alfie change;
  - keep Ticket 06 blocked and preserve the integrated review/Supervisor
    reservation.

Exact plan-persistence write set:

```text
.planning/synara-pi-subagent-lifecycle-reliability/PROJECT.md
.planning/synara-pi-subagent-lifecycle-reliability/issues/05-restart-reconnect-resume-and-crash-diagnostics.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/05-restart-reconnect-resume-and-crash-diagnostics/PLAN.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/05-restart-reconnect-resume-and-crash-diagnostics/WP-01-focused-deterministic-evidence.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/05-restart-reconnect-resume-and-crash-diagnostics/WP-02-controlled-real-pi-and-implementation-report.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/05-restart-reconnect-resume-and-crash-diagnostics/WP-03-ticket-closure-and-routing.md
```

No source implementation is authorized in the plan-persistence transaction.

## 5. Serial dependency graph and Work Packages

```text
plan persistence + Ticket 05 ready-for-agent
  └──> WP-01 focused deterministic recovery evidence
        └──> WP-02 controlled real-Pi evidence + Implementation Report
              └──> WP-03 Ticket 05 closure + route Ticket 06
```

The graph is strictly serial. WP-02 consumes WP-01's frozen candidate and
criterion matrix. WP-03 consumes both prior evidence commits and writes shared
issue/router state. No package is parallel-safe.

| Package | Primary output | Initial production write authority |
|---|---|---|
| [WP-01](WP-01-focused-deterministic-evidence.md) | frozen candidate, deterministic AC/diagnostic matrix, no-replay structural proof | none |
| [WP-02](WP-02-controlled-real-pi-and-implementation-report.md) | controlled provenance, non-destructive real-Pi evidence/disposition, complete Implementation Report | none |
| [WP-03](WP-03-ticket-closure-and-routing.md) | Ticket 05 accepted only from passing evidence; Ticket 06 becomes sole `ready-for-planning` frontier | none |

## 6. Acceptance traceability

| Criterion | Owning evidence |
|---|---|
| T05-AC1 reconnect bounded/no-dispatch | WP-01 repository/card/snapshot/cursor tests and structural counters |
| T05-AC2 restart terminal/live/orphan truth | WP-01 reconciliation/startup-order tests; WP-02 restart and fresh-production-boot real-Pi legs |
| T05-AC3 stale old-attempt/generation history | WP-01 restart, Resume, terminal, repository, and card tests; WP-02 late real-Pi terminal |
| T05-AC4 explicit authorized Resume/inactive denial | WP-01 coordinator/provider structural matrix; WP-02 explicit real-Pi Resume |
| T05-AC5 stage/evidence-gap crash diagnostics | WP-01 fixed diagnostic matrix and bounded/redacted projection assertions |
| T05-AC6 no automatic replay/Resume | WP-01 structural proof; WP-02 fresh-production-boot effect counters |

No AC may pass from inherited totals, source comments, compile success, or an
unexecuted command alone.

## 7. Verification and evidence policy

- Use the exact runner named by each WP and never `bun test`. WP-01 and the
  restart/Resume real-Pi files may use
  `bun run ../../node_modules/vitest/vitest.mjs`. The production-composition
  real-Pi file imports Node's built-in `node:sqlite`, so its direct producer
  must use `node ../../node_modules/vitest/vitest.mjs` under the repository's
  supported Node engine (`>=24.10`). Bun 1.3.12 cannot resolve
  `node:sqlite`; a Bun pre-collection failure with zero tests is environment
  evidence, not a Ticket 05 behavior result.
- Do not use `bun run test <paths>` for focused evidence; the package runner
  ignores positional filtering.
- Unit evidence runs serialized with `--project unit --maxWorkers=1
  --no-file-parallelism`.
- Each wallclock file runs in a standalone process with `--project wallclock
  --maxWorkers=1 --no-file-parallelism`.
- Real-Pi uses exact controlled Alfie provenance, isolated roots/home/state/
  workspace/agent directories, deterministic loopback model endpoint, and no
  user live-instance mutation.
- Ticket 05 makes no destructive zero-owned-child claim. The accepted isolated
  manual evidence remains inherited and reserved for its sole proof purpose;
  do not rerun or relabel it.
- `bun fmt`, `bun lint`, and `bun typecheck` are one final closure gate only and
  may run only with explicit owner authorization in that closure conversation.

## 8. Git and workspace safety

Protected unrelated owner work:

```text
apps/web/package.json
apps/web/src/main.tsx
bun.lock
```

These paths must remain byte-identical to their planning baseline, modified-
unstaged, and absent from every Ticket 05 index/commit.

Before each package record:

```bash
git rev-parse HEAD
git status --short
git diff --name-status fa02c58ed100242dcaab1ce2aabf0ec8d6a9cef2..HEAD
git diff --name-only
git diff --cached --name-only
```

Use explicit staging only. Never use `git add .` or `git add -A`. No reset,
clean, checkout, push, release, deploy, default dev instance, or destructive
process operation is authorized.

## 9. Conditional defect/material-decision branch

Stop with `challenge` before any source/test change when:

- a T05 criterion or required failure/diagnostic row fails;
- reconnect creates or mutates attempts/generations or reaches a provider;
- restart, startup recovery, watchdog, reconciliation, or cleanup dispatches,
  resumes, replays, or creates a parent effect;
- inactive-provider Resume reaches the adapter/coordinator, persists sequence
  `80`, creates an attempt, launches a child, or requires provider bootstrap;
- stale evidence changes current truth or is not counted;
- diagnostics cannot identify stage/evidence gap with existing bounded
  vocabulary or leak prohibited content;
- controlled real-Pi contradicts deterministic truth;
- a source/test/contract/configuration/migration/manifest/lockfile/Alfie change
  appears necessary;
- a crash guardian, durable owner receipt, orphan-terminal exception, PID
  authority, automatic replay, or automatic Resume appears necessary.

The challenge package must record frozen candidate, exact command/exit, failing
criterion/test, current versus required behavior, caller/blast radius, minimum
observed gap, and the exact material question. Do not advance Ticket 05 or
Ticket 06 across the challenge.

## 10. Completion and routing

Ticket 05 closes only when:

1. WP-01 passes every deterministic feature and failure/diagnostic row;
2. WP-02 verifies exact controlled provenance and records truthful
   non-destructive real-Pi results/disposition;
3. the Implementation Report has no placeholder and maps T05-AC1–AC6 to
   executed evidence;
4. no Ticket 05 production/test/contract/configuration/migration/manifest/
   lockfile/Alfie delta exists;
5. no unresolved challenge or AC-affecting blocker remains;
6. the authorized final workspace gate passes;
7. owner WIP and staging safety pass;
8. no Ticket 05 reviewer or Supervisor gate is consumed.

Then WP-03 sets Ticket 05 to `accepted`, routes Ticket 06 as the sole
`ready-for-planning` frontier, and preserves the integrated review plus exactly
one Supervisor final acceptance for the complete project candidate.

## 11. Reopening conditions

Reopen this plan only for material evidence that the measured source differs
from the grounded seams, an AC fails, controlled provenance changes, existing
diagnostics cannot remain truthful and bounded, or an accepted later decision
changes identity, restart, Resume, owner, cleanup, or no-replay authority.

## 12. Completion record (2026-08-28)

The plan executed in full and Ticket 05 closed from passing evidence only:

- WP-01 committed `4090ccee8cf39b9164a9653fc41b239bc59b5173` — frozen
  candidate `7521b92c7cb8a614346f994e963aa379175f540b`; 9/9 files, 118/118
  deterministic tests, exit 0.
- Runner correction `d12e1a2e071afcdc63f630fbff467b76779e7d42` — Node
  producer authorized for the production real-Pi file per §7.
- WP-02 committed `b5d0feefc26bf88d59d1759132c9a8b051c54865` — exact clean
  Alfie `3fe340b401ca86bcbe8b55abd4de107e1d93482e`,
  `@alfie/pi-subagents@0.15.0-alfie.6`, Pi SDK 0.83.0, 5/5 fixture hashes;
  restart 1/1, Resume 1/1, fresh production boot 1 passed/9 skipped (Node
  v24.14.1), all exit 0; Implementation Report complete across all 17 fields.
- WP-03 closed Ticket 05 as `accepted` and routed Ticket 06 as the sole
  `ready-for-planning` frontier. §10 closure conditions 1–8 all hold; the
  owner-authorized final workspace gate passed (`bun fmt` exit 0, `bun lint`
  exit 0 with 0 warnings/0 errors, `bun typecheck` exit 0 with 7/7 tasks,
  0 cached); non-failing console advisories recorded in the issue closure
  record; owner WIP hash `ab8f8f54…eaa8` identical pre/post gate.
- Governance disposition unchanged: no ticket-level review or Supervisor
  gate consumed; the integrated project review and exactly one Supervisor
  final acceptance remain reserved for the complete Ticket 06/project
  candidate.
