# Ticket 06 Plan — integrated real-Pi acceptance

**Plan state:** Decision 0008 containment candidate remains frozen; WP-01 is
**PASS** with `19/19` files and `303/303` deterministic tests, zero failures,
and zero skips. Candidate2 is `2afef48b008527685658801d8f0d84c79e24827d`.
WP-02 is **READY** for exactly one complete five-file non-destructive real-Pi
attempt. No WP-02 leg, test rerun, quality gate, review, or Supervisor
consultation was run in the WP-01 evidence transaction.
**Date:** 2026-08-28

## 1. Objective and governing authorities

Prove the accepted Tickets 01–05 seams against the pinned real-Pi composition,
without changing their canonical expectations, by first applying the Decision
0008 post-await classification correction and then resetting behavioral evidence
at the frozen candidate.

[Decision 0008](../../decisions/0008-reassessment-live-control-post-await-retirement-classification.md)
is binding and Authoritative only for the post-await live-control retirement
classification and its exact correction boundary. [Decision 0007](../../decisions/0007-ticket-06-batching-fixture-causal-control-and-candidate-rebaseline.md)
remains Authoritative for the fixture correction, historical rebaseline,
attempt-3 erratum, and downstream gate state. Decisions 0002/0003/0006 remain
binding for canonical identity, synchronous provider acceptance, terminal truth,
and the other lifecycle invariants.

## 2. Frozen candidate and exact lineage

- Historical base: `12fd6686edc26a3fa0382e8bdeb83a1be8045539`.
- Historical ffd candidate: `ffd45bd867e94c9003415f5f2e937cc9c616e399`, the
  sole-parent child of `12fd6686`, with exactly the two Decision 0007 fixture
  paths. Its WP-01/WP-02 evidence is historical supporting only.
- Frozen candidate2: `2afef48b008527685658801d8f0d84c79e24827d`, the sole-parent
  child of `ffd45bd`. This is the producer identity; its exact candidate SHA is
  recorded before any new behavioral evidence.
- Candidate2 delta from `ffd45bd`: exactly:

  ```text
  apps/server/src/provider/piSubagentLiveLifecycleContainment.ts
  apps/server/src/provider/piSubagentLiveLifecycleContainment.test.ts
  ```

- Total delta from `12fd6686`: exactly those two containment paths plus the two
  Decision 0007 fixture paths:

  ```text
  apps/server/src/provider/piSubagentRealPiAcceptance.test.ts
  apps/server/src/provider/piSubagentRealPiAcceptanceHelpers.ts
  apps/server/src/provider/piSubagentLiveLifecycleContainment.ts
  apps/server/src/provider/piSubagentLiveLifecycleContainment.test.ts
  ```

- Main integration merge: `44249d81c49172e192dcf0f09ddfadc702a4b34c`, with
  parents `50853a3b9774e7aa5462916056195ffa536dc491` (planning) and candidate2.
  The merge is integration provenance only and is never the producer identity.
- Production coordinator/configuration, canonical expectations, lockfiles, all
  other source/test paths, and Alfie remain unchanged.
- Alfie pin: `3fe340b401ca86bcbe8b55abd4de107e1d93482e` /
  `@alfie/pi-subagents@0.15.0-alfie.6`.
- Protected owner WIP remains outside this transaction, untouched and unstaged;
  required aggregate diff hash:
  `ab8f8f54fe818819721f737aa337156ed6348c7410c55083ce3a67785bb7eaa8`.

## 3. Focused implementation evidence

The candidate's focused containment evidence is copied byte-identically into
this plan's evidence directory:

- `candidate2-containment-red.log`: exit 1; 24 tests; 6 failed / 18 passed;
  SHA-256 `665e0bbaf0a9a25d1908c9767d2bd7ff2947d4e1844a6df80d84622300b16e3b`.
- `candidate2-containment-green.log`: exit 0; 24/24 tests passed; SHA-256
  `84feb4814b891ce69472c74dd5596f04c9bf753fa65de18c7d31b352dd95f43b`.

These logs are focused implementation red/green evidence, not WP-01 D
acceptance and not WP-02 R acceptance. The current WP-01 D producer records
are the two `WP-01-decision0008-*` logs described in §6 and the evidence
matrix.

## 4. Evidence classes and acceptance

P = planning/provenance; D = deterministic; R = controlled real-Pi
non-destructive; M = exactly-one owner-authorized manual destructive leg; Q =
quality gate; H = historical supporting-only; A = review and acceptance.
Classes are not substituted or relabeled. The focused red/green logs are
supporting implementation evidence and do not create a current D/R PASS.

Ticket 06 closes only after D/R/M/Q evidence, one integrated review (G-M), and
exactly one final Supervisor acceptance (G-Q). Decision 0008 is not final
acceptance; the final decision filename and number are Decision 0009.

## 5. Serial route and gates

```text
frozen candidate2
  -> WP-01 PASS: same closed 19-file deterministic collection (303/303)
     (296 baseline + actual 7 focused additions; estimate 302 superseded)
  -> WP-02 READY: exactly one complete five-file attempt, no retry
  -> fresh owner authorization, WP-03 (M)
  -> fresh owner authorization after WP-03 PASS, WP-04 (Q)
  -> WP-05 exactly one integrated review (G-M)
  -> WP-06 exactly one final Supervisor Decision 0009 (G-Q)
  -> WP-07 closure/routing
```

WP-01's planning estimate `296 + 6 = 302` is superseded by the authoritative
producer result `296 + 7 = 303`: the pre-change containment collection
contributed seven new cases. The closed set remains the same 19 files, with no
missing or extra file and no broadening. WP-02 is now READY and must run its
five files exactly once, completely and serially, with no retry. Old WP-03/WP-04
authorizations are non-transferable and not executable.

## 6. WP contracts

### WP-01 — reset deterministic evidence (D)

**PASS.** At candidate2, the same closed 19-file deterministic set was
collected once, including `piSubagentLiveLifecycleContainment.test.ts`: 18 unit
files / 263 tests and one contracts file / 40 tests, for `19/19` files and
`303/303` tests, zero failed and zero skipped. The estimate `296 + 6 = 302` is
superseded because the pre-change containment collection contributed seven
new cases; there is no missing or extra file. Current logs, exact commands,
counts, exits, candidate SHA, detached-clean truth, zero candidate delta,
Alfie pin, protected-WIP hash, and explicit staging paths are recorded in the
six-path evidence transaction. Prior WP-01 logs/matrices remain historical.

### WP-02 — one new full non-destructive real-Pi run (R)

**READY after WP-01 PASS.** Run exactly the five existing standalone wallclock
files, serially, once, from a fresh candidate worktree with pinned Alfie and
isolated roots/HOME/state/ports. Preserve all historical logs. A nonzero leg,
unexpected skip, cleanup/provenance drift, candidate drift, protected-WIP drift,
or contradiction stops the attempt with no retry. WP-02 has not run in this
transaction.

### WP-03 and WP-04

WP-03 requires fresh owner authorization after the new five-leg WP-02 PASS and
is the exactly-one manual destructive M leg. WP-04 requires fresh owner
authorization after WP-03 PASS and is the exactly-one Q/report gate. Neither is
authorized or run by this package.

### WP-05 / WP-06 / WP-07

WP-05 performs exactly one integrated review after WP-01–WP-04. WP-06 performs
exactly one final Supervisor consultation after WP-05 PASS and persists
`decisions/0009-integrated-real-pi-acceptance-final-acceptance.md`. WP-07
closes/routes only after accepted Decision 0009 and all gates.

## 7. Exact implementation boundary and prohibited changes

The frozen behavioral candidate may touch only the two Decision 0008 containment
paths named in §2. No PiAdapter, coordinator, contracts, persistence,
orchestration, watchdog, teardown, canonical expectation, configuration,
manifest, lockfile, third source/test path, or Alfie change is allowed.

This WP-01 evidence transaction modifies only the six paths named in §9,
force-adds the two ignored current logs, and records producer outputs that ran
once before this transaction. It runs no producer, test, formatter, lint,
typecheck, destructive action, review, or Supervisor consultation.

## 8. Verification and stop gates

Before and after commit verify exactly the six staged paths, `git diff --check`,
clean index after commit, source-path absence from the evidence commit,
candidate reachability, exact lineage/deltas, current-log hashes, detached and
clean candidate truth, Alfie pin, and the protected-WIP hash record. Stop before
advancing on any candidate delta, provenance, protected-WIP, source, count, or
evidence contradiction. WP-01 D is PASS at `303/303`; WP-02 is only READY and
has not run.

The inherited manual destructive boundary remains unchanged: no automation,
PID guessing, external signalling, or retry. G-M and G-Q remain pending with
one reservation each.

## 9. Planning transaction and commit

Modify and stage exactly these six paths:

```text
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/PLAN.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-01-freeze-and-deterministic-evidence.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-01-decision0008-worktree-provenance.txt
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-01-decision0008-deterministic.log
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-01-decision0008-contracts.log
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-01-decision0008-ac-diagnostic-matrix.md
```

Commit message:

```text
test(pi): record Decision 0008 Ticket 06 deterministic evidence
```

No source implementation, test execution, WP-02 leg, gate, review, or
Supervisor consultation is part of this evidence transaction.
