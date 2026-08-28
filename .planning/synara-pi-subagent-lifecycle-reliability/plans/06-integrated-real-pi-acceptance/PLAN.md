# Ticket 06 Plan — integrated real-Pi acceptance

**Plan state:** Decision 0009 reassessment is persisted and aspect-scoped
**Authoritative**. Candidate `9b55649050b76feffdc4279ceaec92ac74a78686` is
frozen as candidate2's exact sole-parent four-file correction child, with six
distinct paths from `12fd6686`. WP-01 is ready on the unchanged closed 19-file
set; `308` is an estimate only pending the actual producer count. WP-02 is
blocked, no current D/R/Q PASS exists, and final acceptance remains Decision
0010.
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
- Historical candidate2: `2afef48b008527685658801d8f0d84c79e24827d`, the
  sole-parent child of `ffd45bd`.
- Frozen candidate: `9b55649050b76feffdc4279ceaec92ac74a78686`, the exact
  sole-parent child of candidate2 and the producer identity for the next route.
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

- Main integration merge: `cecc9d8ae62bd97b9c81be07d0cfb473a9862cc7`, with
  parents `0e828e0fe5daf273a6a0c04960494756ccdf204e` (planning) and the frozen
  candidate. The merge is integration provenance only and is never the producer
  identity.
- Production coordinator/configuration, canonical expectations, lockfiles, all
  other source/test paths, and Alfie remain unchanged.
- Alfie pin: `3fe340b401ca86bcbe8b55abd4de107e1d93482e` /
  `@alfie/pi-subagents@0.15.0-alfie.6`.
- Protected owner WIP remains outside this transaction, untouched and unstaged;
  required aggregate diff hash:
  `ab8f8f54fe818819721f737aa337156ed6348c7410c55083ce3a67785bb7eaa8`.

## 3. Focused implementation evidence

The frozen candidate's focused Decision 0009 evidence is copied byte-identically
into this plan's evidence directory. These logs are implementation evidence,
not current WP-01 D, WP-02 R, or WP-04 Q acceptance:

- `candidate3-decision0009-red.log`: exit 1; 2 files; 49 tests, 45 passed / 4
  failed; SHA-256 `4285cbdd33f6e4f76cc126133a6589396b8e133aca0522c6fdb1ef087115fbb9`.
- `candidate3-decision0009-green.log`: exit 0; 2 files; 49/49; SHA-256
  `2e22b5879ea1bc16d199e277e8aaa52b334cf81e9fb540841842cc1d4cef5a47`.
- `candidate3-decision0009-conflation-red.log`: exit 1; 2 files; 49 tests,
  1 failed; SHA-256 `363e2f7c3297f27a69425a13021cea0ea889cd8ac8161fc42e59a41268f4ffff`.
- `candidate3-decision0009-conflation-green.log`: exit 0; 2 files; 50/50;
  SHA-256 `d9d1f4f351b0e4598b5699c1e5ca5e73919c49a82e39083c8ff964e8f8c106be`.

The pre-freeze review fixed route-inactive conflation and amended the candidate.
Decision 0009's reason mapping is exact-marker-only: the exact structured
`pi_subagent_managed_execution_unavailable_live` marker may yield internal
`unavailableReason: provider_inactive` only on an unavailable result; an
unaccepted control maps to `pi_subagent_read_live_record_unavailable`, while
observation and generic route-inactive (`provider_route_inactive`) remain
`pi_subagent_live_lifecycle_unavailable`. Provider text is never parsed, and
no accepted effect or public reason is claimed.

A delegated worker also ran heavyweight typecheck/lint and targeted format
validation without user authorization. This factual incident is
non-authoritative, not WP-04/Q evidence or a gate, no current quality pass is
claimed, and it was not rerun. Candidate2's WP-01 producer records remain
historical supporting evidence only; the frozen candidate requires a fresh
WP-01 collection and actual count.

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
frozen candidate `9b55649050b76feffdc4279ceaec92ac74a78686`
  -> WP-01 ready: exact closed 19-file D collection (actual count recorded;
     `308` is estimate only)
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

**READY.** Candidate `9b55649050b76feffdc4279ceaec92ac74a78686` is frozen as
candidate2's exact sole-parent correction child. Run the same closed 19-file
set exactly once and record the actual producer file/test count, exact commands,
exits, skips, candidate SHA, detached-clean truth, six-path total from
`12fd6686`, Alfie pin, protected-WIP hash, and explicit staging paths.
Candidate2's actual `303` tests plus five focused tests make `308` an estimate
only, not a result; do not broaden the set. A failure or unexpected skip stops
the route.

### WP-02 — one new full non-destructive real-Pi run (R)

**BLOCKED until fresh WP-01 PASS.** Candidate2's challenged attempt remains
historical supporting evidence only; it has no current R PASS and no retry.
The frozen candidate's focused logs do not unlock WP-02. The next attempt, when
unblocked, is exactly one complete five-file non-destructive real-Pi run,
serially and without retry. No quality command or other gate substitutes for
that route.

The trace showed containment discarding the structured provider classification.
The frozen candidate records the Decision 0009 correction: preserve internal
`unavailableReason` only on `status: "unavailable"`; the exact structured marker
maps an unaccepted control with `provider_inactive` to
`pi_subagent_read_live_record_unavailable`, while observation and generic
route-inactive remain `pi_subagent_live_lifecycle_unavailable`. The reason is
not public or durable, provider text is never parsed, and the attempted
`applied`-without-acceptance interpretation is rejected. The pre-freeze review
also fixed route-inactive conflation. WP-02 remains blocked until WP-01 PASS.

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

This planning transaction modifies exactly the ten paths named in §9,
including four byte-identical focused evidence logs and their provenance record.
It runs no producer, test, formatter, lint, typecheck, destructive action,
review, or Supervisor consultation.

## 8. Verification and stop gates

Verify before and after commit exactly the ten staged planning paths,
`git diff --check`, clean index after commit, no source or unrelated-log changes,
candidate reachability, sole-parent lineage, exact four-file delta and six-path
total from `12fd6686`, byte-identical copied-log hashes, Alfie pin, and the
protected-WIP hash record. Stop before advancing on any candidate, provenance,
protected-WIP, source, count, or evidence contradiction. Candidate2 D/R and the
focused candidate3 logs remain supporting only; WP-01 is ready with `308` as an
estimate only, WP-02 is blocked, and all downstream gates remain blocked until
the serial route. The unauthorized heavyweight command incident is not a
quality pass or gate and is not rerun.

The inherited manual destructive boundary remains unchanged: no automation,
PID guessing, external signalling, or retry. G-M and G-Q remain pending with
one reservation each.

## 9. Planning transaction and commit

Modify and stage exactly these ten planning paths:

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
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/candidate3-decision0009-red.log
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/candidate3-decision0009-green.log
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/candidate3-decision0009-conflation-red.log
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/candidate3-decision0009-conflation-green.log
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/candidate3-decision0009-provenance.txt
```

Commit message:

```text
docs(planning): freeze Decision 0009 Ticket 06 candidate
```

No source implementation, test execution, retry, destructive run, quality gate,
integrated review, or final-acceptance consultation is part of this planning
transaction. The four focused logs are copied byte-identically; no source change
is made. The unauthorized heavyweight typecheck/lint/targeted-format incident
is recorded as non-authoritative and non-Q, with no current quality pass and no
rerun. All downstream gates remain blocked pending the fresh route.
