# WP-01 — freeze correction candidate and collect deterministic evidence

**State:** PASS — candidate `9b55649050b76feffdc4279ceaec92ac74a78686` ran the
closed 19-file deterministic set exactly once with actual `19/19` files and
`306/306` tests, zero failures, and zero skips. The planning estimate `308` is
superseded by the actual producer count: candidate3 added three focused net
cases to candidate2's historical `303`, for `303 + 3 = 306`. WP-02 is **READY**
for exactly one complete five-file non-destructive real-Pi attempt, serially
and without retry.
**Candidate2:** `2afef48b008527685658801d8f0d84c79e24827d`, the sole-parent child
of `ffd45bd867e94c9003415f5f2e937cc9c616e399`. Its actual `303` result is
historical supporting evidence only and is not reused as current evidence.
**Authority:** [Decision 0009](../../decisions/0009-reassessment-structured-provider-unavailable-preservation.md)
is aspect-scoped **Authoritative** for the exact four-file correction and
rebaseline; Decisions 0007/0008 remain authoritative for their separate
historical aspects.

## Objective and disposition

The frozen candidate ran the same closed 19-file deterministic set exactly once.
The actual producer-collected file and test count is recorded; candidate2's
historical `19/19`, `303/303`, zero-failure/zero-skip result was not reused and
the set was not broadened. The planning estimate `303 + 5 = 308` was an estimate
only and is superseded by the actual `303 + 3 = 306`. This evidence transaction
does not run WP-02 or any later gate.

Current WP-01 D evidence files:

- `evidence/WP-01-decision0009-deterministic.log` — exit 0; 18/18 files;
  266/266 tests; duration 16.34s;
- `evidence/WP-01-decision0009-contracts.log` — exit 0; 1/1 file; 40/40
  tests; duration 223ms;
- `evidence/WP-01-decision0009-worktree-provenance.txt` — exact commands,
  candidate lineage/deltas, detached-clean checks, Alfie pin, protected WIP,
  producer counts, log hashes, and transaction scope;
- `evidence/WP-01-decision0009-ac-diagnostic-matrix.md` — current-log-backed
  AC2/3/4/5/7 and Decision 0009 positive/failure coverage.

Historical WP-01 evidence (renewed, decision0008, and the original candidate2
records) remains preserved and is not cited as current D evidence.

## Required candidate and provenance

- Candidate2 is historical producer identity, never the integration merge. Its
  exact delta from `ffd45bd` is only:
  `apps/server/src/provider/piSubagentLiveLifecycleContainment.ts` and
  `apps/server/src/provider/piSubagentLiveLifecycleContainment.test.ts`.
- Candidate2's total delta from `12fd6686` is the two Decision 0007 fixture
  paths plus the two containment paths.
- Frozen candidate `9b55649050b76feffdc4279ceaec92ac74a78686` is the exact
  recorded sole-parent child of candidate2. Its correction delta is exactly
  these four existing paths:
  `apps/server/src/provider/piSubagentLiveLifecycleContainment.ts`,
  `apps/server/src/provider/piSubagentLiveLifecycleContainment.test.ts`,
  `apps/server/src/provider/piSubagentManagedRuntimeBinding.ts`, and
  `apps/server/src/provider/piSubagentCanonicalRouting.test.ts`.
- Its total distinct delta from `12fd6686` is exactly six paths.
- The candidate is detached and clean; the producer collection introduced no
  source or candidate-surface delta.
- Alfie is pinned to
  `3fe340b401ca86bcbe8b55abd4de107e1d93482e` /
  `@alfie/pi-subagents@0.15.0-alfie.6`, clean except for ignored dependency
  and build outputs.
- Protected owner WIP remains untouched and unstaged with aggregate diff hash
  `ab8f8f54fe818819721f737aa337156ed6348c7410c55083ce3a67785bb7eaa8`.
- Exact commands, outputs, hashes, and explicit staging paths are recorded in
  the provenance file. The two current logs were force-added because `*.log`
  is ignored.

## Closed 19-file set

The set is unchanged from the frozen plan: the 18 unit files are listed in
`evidence/WP-01-decision0009-worktree-provenance.txt` under the exact producer
command, plus `packages/contracts/src/piSubagents.test.ts`. The containment
file remains included exactly once in the unit producer. The producer result
confirms no missing file and no extra file.

## Acceptance and next route

WP-01 PASS is D-class deterministic evidence only. It does not claim R, M, Q,
integrated review, or final Supervisor acceptance. The fresh collection
preserves Decision 0009's mapping: internal `unavailableReason` only on an
unavailable result; control `provider_inactive` maps to
`pi_subagent_read_live_record_unavailable`; observation and generic unavailable
remain generic; no public reason or applied/acceptance lie.

WP-02 is now authorized as exactly one complete five-file non-destructive
real-Pi attempt, serially and without retry, subject to its existing stop
gates. No producer or test rerun occurred in this transaction.

## Commit boundary

WP-01 evidence is limited to its permitted D logs, matrix, provenance, and
updates to this WP file and PLAN.md. The four focused candidate3 logs are
supporting implementation evidence only and do not satisfy WP-01. This
evidence transaction stages exactly the six paths listed in PLAN §9.

No WP-01 producer or test rerun occurs in this transaction. The transactional
write set is exactly the six paths listed in PLAN §9.

Commit message for this evidence transaction:

```text
test(pi): record Decision 0009 Ticket 06 deterministic evidence
```
