# Decision 0016 — Ticket 09 crash-safe parent-effect technical direction

## Status

**accepted — binding technical direction**

Decisions 0001–0015 remain authoritative and unchanged. Ticket 09 remains
unaccepted; this record authorizes only the remediation required by Decision 0015.

## Date

2026-08-18

## Question

Which durable parent-effect boundary, batch mechanism, recovery ownership,
identity scheme, acknowledgement correlation, retry behavior, rollback
assumption, and layering seam must remediate Decision 0015 before Ticket 09
implementation resumes?

## Governing references

- `.planning/synara-pi-durable-subagents/PROJECT.md`
- `.planning/synara-pi-durable-subagents/decisions/0013-t08-durable-completion-outbox-final-acceptance.md`
- `.planning/synara-pi-durable-subagents/decisions/0014-t10-restart-reconciliation-final-acceptance.md`
- `.planning/synara-pi-durable-subagents/decisions/0015-t09-per-thread-completion-coordinator-final-acceptance-remediation.md`
- `.planning/synara-pi-durable-subagents/issues/09-per-thread-completion-coordinator.md`
- committed coordinator, PiAdapter, OrchestrationEngine command-receipt,
  provider-delivery, and queued-turn-promotion mechanisms at `a9b2fe85`.

## Evidence considered

- Current code marks outbox rows `delivered` before direct `session.prompt`;
  process loss can strand them permanently.
- Pi `session.prompt` has no idempotency key and resolves after the full turn.
  A claim/lease around it cannot distinguish accepted-before-loss from
  never-accepted.
- `OrchestrationEngine.dispatch(thread.turn.start)` atomically persists the
  deterministic parent message, immediate or queued turn intent,
  fingerprint-matched command receipt, and projection changes.
- Same command ID plus byte-identical command replays the accepted receipt
  without appending another message/turn request; changed content fails closed.
- Busy roots create durable queued-turn events; existing queued-turn
  promotions provide downstream claim and restart recovery.
- Completion recovery currently has no independent production driver, while
  managed parent sessions are lazy and may be absent at boot.
- Generic thread-level `message_end` can acknowledge an unrelated turn and is
  not a valid recovered-batch correlation mechanism.

## Settled direction

Adopt a bounded immutable completion-dispatch batch ledger and deterministic
internal `thread.turn.start` command. Treat a fingerprint-matched accepted
orchestration command receipt as the sole parent-effect acceptance and
acknowledgement proof. Finalize only exact batch/message/command membership.
Reuse existing provider delivery and queued-turn promotion. Use no
correctness-critical bespoke lease. Drive Ticket 09 recovery when the
dispatcher and relevant managed parent boundary become available.

## 1. Parent-effect acceptance boundary

The parent effect is accepted exactly when `OrchestrationEngine` commits a
fingerprint-matched `accepted` receipt for the batch's deterministic internal
`thread.turn.start` command.

That transaction must durably establish together:

- the deterministic parent user message;
- an immediate turn-start or durable queued-turn request;
- the command fingerprint; and
- the accepted command receipt/result sequence.

The coordinator must not call Pi `session.prompt` directly or infer acceptance
from outbox `delivered`, a claim/lease, promise invocation/timeout, provider
session presence, `message_end`, provider completion, or queued-promotion
state. After receipt acceptance, ordinary provider-delivery and queued-turn
recovery own downstream delivery.

## 2. Durable schema and membership

Create `pi_subagent_completion_dispatch_batches` and add a nullable guarded
batch association to completion-outbox rows. No separate membership table is
required while the accepted maximum batch remains bounded.

The batch must persist at least:

- primary `batch_id`;
- `parent_thread_id`;
- unique deterministic `parent_command_id`;
- deterministic `parent_message_id`, unique within the parent thread;
- protocol/fingerprint version;
- canonical command fingerprint;
- canonical bounded ordered outbox-ID JSON;
- frozen bounded parent message text;
- frozen canonical `thread.turn.start` payload including every
  fingerprint-bearing field;
- state and attempt count;
- nullable accepted receipt sequence;
- bounded last-error/diagnostic evidence; and
- created/updated/accepted/acknowledged/superseded/exhausted timestamps.

States must distinguish awaiting acceptance, retryable boundary failure,
accepted, acknowledged/finalized, superseded, and exhausted/permanent failure.

Batch creation transactionally:

- selects current generation-applicable `pending` or within-budget
  `failed_retryable` rows for one parent thread in canonical order;
- caps membership at the configured maximum;
- creates immutable batch content;
- associates every member exactly once;
- transitions members to existing prepared/`delivered` state only as batch
  membership evidence; and
- supersedes stale members before any parent command submission.

`delivered` is not parent-effect acceptance proof. Duplicate, noncanonical,
cross-thread, missing, oversized, or multiply associated membership fails
closed.

A partial unique index on `parent_thread_id` over all nonterminal batch states
is the durable one-outstanding authority. In-memory maps and optional leases
are optimizations only.

## 3. Stable identity and frozen payload

Use a versioned, domain-separated deterministic hash over protocol version,
parent thread ID, and canonical ordered stable outbox IDs. Derive separately
typed batch, orchestration-command, and parent-message IDs with distinct domain
prefixes.

Freeze the complete fingerprint-bearing command when the batch is created:
timestamp, dispatch mode, origin, runtime/interaction modes,
assistant-delivery mode, deterministic message ID, parent thread, and bounded
completion message. Retry submits stored content byte-for-byte; it does not
rebuild from current time, session configuration, summaries, or harness
policy.

Before dispatch, recompute and compare the canonical fingerprint. Payload
drift, malformed membership, or identity collision fails closed. Identity
rotation is forbidden.

## 4. Claims and leases

No bespoke claim/lease is required for correctness. Correctness authority is:

- guarded transactional batch creation and member association;
- partial unique active-batch index;
- stable command/message/batch identities;
- atomic orchestration command receipts;
- existing durable provider-event delivery; and
- existing queued-turn promotion recovery.

An optional short lease may only reduce redundant attempts; it cannot signal
acceptance, alter identity/membership, strand ownerless work, permit another
active batch, suppress receipt recovery, or become necessary for correctness.

## 5. Recovery ownership and Ticket 10 boundary

Ticket 09 owns recovery of awaiting-acceptance and within-budget retryable
batches. Recovery triggers when progress can be made:

- dispatcher binding/availability;
- relevant managed parent session hydration/start;
- coordinator availability for that parent;
- that parent reaching its safe boundary;
- a new completion for that parent; and
- a bounded ongoing Ticket 09 scan while eligible managed sessions exist.

Boot may discover work, but absent lazy sessions are not failure and must not
be eagerly synthesized solely for completion delivery. Busy, unavailable-yet-
hydratable, waiting-for-dispatcher, and receipt replay consume no retry budget.

Ticket 10 remains unchanged: it owns journal-to-outbox recovery and execution
restart reconciliation, not batch creation/redrive, parent command submission,
acknowledgement, session hydration, or completion-dispatch sweep.

## 6. Exact acknowledgement and local finalization

Receipt confirmation must match:

- batch ID and immutable membership;
- exact deterministic parent command ID and stored fingerprint;
- accepted receipt sequence; and
- parent message ID in the accepted command's committed event set.

After that proof, recovery transactionally marks the batch
accepted/acknowledged, acknowledges only associated outbox members, and
releases the active-thread slot. Finalization is replayable and idempotent.
It does not wait for the full Pi turn; the durable parent message/turn request
is the accepted effect and provider execution is downstream.

Generic `message_end`, provider terminal, user turn, parent settle, or
session-ready events may trigger recovery checks but cannot acknowledge a
batch.

## 7. Rejection and retry accounting

A fingerprint-matched persisted rejection is immutable. On first confirmed
rejection, record bounded evidence and one genuine boundary-failure attempt
under the same identity. Later replay of the same known rejection does not
repeatedly increment counters; because that identity cannot become accepted,
settle the batch exhausted/permanently failed at the configured retry ceiling.

Transient no-receipt failures remain retryable under the stable identity.
Busy/wait/unavailable, receipt replay, recovery inspection, and supersession
consume no attempts. Fingerprint collision is permanent fail-closed, not a
retryable transport failure.

## 8. Rollback and mixed versions

The migration is additive. Old binaries may pause liveness for associated
`delivered` rows but must not reinterpret or redeliver them. Returning to the
remediated binary resumes receipt-based recovery. Evidence deletion/schema
rollback is unauthorized.

Concurrent old/new binaries sharing one database remain unsupported and must
be operationally prevented. Existing negotiated
`completion-delivery-ownership` behavior remains unchanged; no Alfie change,
version bump, or provenance re-pin is authorized.

## 9. Layering and dependency injection

Introduce a narrow parent-effect dispatcher port accepting the frozen internal
command and returning exact accepted receipt, exact persisted rejection,
identity collision, transient/no-receipt failure, or unavailable/busy.

The implementation calls `OrchestrationEngine.dispatch`; it must not insert or
interpret receipts itself or duplicate fingerprint/replay logic.

Avoid the `OrchestrationEngine → ProviderCommandReactor → ProviderService /
PiAdapter` construction cycle with a composition-owned, single-assignment,
late-bound bridge:

- construct the port before the provider layer;
- bind once when the engine is live;
- pre-bind calls return unavailable without retry accounting;
- rebinding is forbidden; and
- binding triggers recovery for hydrated managed parents.

PiAdapter may signal terminal/session-hydration/parent-settle events, but may
not import/construct `OrchestrationEngine`, query receipts, or dispatch
internal commands directly.

## 10. Required remediation evidence

Deterministic evidence must prove:

- loss after batch/member commit but before command submission → same batch
  recovers and commits one message;
- loss after accepted receipt but before local finalization → same receipt
  replays, no second message/turn request, finalization once;
- timeout/no receipt → byte-identical retry;
- accepted despite caller timeout → receipt recovery, no duplicate;
- altered payload under same ID → fail-closed collision, no rotated identity;
- persisted rejection → one genuine failure, no repeated increments,
  terminal exhaustion under same identity;
- concurrent recovery → one batch/effect;
- later same-thread completions remain outside active batch;
- another thread remains independent;
- busy/lazy parent consumes no retry and recovers on exact trigger;
- restart without new terminal still recovers after dispatcher/session
  availability;
- queued acceptance creates one message and uses existing promotion recovery;
- unrelated parent/provider events cannot settle the batch;
- stale-before-creation and stale-before-submission produce zero command;
- execution/terminal evidence remains byte-stable through every batch state;
- transaction failure leaves no partial batch or stranded delivered rows;
- malformed/oversized/duplicate/cross-thread/noncanonical membership fails
  closed;
- rollback leaves evidence inert and new code later recovers without duplicate;
- mixed managed/legacy behavior remains unchanged;
- coordinator, outbox, receipt, provider-delivery, queued-promotion, and
  Decision 0008 real-Pi regressions pass; and
- the Implementation Report records the actual sequence: immutable batch
  commit → exact command/receipt acceptance → receipt-correlated finalization.

## Rejected alternatives

- Outbox lease plus direct Pi prompt: cannot close both crash boundaries.
- Moving `delivered` after direct prompt: exchanges loss for duplication.
- Rescanning delivered rows with direct prompt: duplicates accepted effects.
- Full Pi turn completion as acceptance: preserves a long unresolvable window.
- Generic thread `message_end` acknowledgement: can settle unrelated work.
- Queued-turn promotions without batch ledger: no immutable membership or
  durable one-active-batch authority.
- Bespoke provider queue: duplicates accepted orchestration infrastructure.
- Identity rotation after rejection/collision: violates stable idempotency.
- Mandatory lease: adds complexity without correctness.
- Expanding Ticket 10 or modifying Alfie: outside accepted boundaries.

## Assumptions and residual uncertainty

- SQLite transactional/partial-index/FK/uniqueness behavior remains as tested.
- Bounded canonical JSON remains appropriate while the batch cap is small.
- Orchestration command acceptance stays atomic with message and turn/queue
  events.
- Existing queued-turn promotion owns post-acceptance busy delivery.
- Concurrent mixed binaries remain unsupported.
- Migration number, TypeScript names, hash encoding, and textual prefixes are
  implementation details if they preserve this versioned contract.
- Retention of acknowledged batches must preserve existing operational
  evidence requirements.

## Downstream effect

- Ticket 09 remains unaccepted; T09-AC4 remains open and Ticket 11 blocked.
- Ticket 10 remains accepted and unchanged.
- Decisions 0013–0015 remain binding.
- No Alfie change or rollout is authorized.
- Implementation may proceed only after this record is routed from Project
  Home.

## Failure and rollback implications

- Pre-acceptance failure remains recoverable under the same immutable batch.
- Post-acceptance/pre-finalization failure resolves by exact receipt replay.
- Permanent rejection/collision preserves evidence and child outcome.
- Old code pauses liveness but cannot duplicate/reinterpret persisted evidence.
- Removing batch association, active unique index, frozen payload, or exact
  receipt correlation reopens Decision 0015.

## Reopening conditions

Reopen through a new Decision/Reassessment if evidence shows:

- receipt acceptance is not atomic with deterministic message and turn/queue;
- same-ID matching replay appends duplicate content;
- queued-turn recovery cannot deliver accepted completion messages;
- two active batches can exist for one parent;
- crash can leave members outside recoverable outbox and batch state;
- finalization can acknowledge unrelated content;
- late binding introduces an uncontained construction/startup race;
- old code can redeliver associated rows instead of pausing;
- exhaustion rewrites child outcome or erases evidence;
- bounded JSON membership no longer holds; or
- implementation requires changing Ticket 10, Alfie, or another approved
  boundary.
