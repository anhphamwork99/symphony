# Ticket 06 Plan — integrated real-Pi acceptance

**Plan state:** Decision 0008 reassessment/reset persisted before containment
implementation. Historical candidate `ffd45bd867e94c9003415f5f2e937cc9c616e399`,
historical WP-01 PASS, and the renewed WP-02 integrated-pass/canonical-failure
attempt are supporting only. The renewed attempt stopped after the canonical
failure; its raw logs, hashes, failure details, and spent no-retry state remain
immutable. No current D/R PASS exists.

**Aspect-scoped authorities:** [Decision 0008](../../decisions/0008-reassessment-live-control-post-await-retirement-classification.md)
is binding and Authoritative only for the post-await live-control retirement
classification and its exact correction boundary. [Decision 0007](../../decisions/0007-ticket-06-batching-fixture-causal-control-and-candidate-rebaseline.md)
remains Authoritative only for the batching-fixture correction, historical
rebaseline, attempt-3 erratum, and downstream state. Decisions 0002/0003/0006
remain binding for canonical identity, synchronous provider acceptance,
terminal truth, and all other lifecycle invariants.

**Date:** 2026-08-28

## 1. Objective and reassessment conclusion

Prove the accepted Tickets 01–05 seams against the pinned real-Pi composition,
without changing their canonical expectations, by first implementing the
Decision 0008 post-await classification correction and then resetting all
behavioral evidence at its frozen candidate.

The exact implementation write set is only:

```text
apps/server/src/provider/piSubagentLiveLifecycleContainment.ts
apps/server/src/provider/piSubagentLiveLifecycleContainment.test.ts
```

The correction distinguishes ordinary retirement of the same exact
registration/epoch from replacement or invalidation. It must cover all eight
Decision 0008 semantic rows, preserve provider-owned acceptance, and add no
retry, reconstruction, route restoration, replay, Resume, provider-ID/PID
authority, or terminal/cleanup/generation change. Any third file, canonical
expectation change, Alfie change, or broader seam is a stop/challenge requiring
another decision.

## 2. Candidate and evidence reset

- Historical base: `12fd6686edc26a3fa0382e8bdeb83a1be8045539`.
- Historical candidate: `ffd45bd867e94c9003415f5f2e937cc9c616e399`, the exact
  two-file Decision 0007 fixture child of the historical base. It is historical
  only, not the next producer candidate.
- New candidate: exact two-file containment child of `ffd45bd`; its SHA is
  unknown until implementation and must be recorded before evidence is
  accepted.
- New candidate delta from `ffd45bd`: exactly the two containment paths above.
- Total delta from `12fd6686`: exactly four files — the two Decision 0007
  fixture paths plus the two containment paths. Production coordinator,
  configuration, canonical expectations, all other source/test paths, lockfiles,
  and Alfie remain byte-identical/pinned.
- Integration merge `064b49f1d` is provenance only and never a producer identity.
- Pinned Alfie remains commit `3fe340b401ca86bcbe8b55abd4de107e1d93482e` /
  `@alfie/pi-subagents@0.15.0-alfie.6`; no Alfie source/pin change.
- Protected owner WIP remains outside this transaction and must stay unstaged,
  byte-identical, with required aggregate diff hash
  `ab8f8f54fe818819721f737aa337156ed6348c7410c55083ce3a67785bb7eaa8`.

The historical renewed WP-02 evidence reset is recorded in the two renewed
artifacts. Preserve the integrated PASS, canonical failure at lines 913/924,
not-run lifecycle/restart/resume legs, exact raw-log hashes, and no-retry state;
none is current proof for the corrected candidate.

## 3. Evidence classes and acceptance

P = planning/provenance; D = deterministic; R = controlled real-Pi
non-destructive; M = the exactly-one owner-authorized manual destructive leg;
Q = quality gate; H = historical supporting-only; A = review and acceptance
artifacts. Classes are not substituted or relabeled.

Ticket 06 closes only after D/R/M/Q evidence, one integrated review (G-M), and
exactly one final Supervisor acceptance (G-Q). Decision 0008 is not final
acceptance; the final decision filename and number are **Decision 0009**.

## 4. Serial route and gates

```text
ffd45bd historical candidate
  -> exact two-file containment implementation child
  -> freeze new candidate and record exact SHA
  -> rerun same closed WP-01 baseline (296 + exact focused additions)
  -> exactly one new full five-file WP-02
  -> fresh owner authorization, WP-03 (M)
  -> fresh owner authorization after WP-03 PASS, WP-04 (Q)
  -> WP-05 exactly one integrated review (G-M)
  -> WP-06 exactly one final Supervisor Decision 0009 (G-Q)
  -> WP-07 closure/routing
```

The expected WP-01 aggregate is not guessed before implementation: retain the
296-test baseline and record the exact added focused-case count and resulting
aggregate only after the two-file correction exists. WP-02 is a complete,
serial, exactly-once run of its five closed files; any nonzero leg, unexpected
skip, provenance drift, or diagnostic contradiction stops it with no retry.
Old WP-03/WP-04 authorizations are non-transferable and not executable.

## 5. WP contracts

### WP-01 — reset deterministic evidence (D)

Rerun the same 19-file closed set at the new candidate, including the
containment suite, with baseline 296 tests plus only the exact focused cases
introduced by the implementation. Record the expected aggregate after
implementation, all positive and material failure rows, exact candidate SHA,
zero source delta after freeze, Alfie pin, and protected-WIP/staging proofs.
The historical ffd WP-01 PASS is supporting only and cannot satisfy this gate.

### WP-02 — one new full non-destructive real-Pi run (R)

Run exactly the five existing standalone wallclock files, serially, once, from
a fresh candidate worktree with pinned Alfie and isolated roots/HOME/state/
ports. Preserve the historical renewed attempt unchanged. The new run must
prove canonical F5 terminal-first/enqueue-first behavior at the corrected
boundary, all required lifecycle/restart/resume rows, exact tuple traces,
cleanup/isolation, expected skip discipline, and no destructive claim.

### WP-03 — fresh owner manual destructive run (M)

Blocked until the new five-file WP-02 exits 0 and a fresh explicit owner
authorization is recorded. Exactly one isolated operator run only; the accepted
TERM→bounded-KILL owner-tree recipe is unchanged; no automation, PID guessing,
external signalling, or retry. Historical H evidence is supporting only.

### WP-04 — fresh owner quality gate and report (Q)

Blocked until the newly authorized WP-03 PASS and fresh explicit owner
authorization. Run the one `bun fmt` + `bun lint` + `bun typecheck` gate in the
isolated worktree; stop on formatter drift. Complete the issue Implementation
Report without evidence-class mixing.

### WP-05 / WP-06 / WP-07

WP-05 performs exactly one integrated review after WP-01–WP-04. WP-06 performs
exactly one final Supervisor consultation after WP-05 PASS and persists
`decisions/0009-integrated-real-pi-acceptance-final-acceptance.md`; it does not
edit or relabel Decision 0008. WP-07 closes/routs only after that accepted
Decision 0009 and all gates.

## 6. Exact implementation boundary and prohibited changes

No implementation is performed in this planning transaction. The later source
transaction may touch only the two Decision 0008 paths. It may not modify the
PiAdapter, completion coordinator, contracts, persistence, orchestration,
watchdog, teardown, canonical expectations, configuration, manifests,
lockfiles, Alfie source/pin, or any third test/source file.

No producer, test, formatter, lint, typecheck, destructive process action,
review, or Supervisor consultation is run by this reset. No raw log is edited.

## 7. Stop gates and reopening

Stop with `challenge` before advancing when any of the following occurs:

- the implementation needs a third file, changes canonical expectations,
  changes Alfie/source/configuration, or changes terminal/cleanup/generation
  semantics;
- the new candidate delta is not exactly two files from ffd and four total from
  `12fd6686`;
- Decision 0008's eight rows cannot be causally proven, or deterministic and
  real-Pi F5 disagree;
- any WP-01/WP-02 failure, unexpected skip, nonzero exit, retry, second
  provider action, replay, Resume, reconstruction, parent fallback, or route
  restoration appears;
- candidate/Alfie provenance, Pi acceptance-surface zero delta, protected WIP
  hash, raw-log hashes, or exact expected-skip/cleanup evidence drifts;
- any old authorization is treated as transferable, or WP-03 automation is
  proposed; or
- formatter drift, evidence-class mixing, premature review/acceptance, or a
  material reviewer/Supervisor finding occurs.

A challenge records candidate, command/exit, failing row, observed versus
required behavior, minimum gap, and the next material question. Historical
ffd/WP-01/current renewed WP-02 artifacts remain supporting and immutable.

## 8. Workspace and verification contract

Behavioral producers use fresh detached Symphony/Alfie worktrees, never the
main checkout or user Alfie checkout. Every producer records exact HEADs,
fixture hashes, environment restoration, isolation, and zero tracked delta.
The protected files remain unstaged and exact. Before and after the planning
commit verify:

```bash
git diff --check
git status --short
git diff --cached --name-only
git diff --name-only
printf 'protected: '; git diff -- apps/web/package.json apps/web/src/main.tsx bun.lock | shasum -a 256
git diff --name-only 12fd6686edc26a3fa0382e8bdeb83a1be8045539..HEAD -- apps packages
git hash-object .planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/*.log
```

The planning commit must contain exactly the 12 paths named below; no
`apps/`/`packages/` path may be in it, and after commit the index is clean.
Raw log hashes must equal their pre-transaction values. Do not run tests or
quality commands for this reset.

## 9. Planning transaction and commit

Modify and stage exactly these 12 paths:

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
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-02-renewed-nondestructive-disposition.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-02-renewed-realpi-provenance.txt
```

Commit message:

```text
docs(planning): reassess Ticket 06 under Decision 0008
```

No source implementation, test execution, or producer execution is part of
this transaction.
