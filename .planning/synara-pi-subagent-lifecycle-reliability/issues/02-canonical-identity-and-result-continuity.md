# Ticket 02 — canonical identity and durable result-read continuity

**Status:** ready-for-agent
**Authoritative decision:** [Decision 0002 — Canonical execution identity and result-read continuity](../decisions/0002-canonical-execution-identity-and-result-read-contract.md)
**Dependencies:** Ticket 01 accepted; the named Supervisor identity/read gate is discharged by Decision 0002.
**Implementation:** authorized within this ticket's scope; no implementation is included in this planning update.

## Objective

Implement and prove the binding identity/result-read contract from Decision
0002. A managed execution has one public `executionId` from admission through
result lookup, live observation/control, terminal settlement, reconnect, and
restart. Provider-local Alfie `agentId` remains an internal correlation key and
never becomes a second managed public identity.

Ticket 02 is the sole source implementation frontier. It must not open or
implement Tickets 03–06.

## Authoritative contract

Decision 0002 binds the following requirements:

- `executionId` is the only managed public logical identity.
- `agentId` is provider-local and absent from managed public output/details.
- Symphony owns durable identity, authorization, result continuity, and the
  durable current tuple `(executionId, attemptId, generation)`.
- Alfie owns the exact live in-memory index
  `(executionId,attemptId,generation) -> agentId`.
- Managed tools use `execution_id`; a bounded deprecated `agent_id` syntactic
  alias carries `executionId` only and never accepts a provider `agentId`.
- Authorization, project/thread scope, and durable current-tuple resolution
  occur before provider access.
- Durable terminal truth wins over conflicting live nonterminal state.
- Exact live provider state may supplement nonterminal durable state.
- Missing live provider state returns applicable durable state and a bounded
  diagnostic, not `Agent not found` for a valid managed public handle.
- Steer is live-only for the exact authorized current tuple; it never targets
  queued, replayed, reconstructed, or bootstrap work.
- Capability equivalent to `execution-identity-routing-v1` is required for
  managed composition and missing/incompatible capability fails closed.
- Any required Alfie runtime change requires exact version/re-pin and
  controlled provenance evidence.
- No automatic replay, automatic Resume, provider bootstrap, watchdog,
  teardown, guardian, or unrelated lifecycle redesign is part of this ticket.

## Acceptance criteria

- **T02-AC1 — Canonical public identity:** Managed detached output, result
  payloads, details, and diagnostics use `executionId` as the only public
  logical identity; `agentId` is absent. The durable current tuple remains
  stable and `attemptId`/generation fence stale evidence without replacing
  `executionId`.
- **T02-AC2 — Exact routing and compatibility:** Managed result/control tools
  accept canonical `execution_id`. The deprecated `agent_id` alias is bounded,
  observable, and accepts only the same public `executionId`; a provider-local
  `agentId` is never accepted as a public handle. Alfie resolves live records
  only through the exact tuple-indexed in-memory mapping.
- **T02-AC3 — Durable-first authorized continuity:** Authorization, scope, and
  durable current-tuple resolution occur before provider access. Authorized
  terminal/result evidence remains readable by `executionId` after provider
  record eviction or restart, with bounded metadata; durable terminal state
  wins over any live nonterminal report.
- **T02-AC4 — Live supplement and control boundary:** An exact live provider
  record may supplement nonterminal durable state. Missing live state returns
  the applicable durable state rather than `Agent not found`. Steer is
  exact-live-only and returns a stable unavailable-control diagnostic when the
  exact live record is absent; it never queues, replays, bootstraps, or creates
  a child.
- **T02-AC5 — Failure, fencing, and legacy behavior:** Stale attempt/generation
  requests, unauthorized access, missing durable evidence, oversized payloads,
  unavailable live control, and missing/incompatible capability have bounded,
  stable diagnostics. Legacy/unmanaged sessions retain their existing bypass
  behavior. No automatic replay or Resume is introduced.
- **T02-AC6 — Evidence and provenance:** Deterministic contract/repository
  tests, the controlled pinned-Alfie suite when its surface changes, and an
  isolated real-Pi managed-composition proof cover normal and failure
  directions, including eviction/restart, capability fail-closed behavior,
  terminal precedence, tuple fencing, and no provider-identity leakage. Any
  Alfie runtime change has exact re-pin, version, hash, clean-tree, artifact,
  and paired Symphony/Alfie provenance evidence.

## Testing and evidence seams

### Deterministic contract and repository evidence

Use bounded fixtures to prove identity shapes, authorization ordering,
current-tuple fencing, durable/live precedence, terminal fallback after live
record eviction, missing-evidence diagnostics, alias rejection for a real
provider `agentId`, payload bounds, and exact-live-only steer. Include the
negative directions: conflicting live terminal/nonterminal state, stale tuple,
unauthorized project/thread, unavailable live record, and absent capability.

### Controlled-Alfie evidence

When the Alfie surface changes, exercise the exact pinned controlled extension
and prove:

- the in-memory
  `(executionId,attemptId,generation)->agentId` mapping is exact, bounded, and
  session-scoped;
- managed output/details do not expose `agentId`;
- `execution_id` and the deprecated `agent_id` syntactic alias route to the
  same public execution identity;
- stale tuples cannot reach another provider record;
- live result/control routing does not turn missing records into a public
  identity error; and
- an unrelated legacy or managed session cannot resolve this execution.

### Isolated real-Pi evidence

Exercise the actual controlled managed composition with isolated runtime
configuration and the negotiated capability equivalent to
`execution-identity-routing-v1`. Prove the public `executionId` path, durable
terminal precedence, live supplement, provider-record eviction/restart
continuity, and material diagnostics at the real provider boundary. Do not
relabel deterministic fixtures as real-Pi evidence, and do not claim watchdog,
teardown, Resume, guardian, or bootstrap behavior from this ticket.

Every evidence report must distinguish deterministic, controlled-Alfie, and
real-Pi results and must record the exact pin/provenance boundary used.

## Implementation Report placeholder

- Candidate Symphony commit(s):
- Candidate Alfie commit/version, if changed:
- Decision 0002 contract and compatibility version:
- Changed files and ownership split:
- Durable authorization/current-tuple resolution evidence:
- Live tuple-index and managed tool-routing evidence:
- AC evidence matrix, including normal and failure/diagnostic directions:
- Deterministic test commands/results:
- Controlled-Alfie commands/results and exact provenance:
- Isolated real-Pi commands/results and composition boundary:
- Re-pin, hashes, and dirty-tree checks:
- Review findings/disposition:
- Explicit non-goals preserved:

## Scope and non-goals

### In scope

- Symphony durable identity, authorization, current-tuple, and bounded
  result-read continuity;
- Alfie exact live tuple mapping and managed result/control routing when the
  cross-repository seam requires it;
- managed public output/details and `execution_id` compatibility behavior;
- capability negotiation/fail-closed behavior;
- bounded diagnostics and deterministic, controlled-Alfie, and real-Pi
  evidence for this contract; and
- exact Alfie version/provenance re-pin when an owned runtime surface changes.

### Not in scope

- watchdog stages or escalation;
- owned process-tree teardown, proof-before-fence, or teardown bands;
- explicit Resume eligibility, restart/reconnect policy, or provider bootstrap;
- crash guardian, durable post-restart owner receipt, orphan-terminal
  exception, or automatic replay/Resume;
- raw PID discovery/guessing, PID files, process-name kills, or new Symphony
  kill authority;
- general Pi Agent UX redesign, unrelated public API changes, or opening
  Tickets 03–06; and
- Ticket 02 final acceptance or the project's final acceptance.

## Status and unlock

Decision 0002 is authoritative and has discharged the only Ticket 02 material
decision gate. This ticket is **ready-for-agent**. Implementation agents must
follow the Project Home router, preserve inherited decisions, and report both
normal behavior and material failure/diagnostic behavior before review.
