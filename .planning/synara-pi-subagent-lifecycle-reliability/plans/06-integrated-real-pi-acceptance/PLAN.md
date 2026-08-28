# Ticket 06 Plan — integrated real-Pi acceptance

**Plan state:** Decision 0009 reassessment is persisted and aspect-scoped
**Authoritative**. Candidate2 `2afef48b008527685658801d8f0d84c79e24827d` and
its `303/303` WP-01 plus challenged WP-02 are historical supporting evidence
only. No new candidate, D/R PASS, producer, or acceptance exists. The next
candidate is an exact four-file correction child of candidate2; its total
distinct delta from `12fd6686` must be exactly six paths. Final acceptance is
renumbered Decision 0010.
**Date:** 2026-08-28

## 1. Objective and governing authorities

Prove the accepted Tickets 01–05 seams against the pinned real-Pi composition,
without changing their canonical expectations, by applying the exact Decision
0009 structured-unavailable correction and then resetting behavioral evidence at
a new sole-parent child of candidate2.

[Decision 0008](../../decisions/0008-reassessment-live-control-post-await-retirement-classification.md)
is binding and Authoritative only for post-await same-registration
retirement/replacement classification. [Decision 0007](../../decisions/0007-ticket-06-batching-fixture-causal-control-and-candidate-rebaseline.md)
remains Authoritative only for its historical fixture correction, rebaseline,
erratum, and gate-state aspects. [Decision 0009](../../decisions/0009-reassessment-structured-provider-unavailable-preservation.md)
is aspect-scoped **Authoritative** for internal `unavailableReason` preservation,
managed `provider_inactive` mapping, the exact four-file correction boundary,
candidate rebaseline, and downstream gates. It is not final acceptance;
Decision 0010 is reserved for that final Supervisor record. Decisions
0002/0003/0006 remain binding for canonical identity, synchronous provider
acceptance, terminal truth, and the other lifecycle invariants.

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

- Candidate2's total delta from `12fd6686` is the two Decision 0007 fixture
  paths plus the two containment paths.
- New candidate: one exact recorded sole-parent child of candidate2. Its
  correction delta is exactly:

  ```text
  apps/server/src/provider/piSubagentLiveLifecycleContainment.ts
  apps/server/src/provider/piSubagentLiveLifecycleContainment.test.ts
  apps/server/src/provider/piSubagentManagedRuntimeBinding.ts
  apps/server/src/provider/piSubagentCanonicalRouting.test.ts
  ```

- The new candidate's total distinct delta from `12fd6686` is exactly six
  paths: the two fixture paths plus those four correction paths.

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

These logs are focused implementation red/green evidence, not new-candidate
WP-01 D acceptance and not WP-02 R acceptance. Candidate2's WP-01 producer
records are historical supporting evidence only. The new candidate requires a
fresh WP-01 collection and actual count.

## 4. Evidence classes and acceptance

P = planning/provenance; D = deterministic; R = controlled real-Pi
non-destructive; M = exactly-one owner-authorized manual destructive leg; Q =
quality gate; H = historical supporting-only; A = review and acceptance.
Classes are not substituted or relabeled. The focused red/green logs are
supporting implementation evidence and do not create a current D/R PASS.

Ticket 06 closes only after fresh D/R/M/Q evidence, one integrated review (G-M),
and exactly one final Supervisor acceptance (G-Q). Decision 0009 is not final
acceptance; the final Supervisor record is Decision 0010.

## 5. Serial route and gates

```text
candidate2 `2afef48b`
  -> exact four-file correction child; freeze SHA
  -> WP-01 fresh closed 19-file D collection (actual count recorded)
  -> exactly one new complete five-file WP-02 R attempt
  -> fresh owner authorization, WP-03 (M)
  -> fresh owner authorization after WP-03 PASS, WP-04 (Q/report)
  -> WP-05 exactly one integrated review (G-M)
  -> WP-06 exactly one final Supervisor Decision 0010 (G-Q)
  -> WP-07 closure/routing
```

The historical candidate2 WP-01 result was `19/19`, `303/303`, zero failures
and skips; it is not reused. The new candidate must rerun the same closed set
and record its actual count. The candidate2 WP-02 attempt is
stopped/challenged after the canonical-identity nonzero exit; its two raw
Decision 0008 logs and provenance are historical supporting evidence only. The
completed enqueue-first trace is a PASS for that trace, but the terminal-first
classification mismatch means there is no current R PASS. WP-03/WP-04/WP-05/
WP-06/WP-07 remain blocked and no retry is authorized.

## 6. WP contracts

### WP-01 — reset deterministic evidence (D)

**READY after candidate freeze.** Run the same closed 19-file deterministic
set exactly once at the new sole-parent correction child. Record the actual
producer file/test count, exact commands, exits, skips, candidate SHA,
detached-clean truth, six-path total from `12fd6686`, Alfie pin,
protected-WIP hash, and explicit staging paths. Candidate2's `19/19`, `303/303`
result is historical supporting evidence only; do not broaden the set merely
because the correction includes binding/routing paths. A failure or unexpected
skip stops the route.

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
Decision 0009 resolves the material choice: preserve internal
`unavailableReason` only on `status: "unavailable"`; the managed binding maps
unaccepted control `provider_inactive` to `read_live_record_unavailable`, while
observation and generic unavailable remain generic. The reason is not public or
durable, provider text is never parsed, and the attempted
`applied`-without-acceptance interpretation is rejected. The exact four-file
correction and six-path total from `12fd6686` must be implemented and frozen
before the renewed route.

### WP-03 and WP-04

WP-03 requires fresh owner authorization after the new five-leg WP-02 PASS and
is the exactly-one manual destructive M leg. WP-04 requires fresh owner
authorization after WP-03 PASS and is the exactly-one Q/report gate. Neither is
authorized or run by this package.

### WP-05 / WP-06 / WP-07

WP-05 performs exactly one integrated review after WP-01–WP-04. WP-06 performs
exactly one final Supervisor consultation after WP-05 PASS and persists
`decisions/0010-integrated-real-pi-acceptance-final-acceptance.md`. WP-07
closes/routes only after accepted Decision 0010 and all gates.

## 7. Exact implementation boundary and prohibited changes

The new behavioral candidate may touch only the four Decision 0009 paths named
in §3. No PiAdapter, coordinator, contracts/schema, persistence, orchestration,
watchdog, teardown, canonical expectation, configuration, manifest, lockfile,
fifth source/test path, or Alfie change is allowed.

This planning transaction modifies only the twelve planning paths named in §9
and does not modify raw logs. It runs no producer,
test, formatter, lint, typecheck, destructive action, review, or Supervisor
consultation.

## 8. Verification and stop gates

Verify before and after commit exactly the twelve staged planning paths,
`git diff --check`, clean index after commit, no raw-log/source/index changes,
candidate reachability, sole-parent lineage, exact four-file delta and six-path
total from `12fd6686`, byte-identical raw-log hashes, HOME cleanup records,
Alfie pin, and the protected-WIP hash record. Stop before advancing on any
candidate, provenance, protected-WIP, source, count, or evidence contradiction.
Candidate2 D/R remains historical only; the new route has no current D/R PASS or
retry authority. All downstream gates remain blocked until the serial route.

The inherited manual destructive boundary remains unchanged: no automation,
PID guessing, external signalling, or retry. G-M and G-Q remain pending with
one reservation each.

## 9. Planning transaction and commit

Modify and stage exactly these twelve planning paths:

```text
.planning/synara-pi-subagent-lifecycle-reliability/PROJECT.md
.planning/synara-pi-subagent-lifecycle-reliability/issues/06-integrated-real-pi-acceptance.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/PLAN.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-01-freeze-and-deterministic-evidence.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-02-non-destructive-real-pi-evidence.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-03-manual-destructive-run.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-04-quality-gate-and-implementation-report.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-05-integrated-review.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-06-supervisor-final-acceptance.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-07-closure-and-routing.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-02-decision0008-nondestructive-disposition.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-02-decision0008-realpi-provenance.txt
```

Commit message:

```text
docs(planning): reassess Ticket 06 under Decision 0009
```

No source implementation, test execution, retry, destructive run, quality gate,
integrated review, or final-acceptance consultation is part of this planning
transaction. No raw log or source change is made; all historical failure details
remain preserved and all downstream gates are blocked pending the fresh route.
