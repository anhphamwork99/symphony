# WP-01 — Decision 0008 deterministic evidence at frozen candidate2

**State:** **PASS** — deterministic evidence recorded at `303/303` with zero
failures and zero skips.
**Candidate:** `2afef48b008527685658801d8f0d84c79e24827d`, the exact detached,
clean sole-parent child of `ffd45bd867e94c9003415f5f2e937cc9c616e399`.
**Authority:** [Decision 0008](../../decisions/0008-reassessment-live-control-post-await-retirement-classification.md)
is Authoritative for the post-await retirement/replacement classification;
Decision 0007 remains authoritative for the fixture correction and historical
rebaseline.

## Objective and disposition

The same closed 19-file deterministic set was collected once at frozen
candidate2. The unit producer covered 18 files and 263 tests; the contracts
producer covered one file and 40 tests. Aggregate result: **19/19 files,
303/303 tests, 0 failed, 0 skipped**.

The planning estimate `296 + 6 = 302` is superseded by the authoritative
producer result. The pre-change containment collection contributed **seven**
new cases, so the actual total is `296 + 7 = 303`. There is no missing file and
no extra file. All prior WP-01 logs and matrices remain historical and were not
overwritten.

Current evidence files:

- `evidence/WP-01-decision0008-deterministic.log` — exit 0; 18/18 files;
  263/263 tests; duration 16.31s;
- `evidence/WP-01-decision0008-contracts.log` — exit 0; 1/1 file; 40/40
  tests; duration 257ms;
- `evidence/WP-01-decision0008-worktree-provenance.txt` — exact commands,
  candidate lineage/deltas, detached-clean checks, Alfie pin, protected WIP,
  producer counts, and transaction scope;
- `evidence/WP-01-decision0008-ac-diagnostic-matrix.md` — current-log-backed
  AC2/3/4/5/7 and Decision 0008 positive/failure coverage.

## Required candidate and provenance

- Candidate2 is the producer identity, never the integration merge. Its exact
  delta from `ffd45bd` is only:
  `apps/server/src/provider/piSubagentLiveLifecycleContainment.ts` and
  `apps/server/src/provider/piSubagentLiveLifecycleContainment.test.ts`.
- Its total delta from `12fd6686` is exactly four authorized paths: those two
  containment paths plus `apps/server/src/provider/piSubagentRealPiAcceptance.test.ts`
  and `apps/server/src/provider/piSubagentRealPiAcceptanceHelpers.ts`.
- Candidate2 is detached and clean; the producer collection introduced no
  source or candidate-surface delta.
- Alfie is pinned to
  `3fe340b401ca86bcbe8b55abd4de107e1d93482e` /
  `@alfie/pi-subagents@0.15.0-alfie.6`, clean except for ignored dependency
  and build outputs.
- Protected owner WIP remains untouched and unstaged with aggregate diff hash
  `ab8f8f54fe818819721f737aa337156ed6348c7410c55083ce3a67785bb7eaa8`.
- Exact commands, outputs, hashes, and explicit staging paths are recorded in
  the provenance file. The two current logs are force-added because `*.log`
  is ignored.

## Closed 19-file set

The set is unchanged from the frozen plan: the 18 unit files are listed in
`evidence/WP-01-decision0008-worktree-provenance.txt` under the exact producer
command, plus `packages/contracts/src/piSubagents.test.ts`. The containment
file remains included exactly once in the unit producer.

## Acceptance and next route

WP-01 is **PASS** only for D-class deterministic evidence. The matrix records
positive and material failure/diagnostic evidence for T06-AC2, T06-AC3,
T06-AC4, T06-AC5, and T06-AC7, including Decision 0008's new same-registration
retirement and replacement/invalidation classifications. It does not claim
R, M, Q, integrated review, or final Supervisor acceptance.

WP-02 is **READY** for exactly one complete five-file non-destructive real-Pi
attempt, serially and without retry, after its required fresh authorization.
No WP-02 leg, test rerun, destructive action, quality gate, review, or
Supervisor consultation occurred in this transaction.

## Commit boundary

This transaction modifies and stages exactly these six paths:

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
