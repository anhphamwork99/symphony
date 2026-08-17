# 0006 — Ticket 22 bounded foreground attachment technical direction

**Status:** Accepted

**Date:** 2026-08-17

**Decision type:** Project Supervisor material technical decision verification

**Integrated baseline:** Symphony `3f10133b`; accepted Decisions 0001–0005;
Ticket 22 is the blocker-free remediation frontier.

## Question

What cross-repository technical contract must Ticket 22 use for:

1. ownership of bounded foreground attachment;
2. trustworthy started and detached lifecycle evidence and durable ordering;
3. capability negotiation and legacy fallback;
4. timer, promise, registry, session, and cancellation cleanup;
5. foreground wait configuration and timing tolerance;
6. lifecycle-persistence failure semantics;
7. Symphony/Alfie write boundaries and provenance; and
8. explicit non-goals?

This decision verifies an implementation direction. It is not Ticket 22 final
acceptance.

## Governing references

- `../PROJECT.md` — accepted Project Contract routing and Ticket 22 frontier.
- `../spec.md` — extension-owned live execution, Symphony-owned durable
  control/observation, bounded foreground attachment, parent-turn cancellation,
  journal durability, mixed-version safety, and out-of-scope boundaries.
- `../issues/22-real-bounded-foreground-attachment.md` — T22-AC1 through
  T22-AC8 and owner-approved Testing Seams.
- `0001-testing-strategy-governance.md` — public-boundary, failure-pairing,
  real-Pi, persistence-reopen, and diagnostic evidence requirements.
- `0002-t18-migration-lineage-final-acceptance.md` — accepted schema and
  migration-lineage baseline.
- `0003-t19-real-pi-capability-final-acceptance.md` — accepted real-Pi
  capability, mixed-version, listener-ownership, and provenance baseline.
- `0004-t20-atomic-authorized-production-admission-final-acceptance.md` —
  authoritative sequence-1 atomic admission and identity baseline.
- `0005-t21-production-fail-closed-control-health-final-acceptance.md` —
  authoritative adapter-lifetime shared health, fail-closed admission, recovery,
  warning, and legacy-bypass baseline.

Decisions 0001–0005 remain authoritative and are not reopened.

## Evidence

Current source inspection establishes:

- Symphony `PiAdapter` wraps the actual negotiated `Agent` tool, atomically
  admits a managed execution, passes server-minted execution/attempt/generation
  identities into the original tool, and then awaits the original tool
  unbounded.
- The production path does not currently call
  `PiSubagentExecutionRepository.recordLifecycleEvent` for child-started or
  foreground-detached observations.
- The repository already supports attempt/generation-local lifecycle sequencing,
  idempotent event identity, metadata, durable journal ordering, aggregate
  updates, and database reopen. Ticket 22 therefore does not require a schema
  migration.
- Alfie's actual foreground path owns the child through
  `AgentManager.spawnAndWait`, emits progress on an approximately 80 ms spinner
  interval, and waits for child settlement without a foreground bound.
- Alfie's `AgentManager` owns the child session, operation token, promise,
  parent-abort listener, abort path, stale-settlement protection, queue/live
  registry, and session disposal. Moving only the timeout to Symphony would
  split attachment arbitration from live ownership.
- Existing capability negotiation requires `managed-spawn` and
  `abort-propagation`, but those capabilities do not prove that an extension
  implements bounded foreground attachment or lifecycle reporting.
- The real-extension acceptance gate pins the exact Alfie commit and SHA-256
  hashes for the extension package manifest, `src/index.ts`, and
  `src/agent-manager.ts`. Any Ticket 22 Alfie change therefore requires a new
  provenance pin and hashes.

The designer recommendation is supporting evidence only. Its ownership,
ordering, capability, and fail-closed directions conform to governing
authority. Its concrete 250 ms persistence grace was not independently
authorized by the Project Contract.

## Decision

### 1. Alfie owns foreground attachment arbitration

The actual Alfie extension must own the single arbitration among:

- child settlement;
- foreground budget expiry;
- parent-turn cancellation;
- startup failure; and
- session or explicit cleanup.

A managed foreground child that settles before the budget returns the same
normal inline result and does not create a follow-up delivery.

If the budget wins while the same child is active, Alfie changes only the
parent-tool attachment state, durably records detach, and returns the existing
execution handle. It must not spawn, resume, clone, or otherwise replace the
child.

Symphony must not wrap `originalExecute` in a separate `Promise.race`. A
Symphony-only timeout would release the tool transport without atomically
changing Alfie's attachment ownership, lifecycle reporting, timer ownership,
or cleanup state and is therefore rejected.

The managed foreground path must remove the legacy 80 ms spinner publication.
Legacy unmanaged foreground behavior remains unchanged.

### 2. Lifecycle evidence and durable order

Ticket 20's atomic admission remains sequence 1 and is not changed:

1. sequence 1: `accepted`, committed before child start;
2. sequence 2: `running`, metadata identifying the `started` observation;
3. sequence 3: `running`, metadata identifying the foreground `detached`
   observation.

Sequence 2 must originate from Alfie's actual child-start transition, after
`AgentManager` has created the concrete record and transferred it to running
ownership. Symphony-side inference from admission, elapsed time, tool
invocation, or a synthetic Agent replacement is not trustworthy started
evidence.

Sequence 3 must originate from Alfie's attachment arbiter only after the
foreground deadline wins for that still-active concrete operation. It records
an attachment transition, not a new execution-state transition; therefore
`running` with bounded metadata is correct. Detach must preserve:

- `executionId`;
- `attemptId`;
- `generation`;
- Alfie record and child session;
- operation token;
- child promise; and
- `parent_turn` cancellation scope.

The sequence-2 event must commit before either successful inline publication or
successful detach publication. The sequence-3 event must commit before the
execution handle is returned.

Lifecycle event IDs must be deterministic or otherwise retry-stable for the
execution/attempt/generation/phase so retries converge through the repository's
existing idempotency rules. Metadata must be bounded and contain no prompt,
result, transcript, or raw error content.

Database reopen evidence must recover the same non-terminal execution aggregate
and the ordered sequence-1/2/3 journal, including the started/detached metadata.

Ticket 22 must not add a second admission event, renumber sequence 1, or convert
detach into a terminal, cancelling, queued, or independent state.

### 3. Capability negotiation and legacy fallback

Bounded foreground attachment and durable lifecycle reporting require an
explicit additive capability, named:

`bounded-foreground-attachment`

Symphony must require this capability before enabling Ticket 22 managed
semantics. The capability may remain within protocol version 1 because the
existing handshake already supports additive named capabilities and reports
missing capabilities explicitly.

The in-process bridge must provide an explicit host-to-extension managed
runtime binding through which Alfie receives:

- the validated foreground budget; and
- a Symphony-owned durable lifecycle reporter.

The exact private function or symbol spelling is an implementation detail, but
it must not be model-supplied, inferred from untrusted Agent arguments, or
globally shared across unrelated Pi sessions.

A bridge that is absent, malformed, version-incompatible, or missing the new
capability must not receive managed admission, bounded-detach labeling, or
durability claims. Its actual Agent tool continues under legacy unmanaged
semantics.

An adjacent legacy session and concurrent managed sessions must have
independent timers, identities, reporters, results, and cleanup.

### 4. Promise, timer, registry, and cancellation ownership

Each managed foreground invocation owns exactly one foreground deadline timer.
Every path must clear or settle that timer:

- inline child settlement;
- successful detach;
- startup failure;
- lifecycle-report failure;
- parent abort;
- session disposal; and
- explicit cleanup.

Detach must not abort the child, clear its operation token, remove its parent
abort listener, dispose its session, or discard its promise. Alfie's existing
operation-token and stale-settlement guards remain authoritative.

After detach, the child remains in Alfie's live ownership registry until actual
settlement, parent cancellation, session disposal, or explicit cleanup.
Settlement must remove any Ticket-22-specific live attachment/observation entry
and timer. This does not require deleting a bounded historical result record
that Alfie legitimately retains for result retrieval.

Session disposal and explicit cleanup must abort and clean only the records
owned by that session or requested execution. Cleanup of one managed execution
must not stop or remove an unrelated managed or legacy child.

The existing `parent_turn` signal remains attached across detach. Detach does
not create cancellation independence.

### 5. Foreground configuration and timing tolerance

The production configuration contract is:

- environment key:
  `SYNARA_PI_SUBAGENT_FOREGROUND_WAIT_MS`;
- default: `10000` ms;
- accepted range: integer `100` through `60000` ms, inclusive;
- invalid policy: unset, empty, non-numeric, non-finite, fractional,
  under-range, or over-range values fall back to `10000` ms;
- invalid values are not clamped to the nearest endpoint.

Symphony resolves and validates the value once as server policy and supplies
the resolved number to the negotiated Alfie managed-runtime binding. Alfie
must not read arbitrary model arguments as the policy source. The setting does
not change legacy sessions.

For T22 acceptance, a long child on a functioning test event loop must return
the handle no later than:

`configured budget + 500 ms`

The 500 ms is the bounded production-call-chain acceptance envelope for local
durable detach plus ordinary scheduling jitter. It is not a general service
level, an allowance to add a second foreground wait, or evidence that a
blocked JavaScript event loop can meet wall-clock deadlines.

Bounds parsing should be tested without waiting 60 seconds. The actual Pi
boundary must exercise at least the default, one valid short budget, and invalid
fallback, with exact elapsed times recorded.

### 6. Lifecycle-persistence failure semantics

Lifecycle evidence is non-droppable. If sequence 2 or sequence 3 persistence
returns failure after the child has started:

1. do not return an inline success or successful detached handle;
2. transition the existing adapter-lifetime shared control health to degraded
   using the accepted Ticket 21 mechanism;
3. request abort of the exact Alfie child;
4. preserve the already-committed sequence-1 admission and any earlier
   lifecycle truth;
5. return the stable
   `pi_subagent_lifecycle_persistence_failed` diagnostic; and
6. do not claim `cancelled`, `failed`, or any other terminal state without the
   evidence owned by later lifecycle/terminal work.

Abort is containment of potentially untrackable live work. It is not terminal
acknowledgement. If abort cannot be acknowledged, the durable state and
diagnostic must remain honest about that uncertainty.

A failure for one execution must not mutate an unrelated execution's aggregate,
timer, registry ownership, or result.

No separate 250 ms persistence grace is authorized. It would introduce another
policy constant without governing evidence and could create a late-commit race
if implemented as a naïve `Promise.race`.

The accepted 500 ms end-to-end tolerance is sufficient for Ticket 22's
success-path acceptance evidence. A lifecycle reporter that can remain pending
forever is a recorded operational uncertainty, not permission to let the
foreground path wait indefinitely. Before implementation acceptance, the
planner must choose a single Alfie-owned deadline mechanism that preserves
late-write truth and the failure behavior above, without adding a second
Symphony timeout or silently discarding a late repository outcome.

A demonstrated hanging lifecycle-store incident, or evidence that the
single-envelope mechanism cannot preserve both bounded return and durable truth,
requires Reassessment rather than an invented additional grace.

### 7. Authorized write surfaces and provenance

Ticket 22 may change only the cross-repository surfaces needed for this
behavior.

Expected Alfie surfaces:

- `agent/extensions/pi-subagents/src/index.ts` — real Agent foreground
  arbitration, managed-only spinner suppression, bridge/runtime binding,
  lifecycle reporting, handle response, and session cleanup;
- `agent/extensions/pi-subagents/src/agent-manager.ts` — only the minimal API or
  ownership hooks needed to expose the existing child record/promise/start
  transition and clean Ticket-22-specific live state;
- focused Alfie extension tests.

Expected Symphony surfaces:

- `packages/contracts/src/piSubagents.ts` and focused tests — additive
  `bounded-foreground-attachment` capability and already-supported lifecycle
  metadata typing if needed; no unrelated contract expansion;
- `apps/server/src/config.ts`, `apps/server/src/main.ts`, and focused config
  tests — foreground budget resolution;
- `apps/server/src/provider/piSubagentBridge.ts` — capability and session-local
  durable-reporter binding;
- `apps/server/src/provider/Layers/PiAdapter.ts` — production binding of the
  validated policy and repository-backed reporter, without a Symphony
  attachment race;
- focused PiAdapter, bridge, persistence-reopen, cleanup, concurrency, and
  real-extension tests;
- `apps/server/src/provider/test-fixtures/piSubagentExtensionProvenance.json` —
  updated Alfie pin and hashes;
- Ticket 22 Implementation Report.

The planner may narrow this set when existing seams suffice. Expanding into UI,
completion delivery, cancellation APIs, migrations, or unrelated provider
adapters requires separate authority.

Alfie changes must be committed first. Symphony must then pin the exact Alfie
commit and recompute every tracked extension hash. Real-extension verification
must use that exact clean Alfie checkout. Uncommitted sibling source, a synthetic
replacement tool, or an unpinned extension cannot satisfy T22-AC8.

No database schema or migration change is authorized: the accepted repository
already stores running lifecycle events, bounded metadata, aggregate state, and
journal order needed by Ticket 22.

### 8. Explicit non-goals

Ticket 22 does not own:

- a new sequence-1 admission model or requested-phase event;
- persisted or process-independent control health;
- true child continuation across Symphony restart;
- automatic replay or resume after restart;
- cancellation independence after foreground detach;
- durable cancellation intent or cancellation acknowledgement, owned by
  Ticket 06;
- progress coalescing, heartbeat policy, or progress delivery, owned by
  Ticket 23;
- terminal lifecycle, completion outbox, notification batching, or completion
  follow-up ownership, assigned to later tickets;
- execution queueing, quotas, watchdog escalation, or external workers;
- UI execution cards, reconnect projection, or transcript pagination;
- scheduled subagents;
- changes to Alfie's steer, resume, stale-settlement, operation-token, or
  terminal-ownership semantics;
- replacing the real Alfie Agent tool with a Symphony or test-only Agent tool;
- a schema migration; or
- remote push, publication, deployment, or release.

## Rejected alternatives

### Symphony-only `Promise.race`

Rejected because it releases the parent transport outside the component that
owns the child promise, operation token, abort listener, and live registry. It
cannot provide atomic detach evidence or reliable cleanup.

### Reusing only `managed-spawn`

Rejected because an older extension may support managed identity and abort
propagation while still waiting forever in foreground. That capability does not
prove Ticket 22 semantics.

### Inferring start in Symphony after admission

Rejected because admission precedes child start and cannot prove that Alfie
created or started the actual child.

### Treating detach as a new child, background respawn, or cancellation-scope change

Rejected because T22-AC2 and T22-AC3 require the same concrete child and the
same parent-turn cancellation scope.

### Returning the handle before sequence-3 persistence

Rejected because reconnect or database reopen could then recover only accepted
or started truth while the user had already been told the execution detached
durably.

### Continuing after lifecycle-write failure

Rejected because lifecycle is non-droppable and the project requires degraded
control health when lifecycle cannot be persisted. Continuing would create
work whose attachment truth is not durable.

### Claiming cancellation immediately after containment abort

Rejected because abort dispatch is not cancellation acknowledgement or
owner-death evidence.

### Clamping invalid foreground configuration

Rejected in favor of a stable default fallback. Clamping malformed operational
input can silently convert an operator mistake into an unintended extreme wait.

### Separate 250 ms persistence grace

Rejected as an unsupported second constant and a source of late-write races.
Ticket 22 has one budget-plus-tolerance envelope.

### New migration or generalized lifecycle framework

Rejected because the accepted schema and repository already provide the needed
event, metadata, ordering, aggregate, and reopen behavior.

### Ticket 23 progress, Ticket 06 cancellation, or later terminal/outbox work

Rejected as scope expansion. Ticket 22 must preserve their boundaries.

## Assumptions and residual uncertainty

- The supplied Symphony HEAD `3f10133b` is the integrated implementation
  baseline for planning.
- The current real Alfie foreground and manager paths inspected are the paths
  pinned by the existing provenance gate.
- Local SQLite lifecycle commits normally fit within the 500 ms acceptance
  envelope; this is to be verified, not assumed as final-acceptance evidence.
- JavaScript timer delivery cannot provide a hard wall-clock guarantee while
  the event loop is blocked.
- The exact private shape used to register the session-local lifecycle reporter
  remains an ordinary implementation detail so long as it satisfies capability
  gating, ownership, isolation, and cleanup requirements above.
- A truly non-settling lifecycle-store operation remains a residual operational
  uncertainty. The implementation must not hide it with an unsafe late-write
  race; material evidence that the chosen mechanism cannot remain bounded
  triggers Reassessment.
- Ticket 22 does not yet durably record the eventual terminal outcome of a
  detached child. That work remains assigned downstream.

## Downstream effect

The implementation planner must treat this record as the authoritative
cross-repository contract for Ticket 22.

The plan must include:

- Alfie-owned attachment arbitration;
- Symphony-owned durable lifecycle reporting;
- sequence-1/2/3 ordering and reopen evidence;
- additive capability gating and old-extension fallback;
- per-execution timer/registry cleanup and parent-cancellation continuity;
- exact config parsing and timing evidence;
- lifecycle-write failure injection and unrelated-child isolation;
- real Pi fast, long, concurrent, invalid-config, legacy, and cleanup paths;
- an Alfie-first commit followed by Symphony provenance re-pin; and
- explicit confirmation that no migration or downstream ticket scope was added.

Dependent implementation must not begin until this decision is persisted,
tracked, and cited as an aspect-scoped `Authoritative` reference.

## Failure and rollback implications

The change is additive and capability-gated.

A mixed-version rollback to an Alfie extension without
`bounded-foreground-attachment` must cause Symphony to use legacy unmanaged
behavior rather than partially applying Ticket 22 semantics.

Rolling back only Symphony or only Alfie must not label an unbounded foreground
execution as managed bounded attachment. Provenance pinning must prevent tests
from silently accepting a mismatched sibling checkout.

No durable schema rollback is required because this decision authorizes no
migration.

No remote publication or deployment is authorized by this decision.

## Reopening conditions

Reopen this decision for material evidence that:

- the actual Alfie API cannot arbitrate settlement, timeout, and cleanup without
  weakening its accepted operation-token or stale-settlement guards;
- the chosen lifecycle reporter cannot preserve both bounded attachment and
  durable ordering;
- a sequence-2 event can commit without a concrete started child;
- a handle can return before sequence-3 durability;
- lifecycle-write failure leaves a child running without durable control or
  mutates unrelated execution truth;
- the 100–60000 ms range or 500 ms acceptance envelope is impractical on the
  real production boundary;
- a lifecycle-store operation hangs in production or deterministic evidence
  shows that an additional persistence deadline is required;
- additive capability negotiation cannot safely distinguish the new extension
  from the accepted Ticket 19 baseline;
- Ticket 22 requires a schema change after all;
- provenance no longer proves the exact Alfie source used by the tests; or
- new evidence contradicts Decisions 0001–0005.

## Superseded records

None. Decisions 0001–0005 remain unchanged.
