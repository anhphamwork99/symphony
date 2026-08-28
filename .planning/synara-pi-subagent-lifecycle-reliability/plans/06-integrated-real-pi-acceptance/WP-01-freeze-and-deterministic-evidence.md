# WP-01 — freeze correction candidate and collect deterministic evidence

**State:** READY — candidate `9b55649050b76feffdc4279ceaec92ac74a78686`
is frozen as the exact sole-parent correction child of candidate2. Candidate2's
actual `303` tests are historical supporting evidence only; `308` is an estimate
only pending this producer's actual count.
**Candidate2:** `2afef48b008527685658801d8f0d84c79e24827d`, the sole-parent child
of `ffd45bd867e94c9003415f5f2e937cc9c616e399`.
**Authority:** [Decision 0009](../../decisions/0009-reassessment-structured-provider-unavailable-preservation.md)
is aspect-scoped **Authoritative** for the exact four-file correction and
rebaseline; Decisions 0007/0008 remain authoritative for their separate
historical aspects.

## Objective and disposition

The frozen candidate must run the same closed 19-file deterministic set exactly
once. Record the actual producer-collected file and test count; do not reuse
candidate2's historical `19/19`, `303/303`, zero-failure/zero-skip result and do
not broaden the set. Candidate2's `303` plus five focused implementation tests
makes `308` an estimate only, subject to the actual producer result. This
planning transaction does not run WP-01.

Historical candidate2 evidence files:

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

- Candidate2 is historical producer identity, never the integration merge. Its
  exact delta from `ffd45bd` is only:
  `apps/server/src/provider/piSubagentLiveLifecycleContainment.ts` and
  `apps/server/src/provider/piSubagentLiveLifecycleContainment.test.ts`.
- Candidate2's total delta from `12fd6686` is the two Decision 0007 fixture
  paths plus the two containment paths.
- Frozen candidate `9b55649050b76feffdc4279ceaec92ac74a78686` is one exact
  recorded sole-parent child of candidate2. Its correction delta is exactly
  these four existing paths:
  `apps/server/src/provider/piSubagentLiveLifecycleContainment.ts`,
  `apps/server/src/provider/piSubagentLiveLifecycleContainment.test.ts`,
  `apps/server/src/provider/piSubagentManagedRuntimeBinding.ts`, and
  `apps/server/src/provider/piSubagentCanonicalRouting.test.ts`.
- Its total distinct delta from `12fd6686` is exactly six paths.
- Candidate2 is detached and clean; the producer collection introduced no
  source or candidate-surface delta.
- Alfie is pinned to
  `3fe340b401ca86bcbe8b55abd4de107e1d93482e` /
  `@alfie/pi-subagents@0.15.0-alfie.6`, clean except for ignored dependency
  and build outputs.
- Protected owner WIP remains untouched and unstaged with aggregate diff hash
  `ab8f8f54fe818819721f737aa337156ed6348c7410c55083ce3a67785bb7eaa8`.
- Exact historical commands, outputs, hashes, and explicit staging paths are
  recorded in the provenance file. The historical logs were force-added because
  `*.log` is ignored.

## Closed 19-file set

The set is unchanged from the frozen plan: the 18 unit files are listed in
`evidence/WP-01-decision0008-worktree-provenance.txt` under the exact producer
command, plus `packages/contracts/src/piSubagents.test.ts`. The containment
file remains included exactly once in the unit producer.

## Acceptance and next route

A future WP-01 PASS is D-class deterministic evidence only. It does not claim
R, M, Q, integrated review, or final Supervisor acceptance. The fresh collection
must preserve Decision 0009's mapping: internal `unavailableReason` only on an
unavailable result; control `provider_inactive` maps to
`pi_subagent_read_live_record_unavailable`; observation and generic unavailable
remain generic; no public reason or applied/acceptance lie.

After the fresh WP-01 PASS, WP-02 is authorized only as exactly one complete
five-file non-destructive real-Pi attempt, serially and without retry. No
producer or test rerun occurs in this planning transaction.

## Commit boundary

Future WP-01 evidence is limited to its permitted D logs, matrix, provenance,
and this WP file. The four focused candidate3 logs are supporting implementation
evidence only and do not satisfy WP-01. This freeze transaction stages exactly
the ten paths listed in PLAN §9.

No WP-01 producer or test rerun occurs in this transaction. The transactional
write set is exactly the ten paths listed in PLAN §9.

Commit message for this planning transaction:

```text
docs(planning): freeze Decision 0009 Ticket 06 candidate
```
