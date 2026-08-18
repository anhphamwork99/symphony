# Decision 0018 — Ticket 09 crash-safe per-thread completion coordinator final acceptance

## Status

**ACCEPT — Ticket 09 accepted.**

This Reassessment supersedes Decision 0015's `NEEDS REMEDIATION` verdict.
Decision 0015 remains authoritative historical evidence of the original
rejection; its reopening conditions are now satisfied by the remediated
candidate under Decision 0016.

## Date

2026-08-18

## Accepted candidate

- Symphony merge commit `ebf224a6`.
- Ticket 09 remediation work-package commits `0f298eb8` through `cf641ba7`,
  as integrated by `ebf224a6`.
- Alfie `489acd6264eeedbb1a84e2ba2295af8d1b766b3b`, package version
  `@alfie/pi-subagents@0.14.0-alfie.1`, unchanged from the Decision 0015
  candidate and independently verified clean.
- Migration 103, providing the immutable
  `pi_subagent_completion_dispatch_batches` ledger and guarded
  completion-outbox membership.

Ticket 13 commits interleaved in main history are outside this acceptance.
The authoritative Project Home separately routes Decision 0017 as Ticket 13's
acceptance; this record is numbered Decision 0018. This decision neither
supplies, implies, reopens, nor reassesses Ticket 13 acceptance.

Uncommitted changes to `apps/server/.pi/notifications.jsonl` and web composer
styles are excluded from the accepted candidate.

## Question

Does the remediated Ticket 09 candidate satisfy T09-AC1 through T09-AC6 and
every reopening condition imposed by Decision 0015, under the binding
crash-safe parent-effect direction in Decision 0016, such that Ticket 09 may
be accepted and Ticket 11's final blocker removed?

## Governing references

Authoritative:

- `.planning/synara-pi-durable-subagents/PROJECT.md`
- `.planning/synara-pi-durable-subagents/issues/09-per-thread-completion-coordinator.md`
- `.planning/synara-pi-durable-subagents/decisions/0015-t09-per-thread-completion-coordinator-final-acceptance-remediation.md`
- `.planning/synara-pi-durable-subagents/decisions/0016-t09-crash-safe-parent-effect-technical-direction.md`
- `.planning/synara-pi-durable-subagents/reviews/09-per-thread-completion-coordinator-remediation-review.md`
- `.planning/synara-pi-durable-subagents/decisions/0001-testing-strategy-governance.md`
- `.planning/synara-pi-durable-subagents/decisions/0008-t22-real-bounded-foreground-attachment-final-acceptance-remediation.md`
- `.planning/synara-pi-durable-subagents/decisions/0013-t08-durable-completion-outbox-final-acceptance.md`
- `.planning/synara-pi-durable-subagents/decisions/0014-t10-restart-reconciliation-final-acceptance.md`

Aspect-scoped boundaries:

- Decision 0014 remains authoritative for Ticket 10; nothing here reopens it.
- Decision 0017 remains a separate Ticket 13 decision.
- Ticket 11's dependency declaration is authoritative for the downstream
  frontier.

## Lifecycle honored

1. Ticket 09 implemented with a criterion-level Implementation Report.
2. Exactly one independent review of the original candidate returned PASS/HIGH.
3. Decision 0015 rejected final acceptance (delivered-before-effect crash
   window).
4. Decision 0016 settled the binding remediation direction.
5. Remediation implemented in `0f298eb8`..`cf641ba7`, integrated by
   `ebf224a6`.
6. The Implementation Report was corrected to the actual sequence: immutable
   batch commit → exact command/receipt acceptance → receipt-correlated
   finalization.
7. Exactly one independent remediation review was persisted: PASS/HIGH, every
   Decision 0015 reopening bullet and all 22 Decision 0016 §10 requirements
   mapped, focused/failure/migration/engine-backed/managed-legacy/real-Pi/
   Decision 0008 evidence independently reproduced.
8. This exactly-once Supervisor consultation reassessed Decision 0015 against
   its reopening conditions and returns **ACCEPT**.

The reviewer's PASS is evidence, not acceptance authority.

## Settled verdict

**Accept Ticket 09. T09-AC1 through T09-AC6 all pass.**

### T09-AC1 — PASS

Near-simultaneous applicable completions for one parent thread are
transactionally placed in one immutable bounded batch with canonical ordering
and frozen parent content. Batch cap is configurable 1–64 (default 8, fails to
default). Overflow remains outside the active batch for a later bounded
dispatch. Parent content preserves bounded summaries, execution identities,
and transcript references.

### T09-AC2 — PASS

At most one outstanding managed batch per parent thread across restart and
recovery, enforced by the migration-103 partial unique index over nonterminal
states `awaiting_acceptance`, `retryable`, and `accepted`. Later same-thread
completions remain outside the active batch until exact finalization or a
terminal disposition releases the slot. Other threads remain independently
deliverable. In-memory coordination is not relied upon.

### T09-AC3 — PASS

Parent activity is the sole delivery gate; busy, lazy, unavailable-yet-
hydratable, pre-bind, receipt-replay, and recovery-inspection conditions
consume no retry budget. Recovery resumes through dispatcher binding, managed
session hydration, parent settlement, new completion, or the bounded scan over
eligible hydrated managed sessions.

### T09-AC4 — PASS

Both crash positions identified by Decision 0015 are closed.

Pre-submission loss: the immutable batch and member association commit before
submission; the batch ledger (not a scan of `delivered` rows) is the durable
recovery authority; restart or a later eligible trigger redrives the same
batch without requiring a new terminal event; stored command, message,
membership, fingerprint, and identities are unchanged.

Post-acceptance/pre-finalization loss: parent-effect acceptance occurs only
when `OrchestrationEngine` atomically commits the deterministic parent
message, immediate or queued turn intent, command fingerprint, and accepted
receipt; recovery replays the same frozen command ID and byte-identical
payload; a fingerprint-matched replay returns the same accepted receipt with
no second message, turn request, or receipt; finalization acknowledges only
exact batch members and is replayable and idempotent.

"Delivery failure remains retryable" is governed by the bounded-retry policy:
genuine transient failures retry until the configured ceiling; exhaustion
after that ceiling is an honest terminal delivery outcome (not an
unrecoverable crash window) that releases the per-thread slot while retaining
batch, membership, error, attempt, and outbox evidence, never rewriting the
child outcome.

### T09-AC5 — PASS

Managed notification suppression requires negotiated
`completion-delivery-ownership` and durable host acknowledgement for the exact
execution; legacy or unnegotiated operation retains the legacy path. Real-Pi
evidence proves both sides with no double delivery. No Alfie change was
required; provenance remains valid.

### T09-AC6 — PASS

Generation-inapplicable work produces zero parent command effect:
stale-before-creation entries are fenced transactionally (no batch);
stale-before-submission batches are superseded before dispatch, release the
slot, and retain readable evidence without altering execution outcomes.

## Decision 0015 reopening-condition verdicts

All satisfied: both crash positions closed; unfinished ownership recoverable;
stable-identity redrive without duplicates; one outstanding batch survives
restart; busy deferral consumes no budget; retry policy consumed in
production; stale generations zero effect; execution/delivery independence;
evidence readability; managed/legacy + provenance valid; focused/failure/
real-Pi/migration/integration/Decision 0008 evidence passing; corrected
Implementation Report ordering. Decision 0015's rejection is superseded for
this candidate.

## Evidence basis

The sole independent remediation review returned PASS/HIGH and mapped every
Decision 0015 bullet and all 22 Decision 0016 §10 requirements to inspected,
reproduced-green evidence: coordinator 19/19; dispatch-batch repository 13/13;
migration replay 3/3; lineage 4/4; engine-backed 4/4; dispatcher 10/10;
identity 12/12; outbox 11/11; config 195/195; real-Pi ownership 2/2;
RealExtension 11/11; Integrated 7/7; Restart 1/1; Terminal 2/2; tsc exit 0.
Real-Pi/wallclock ran per-file standalone under the Decision 0008 clean
environment; Alfie verified clean at the pin.

Load-bearing source inspection confirmed: transactional batch creation and
exact member association; durable one-active-batch authority; versioned
domain-separated stable identities; byte-identical stored-command replay;
atomic orchestration acceptance and fingerprint-matched receipt replay; exact
receipt/membership correlation before finalization; no direct Pi prompt in the
managed completion path; no correctness-critical claim/lease; single-assignment
late binding without a construction cycle; production recovery triggers and
bounded scan; bounded retry accounting that never mutates the execution
aggregate; additive replay-safe migration; old-binary rollback inertness.

## Findings and dispositions

### F1 — LOW: success evidence uses a failure diagnostic code

Receipt-correlation confirmation and accepted-and-acknowledged finalization
are emitted under `pi_subagent_completion_delivery_failed`; persisted batch
state and timestamps are correct.

**Disposition:** nonblocking observability defect. Follow-up owner: Ticket 11
(reconnectable execution-card diagnostics contract) — add a dedicated
success/finalization literal and map receipt-confirmed finalization to it.
Until then durable batch state is authoritative. Reopen only if the mislabeled
event drives control behavior, retry accounting, user-visible false failure,
or contradicts durable truth.

### F2 — LOW: engine-backed rollback test is thin

**Disposition:** no remediation; the invariant is evidenced at the owning
state-machine boundaries. Follow-up owner: Ticket 17 integrated acceptance —
strengthen or rename if carried into the integrated matrix. Reopen only if old
code can redrive associated `delivered` members, new code cannot resume, or
replay can duplicate the accepted effect.

### F3 — INFO: no dedicated production-composition test

**Disposition:** no remediation; wiring supported by source inspection, tsc,
dispatcher bind-semantics tests, resolver tests, real-engine adapter evidence,
and real-Pi integration. Follow-up owner: Ticket 17 — add a composition/
startup assertion if it touches the bootstrap acceptance harness. Reopen only
if the bridge can stay unbound after normal startup, bind twice, race
construction, or production ignores the configured cap.

### F4 — INFO: malformed stored payload maps to transient in the dispatcher

**Disposition:** accepted — unreachable on the governed coordinator path
(pre-dispatch fingerprint verification fails closed first) and pinned by unit
test. Owner: dispatcher's future maintainer if a second direct caller is
introduced. Reopen only if a production caller can bypass coordinator
verification and retry malformed/drifted content indefinitely.

### F5 — INFO: outbox identity no longer embedded in follow-up text

**Disposition:** accepted — structural dedupe (deterministic ids + receipt +
ledger membership) is stronger than text keys; execution identity remains in
the parent message and outbox membership remains in the ledger. Ticket 12 must
preserve execution-identity traceability in transcript/result reading.
Reopen only if operators cannot correlate parent content to evidence or dedupe
depends on mutable text.

### F6 — INFO: exhausted/superseded members remain delivered-unacknowledged

**Disposition:** confirmed intended semantics — `acknowledged` means exact
parent-effect acceptance and finalization and must not be fabricated for
exhausted/superseded work. T09-AC4 requires recoverability through the
configured budget, not infinite retry after immutable rejection/collision.
No follow-up owner; this Decision settles the interpretation. Reopen only if
exhaustion occurs without genuine failures, busy/inspection consumes budget,
evidence is erased, child outcome changes, or slot release permits duplicate
acceptance.

No finding blocks acceptance.

## Rejected alternatives

- Retain Decision 0015's rejection: both crash windows are closed at a
  durable idempotent orchestration boundary.
- Direct Pi prompt + claim/lease: cannot distinguish never-accepted from
  accepted-before-loss.
- Treat `delivered` as acceptance: it is membership evidence only.
- Move `delivered` after a direct prompt: exchanges loss for duplication.
- Rescan delivered rows and re-prompt: cannot prove nonduplication.
- Require infinite retries: conflicts with the bounded Ticket 08 policy and
  retains slots forever on immutable rejection/collision.
- Acknowledge exhausted/superseded members: would falsely claim accepted
  content.
- Block acceptance for F1–F3: observability/test-maintenance gaps with
  sufficient independent behavioral evidence and downstream owners.
- Block acceptance for F4/F5: neither affects the governed path or structural
  dedupe.
- Require another review: the exactly-one lifecycle is complete.
- Reopen Ticket 10 or modify Alfie: outside Decision 0016 and unsupported.
- Treat this decision as Ticket 13 acceptance: Ticket 13 has its own
  authoritative lifecycle.
- Accept solely because the reviewer returned PASS: acceptance follows
  independent adjudication of the invariants and reopening conditions.

## Assumptions and residual risks

- Evidence corresponds to merge `ebf224a6` and the disclosed remediation
  commits; Alfie remains byte-identical to the clean pin.
- SQLite transactional/guarded-update/uniqueness/partial-index behavior
  remains as exercised by the suites.
- `OrchestrationEngine` acceptance stays atomic; same-ID matching-fingerprint
  replay returns the existing accepted receipt without appending content;
  queued-turn promotion remains the downstream delivery owner.
- Concurrent old/new binaries sharing one database remain unsupported and
  operationally prevented; old binaries may pause liveness for associated
  `delivered` rows but must not reinterpret or redeliver them.
- Lazy parent sessions are not eagerly synthesized solely for completion
  delivery.
- No literal two-process concurrency test is accepted because the unique
  index, deterministic identity, transactional association, and engine receipt
  uniqueness are each directly tested; a future multi-process topology must
  preserve those database authorities.
- F1 may temporarily confuse the runtime-event surface; durable batch state is
  authoritative.
- No publication, deployment, release, schema deletion, or external side
  effect is authorized by this acceptance.

## Downstream effect

- Ticket 09 is accepted and complete at Symphony `ebf224a6`.
- Decision 0015's rejection is superseded for this candidate; Decision 0016's
  direction remains binding for maintenance.
- Ticket 11's Ticket 06/09/10 dependency edges are all satisfied: **Ticket 11
  becomes blocker-free and is the next frontier ticket.**
- Ticket 10 remains accepted under Decision 0014 and is not reopened.
- Alfie remains unchanged at `489acd626` / `0.14.0-alfie.1`.
- Ticket 13 remains governed solely by its own record (Decision 0017).
- No dependent work may weaken stable command identity, exact receipt
  correlation, durable one-batch-per-thread authority, generation fencing, or
  execution/delivery separation.

## Failure and rollback implications

The migration is additive. Batch ledger, member association, receipt sequence,
fingerprint, retry, exhaustion, supersession, and acknowledgement evidence must
be preserved. Rolling application code back to a pre-remediation binary may
pause delivery for batch-associated `delivered` members; older code must not
rescan, reinterpret, acknowledge, or redeliver them; returning to the accepted
binary resumes receipt-based recovery. Schema rollback, evidence deletion,
batch-association removal, identity rotation, or removal of the partial unique
active-batch index is unauthorized. Concurrent mixed binaries remain
unsupported. If rollback removes the bridge, recovery triggers, bounded scan,
or exact receipt finalization, Ticket 09 must no longer be represented as
crash-safe or accepted. Execution outcomes remain independent during rollback.
Reverting Alfie below `0.14.0-alfie.1` requires treating it as lacking
negotiated `completion-delivery-ownership`.

## Reopening conditions

Reopen through a new numbered Decision or Reassessment if material evidence
shows:

- pre-submission crash can leave a batch undiscoverable/undriven while an
  eligible managed parent boundary exists;
- post-acceptance crash can append duplicate message/turn/receipt content;
- orchestration acceptance is not atomic with the deterministic message and
  turn/queue intent;
- same-ID matching-fingerprint replay does not return the same receipt;
- retries rebuild or rotate frozen identity/membership/fingerprint content;
- changed content under an existing command ID does not fail closed;
- two nonterminal batches can exist for one parent thread;
- later same-thread completions enter a frozen batch or dispatch early;
- one thread's recovery failure blocks another thread;
- busy/lazy/unavailable/replay/inspection/supersede paths consume retry
  budget;
- genuine transient failures do not consume the configured policy;
- rejection or collision repeatedly increments attempts or rotates identity;
- exhaustion occurs before the genuine-failure ceiling, erases evidence,
  retains the slot, fabricates acknowledgement, or changes child outcome;
- stale generation work creates any parent effect or acknowledgement;
- finalization acknowledges outside exact membership or without exact
  command/fingerprint/message/receipt correlation;
- generic settle/terminal/`message_end`/unrelated events can acknowledge a
  batch;
- execution/terminal evidence changes through batch lifecycle transitions;
- transaction failure leaves partial batch state or stranded delivered rows;
- malformed/oversized/duplicate/cross-thread/noncanonical membership reaches
  dispatch;
- late binding can stay absent after normal startup, bind twice, or race
  construction;
- production recovery can starve despite hydrated managed sessions;
- an old binary redelivers batch-associated rows;
- managed ownership suppresses legacy notification without negotiated
  capability + durable acknowledgement, or double notification occurs;
- Alfie provenance no longer matches the pin;
- F1's mislabeled event begins driving retry/control behavior or false
  durable failure projection;
- Decision 0008 standalone real-Pi evidence reproducibly fails outside
  documented environment/provenance drift;
- the accepted candidate differs materially from `ebf224a6`;
- implementation requires changing Ticket 10, Alfie, or another accepted
  boundary; or
- material new evidence contradicts the governing decisions, ticket criteria,
  or the independent remediation evidence.

## Superseded record

Decision 0015 is superseded only as the active Ticket 09 acceptance verdict.
It remains binding historical evidence of the rejected pre-remediation
protocol and continues to prohibit representing that earlier
delivered-before-effect candidate as crash-safe.
