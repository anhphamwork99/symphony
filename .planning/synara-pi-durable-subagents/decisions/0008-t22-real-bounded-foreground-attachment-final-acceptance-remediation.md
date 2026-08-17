# Decision 0008 — Ticket 22 final acceptance (remediation cycle)

**Status:** accepted (binding; supersedes Decision 0007 for Ticket 22 final
acceptance; Decisions 0001–0006 remain authoritative and unchanged).

**Date:** 2026-08-17

**Accepted candidate:**

- Symphony `8a5e8dacff7dadb18aded418bf63f0b035da6ebd`
- Alfie `82406bd834c5f52785fe8f3b65d316d3f8b3fd62` (pinned, clean, byte-identical to pin)

## Question

Does the remediated Ticket 22 candidate at Symphony `8a5e8dac` and Alfie
`82406bd8` satisfy T22-AC1 through T22-AC8 under Decisions 0001–0006, the
approved Testing Seams, and the owner's option-A timing adjudication, after
reconciling the independent reviewer's M1 and M2 findings?

## Governing references

Project Home; specification; Issue 22; Decisions 0001–0006; WP-05; WP-06;
WP-07; WP-08 and WP-08 challenge evidence. Decision 0007 is historical
reopening evidence and is superseded for this cycle.

## Lifecycle honored

Reopened acceptance → owner-adjudicated remediation (WP-06 Alfie; WP-07
Symphony) → WP-08 challenge with corrected root-cause attribution → owner
option-A adjudication (envelope `budget + 500 ms` unchanged; per-file
standalone invocations are the envelope acceptance method; WP-08 isolation
config kept) → exactly one independent feature-level re-review (reviewer
`8c103414`, RECOMMEND ACCEPT, high confidence, all ACs directly reproduced) →
M1 repaired pre-acceptance (`4866644e`) → one Project Supervisor
final-acceptance consultation → ACCEPT.

## Settled verdict

**Accept Ticket 22. T22-AC1 through T22-AC8 all pass.**

- **AC1:** real child completes through the real production boundary against
  the owner-approved deterministic model endpoint; successful inline output
  and status; accepted/started journal only; no detach or follow-up delivery.
- **AC2:** over-budget child returns the existing durable execution handle,
  no replacement; assertions remain exactly `budget + 500 ms`.
- **AC3:** detach changes only parent-tool attachment; execution/attempt/
  generation, concrete child, operation ownership, and `parent_turn`
  cancellation scope unchanged.
- **AC4:** seq1 accepted, seq2 started, seq3 detached-running commit in order;
  reopen recovers the same non-terminal aggregate and identities.
- **AC5:** `ServerConfigLive` resolves
  `SYNARA_PI_SUBAGENT_FOREGROUND_WAIT_MS` on the production path; default
  10000, valid values preserved, range rejection and invalid fallback
  exercised without clamping.
- **AC6:** two concurrent managed executions plus a real adjacent
  stripped-capability legacy Pi session retain independent timers,
  identities, journals, results, and semantics; legacy stays unbounded and
  unlabeled.
- **AC7:** WP-06 exactly-once post-detach settlement continuation removes
  `agentActivity`, marks the widget finished through the existing idle
  cleanup path, emits no notification or downstream terminal claim;
  settlement/abort/startup-failure/disposal/explicit-cleanup evidence
  preserves unrelated children.
- **AC8:** real-extension acceptance pinned to the exact Alfie commit and
  hashes; synthetic replacements cannot satisfy the evidence.

Reopened defects and evidence gaps fully reconciled: AC5 wiring fixed; AC7
cleanup fixed; AC1 proves successful completion; AC2 uses the exact envelope;
AC6 uses a real legacy session; lifecycle persistence failures are
error-shaped and not identity-stamped; provenance re-pinned to WP-06.

## Evidence

Criterion-level source and test evidence in the Issue 22 remediation report;
provenance SHA-256 independently recomputed by the reviewer; per-file
standalone envelope runs green (acceptance 6/6 reproduced repeatedly; reopen,
lifecycle, real-extension, main+config green); full server suite green 2×
after the M1 repair (371 files, 4384 passed | 17 skipped, exit 0); Alfie
extension suite 469/469 (bounded-foreground 17/17); M1 repair commit
`4866644e`; findings disposition at `8a5e8dac`.

## Recorded nonblocking risk — M2

JavaScript timer delivery and standalone wall-clock tests remain sensitive to
deliberate concurrent machine load (one reviewer standalone run exceeded the
envelope under induced load; dedicated loops and both full-suite runs green).
Consistent with Decision 0006's explicit assumption that a blocked event loop
cannot provide a hard wall-clock guarantee. Standing mitigation: use per-file
standalone invocations for envelope acceptance; preserve the harness
documentation in `apps/server/vitest.config.ts`.

## Rejected alternatives

- **Non-acceptance:** no criterion or Decision-0006 invariant remains failed;
  M1 already repaired and reverified.
- **Reassess or widen Decision 0006 §5:** the owner expressly retained
  `budget + 500 ms`; production-chain evidence satisfies it on a functioning
  event loop; contrary measurements are documented harness/load contention.
- **Another independent review:** the sole reviewer covered AC1–AC8 and
  identified M1 precisely; a competing package would violate the
  single-review lifecycle.
- **Remove WP-08 isolation:** the project split remains a strict harness
  improvement with integration discovery restored; it is not treated as the
  proof that eliminated the timing tail.

## Assumptions and residual uncertainty

Post-review full-suite outputs and clean final-worktree reports correspond to
the candidate hashes; all remediation commits are local and unpublished.
Hosted-provider completion behavior was not exercised (credentials
unavailable); the approved deterministic endpoint exercises the real Pi and
provider protocol boundary. A genuinely blocked event loop or non-settling
durable store still cannot guarantee wall-clock delivery.

## Downstream effect

Ticket 22 marked accepted/completed with evidence links; this record is the
authoritative Ticket 22 acceptance; blocker-free remediation frontier
advances to Ticket 23; Ticket 06 remains blocked until Ticket 24 is accepted.
All commits local-only; no publication, deployment, or release.

## Failure and rollback implications

The change is additive, capability-gated, and migration-free. Rolling back
Ticket 22 returns managed foreground execution to prior unbounded behavior
while leaving Tickets 18–21 and schema state intact. A mixed-version
extension without `bounded-foreground-attachment` continues through legacy
unmanaged behavior.

## Reopening conditions

Reopen only for material evidence that: the final source differs materially
from Symphony `8a5e8dac` or Alfie `82406bd8`; production configuration ignores
or mis-resolves the foreground wait environment policy; a detached child is
replaced, loses identity, or loses `parent_turn` cancellation; a handle can
publish before seq-3 durability or seq 3 can precede seq 2; post-detach
settlement leaks activity/widget/timer ownership or cleanup affects an
unrelated child; lifecycle persistence failure returns successful managed
output or leaves uncontained work; a legacy session receives managed bounded
semantics without the negotiated capability; provenance no longer proves the
exact Alfie source; dedicated standalone production-boundary runs
reproducibly violate `budget + 500 ms` on a functioning event loop without
induced harness contention; a production lifecycle-store hang demonstrates the
accepted single-envelope mechanism cannot preserve bounded return and durable
truth; or new evidence contradicts Decisions 0001–0005.
