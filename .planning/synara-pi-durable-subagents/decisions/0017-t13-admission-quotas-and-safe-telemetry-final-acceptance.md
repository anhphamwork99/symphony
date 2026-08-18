# Decision 0017 — Ticket 13 admission quotas and safe telemetry final acceptance

**Status:** accepted — binding Project Supervisor final-acceptance Decision
**Date:** 2026-08-18

## Question

Does the complete uncommitted Ticket 13 candidate in the shared Symphony
checkout satisfy T13-AC1 through T13-AC7 under the Project Contract,
Decision 0001 testing governance, Decision 0014's AC4 approval requirement,
Decision 0008's standalone wall-clock acceptance method, and the sole
independent feature-level review?

## Accepted candidate

The exact Ticket 13 uncommitted source and planning diff inspected in
`/Users/anhpham99/symphony` for this consultation, excluding the pre-existing
runtime artifact `apps/server/.pi/notifications.jsonl`.

Acceptance applies only if the subsequent completion commit preserves this
candidate materially unchanged. The completion commit hash must be appended to
this record or the ticket implementation report after creation.

**Completion commit:** `8465b0fa` — preserves the accepted candidate and
excludes `apps/server/.pi/notifications.jsonl`.

## Governing references

- `.planning/synara-pi-durable-subagents/PROJECT.md`
- `.planning/synara-pi-durable-subagents/spec.md`
- `.planning/synara-pi-durable-subagents/issues/13-admission-quotas-and-telemetry.md`
- `.planning/synara-pi-durable-subagents/decisions/0001-testing-strategy-governance.md`
- `.planning/synara-pi-durable-subagents/decisions/0008-t22-real-bounded-foreground-attachment-final-acceptance-remediation.md`
- `.planning/synara-pi-durable-subagents/decisions/0014-t13-ac4-metrics-surface-approval-authority.md`
- `.planning/synara-pi-durable-subagents/reviews/13-admission-quotas-and-telemetry-review.md`

## Evidence

The Ticket 13 Testing Seams record is Approved and contains the owner's
2026-08-18 verbatim approval **“okay duyệt AC4”**. This satisfies Decision 0014;
the approved mapping remains the optional
`serverGetDiagnostics -> ServerDiagnosticsResult.piSubagents` block.

The current source implements finite 4/64/16 provider-session/server/project
admission defaults; process-local serialized durable count plus admission
write; replay preservation; fail-closed quota-read diagnostics; a configurable
two-hour journal-only wall-time trigger for Ticket 15; bounded SQL diagnostics
aggregation; safe closed logging; concurrent admission/progress saturation;
and finite invalid-configuration fallback.

Verification evidence:

- Ticket-focused server: 9 files / 298 passed.
- Contracts: 2 files / 16 passed.
- Decision-0008 standalone wall-clock files: 6/6 and 11/11 passed.
- Workspace fmt, lint, and typecheck: exit 0; lint 0 errors; seven typecheck
  tasks passed.
- Full workspace run: 4,633 passed / 17 skipped / 3 failed. Two failures were
  Decision-0008 full-load wall-clock artifacts and passed through the binding
  standalone method without threshold changes. The third was a stale
  fault-injection fixture missing the new repository reads; it was repaired
  and its complete real-extension file passed 11/11.
- The sole independent feature-level reviewer inspected current source,
  independently reproduced the focused, contract, and standalone evidence,
  confirmed the current fixture and empty-schema telemetry behavior, and
  returned PASS with high confidence and no blockers.

## Settled verdict

**Accept Ticket 13. T13-AC1 through T13-AC7 all pass.**

- **AC1:** finite configurable provider-session, server-wide, and per-project
  budgets are wired into production and enforced before spawn.
- **AC2:** capacity exhaustion and quota-store uncertainty return stable
  diagnostics without starting a child; serialized count plus write prevents
  concurrent oversubscription; replay identity semantics remain intact.
- **AC3:** the default two-hour wall-time policy records a deterministic,
  generation-fenced, journal-only `pi_subagent_walltime_expired` trigger.
  It does not settle projection or implement Ticket 15 watchdog stages.
- **AC4:** the owner-approved optional diagnostics block exposes all required
  execution counts and operational metrics through bounded aggregate queries
  on the existing operator RPC.
- **AC5:** metrics and default logs use safe correlation and aggregate values
  without prompt, result, transcript, summary, rejection-reason, raw SQL, or
  secret content.
- **AC6:** 100 concurrent admissions remain within a four-execution provider
  budget; 5,000 progress updates retain one latest slot; terminal state and
  completion outbox durability survive pressure.
- **AC7:** invalid values fall back to finite defaults and cannot produce
  unlimited concurrency, queueing, or wall time.

## Full-suite failure disposition

The two timing failures are nonblocking under Decision 0008 because the
complete affected files passed via the binding per-file standalone method,
without widening thresholds, and the independent reviewer reproduced them.

The stale fixture omission was a real test defect, was repaired locally, and
the complete affected real-extension file passed 11/11. No production behavior
was weakened to obtain that result.

A post-repair second full workspace run was not provided. This is accepted
because the repair was confined to delegating the newly required repository
reads in the intended fault-injection fixture, the complete containing file
passed, the reviewer independently confirmed current source, and no other
full-run failure was present.

## Scope, security, performance, and failure judgment

The candidate is Ticket-13-scoped. It adds no migration, new endpoint, watchdog
stage, or projection settlement on wall-time expiry.

Authorization remains ahead of quota admission and quota uncertainty fails
closed. Operational surfaces do not expose prompts, results, transcripts, or
secrets.

Quota atomicity is process-local, matching the current single-process server.
A future multi-process server sharing SQLite must replace the semaphore/count
pair with a database-atomic reservation.

Progress memory remains latest-slot bounded and terminal delivery stays on its
durable path. Telemetry aggregation occurs in SQLite; lifecycle-history scans
may be optimized if measured diagnostics latency becomes material.

## Rejected alternatives

- **Reject for the two full-load timing failures:** rejected because Decision
  0008 designates standalone per-file wall-clock invocations as binding, and
  both files passed that method without threshold widening.
- **Require another independent review:** rejected because the one-review
  lifecycle is complete and the sole reviewer covered the full candidate.
- **Require a new project-scoped AC4 decision:** rejected because Decision 0014
  classifies the mapping as a ticket-level seam and its owner approval is now
  expressly satisfied.
- **Add a migration, metrics endpoint, or Ticket 15 watchdog stages:** rejected
  as unnecessary and outside Ticket 13.
- **Reject for process-local quota atomicity:** rejected because it matches the
  evidenced single-process architecture.
- **Reject solely for no second full-suite run:** rejected because every
  disclosed failure has current-source reconciliation and independent
  reproduction; no unresolved criterion-level failure remains.

## Assumptions and residual uncertainty

- Synara remains a single server process for admission ownership.
- The completion commit contains the materially unchanged accepted candidate
  and excludes the runtime notifications artifact.
- Timing guarantees retain Decision 0008's functioning-event-loop assumption.
- Detach and cancellation percentile queries currently scan lifecycle history
  without a time window or dedicated partial index.
- Failure of the Pi telemetry query currently fails the complete diagnostics
  RPC, consistent with existing projection-count behavior.
- `progress.coalesced` and `progress.dropped` intentionally share the durable
  replacement count until a distinct drop mode exists.
- No clean second full workspace run after the fixture-only repair was
  supplied; targeted and independently reproduced evidence is accepted.

## Downstream effect

Ticket 13 may be marked accepted and complete after this Decision Record is
persisted and tracked. Ticket 15's Ticket-13 blocker is satisfied and it may
consume the durable wall-time escalation trigger.

The main agent may create the completion commit only after persisting this
record. No publication, deployment, release, or external side effect is
authorized.

## Failure and rollback implications

The change is migration-free and uses additive optional diagnostics contracts.
Rolling it back removes the new admission budgets, wall-time trigger, and Pi
diagnostics block and restores the preceding admission behavior. Such rollback
would reopen Ticket 13 and re-block Ticket 15.

If deployment topology becomes multi-process, the process-local arbiter is no
longer sufficient and admission must move to a database-atomic reservation
before that topology is supported.

## Reopening conditions

Reopen this Decision if material evidence shows any of the following:

- the completion commit differs materially from the accepted candidate;
- a child starts outside provider-session, server, or project limits;
- concurrent admission oversubscribes a configured budget;
- a replay starts a duplicate child or loses command-identity semantics;
- quota-store uncertainty admits work rather than failing closed;
- wall-time expiry mutates aggregate state, claims termination, or dispatches
  Ticket 15 watchdog control from Ticket 13;
- the wall-time trigger is not durable, idempotent, attempt/generation fenced,
  or consumable by Ticket 15;
- diagnostics diverge from the owner-approved `piSubagents` mapping;
- default metrics or logs expose content-bearing or secret data;
- progress saturation can displace terminal lifecycle or outbox truth;
- invalid configuration creates unlimited admission or wall time;
- a clean subsequent full run reveals a materially different candidate-caused
  failure;
- standalone wall-clock files reproducibly fail under Decision 0008;
- Synara adopts a multi-process server sharing the database without
  database-atomic quota reservation;
- material evidence contradicts Decisions 0001, 0008, 0014, or the independent
  reviewer package.
