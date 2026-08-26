# Decision 0003 — terminal steer race linearization contract

## Status

**Binding Supervisor decision; semantic arbitration Gate passed.** This record
persists the settled queue-insertion linearization contract for Ticket 02
WP-05/F5. The Supervisor consultation was read-only: this decision does not
authorize source repair, accept Ticket 02, complete WP-05, or open Ticket 03.
It clarifies Decision 0002 and does not supersede it.

- **Date:** 2026-08-26
- **Consultation class:** Project Supervisor material technical decision
  consultation under the Binding Decision Handoff.
- **Project:** [Synara Pi subagent lifecycle reliability](../PROJECT.md)
- **Ticket:** 02 — canonical identity and durable result-read continuity
- **Related authority:** [Decision 0002](0002-canonical-execution-identity-and-result-read-contract.md)
- **Evidence seam:** pinned Alfie managed wrapper and the pinned Pi SDK
  `AgentSession.steer`/`_queueSteer` synchronous queue insertion.

## Question

When an authorized managed steer races terminal/live retirement, what event
linearizes the request, and what may the caller observe when retirement and
natural completion occur before the call returns?

The answer must preserve Decision 0002's exact-live-only control boundary,
durable terminal authority, attempt/generation fencing, no-replay posture, and
provider-identity isolation without inventing a second send or a post-terminal
route.

## Binding direction

A managed steer linearizes exactly when the pinned Pi SDK
`AgentSession.steer`/`_queueSteer` synchronously inserts the steer into the
exact live session queue selected by the authorized current tuple. The queue
insertion is the one and only provider-side insertion event for that request.
The live guard and the synchronous SDK insertion are therefore the decisive
race boundary; an invocation, tuple lookup, promise creation, or later response
is not a linearization event.

The contract has two legal outcomes:

1. **Terminal/live-retirement-first:** if terminal/live retirement wins before
   synchronous SDK insertion, the request returns a bounded
   `unavailable-control` or stale result. There is zero provider queue
   insertion and zero provider send. It must not fall through to another
   record, queue, replay, Resume, bootstrap, reconstruction, or new child.
2. **Queue-insertion-first:** if synchronous SDK insertion wins while the exact
   tuple is live, the request is applied according to the managed steer
   contract because it has linearized. Natural completion and durable terminal
   commit may then occur before the caller's steer promise returns. Such a
   response may still report the applied insertion, but it must not imply a
   second send, a new queue insertion, or a reopened live child.

In both outcomes, durable terminal evidence remains authoritative. Once exact
live retirement wins, the tuple-index entry stays retired. There is no
post-terminal second send, requeue, replay, Resume, bootstrap, reconstruction,
or new child. A response that was already linearized does not override durable
terminal truth or recreate live control.

The public operation remains keyed by `executionId` and the authorized current
`(executionId, attemptId, generation)` tuple. No provider-local `agentId` may
appear in the response, trace exposed to managed callers, diagnostic, or
bookkeeping identity.

## Required ordering and state transitions

The implementation and evidence must make the following ordering observable
without assuming that asynchronous return timing defines the race:

```text
invocation
  -> durable authorization/current-tuple lookup
  -> exact live guard
  -> (if enqueue-first) synchronous Pi SDK queue insertion
  -> exact live retirement and tuple-index removal
  -> durable terminal commit
  -> bounded late bookkeeping
  -> return
```

The terminal-first trace omits the SDK insertion and records the bounded
unavailable/stale return with zero provider insertion/send. The enqueue-first
trace records exactly one SDK insertion before retirement/index removal; it may
record natural completion and durable terminal commit before the await returns,
then bounded bookkeeping and return. Evidence may add scheduler or provider
events, but must retain these named trace points and their causal order.

Terminal/live retirement must remove the exact tuple-index entry before the
terminal durable commit for this race contract. A terminal commit before exact
index retirement is not an alternate accepted ordering; it is a reopening
condition because it can leave a stale live route observable at the authority
boundary.

## Natural completion ordering

Natural completion may win after queue insertion and before the managed steer
call returns. In that enqueue-first interleaving:

- the inserted steer remains the one applied insertion;
- natural completion retires the exact live tuple and removes its index entry;
- durable terminal evidence commits and remains the authoritative result;
- the late steer response may preserve the applied outcome because insertion
  already linearized; and
- no post-terminal provider action, reindexing, replay, Resume/bootstrap,
  reconstruction, or child creation may occur.

If natural completion/live retirement wins before insertion, the terminal-first
outcome applies instead. There is no provider insertion or send to compensate
for the unavailable live child.

Late `activeDelegation` bookkeeping from natural completion is acceptable only
if it cannot reopen status or the exact tuple index, override durable terminal
truth, cause provider action, or leak provider identity. Bookkeeping is not a
new lifecycle authority and cannot turn an already retired tuple back into a
live target.

## Cancellation and generation invalidation

Cancellation must invalidate the relevant generation so post-await
bookkeeping cannot mutate the retired execution, status, tuple index, terminal
truth, or provider route. The cancellation race must prove both sides of the
same insertion boundary:

- if cancellation/invalidated generation wins before synchronous insertion, the
  call returns its bounded cancellation/unavailable outcome and performs zero
  provider insertion/send; and
- if insertion wins first, cancellation cannot retroactively erase the
  linearization event, but it must prevent stale post-await bookkeeping from
  mutating status/index/terminal truth or causing another provider action.

No cancellation completion, natural-completion callback, or late promise
continuation may restore a generation, reinsert a tuple, override terminal
truth, or dispatch a second steer. The generation check must be performed at
every post-await mutation point that could otherwise affect these boundaries.

## Safe and unsafe interleavings

### Safe interleavings

- **Terminal-first:** invocation and tuple authorization complete; the exact
  live guard observes retirement/staleness; index removal and durable terminal
  settlement proceed; the bounded unavailable/stale response returns with zero
  provider insertion/send.
- **Enqueue-first:** invocation, tuple lookup, and live guard complete; the
  pinned SDK synchronously inserts exactly once; natural completion retires the
  tuple and durable terminal evidence commits before return; the response may
  report the already-applied insertion while terminal truth remains durable and
  final.
- **Cancellation-first:** cancellation invalidates the generation before
  insertion; the request has no provider effect and late continuations are
  fenced.
- **Insertion-before-cancellation:** insertion has already linearized;
  cancellation fences all later bookkeeping and provider actions without
  fabricating a second insertion or changing the durable terminal result.

### Unsafe interleavings

The following are not permitted by this decision:

- terminal/live retirement or index removal followed by a provider insertion or
  send for the same request;
- terminal durable commit before exact live index retirement in the governed
  race;
- a second send, queue insertion, requeue, replay, Resume, bootstrap,
  reconstruction, or new child after terminal retirement;
- using a stale tuple, global provider scan, reconstructed record, or provider
  `agentId` to rescue an unavailable steer;
- a late natural-completion or cancellation continuation reopening status or
  the tuple index, overriding durable terminal truth, or causing provider
  action;
- an applied result without exactly one prior synchronous SDK insertion; or
- exposing provider identity or unbounded provider internals through the race
  response, diagnostic, or trace.

## Required deterministic and isolated real-Pi evidence

WP-05 must prove the contract as evidence, not as a source-change
authorization. The deterministic suite must contain separate, synchronized
cases for:

1. terminal/live-retirement-first;
2. queue-insertion-first, including natural completion and durable terminal
   commit before the steer call returns; and
3. cancellation/generation invalidation, including post-await bookkeeping
   fencing.

The isolated real-Pi suite must contain separate terminal-first and
enqueue-first cases against the exact controlled production artifact and exact
SDK path. Each case must capture the ordered trace containing invocation,
tuple lookup, live guard, SDK insertion when it occurs, retirement/index
removal, durable commit, bookkeeping, and return. It must assert provider
mutation/target counts, exactly one insertion for enqueue-first, zero
insertion/send for terminal-first, zero replay/Resume/bootstrap/reconstruction
/new-child counters, durable terminal precedence, and bounded diagnostics.

The evidence must record the exact artifact and SDK versions, including the
WP-04 Alfie artifact commit `73bc7744f8fbbd12206302de2df8230b29a49178`,
`@alfie/pi-subagents@0.15.0-alfie.5`, and Pi SDK
`@earendil-works/pi-coding-agent@0.83.0`, together with the manifest/provenance
hashes and isolated runtime configuration. Deterministic, controlled-Alfie,
and isolated real-Pi rows remain distinct; none may be relabeled as another.

## Review reconciliation

Decision 0003 is the settled repair to the previously open WP-03 F5 wording.
WP-05 must update its F5 description, required leg, evidence matrix,
verification commands, and self-review so both terminal-first and
enqueue-first strands, plus cancellation, are explicit. The update remains
planning-only and must preserve Ticket 02's status, WP-05's pending state, and
Decision 0002's scope.

This decision does not claim that any required test has run or passed. A
missing dependency, unavailable exact artifact, dirty provenance boundary,
or failed isolated real-Pi leg is an evidence limitation or implementation
failure to report honestly, not permission to weaken this contract.

## Rejected alternatives

1. **Always return unavailable once terminal evidence exists:** rejected. It
   would incorrectly discard a steer that synchronously inserted before
   retirement and would confuse call-return timing with linearization.
2. **Treat a late return as proof that no steer applied:** rejected. Natural
   completion and durable terminal commit may occur after insertion but before
   the promise returns.
3. **Send after the live guard or rescue through replay/bootstrap/reindex:**
   rejected. Control is exact-live-only and no post-terminal side effect is
   authorized.
4. **Make terminal durable commit the sole race boundary before index
   retirement:** rejected. The exact live guard and index retirement must win
   before the governed terminal commit; otherwise a stale route can remain
   observable.
5. **Allow late bookkeeping to settle status/index opportunistically:**
   rejected. Only constrained bookkeeping is safe; it cannot reopen, override,
   act, or leak.
6. **Treat cancellation as an after-the-fact response decoration:** rejected.
   Cancellation must invalidate generations and fence every post-await
   mutation point.
7. **Use a synthetic Agent or mutable/global Pi home for real-Pi proof:**
   rejected. The real-Pi obligation requires the controlled artifact and
   registered production Agent/SDK path.

## Assumptions

- The pinned Pi SDK's `AgentSession.steer`/`_queueSteer` insertion is
  synchronous at the exact version recorded above; no pre-insertion async
  yield exists in the exercised path.
- The pinned Alfie managed wrapper exposes the exact live/status guard and
  tuple-index retirement needed to observe the boundary without a global scan.
- Existing Decision 0002 journal-first terminal, durable current-tuple,
  authorization, capability, boundedness, and no-replay contracts remain in
  force.
- WP-05 can synchronize the provider/model boundary without changing
  production lifecycle semantics or adding a migration.

## Residual risks

- A future Pi SDK or Alfie release may make queue insertion asynchronous,
  introduce a pre-insertion yield, or change the exact live guard; the evidence
  then no longer proves this contract.
- Provider/model scheduling can make the enqueue-first trace timing-sensitive;
  synchronization must prove causal order rather than rely on elapsed time.
- A late bookkeeping path can regress silently if it gains a new status/index or
  provider side effect; the ordered trace and post-race counters must remain
  regression gates.
- Real-Pi evidence remains bounded by the isolated artifact, SDK, runtime, and
  model-server configuration actually recorded by WP-05.

## Reopening, rollback, and downstream effects

Reopen Decision 0003 if evidence shows that SDK insertion becomes async, a
pre-insertion yield appears, terminal can commit before exact index retirement,
post-terminal send/reindex/terminal override occurs, cancellation fails to
invalidate the generation, or an applied result occurs without exactly one
prior insertion. A test inconvenience, provider eviction, or late return by
itself is not a reopening reason.

Rollback must preserve Decision 0002's durable `executionId`, attempt,
generation, terminal, and result evidence. It may disable the managed capability
or the versioned race implementation only through a bounded fail-closed
boundary; it must not rewrite durable identity, requeue or replay work, restore
a retired index, or reinterpret a terminal result.

Decision 0003 clarifies Decision 0002 only. It leaves Ticket 02 pending and
ready-for-agent, keeps WP-05 as the current package frontier, leaves Tickets
03–06 blocked, and authorizes no source change, migration, release, push,
deploy, or final acceptance.

## Binding summary

Managed steer linearizes on synchronous insertion by the pinned
`AgentSession.steer`/`_queueSteer` into the exact live session queue. Retirement
before insertion yields bounded unavailable/stale with zero provider effect;
insertion before retirement may be applied even when natural completion and
durable terminal commit precede return. Durable terminal truth remains the
authority, the exact index stays retired, and no post-terminal second action or
reconstruction is allowed. Cancellation invalidates generations so late
bookkeeping cannot mutate lifecycle truth. WP-05 must prove terminal-first,
enqueue-first, and cancellation deterministically, and terminal-first and
enqueue-first against isolated real Pi, with exact ordered traces and exact
artifact/SDK provenance.
