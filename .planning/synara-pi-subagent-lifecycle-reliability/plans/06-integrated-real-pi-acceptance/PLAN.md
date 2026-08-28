# Ticket 06 Plan — integrated real-Pi acceptance

**Plan state:** Decision 0008 containment candidate remains frozen; WP-01 is
**PASS** with `19/19` files and `303/303` deterministic tests, zero failures,
and zero skips. Candidate2 is `2afef48b008527685658801d8f0d84c79e24827d`.
WP-02's candidate attempt is **CHALLENGED — historical supporting evidence
only**: the integrated leg passed (`10 passed, 1 expected skip`, exit 0), the
canonical-identity leg failed (`8 passed, 1 failed`, exit 1), and the later
three legs were not run because the first nonzero exit stopped the attempt.
There is no current WP-02 R PASS and no retry. The completed trace exposes a
material diagnostic-contract choice that must route to Supervisor reassessment
before any source change.
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
  -> WP-02 candidate attempt: CHALLENGED historical evidence only
     (integrated 10 passed + 1 expected skip, exit 0; canonical 8 passed /
      1 failed, exit 1; later three legs not run; no retry)
  -> Supervisor reassessment of the diagnostic-contract choice
  -> only after reassessment: authorized exact source correction/candidate
  -> renewed WP-01 -> one renewed full five-file WP-02
  -> fresh owner authorization, WP-03 (M)
  -> fresh owner authorization after WP-03 PASS, WP-04 (Q)
  -> WP-05 exactly one integrated review (G-M)
  -> WP-06 exactly one final Supervisor Decision 0009 (G-Q)
  -> WP-07 closure/routing
```

WP-01's planning estimate `296 + 6 = 302` is superseded by the authoritative
producer result `296 + 7 = 303`: the pre-change containment collection
contributed seven new cases. The closed set remains the same 19 files, with no
missing or extra file and no broadening. The candidate WP-02 attempt is
stopped/challenged after the canonical-identity nonzero exit; its two raw
Decision 0008 logs and provenance are historical supporting evidence only. The
completed enqueue-first trace is a PASS for that trace, but the terminal-first
classification mismatch means there is no current R PASS. A Supervisor
reassessment is required before source work; WP-03/WP-04/WP-05/WP-06/WP-07
remain blocked and no retry is authorized.

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

**CHALLENGED — historical supporting evidence only.** At candidate2, the
integrated producer completed `10 passed, 1 skipped` (the one expected manual
skip) with exit 0 under fresh HOME `tmp.k0HG` and cleanup PASS. The serial
canonical-identity producer then completed `8 passed, 1 failed` with exit 1
under fresh HOME `tmp.Td4` and cleanup PASS. Its terminal-first assertion at
`piSubagentCanonicalIdentityAcceptance.test.ts:913` expected
`pi_subagent_read_live_record_unavailable` but received the generic
`pi_subagent_live_lifecycle_unavailable`. Its enqueue-first trace separately
passed with `applied`, exactly one session steer and one SDK insertion. The
remaining lifecycle-containment, restart, and resume legs were not run after
fail-stop. The raw logs are preserved byte-identically in the two
`WP-02-decision0008-*` files. WP-02 has no current R PASS and no retry.

The trace shows containment discarding the structured provider classification.
Before any source change, this material choice is routed to Supervisor
reassessment: either option A extends the containment diagnostic union/array in
the same two files and maps unaccepted `provider_inactive` to
`read_live_record_unavailable`, or option B authorizes a third binding
file/value-preservation change. The attempted `applied`-without-acceptance
interpretation is rejected.

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

This planning/evidence transaction modifies only the six paths named in §9,
force-adds the two owner-checkout Decision 0008 logs byte-identically, and
records producer outputs that ran before this transaction. It runs no producer,
test, formatter, lint, typecheck, destructive action, review, or Supervisor
consultation.

## 8. Verification and stop gates

Before and after commit verify exactly the six staged paths, `git diff --check`,
clean index after commit, source-path absence from the evidence commit,
candidate reachability, exact lineage/deltas, byte-identical owner log copies
and hashes, HOME cleanup records, detached and clean candidate truth, Alfie pin,
and the protected-WIP hash record. Stop before advancing on any candidate delta,
provenance, protected-WIP, source, count, or evidence contradiction. WP-01 D
remains PASS at `303/303`; WP-02 is challenged historical evidence only, with
no current R PASS and no retry. All downstream gates remain blocked pending
Supervisor reassessment and the required renewed route.

The inherited manual destructive boundary remains unchanged: no automation,
PID guessing, external signalling, or retry. G-M and G-Q remain pending with
one reservation each.

## 9. Planning transaction and commit

Modify and stage exactly these six paths:

```text
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/PLAN.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-02-non-destructive-real-pi-evidence.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-02-decision0008-realpi-provenance.txt
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-02-decision0008-realpi-acceptance.log
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-02-decision0008-canonical-identity-acceptance.log
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-02-decision0008-nondestructive-disposition.md
```

Commit message:

```text
test(pi): record Decision 0008 canonical diagnostic challenge
```

No source implementation, test execution, retry, destructive run, quality
gate, integrated review, or final-acceptance consultation is part of this
planning/evidence transaction. The candidate attempt remains historical only;
all downstream gates are blocked pending Supervisor reassessment.
