# Decision 0006 — live lifecycle containment linearization contract

**State:** accepted
**Consultation class:** material technical decision verification for Ticket 03 DG-3; not Ticket 03 acceptance or final project acceptance
**Project Home:** [`../PROJECT.md`](../PROJECT.md)
**Ticket:** [`../issues/03-terminal-before-cleanup-and-live-lifecycle-containment.md`](../issues/03-terminal-before-cleanup-and-live-lifecycle-containment.md)
**Preserves:** local Decisions 0001–0005; inherited durable-subagents Decisions 0012, 0021, 0025, and 0027–0034
**Date:** 2026-08-27

## Question

What minimal live lifecycle containment and linearization contract governs Ticket
03 when the provider becomes inactive, an exact callback is missing or lost,
persistence fails, or callbacks arrive late, while preserving journal-first
terminal truth, proof-before-fence, exact-owner authority, and bands 70–78?

## Decision

Select **Alternative A**: a volatile exact-tuple observation/control proxy that
fails bounded-unavailable when the exact provider callback is inactive or
absent and never buffers, replays, bootstraps, reconstructs, or creates owner
or cleanup proof.

Alternative B, a server-clock inactivity window, is rejected because elapsed
silence is not exact runtime evidence and would duplicate Ticket 04 watchdog
ownership. Alternative C, receipt-assisted authority, is rejected because it
contradicts settled DG-4. A bounded transport or invocation deadline may bound
one call, but it is not a liveness lease or lifecycle timer.

## Authority basis

- Project routing and settled invariants are governed by
  [`../PROJECT.md`](../PROJECT.md).
- Ticket 03 scope and acceptance criteria are governed by
  [`../issues/03-terminal-before-cleanup-and-live-lifecycle-containment.md`](../issues/03-terminal-before-cleanup-and-live-lifecycle-containment.md).
- Decision 0012 establishes sequence-band-40 journal-first terminal truth,
  post-commit notification, first-applicable-terminal ownership, persistence
  retry, and stale tuple accounting.
- Decisions 0021 and 0025 establish that command completion, provider
  inactivity, timeout, session stop, and band-74 handoff are not terminal or
  cleanup proof; a same-generation terminal remains applicable before proven
  teardown.
- Decisions 0027, 0033, and 0034 establish bands 75–78, exact live-owner-only
  control, no parent fallback, no Symphony PID authority, and proven-band-76
  settlement/fencing only.
- Local Decision 0002 requires durable authorization/current-tuple resolution
  before exact live-provider access.
- Local Decision 0003 requires an already-retired exact live route not to be
  reconstructed or used for a second control action.

This decision preserves public `executionId`, attempt/generation fencing,
journal-first terminal truth, proof-before-fence, nonterminal cleanup
uncertainty, exact opaque owner endpoints, controlled Alfie `.6` provenance,
and the prohibitions on replay, Resume, bootstrap, guardian, schema migration,
parent fallback, raw-PID authority, and durable owner receipts.

## Binding contract

### Adapter identity and authority

The adapter is a volatile, session-scoped proxy over the exact current:

```text
(executionId, attemptId, generation, providerSessionInstance)
```

It has two bounded functions:

1. obtain an exact live observation from the provider-owned runtime; and
2. dispatch a live-only control through its existing exact callback or opaque
   owner endpoint.

Before provider access, Symphony must:

1. authorize project/thread/execution scope;
2. resolve the durable current `(executionId, attemptId, generation)` tuple;
3. resolve the callback registration associated with that tuple and provider
   session instance; and
4. reject stale, missing, inactive, disposed, mismatched, or replaced
   registrations.

The adapter is not durable lifecycle authority, owner proof, cleanup proof, a
callback queue, retry journal, provider bootstrap mechanism, or process
supervisor. Registration presence alone proves none of those things.

The adapter must not expose or consume provider `agentId`, raw PID, process
group, provider record, raw session, or unbounded provider output.

### Linearization points

#### Live observation

A live observation linearizes only when the exact provider callback:

1. has entered for the resolved tuple and provider session instance;
2. atomically revalidates that the registration remains current and active;
   and
3. captures the bounded provider-owned snapshot returned for that invocation.

Durable lookup, callback lookup, invocation creation, elapsed time, or eventual
response alone is not the observation linearization point. The snapshot is
only evidence about that exact capture; it is not a lease or proof that the
provider remained live before or after it.

#### Live control

A live control linearizes at the existing provider-owned action's accepted
effect boundary after exact callback revalidation.

- Managed steer retains Decision 0003's synchronous Pi SDK queue-insertion
  boundary.
- Abort, stop, teardown request, or another command may have its own
  provider-owned acceptance boundary, but command acceptance or return is
  never terminal evidence or cleanup proof.
- Teardown proof remains exclusively the validated owner result durably
  committed through band 76.
- If no provider-owned acceptance point was reached, return bounded
  unavailable with zero provider dispatch.
- If acceptance occurred but the response was lost or timed out, return
  outcome unknown. Do not retry, reconstruct, or claim no effect occurred.

#### Terminal lifecycle

A terminal callback linearizes as lifecycle truth only when the sequence-band-
40 journal insertion and guarded aggregate mutation commit successfully in the
existing repository transaction.

Before commit, no public terminal notification or completion delivery may
occur. Callback arrival, callback acceptance, provider return, provider
retirement, and terminal-shaped payloads are not durable terminal truth.
After commit, durable terminal truth has precedence over conflicting live
observation.

#### Cleanup proof and fencing

Cleanup proof linearizes only when a validated exact-owner `proven` outcome
commits through the existing band-76 proof/settlement transaction.

- Bands 70–74, band 75, band 77, and band 78 do not fence generation.
- Callback inactivity/loss, timeout, provider or owner absence, command return,
  and persistence failure do not fence generation.
- No fencing may precede the proven-band-76 commit.
- Band 76 must preserve atomic proof-before-fence and guarded terminal
  settlement.

## Deterministic race outcomes

| Case | Binding outcome |
| --- | --- |
| Terminal before cleanup | A successful band-40 transaction owns terminal outcome. Later handoff or cleanup evidence remains separate and cannot overwrite it, create a second terminal owner, or relabel it as `cancelled`. |
| Cleanup before terminal | Bands 74, 75, 77, and 78 leave the execution nonterminal and unfenced; a current same-generation terminal remains applicable. Only successful band 76 may settle applicable cancellation and fence generation. A terminal afterward is stale history. |
| Same-generation late terminal | Late relative to handoff, uncertain cleanup, callback retirement, or provider inactivity is not stale. If the tuple remains current and no terminal owns the aggregate, band 40 applies normally; otherwise first-applicable-terminal wins. |
| Stale-generation callback | Journal/account it as stale under Decision 0012, emit the stable stale diagnostic, and perform no current aggregate, provider route, cleanup, terminal, or generation mutation. |
| Terminal persistence failure | Emit no terminal notification/delivery. Degrade health and emit the persistence-failure diagnostic. Keep honest durable nonterminal/uncertain state. A bounded retry of the same terminal event may later commit under existing deduplication; do not synthesize terminal, cleanup proof, replay, or a replacement child. |
| Provider inactive before callback acceptance | Return bounded live-lifecycle unavailable with zero provider dispatch and the applicable durable state. Do not infer terminal, cancellation, cleanup, owner loss, or Resume eligibility. |
| Callback missing/disposed before dispatch | Same bounded unavailable result with zero provider effect. No alternate callback, scan, parent fallback, reconstruction, buffering, or replay. |
| Callback timeout/loss after control acceptance | Return bounded outcome unknown. Do not claim success or zero effect and do not retry automatically. Later durable terminal or cleanup evidence settles independently. |
| Terminal callback lost | Durable state remains unchanged because no journal transaction occurred. Do not synthesize terminal truth; a later same-current-tuple terminal remains applicable. |
| Late response from replaced/stale callback | Ignore it after tuple and provider-session-instance revalidation. It cannot mutate current state, restore a route, notify terminal delivery, dispatch a second action, or create owner proof. |

## Provider inactivity and bounded calls

Ticket 03 introduces no server-clock inactivity window. Existing bounded
transport/invocation deadlines may prevent indefinite waiting. Expiration
means:

- `unavailable` when exact provider acceptance is proven not to have occurred;
  or
- `outcome_unknown` when acceptance may have occurred but the response was
  lost.

Deadline expiry is not a provider lease, terminal evidence, cancellation,
cleanup proof, owner proof, permission to fence, permission to retry, or
permission to bootstrap, replay, Resume, or create a child. Watchdog timing and
bands 70–74 remain Ticket 04 territory.

## Stable diagnostics

Diagnostics are bounded, stage-scoped, and use fixed reason enums.

### `pi_subagent_live_lifecycle_unavailable`

Reasons:

- `provider_inactive`;
- `callback_missing`;
- `callback_disposed`;
- `callback_mismatched`;
- `callback_timeout_before_acceptance`.

Meaning: no exact accepted provider action was established. It must not claim
terminal, cancellation, cleanup, owner proof, or zero owned processes.

### `pi_subagent_live_lifecycle_outcome_unknown`

Reasons:

- `callback_lost_after_acceptance`;
- `callback_timeout_after_acceptance`;
- `callback_failed_after_acceptance`.

Meaning: a provider action may have linearized but its returned outcome is
unavailable. Automatic retry, success claims, and zero-effect claims are
prohibited.

### `pi_subagent_live_lifecycle_stale_ignored`

Meaning: a callback or response failed exact attempt, generation, or provider-
session-instance revalidation. It guarantees no current-state or provider-side
follow-up mutation.

Existing terminal diagnostics remain authoritative:

- `pi_subagent_terminal_persistence_failed`;
- `pi_subagent_terminal_stale_ignored`;
- `pi_subagent_event_sequence_gap`.

A same-generation terminal committed after volatile route retirement may emit
`pi_subagent_terminal_late_applied` after commit. It is observational only and
must not become a lifecycle state or delay notification.

Metadata is limited to public tuple identity, stage, phase, fixed reason, and
bounded safe error classification. It must not expose `agentId`, provider
internals, PIDs, transcripts, stack traces, or arbitrary high-cardinality
error text.

## Source and change constraints

Ticket 03 implementation is bounded to:

- one internal live lifecycle containment adapter/module;
- composition and call-site wiring around existing exact-tuple callback/owner
  seams;
- existing terminal ingress, observation/control routing, and focused
  diagnostics;
- deterministic and controlled-runtime tests; and
- the Ticket 03 implementation report.

Not authorized:

- database or journal migration;
- new lifecycle or teardown sequence bands;
- public identity or public API changes;
- raw PID/process-group handling;
- parent-supervisor fallback;
- durable callback/owner receipts;
- callback buffering or replay;
- provider bootstrap, automatic Resume, guardian, or new child creation;
- server-clock inactivity semantics;
- broad watchdog or teardown redesign; or
- weakening controlled Alfie `.6` provenance.

The controlled artifact remains
`3fe340b401ca86bcbe8b55abd4de107e1d93482e` /
`@alfie/pi-subagents@0.15.0-alfie.6`. No Alfie runtime change is authorized. If
exact callback/session-instance validation cannot be implemented against `.6`,
Ticket 03 must fail closed and reopen this decision with exact evidence.

## Verification obligations

Ticket 03 must provide:

1. Deterministic synchronized race tests for terminal-before-cleanup,
   uncertainty before same-generation terminal, band-76 before late terminal,
   first-terminal ownership, stale tuple/session callbacks, terminal
   persistence failure and retry, callback absence before dispatch, response
   loss after acceptance, and late callbacks unable to reopen a route.
2. Exact traces/counters for durable authorization/current tuple, callback
   lookup and validation, provider acceptance point, journal commit/failure,
   callback retirement, notification/suppression, and return classification.
3. Controlled Alfie `.6` integration evidence for tuple/session isolation, no
   scan or `agentId` exposure, sibling/replacement isolation, fail-closed
   callback failures, and unchanged provenance.
4. Non-destructive isolated real-Pi evidence for journal-first terminal commit
   and notification, route retirement followed by applicable same-generation
   terminal, bounded inactive/unavailable behavior, and no replay, Resume,
   bootstrap, new child, parent fallback, or PID authority.
5. Failure/diagnostic evidence for every fixed code/reason at its causal
   boundary, paired with durable evidence or its proven absence. Elapsed-time-
   only tests are not causal proof.

Destructive zero-owned-child proof remains governed by inherited Decisions
0031–0034 and is not a Ticket 03 claim.

## Rejected alternatives

1. Server-clock inactivity window — silence is not exact runtime evidence and
   duplicates watchdog ownership.
2. Receipt-assisted authority — a receipt cannot replace the current exact
   identity-capturing owner and would reopen DG-4.
3. Automatic callback replay/control retry — a lost response may follow a
   linearized side effect.
4. Callback absence as terminal/cancellation — absence is uncertainty.
5. Provider callback return as cleanup proof — only band 76 may prove cleanup.
6. Parent callback/supervisor fallback or provider-record scan — control is
   exact-live-only.
7. Persisted callback registrations — a prohibited durable owner-receipt
   variant.
8. New bands or migration — existing guarded journal transactions are
   sufficient.

## Assumptions and residual uncertainty

- Controlled Alfie `.6` can expose exact callback/session-instance validation
  without runtime changes.
- Existing repository transactions preserve band-40 journal-first and band-76
  proof-before-fence semantics.
- Existing operation deadlines can bound callback invocation without becoming
  lifecycle timers.
- Ticket 04 owns watchdog timing, cancellation escalation, and teardown retry.
- A callback may linearize immediately before connection loss; report outcome
  unknown rather than guessing or retrying.
- Provider retirement may precede failed terminal persistence, leaving honest
  durable nonterminal state with no live callback. Recovery requires a later
  valid terminal retry or later-ticket reconciliation.

## Failure, rollback, and reopening

Rollback may disable the adapter through a bounded fail-closed managed
capability boundary while preserving all durable journal rows. It must not
reinterpret absence, outcome unknown, handoff, survivors, or owner-unproven as
terminal or cleanup proof; restore global lookup/parent fallback; retry
accepted controls; recreate retired routes; rewrite terminal outcomes; delete
bands 70–78; or grant PID/durable-owner authority.

Reopen only if material evidence establishes that:

1. Alfie `.6` cannot atomically bind/revalidate tuple plus provider session;
2. pre-acceptance failure cannot be distinguished from possible post-
   acceptance response loss;
3. current repository transactions violate band-40 or band-76 ordering;
4. same-generation callback admission would weaken terminal ownership;
5. bounded diagnostics cannot distinguish unavailable, outcome unknown,
   persistence failure, and stale callback;
6. a later binding decision changes terminal ownership, bands, exact-owner
   authority, or restart/Resume boundaries; or
7. controlled-artifact provenance changes materially.

## Downstream effect

- DG-3 is settled by Alternative A.
- DG-4 remains closed under inherited Decisions 0027, 0033, and 0034.
- After this record is persisted and cited, Ticket 03 may become
  `ready-for-agent` as the sole frontier.
- Tickets 04–06 remain blocked.
- This decision grants no source implementation beyond Ticket 03's bounded
  scope, no ticket/project acceptance, and no release, push, or deployment.
- The project's single final-acceptance consultation remains reserved for the
  complete integrated project candidate.
