# Decision 0014 — Ticket 10 final acceptance (restart reconciliation to terminal or orphaned)

## Status

**accepted** (binding; Decisions 0001–0013 remain authoritative and unchanged)

**Date:** 2026-08-18

## Accepted candidate

- Symphony completion commit `e58ff719`:
  `piSubagentRestartReconciliation.ts`, production startup wiring in `main.ts`,
  the standalone real-Pi restart acceptance suite, the focused unit suite, and
  the Ticket 10 Implementation Report.
- Ticket-10 persistence, contract, and configuration hunks contained in the
  parallel Ticket-09 stream commit `98b9e990`:
  `listNonTerminalExecutions`, `recordOrphanedEvent`,
  `recoverCompletionOutbox` recovery clamping and stale-applicability join,
  diagnostic literals and reconciliation schemas, and
  `resolvePiSubagentOrphanAfterMs` with production environment wiring.
- Follow-up documentation commits:
  - `863ef999`, correcting the disclosed cross-commit ownership note;
  - `ee2ac3a6`, persisting the independent Ticket-10 review.
- Ticket 10 does not accept or claim Ticket 09's feature work merely because
  `98b9e990` contains shared Ticket-10 seams. Ticket 09 remains subject to its
  own report, independent review, and final-acceptance consultation.
- Ticket 10 required no Alfie source change. Its candidate was verified against
  the then-pinned Alfie `608c1c57d` / `0.13.0-alfie.1`; the independent
  reviewer also verified the standalone restart acceptance path after the
  parallel Ticket-09 stream re-pinned Alfie to `489acd626` /
  `0.14.0-alfie.1`.

## Question

Does the Ticket 10 candidate at Symphony `e58ff719` plus the Ticket-10 hunks
inside `98b9e990` satisfy T10-AC1 through T10-AC7 and discharge Decision
0013's F1, F2, and F3 obligations under the owner-approved Testing Seams,
Decisions 0001, 0008, 0012, and 0013, and the standing server-side
lease-authority invariant, such that Ticket 10 can be accepted and its
downstream dependency edges satisfied?

The decision must also settle whether independent-review findings F1 through
F5 require Ticket-10 remediation.

## Governing references

- Project Home:
  `.planning/synara-pi-durable-subagents/PROJECT.md`.
- Normative Ticket 10, including T10-AC1 through T10-AC7, owner-approved
  Testing Seams, complete Implementation Report, evidence matrix, failure and
  diagnostic evidence, and pre-review disclosures:
  `.planning/synara-pi-durable-subagents/issues/10-restart-reconciliation.md`.
- Exactly one persisted independent feature-level review:
  `.planning/synara-pi-durable-subagents/reviews/10-restart-reconciliation-review.md`.
- Decision 0001, governing state-machine, orchestration, failure, diagnostic,
  restart, and forbidden success-equivalence evidence.
- Decision 0008, governing per-file standalone wallclock verification.
- Decision 0012, governing journal-first terminal truth, first-terminal-wins,
  bounded evidence, attempt/generation fencing, and the separation of
  cancellation from normal terminal ownership.
- Decision 0013, governing atomic terminal/outbox truth and assigning Ticket 10:
  - F1, re-clamping journal-extracted metadata at startup recovery;
  - F2, excluding or equivalently settling stale terminal evidence during
    recovery;
  - F3, invoking journal-first outbox recovery during production startup.
- The standing obligation from Decisions 0009–0013 that lease authority is
  validated or re-derived server-side. Producer-supplied `occurredAt` and
  stored `lease_expires_at` are not authoritative. Notification, timeout,
  temporary absence, or `session.abort()` resolution is not termination
  evidence.
- Tickets 09, 11, 12, and 15 for the downstream production consumer,
  reconnectable execution projection, transcript reader, and lease-expiry
  sweep-driver boundaries.

The owner-approved Ticket-10 Testing Seams and the exactly-one-review plus
exactly-one-consultation cadence are not reopened.

## Lifecycle honored

Decision 0013 accepted Ticket 08 and assigned startup recovery plus F1/F2
dispositions to Ticket 10 → Ticket 10 was implemented across `e58ff719` and
the disclosed Ticket-10 portions of `98b9e990` → its normative ticket received
a complete Implementation Report, criterion-level evidence matrix, failure and
diagnostic evidence, and explicit scope disclosures → exactly one persisted
independent feature-level review completed on 2026-08-18 and returned PASS with
HIGH confidence for T10-AC1 through T10-AC7 and Decision-0013 F1/F2/F3, with
five INFO findings and no BLOCKER, HIGH, or MEDIUM finding → exactly one
Project Supervisor final-acceptance consultation, activation class 2 →
**ACCEPT**.

No second independent feature review is required or authorized.

## Settled verdict

**Accept Ticket 10. T10-AC1 through T10-AC7 and Decision-0013 F1/F2/F3 all
pass.**

### T10-AC1 — PASS

When neither matching live-owner evidence nor applicable terminal evidence
exists, reconciliation records non-terminal `orphaned` with the stable
`pi_subagent_owner_loss_orphaned` diagnostic. The settlement is transactional,
identity-guarded, generation-fenced, and idempotent. A repeated pass does not
advance generation again. Reconciliation never asserts or preserves `running`
without matching live-owner evidence.

The focused unit suite proves the orphan aggregate, durable diagnostic,
non-terminal cancellation visibility, generation advance, and idempotent second
pass. The real-Pi standalone acceptance proves that the no-owner view orphans a
real detached execution.

### T10-AC2 — PASS

A transcript terminal marker restores an outcome only when execution,
attempt, and generation match the current aggregate. Restoration uses the
accepted journal-first `recordTerminalEvent` path, preserving first-terminal
ownership and creating completion-outbox truth atomically. A stale marker
restores nothing and follows the owner-loss path.

The unit suite proves matching-marker restoration and pending outbox creation,
and proves rejection of a stale-generation marker.

### T10-AC3 — PASS

Live-owner evidence is accepted only when execution ID, attempt ID, generation,
and `isRunning` all match. Reconciliation refreshes the heartbeat observation
using the server clock without creating a new attempt or generation.

The focused and real-Pi acceptance suites prove identity-preserving refresh from
a real bridge registry record and prove that mismatched evidence cannot preserve
`running`.

### T10-AC4 — PASS

The restart coordinator has no spawn, resume, cancel, interrupt, abort, or
delegation-dispatch capability. Startup invokes only journal-first outbox
recovery and reconciliation settlement/read paths. Tests prove no new attempt
and a journal shape limited to accepted, running, and orphaned lifecycle
observations.

Structural absence of a dispatch surface is the strongest honest evidence for
the no-replay invariant at this seam and is consistent with Decision 0001.

### T10-AC5 — PASS

Orphan settlement advances generation once, fencing late events from the
owner-lost generation. Late terminal evidence is journaled as stale,
increments `stale_terminal_events`, does not mutate the orphan aggregate, and
creates no completion-outbox row. Late generic lifecycle evidence remains
history-only.

Both focused and real-Pi acceptance evidence prove stale-terminal counting and
preservation of the orphan aggregate after a real child reports late.

### T10-AC6 — PASS

The durable owner-loss diagnostic states that partial external or workspace
side effects may already exist, directs the operator to inspect before
resuming, and states that delegation was not automatically replayed.

The message is persisted on the execution and journal and is available through
the diagnostic observer seam. Unit and real-Pi acceptance tests assert the
required message content.

### T10-AC7 — PASS

Lease-expiry reconciliation derives authority from
`last_heartbeat_at + leaseDurationMs + orphanAfterMs` against the server clock.
It does not consume stored producer-derived `lease_expires_at`. Matching live
ownership still wins after the threshold; without renewed live evidence, an
expired execution enters the same owner-loss settlement.

`SYNARA_PI_SUBAGENT_ORPHAN_AFTER_MS` defaults to 60,000 ms, accepts values from
1,000 through 3,600,000 ms, and falls back to the default for invalid or
out-of-range input without clamping. Focused tests prove below-threshold,
past-threshold, live-owner, and configurable-threshold behavior; configuration
and main-path tests prove production resolution.

### Decision 0013 F1 — PASS

`recoverCompletionOutbox` re-clamps journal-extracted summary and transcript
reference before creating recovered entries. Independently reproduced evidence
uses a 50,000-character summary and 5,000-character transcript reference and
proves recovered values remain within the accepted 2,000/1,024-character
bounds.

This closes Decision 0013 F1 before startup recovery is exposed in production.

### Decision 0013 F2 — PASS

`listTerminalEventsWithoutOutbox` joins terminal journal evidence to the
current aggregate on attempt and generation. Inapplicable stale evidence is
excluded before outbox materialization and therefore cannot become pending,
reach the first pump, or produce superseded-accounting churn.

Tests prove that a stale superseded-attempt terminal row creates no recovery
entry while current applicable terminal evidence remains recoverable. This
implements Decision 0013's preferred simple direction.

### Decision 0013 F3 — PASS

Production startup invokes `recoverCompletionOutbox` first and then
`reconcilePiSubagentExecutions({ mode: "restart" })` after the server is live.
The startup work is forked, handles empty state as a no-op, and converts
per-entry failures into bounded failure accounting and diagnostics rather than
blocking or crashing server boot.

Recovered pending entries use the accepted generation-fenced delivery path.
The production delivery pump and parent consumer remain Ticket 09 scope.

## Evidence basis

The independent reviewer returned **PASS**, confidence **HIGH**, with all seven
Ticket-10 criteria and all three Decision-0013 obligations passing.

The reviewer independently reproduced:

- six focused server files: **268 tests passed**, zero failed;
- reconciliation suite: **12/12 passed**;
- standalone real-Pi restart acceptance under Decision 0008's binding clean-env
  method: **1/1 passed**, approximately nine seconds;
- contracts: **13/13 passed**;
- cancellation and bridge regression set: **50/50 passed**;
- standalone real-Pi terminal acceptance: **2/2 passed**;
- standalone real-Pi cancellation acceptance: **2/2 passed**;
- server TypeScript checking: exit zero.

Direct inspection covered the load-bearing behavior:

- guarded, idempotent orphan settlement and generation advance;
- stale-terminal accounting before any aggregate mutation or outbox insertion;
- current attempt/generation applicability in recovery;
- journal-to-outbox recovery bounds;
- startup ordering and failure containment;
- server-side lease re-derivation;
- downstream cancellation and outbox fencing after orphan generation advance;
- absence of a delegation replay surface.

The review confirmed the disclosed cross-commit split by blob comparison.
Migration-lineage suites remained green; Ticket 10 adds no migration.

## Recorded findings and dispositions

### F1 — INFO: Alfie provenance drift from the parallel Ticket-09 stream

The candidate-at-commit Ticket-10 wallclock assertion matched Alfie
`608c1c57d` / `0.13.0-alfie.1`. The current tree was subsequently re-pinned by
Ticket 09 to `489acd626` / `0.14.0-alfie.1`, and the reviewer verified the
Ticket-10 restart acceptance path at both pins.

**Disposition:** environment note only. No Ticket-10 remediation. Ticket 10
does not claim ownership of Ticket 09's Alfie changes.

### F2 — INFO: `already_terminal` outcome naming for a concurrent newer attempt

A concurrent-resume stale-generation settlement can be represented by the
outcome kind `already_terminal` even when the current execution is non-terminal
under a newer identity.

**Disposition:** cosmetic reporting only. The guarded repository update
protects the newer attempt, and a later pass reconciles that current identity.
No durable-state or acceptance effect; no Ticket-10 remediation.

### F3 — INFO: no dedicated contracts test block for each new schema

The diagnostic literals are covered by the existing general decode loop, and
the new schemas and outcome kinds are exercised by server behavior tests, but
the contracts package has no dedicated Ticket-10 schema test block.

**Disposition:** optional test-maintenance follow-up only. Existing direct and
indirect coverage is sufficient for acceptance. No Ticket-10 remediation.

### F4 — INFO: lease observation-read failure is fail-closed

If the lease-expiry path cannot read `last_heartbeat_at`, it treats the value as
not-liveness and allows owner-loss reconciliation after the threshold rather
than preserving `running` indefinitely.

**Disposition:** accepted behavior. A failed observation read is not evidence
of liveness, and the behavior matches the ticket's disclosed failure surface.
No remediation.

### F5 — INFO: configured orphan threshold awaits its production sweep driver

Startup correctly uses restart mode, for which the lease-expiry threshold is
irrelevant. The threshold resolver and lease-expiry coordinator behavior are
production-quality and verified at their seam, but no periodic production
caller invokes lease-expiry mode yet.

**Disposition:** accepted downstream boundary. Ticket 15 owns the production
lease-expiry/watchdog sweep driver. Ticket 10 must not absorb that scope.

### Inherited Ticket-07 F4 note

Decision 0012's nonblocking extension-side cancelled-background reporter-entry
retention consideration was explicitly disclosed as outside Ticket 10's
Symphony reconciliation write set. No evidence shows that it can cross an
identity fence or corrupt durable reconciliation.

**Disposition:** this acceptance does not claim that the extension-side cleanup
was remediated. The note remains nonblocking and must not be described as
closed by Ticket 10. It does not alter T10-AC1 through T10-AC7 or
Decision-0013 F1/F2/F3.

No finding conditions Ticket-10 acceptance.

## Rejected alternatives

- **Reject for any of F1 through F5:** rejected. None changes durable
  correctness, violates a criterion, or contradicts a governing decision.
- **Require a true OS `kill -9` harness:** rejected. The approved restart seam
  tests the durable post-restart view, while a real detached child proves the
  live bridge boundary. Killing the test process adds OS mechanics without
  stronger reconciliation-contract evidence.
- **Require production transcript-file reading in Ticket 10:** rejected.
  Production currently restores from durable journal truth. Reporting and
  reading the extension transcript file requires an Alfie contract change and
  belongs to Ticket 12.
- **Require the lease-expiry sweep driver in Ticket 10:** rejected. Ticket 10
  owns the coordinator, policy, configuration, and startup reconciliation;
  Ticket 15 owns periodic watchdog escalation and consumption.
- **Treat absence or timeout as terminal evidence:** rejected. Restart
  owner-loss produces non-terminal `orphaned`; it does not fabricate success,
  failure, or cancellation.
- **Trust stored `lease_expires_at`:** rejected. Lease authority is re-derived
  from the server-observed heartbeat and configured duration against the server
  clock.
- **Automatically replay the delegation after restart:** rejected. This would
  risk duplicating external or workspace side effects and violate Ticket 10,
  Decision 0001, and the accepted recovery model.
- **Require another independent feature review:** rejected. The persisted
  review supplies complete criterion-level evidence. Another competing review
  would violate the accepted cadence.
- **Declare Ticket 11 immediately blocker-free:** rejected. Its authoritative
  ticket lists Tickets 06, 09, and 10 as blockers. Decisions 0011 and 0014
  satisfy the Ticket-06 and Ticket-10 edges, but Ticket 09 remains awaiting its
  separate acceptance.

## Assumptions and residual uncertainty

- The independent reviewer's reproduced outputs correspond to the disclosed
  candidate and current integrated tree.
- The reviewer's blob comparison correctly identifies the Ticket-10 portions
  of `98b9e990`.
- SQLite transaction, uniqueness, and guarded-update behavior is the behavior
  exercised by the focused repository and reconciliation suites.
- The current production terminal writers continue to honor Decision 0012's
  bounded, journal-first terminal contract.
- Ticket 09's production consumer will preserve the accepted outbox identity as
  the parent-effect dedupe key; Ticket 09 must establish this independently
  before its own acceptance.
- Production transcript-file discovery and reading are not claimed by Ticket
  10 and remain Ticket 12 scope.
- Periodic lease-expiry/watchdog invocation is not claimed by Ticket 10 and
  remains Ticket 15 scope.
- The extension-side reporter-entry retention note from Decision 0012 is not
  claimed as remediated by this candidate.
- All commits remain local-only. Publication, deployment, release, and external
  side effects are outside this decision.
- Ticket 10 adds no migration.

## Downstream effect

- Ticket 10 is marked **complete (accepted)** with Decision 0014 as its
  authoritative final acceptance.
- Project Home adds Decision 0014 to authoritative routing and records Tickets
  01–08 and 10 complete.
- Ticket 09 remains **implemented (awaiting review)** in its parallel stream and
  retains responsibility for the production completion pump, batching,
  safe-parent-boundary delivery, retry-limit consumption, and stable-dedupe
  parent effects. This decision does not accept Ticket 09.
- Ticket 11's Ticket-10 dependency is now satisfied. Ticket 11 also depends on
  Ticket 09, so it becomes blocker-free only after Ticket 09 receives its own
  acceptance. It is not yet the blocker-free frontier.
- Ticket 12 retains ownership of production transcript/result reading,
  including any extension contract needed to discover transcript artifacts.
- Ticket 15 retains ownership of the production lease-expiry/watchdog sweep
  driver and consumption of `SYNARA_PI_SUBAGENT_ORPHAN_AFTER_MS`. Acceptance of
  Ticket 10 satisfies Ticket 15's Ticket-10 dependency, but Ticket 15 also
  remains blocked by Ticket 13.
- Ticket 14's Ticket-10 dependency is also satisfied, but Ticket 14 remains
  blocked by Ticket 13.
- The active acceptance frontier remains Ticket 09. Once Ticket 09 is accepted,
  Ticket 11 becomes eligible under its recorded dependencies.
- The accepted invariants remain:
  - restart never fabricates liveness or a terminal outcome;
  - owner loss without terminal truth produces non-terminal `orphaned`;
  - restart reconciliation never automatically replays delegation;
  - live ownership and terminal restoration require matching execution,
    attempt, and generation;
  - stale events remain history, are counted where required, and cannot mutate
    current truth or create a fresh parent effect;
  - recovered evidence remains bounded;
  - outbox recovery precedes restart reconciliation at startup;
  - execution outcome and completion delivery remain separate state machines;
  - lease authority is re-derived server-side;
  - notification, timeout, absence, or abort resolution is never termination
    evidence.

## Failure and rollback implications

Ticket 10 is additive and migration-free.

Rolling back the startup coordinator or its `main.ts` invocation leaves
non-terminal executions and journal-without-outbox evidence unreconciled after
restart. The server must not claim that those executions remain running merely
because their pre-restart aggregate said so.

Rolling back `recordOrphanedEvent` or its generation fence reintroduces the
risk that late events from an owner-lost generation mutate current execution
truth. Existing orphan journal evidence and diagnostics must be preserved
during remediation.

Rolling back the recovery clamp reopens Decision 0013 F1 by allowing legacy or
generic journal metadata to expand into unbounded recovered outbox content.

Rolling back the current-attempt/current-generation applicability join reopens
Decision 0013 F2 by allowing stale terminal evidence to materialize as pending
recovery entries.

Rolling back startup invocation reopens Decision 0013 F3. Existing pending
outbox entries remain durable but must not be represented as delivered or
acknowledged without the production consumer.

Rolling back server-side lease re-derivation or trusting stored
`lease_expires_at` reopens the standing lease-authority decisions.

Because no migration is added, code rollback does not require schema rollback.
Already-persisted terminal, outbox, orphan, stale-counter, and diagnostic
evidence must not be deleted or reinterpreted as weaker truth.

If Decision 0014 is reopened, Ticket 10 returns to needs-remediation. Tickets
11, 14, and 15 become blocked wherever they depend on accepted Ticket-10
reconciliation behavior.

## Reopening conditions

Reopen through a new numbered decision, never by editing this record, only for
material evidence that:

- the accepted Ticket-10 source differs materially from `e58ff719` plus the
  disclosed Ticket-10 hunks in `98b9e990`;
- restart reconciliation preserves or asserts `running` without matching live
  ownership evidence;
- matching current terminal evidence is ignored or an identity/generation
  mismatch can restore an outcome;
- restart reconciliation can spawn, resume, replay, or otherwise redispatch the
  delegation automatically;
- owner loss can be represented as terminal success, failure, or cancellation
  without accepted terminal evidence;
- orphan settlement is terminal, fails to persist the stable diagnostic,
  advances generation repeatedly, or permits a late stale event to mutate
  current truth;
- a late stale terminal avoids required counting, creates an outbox entry, or
  causes a parent effect;
- a concurrent newer attempt can be overwritten by stale reconciliation;
- journal-first terminal restoration ceases to preserve first-terminal-wins or
  atomic terminal/outbox truth;
- startup reconciliation runs before journal-first outbox recovery, blocks or
  crashes normal server boot, or leaves recovery permanently uninvoked;
- recovery can expose unbounded journal metadata or materialize inapplicable
  stale terminal evidence as indefinitely pending work;
- lease-expiry control trusts producer-derived `occurredAt` or stored
  `lease_expires_at`, or a timeout/absence is treated as termination evidence;
- the orphan diagnostic stops warning about possible partial side effects,
  inspection before resume, or absence of automatic replay;
- Ticket 09's consumer violates stable-dedupe or generation-fencing invariants
  inherited from Decisions 0013 and 0014;
- Ticket 12 treats transcript-file existence as liveness or terminal proof;
- Ticket 15's sweep bypasses the accepted lease-expiry coordinator or its
  server-side authority derivation;
- the binding standalone real-Pi restart acceptance reproducibly fails outside
  documented harness or provenance-environment drift;
- the independent review evidence is shown not to correspond to the accepted
  candidate; or
- new evidence materially contradicts Decisions 0001–0013, the owner-approved
  Ticket-10 Testing Seams, or this record's criterion verdicts.
