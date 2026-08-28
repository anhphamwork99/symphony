# WP-02 Decision 0008 candidate non-destructive disposition

**Date:** 2026-08-28 (local, UTC+7)
**Disposition:** **CHALLENGED — historical supporting evidence only**
**Candidate:** `2afef48b008527685658801d8f0d84c79e24827d`
**No current WP-02 R PASS. No retry.**

## 1. Executed scope and exact outcome

This candidate attempt ran the first two authorized standalone producers
serially. The integrated producer passed and the canonical-identity producer
failed; the first nonzero exit stopped the attempt. The later three producers
were not run.

| Leg | HOME isolation / cleanup | Result |
|---|---|---|
| `piSubagentRealPiAcceptance.test.ts` | fresh HOME `tmp.k0HG`; cleanup PASS | 10 passed, 1 expected skip; exit 0 |
| `piSubagentCanonicalIdentityAcceptance.test.ts` | fresh HOME `tmp.Td4`; cleanup PASS | 8 passed, 1 failed; exit 1 |

The integrated skip was exactly the expected manual destructive test. No
unexpected skip occurred. No destructive operation, PID enumeration/signalling,
quality gate, review, or Supervisor consultation ran. The complete provenance
and raw-log hashes are recorded in
`WP-02-decision0008-realpi-provenance.txt`.

## 2. Completed trace: enqueue-first PASS

The canonical enqueue-first strand completed with:

```text
result                  : applied
sessionSteerInvocations  : 1
sdkInsertions            : 1
```

Its causal trace reached the exact production tool call, manager invocation,
exact live tuple/held child, live-guard pass, session-steer invocation, one
synchronous SDK insertion, promise hold/release, bridge-index retirement,
durable seq-40 commit, post-await generation pass, bookkeeping, and settlement.
The raw log is the byte-identical record of this completed trace:

`evidence/WP-02-decision0008-canonical-identity-acceptance.log`
SHA-256: `bf1cd51eaa9e8b81833951e9f95e0d64934044393e98b760881da168731c59d1`

This is a PASS for the enqueue-first trace only. It is not a five-file WP-02
PASS and does not erase the terminal-first failure.

## 3. Terminal-first failure and source-grounded challenge

At `piSubagentCanonicalIdentityAcceptance.test.ts:913`, terminal-first asserted:

```text
expected: pi_subagent_read_live_record_unavailable
received: pi_subagent_live_lifecycle_unavailable
```

The trace proves that containment discarded the structured provider
classification. The terminal-first control was unaccepted, so its result
cannot be relabeled `applied`; doing so would claim a provider effect without
the provider-owned acceptance boundary. **Applied-without-acceptance is
rejected.**

The exact material choice is whether the existing two-file containment
boundary can preserve the structured value or whether the binding must widen.
This is a Supervisor reassessment item, not an implementation decision for this
transaction.

## 4. Required Supervisor reassessment before source

Supervisor must reassess and authorize one of these designs before any source
change:

- **Option A — same two files:** extend the
  `PiSubagentLiveLifecycleDiagnosticCode` union/array in
  `piSubagentLiveLifecycleContainment.ts` and its focused test, and map the
  unaccepted `provider_inactive` control to
  `pi_subagent_read_live_record_unavailable`.
- **Option B — third binding file/value preservation:** authorize a third
  binding file or equivalent value-preservation seam if the structured
  provider classification cannot be carried within the two-file boundary.

No source, test, contract, schema, configuration, lockfile, or Alfie change is
authorized by this evidence record. The current candidate remains challenged
historical evidence only until the reassessment resolves the boundary.

## 5. Downstream stop state

The candidate attempt did not complete all five legs. Therefore:

- WP-02 has no current R PASS and cannot authorize WP-03;
- WP-03's manual destructive leg is blocked;
- WP-04's quality/report gate is blocked;
- WP-05's integrated review is blocked;
- WP-06's final Supervisor acceptance is blocked; and
- WP-07 closure/routing is blocked.

The required route is Supervisor reassessment → any explicitly authorized exact
source correction/candidate → renewed WP-01 → one renewed complete five-file
WP-02 → fresh downstream authorizations. No retry is permitted for this
candidate attempt.

## 6. Transaction and preservation boundary

The two raw logs were copied byte-identically from the owning checkout
`/Users/anhpham99/symphony/.planning/.../evidence/` and are force-added under
the two Decision 0008 filenames. This planning/evidence-only transaction
modifies exactly six paths: PLAN.md, this WP-02 contract, this disposition,
the provenance record, and the two raw logs. Protected owner WIP remains
unstaged with its exact aggregate hash; no apps/packages/source path is
committed.
