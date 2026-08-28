# Ticket 06 Plan — integrated real-Pi acceptance

**Plan state:** Decision 0008 containment candidate frozen; WP-01 is ready for
producer collection. Candidate2 is `2afef48b008527685658801d8f0d84c79e24827d`.
There is no current D/R PASS. The focused red/green logs are preserved
implementation evidence only. This planning transaction runs no producer,
test, quality gate, review, or Supervisor consultation.
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
acceptance and not WP-02 R acceptance. No producer ran in this package.

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
  -> WP-01 ready: same closed 19-file deterministic collection
     (296 baseline + 6 focused additions = expected 302; producer count required)
  -> exactly one new full five-file WP-02
  -> fresh owner authorization, WP-03 (M)
  -> fresh owner authorization after WP-03 PASS, WP-04 (Q)
  -> WP-05 exactly one integrated review (G-M)
  -> WP-06 exactly one final Supervisor Decision 0009 (G-Q)
  -> WP-07 closure/routing
```

WP-01's expected aggregate is `296 + 6 = 302`, subject to confirmation of the
actual producer-collected count. The closed set must remain the same 19 files;
no broadening is allowed. WP-02 is blocked until WP-01 PASS and must run its
five files exactly once, serially, with no retry. Old WP-03/WP-04 authorizations
are non-transferable and not executable.

## 6. WP contracts

### WP-01 — reset deterministic evidence (D)

**Ready.** At candidate2, rerun the same closed 19-file deterministic set,
including `piSubagentLiveLifecycleContainment.test.ts`. Preserve the 296-test
historical baseline and collect the six new focused cases for an expected 302;
record and verify the actual producer count before accepting D evidence. Record
all positive and material failure rows, exact candidate SHA, zero source delta
after freeze, Alfie pin, protected-WIP hash, and explicit staging paths. The
focused red/green logs are not a substitute for this producer run.

### WP-02 — one new full non-destructive real-Pi run (R)

**Blocked pending WP-01 PASS.** Run exactly the five existing standalone
wallclock files, serially, once, from a fresh candidate worktree with pinned
Alfie and isolated roots/HOME/state/ports. Preserve all historical logs. A
nonzero leg, unexpected skip, cleanup/provenance drift, candidate drift,
protected-WIP drift, or contradiction stops the attempt with no retry.

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

This planning transaction modifies only the eight paths named in §9, copies the
two raw logs byte-identically, and runs no producer, test, formatter, lint,
typecheck, destructive action, review, or Supervisor consultation.

## 8. Verification and stop gates

Before and after commit verify exact staged paths, `git diff --check`, clean
index after commit, source path absence from the planning commit, candidate
reachability, exact lineage/deltas, raw-log hashes, Alfie pin, and the protected
WIP hash record. Stop before advancing on any candidate delta, provenance,
protected-WIP, source, count, or evidence contradiction. No current D/R PASS is
claimed.

The inherited manual destructive boundary remains unchanged: no automation,
PID guessing, external signalling, or retry. G-M and G-Q remain pending with
one reservation each.

## 9. Planning transaction and commit

Modify and stage exactly these eight paths:

```text
.planning/synara-pi-subagent-lifecycle-reliability/PROJECT.md
.planning/synara-pi-subagent-lifecycle-reliability/issues/06-integrated-real-pi-acceptance.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/PLAN.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-01-freeze-and-deterministic-evidence.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-02-non-destructive-real-pi-evidence.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/candidate2-containment-red.log
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/candidate2-containment-green.log
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/candidate2-rebaseline-provenance.txt
```

Commit message:

```text
docs(planning): freeze Decision 0008 Ticket 06 candidate
```

No source implementation, test execution, or producer execution is part of
this planning transaction.
