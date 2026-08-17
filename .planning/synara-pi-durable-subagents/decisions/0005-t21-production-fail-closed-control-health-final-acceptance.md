# 0005 — Ticket 21 production fail-closed control-health final acceptance

**Status:** Accepted with recorded nonblocking risks

**Date:** 2026-08-17

**Decision type:** Project Supervisor final acceptance

**Integrated candidate:** `9f6ce23a`

**Fixed point:** `991bd616`

**Candidate commits:** `a029687a`, `93cac45c`, `94ec9e46`, `9f6ce23a`

**Publication:** Local integration only; not pushed or published.

## Question

Does the integrated Ticket 21 candidate satisfy T21-AC1 through T21-AC7
under the accepted Project Contract and approved Testing Seams, including
production fail-closed behavior on lifecycle-persistence failure, shared
control-health degradation, safe recovery, preservation of existing durable
truth, safe operator diagnostics, and continued legacy Agent usability?

## Governing references

- `../PROJECT.md` — authoritative routing and remediation frontier.
- `../spec.md` — normative behavior, durability, mixed-version, and
  fail-closed invariants.
- `0001-testing-strategy-governance.md` — accepted evidence and test-seam
  governance.
- `0002-t18-migration-lineage-final-acceptance.md` — accepted migration
  baseline.
- `0003-t19-real-pi-capability-final-acceptance.md` — accepted real-Pi and
  provenance baseline.
- `0004-t20-atomic-authorized-production-admission-final-acceptance.md` —
  accepted atomic admission baseline, including the accepted absence of a
  separate requested-phase write until the durable queue phase.
- `../issues/21-production-fail-closed-control-health.md` — T21-AC1 through
  T21-AC7, approved Testing Seams, and completed Implementation Report.

Decisions 0001 through 0004 remain authoritative and are not reopened.

## Evidence

- Integrated local candidate HEAD `9f6ce23a`, fixed point `991bd616`, with
  commits `a029687a`, `93cac45c`, `94ec9e46`, and `9f6ce23a`; tracked working
  tree reported clean and all commits remain local/unpushed.
- The sole independent feature/ticket-level reviewer returned
  `accept-with-recorded-nonblocking-risks`, passed T21-AC1 through T21-AC7,
  and found no critical, high, or medium blocker.
- Focused ticket verification passed 7 files and 81 tests.
- Exact root `bun run test` passed all 8/8 workspace tasks. The server result
  was 4,250 tests passed and 17 skipped.
- The real-extension evidence exercised the actual proven Pi extension and
  demonstrated:
  - persistence failure rejects before child start;
  - no partial execution or journal truth remains;
  - degradation is shared across managed sessions in one adapter;
  - a fresh command recovers through its normal atomic admission;
  - rejected commands are not replayed;
  - safe degradation and recovery warnings are emitted;
  - an actual legacy Agent remains usable and receives no managed or durable
    labeling during managed degradation.
- Existing running, orphaned, and terminal aggregates and journals were
  compared before and after degraded admissions and remained field-equivalent.
- Root typecheck remains blocked by 12 unchanged baseline errors in
  `packages/contracts/src/piSubagents.test.ts`. Server errors improved from
  78 at `991bd616` to 75 at the candidate, with no new ticket-related error;
  `piSubagentControlHealth.ts` improved from two errors to zero.
- `bun fmt` and `bun lint` were not run because they were not explicitly
  authorized. This is recorded as a verification limitation, consistent with
  the treatment already accepted in Decision 0004.
- The temporary `.pi/notifications.jsonl` test artifact was cleaned after
  review.
- No schema, migration, contract, or Alfie source change is part of Ticket 21.

## Decision

Accept Ticket 21 with recorded nonblocking risks.

T21-AC1 through T21-AC7 pass:

1. Atomic lifecycle-admission persistence failure prevents actual child start
   and returns the stable
   `pi_subagent_lifecycle_persistence_failed` diagnostic.
2. Failed admission leaves no accepted/running projection, execution row, or
   journal fragment.
3. One adapter-lifetime shared health controller records degradation and
   keeps fresh managed admission fail-closed while durable writes fail.
4. Existing running, orphaned, and terminal durable truth remains unchanged
   during degraded admission.
5. Recovery is fresh-command-driven and single-flight. A successful durable
   admission restores available health and admits that command without
   replaying prior rejected work or duplicating a child.
6. Degradation and recovery are observable through bounded transition-only
   `runtime.warning` events containing safe metadata.
7. Legacy and unhandshaked sessions remain governed by negotiated legacy
   policy and are never represented as managed, durable, or
   restart-recoverable.

The lack of a separate requested-phase lifecycle write is unchanged from
Decision 0004. Ticket 21 correctly applies fail-closed behavior to the
accepted atomic admission write that exists at this boundary. The later
durable queue phase owns a genuine requested period.

No material contrary evidence requires Reassessment of Decisions 0001–0004.

## Recorded nonblocking risks

1. **Heavyweight verification and baseline type debt:** `bun fmt` and
   `bun lint` were not authorized. Root typecheck remains blocked by 12
   unchanged contracts-baseline errors, while the server count improved and
   no ticket-related error was introduced.
2. **Requested-phase representation:** there is still no separate durable
   requested-phase write. This is the already accepted Decision 0004 boundary
   and must be reconsidered when the durable queue phase is implemented.
3. **Adapter-lifetime health:** health is intentionally in-process and scoped
   to one adapter lifetime. Restart begins as available and the first failed
   durable write degrades it again; health itself is not persisted.
4. **Hanging durable-store operation:** the recovery gate has no independent
   timeout. A durable operation that hangs rather than returning success or
   failure can leave recovery callers waiting. No governing timeout or service
   level was established for Ticket 21, so this does not fail an acceptance
   criterion, but it must remain visible for later watchdog and operational
   hardening.
5. **Test-artifact hygiene:** `.pi/notifications.jsonl` was created during
   testing and subsequently cleaned. Future verification should continue to
   prevent this runtime artifact from entering tracked candidate state.
6. **Fixture/comment hygiene:** mild reviewer-noted fixture and comment
   cleanliness issues do not change production behavior or acceptance
   evidence.

## Rejected alternatives

- **Reject Ticket 21:** rejected because no acceptance criterion failed and
  the sole independent reviewer found no material blocker.
- **Advisory/not ready:** rejected because the candidate has complete
  criterion-level implementation evidence, focused verification, an exact
  passing root test run, real-extension evidence, and one independent
  ticket-level review.
- **Plain acceptance without recorded risks:** rejected because heavyweight
  verification limitations, baseline type debt, adapter-scoped health, and
  hanging-store behavior should remain visible to downstream tickets.
- **Require a separate requested-phase write now:** rejected because Decision
  0004 already assigns that lifecycle period to the durable queue phase.
- **Require persisted control health:** rejected because Ticket 21 specifies
  one adapter-lifetime shared controller, and first-write fail-closed behavior
  re-establishes degradation after restart without changing durable execution
  truth.
- **Add a speculative recovery timeout in this ticket:** rejected because no
  governing timeout was established and the candidate’s conservative waiting
  behavior does not start untracked work. Timeout/watchdog policy should be
  settled where operational bounds are defined.

## Assumptions and residual uncertainty

- The supplied candidate identity, fixed point, local commit chain, and clean
  tracked working-tree status accurately describe the reviewed checkout.
- The sole reviewer evidence summarized in the final-acceptance handoff is the
  complete independent ticket-level review package.
- The 12 root contracts errors and remaining 75 server errors are unchanged
  baseline debt except for the verified reduction in control-health errors.
- A store operation that never settles was recorded as a risk but was not
  represented by the injected failure tests.
- No external publication or push has occurred.

## Downstream effect

- Ticket 21 remains completed and is accepted.
- Ticket 22 becomes the blocker-free remediation frontier.
- Ticket 06 remains blocked until ticket 24 is accepted.
- Downstream managed-admission work may rely on:
  - one adapter-lifetime shared control-health controller;
  - fail-closed rejection before child start when atomic lifecycle admission
    cannot be persisted;
  - transition-only safe operator warnings;
  - single-flight fresh-command recovery;
  - preservation of existing durable execution truth; and
  - legacy Agent usability without managed labeling during degradation.
- This decision authorizes tracker updates only. It does not authorize push,
  publication, deployment, or another external side effect.

## Failure and rollback implications

The candidate and decision remain local. Rollback is local to fixed point
`991bd616`; no remote state or external publication must be reversed.

Rolling back Ticket 21 removes the shared degraded-health and recovery
behavior and returns production admission to the accepted Ticket 20 baseline.
It does not alter migration lineage or persisted schema.

## Reopening conditions

Reopen this decision only for material evidence that:

- a failed atomic lifecycle admission can start a managed child;
- a persistence failure leaves partial execution or journal truth;
- degradation is not shared across managed sessions using the same adapter;
- degraded admission mutates pre-existing durable execution truth;
- recovery replays a rejected command or starts a duplicate child;
- health warnings leak prompts, results, raw SQL, injected error content, or
  other sensitive data;
- a legacy execution is labeled managed, durable, or restart-recoverable;
- candidate contents diverge materially from reviewed HEAD `9f6ce23a`;
- the reported baseline-only verification failures are shown to be introduced
  or worsened by Ticket 21;
- a real hanging-store incident or an adopted bounded-latency requirement
  makes the unbounded recovery wait unacceptable; or
- durable queue work introduces a genuine requested phase requiring
  reassessment of Decision 0004’s lifecycle representation.

## Superseded records

None. Decisions 0001 through 0004 remain unchanged.
