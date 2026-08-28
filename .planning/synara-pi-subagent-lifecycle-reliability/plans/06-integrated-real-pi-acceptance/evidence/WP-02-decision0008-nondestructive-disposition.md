# WP-02 Decision 0008 candidate non-destructive disposition

**Date:** 2026-08-28 (local, UTC+7)
**Disposition:** **CHALLENGED — historical supporting evidence only**
**Candidate:** `2afef48b008527685658801d8f0d84c79e24827d`
**No current WP-02 R PASS. No retry.**

## 1. Executed scope and exact outcome

This candidate2 attempt ran the first two authorized standalone producers
serially. The integrated producer passed and the canonical-identity producer
failed; the first nonzero exit stopped the attempt. The later three producers
were not run.

| Leg | HOME isolation / cleanup | Result |
|---|---|---|
| `piSubagentRealPiAcceptance.test.ts` | fresh HOME `tmp.k0HG`; cleanup PASS | 10 passed, 1 expected skip; exit 0 |
| `piSubagentCanonicalIdentityAcceptance.test.ts` | fresh HOME `tmp.Td4`; cleanup PASS | 8 passed, 1 failed; exit 1 |

The integrated skip was exactly the expected manual destructive test. No
unexpected skip, destructive operation, PID enumeration/signalling, quality
gate, review, or Supervisor consultation ran.

## 2. Completed trace and material mismatch

At `piSubagentCanonicalIdentityAcceptance.test.ts:913`, terminal-first asserted:

```text
expected: pi_subagent_read_live_record_unavailable
received: pi_subagent_live_lifecycle_unavailable
```

The containment seam discarded the structured provider classification. The
terminal-first control was unaccepted, so it cannot be relabeled `applied`; no
provider acceptance, SDK insertion, retry, second action, or duplicate action
is established by this trace. The enqueue-first strand separately passed with
`applied`, exactly one session steer, and one SDK insertion, but it does not
repair terminal-first and is not a five-file WP-02 PASS.

## 3. Decision 0009 route

Decision 0009 is aspect-scoped **Authoritative** and selects internal
`unavailableReason` preservation. The reason may exist only on an internal
`status: "unavailable"` result. The managed binding maps an unaccepted control
with `provider_inactive` to `pi_subagent_read_live_record_unavailable`.
Observation and generic unavailable cases remain
`pi_subagent_live_lifecycle_unavailable`. The reason is never public, durable,
or parsed from provider text.

The exact correction boundary is four existing files:

```text
apps/server/src/provider/piSubagentLiveLifecycleContainment.ts
apps/server/src/provider/piSubagentLiveLifecycleContainment.test.ts
apps/server/src/provider/piSubagentManagedRuntimeBinding.ts
apps/server/src/provider/piSubagentCanonicalRouting.test.ts
```

The new candidate is one sole-parent child of candidate2. Its total distinct
delta from `12fd6686` is exactly six paths: the two Decision 0007 fixture paths
plus those four correction paths. No fifth behavioral file or public/schema,
configuration, lockfile, manifest, or Alfie change is authorized.

## 4. Downstream stop state

The required route is: correction child and freeze → fresh WP-01 on the
unchanged closed 19-file set with actual count → exactly one complete fresh
five-file WP-02 → fresh owner WP-03 → fresh owner WP-04 → WP-05 one integrated
review → WP-06 one final Supervisor Decision 0010 → WP-07 closure. Candidate2
D/R records cannot satisfy the new route. WP-03 through WP-07 remain blocked,
and no retry or missing-leg rerun is permitted.

## 5. Preservation boundary

The two raw owner-checkout logs remain byte-identical under their existing
Decision 0008 filenames. This derivative disposition does not rewrite raw logs,
source, tests, configuration, lockfiles, Alfie, protected owner WIP, or runtime
artifacts. Protected WIP remains unstaged with aggregate hash
`ab8f8f54fe818819721f737aa337156ed6348c7410c55083ce3a67785bb7eaa8`.
