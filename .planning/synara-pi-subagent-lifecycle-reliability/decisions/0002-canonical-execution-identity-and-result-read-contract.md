# Decision 0002 — Canonical execution identity and result-read continuity

## Status

**Binding Supervisor decision; accepted technical direction.** This record
persists the material technical decision returned by the Project Supervisor.
It unlocks Ticket 02 for implementation planning and evidence collection. It
is not Ticket 02 implementation, feature review, or final project acceptance.

## Date and consultation class

- **Date:** 2026-08-26
- **Consultation class:** Project Supervisor material technical decision
  consultation under the Binding Decision Handoff.
- **Project:** [Synara Pi subagent lifecycle reliability](../PROJECT.md)
- **Decision owner:** Project Supervisor, routed through the Project Home.

## Question

Which public identity and durable result-read contract shall Ticket 02 bind so
that the detached public handle remains readable and controllable without
conflating Symphony's durable `executionId` with Alfie's provider-local
`agentId`, including after provider-record eviction or restart?

The decision must name the canonical public identity, the owner of any live
mapping, the authorized live-versus-durable result boundary, bounded
compatibility and diagnostics, the current attempt/generation tuple, the
capability/provenance gate, and the explicit boundaries that remain for later
lifecycle tickets.

## Governing references

- [Project Home](../PROJECT.md) — sole status, routing, dependency, and
  frontier authority.
- [Ticket 01 grounding report](../issues/01-baseline-reproduction-and-decision-matrix.md)
  — accepted reproduction, identity mismatch, source seam map, and failure
  matrix.
- [Canonical identity decision handoff](../handoffs/01-canonical-identity-decision-gate.md)
  — Supervisor question and consultation alternatives.
- [Decision 0001 — project charter and inherited authority](0001-project-charter-and-inherited-authority.md).
- [Lifecycle reliability specification](../spec.md) and [terms](../terms.md).
- Inherited durable-subagents authority, especially the journal-first,
  attempt/generation, authorization, no-replay, and evidence rules in
  `../../synara-pi-durable-subagents/PROJECT.md` and
  `../../synara-pi-durable-subagents/decisions/0001-testing-strategy-governance.md`.
- Inherited handshake-first authority, especially the controlled-extension,
  capability, fail-closed, and provenance rules in
  `../../synara-pi-subagent-handshake-first/PROJECT.md`.

The accepted inherited decisions remain authoritative by aspect. This
Decision 0002 binds only the canonical execution identity and result/control
continuity boundary described below; it does not supersede their lifecycle,
process-ownership, or controlled-artifact rules.

## Consultation evidence

The accepted Ticket 01 report established the material failure that this
consultation must resolve:

- Symphony mints and durably persists `executionId` for a logical managed
  execution, while Alfie's detached/public path and hidden details can retain
  provider-local `agentId`.
- The pinned Alfie GET_RESULT and steer paths perform strict in-memory
  `agentId`/AgentManager lookup. Passing the public `executionId` can therefore
  return `Agent not found` while the child is still progressing.
- Symphony already owns durable admission, lifecycle, terminal/outbox,
  restart, watchdog, and teardown evidence keyed by `executionId`,
  `attemptId`, and generation.
- Provider-record absence is not terminal evidence, cleanup proof, owner proof,
  or permission to replay or Resume.

The consultation therefore treats identity namespace separation, durable
continuity, authorization, and current-tuple fencing as one contract. It does
not treat a visible text change or a provider error as a lifecycle settlement.

## Binding decision

### 1. One public identity; provider identity is local

1. `executionId` is the only public logical identity for a managed execution.
   It is stable across the logical execution's attempts and explicit Resume
   attempts.
2. `attemptId` and generation identify the concrete current run and fence stale
   evidence and controls. The durable current tuple is
   `(executionId, attemptId, generation)`.
3. `agentId` is provider-local correlation identity. It must be absent from
   managed public output and managed public details. Managed output/details
   must not expose a second provider identity that callers could mistake for
   the durable handle.
4. Symphony owns the durable logical identity, authorization, durable result
   continuity, and the durable current tuple. Symphony is the authority that
   resolves the authorized execution and current tuple before any provider
   access.
5. Alfie owns the exact in-memory live index that maps
   `(executionId, attemptId, generation) -> agentId`. The index is exact,
   session-scoped, bounded to live managed records, and not a global scan or a
   durable authority. Alfie may use `agentId` internally after Symphony has
   authorized and resolved the exact current tuple.

### 2. Managed tool input and compatibility

1. Managed result and control tools use `execution_id` as their canonical
   input.
2. A bounded deprecated syntactic `agent_id` alias may remain for compatibility
   only when its value is the same public `executionId`. The alias does **not**
   accept or expose an Alfie provider `agentId`, does not create a second
   identity namespace, and must be observable as deprecated compatibility
   usage.
3. A managed composition requires a capability equivalent to
   `execution-identity-routing-v1`. Capability negotiation is a hard boundary:
   if the capability is absent, malformed, incompatible, or cannot be bound to
   the exact managed session, the managed composition fails closed. It must not
   claim the Decision 0002 routing contract.
4. Legacy or unmanaged behavior remains outside this managed contract and is
   not relabeled as managed identity-routing behavior. It must not silently
   inherit a partial alias.

### 3. Authorization and durable-first resolution

1. Authorization, project/thread scope, and the durable current tuple resolve
   before provider access. No provider lookup may be used to decide whether a
   public caller is authorized or which execution/current tuple it means.
2. The result-read boundary is bounded and authorized. It consults the durable
   aggregate and current tuple first, then may consult the exact live provider
   record only through the tuple-indexed mapping.
3. Durable terminal evidence wins. If durable state is terminal, that terminal
   truth is returned even if an in-memory provider record exists or reports a
   conflicting nonterminal state.
4. For a nonterminal durable execution, the exact live provider may supplement
   the durable state with bounded live result/progress details when the exact
   current tuple is present. Live data must not replace durable identity,
   authorization, or tuple resolution.
5. If the exact live provider record is missing, the result-read path returns
   the applicable durable state and bounded diagnostic. It must not return
   `Agent not found` merely because the provider record is absent. If durable
   evidence is itself unavailable, the path returns a stable missing-evidence
   or uncertainty diagnostic; it does not fabricate a result or terminal state.

### 4. Control boundary

1. Steer is live-only. It may target only the exact currently authorized tuple
   and the exact live provider record resolved by the tuple index.
2. Steer must never target queued, replayed, reconstructed, bootstrap, or
   otherwise non-live work. Missing live state is an unavailable-control
   diagnostic, not permission to dispatch or recreate a child.
3. This decision does not add automatic replay, provider bootstrap, automatic
   Resume, or a new process-kill authority.
4. Stale attempt/generation requests are rejected deterministically after
   durable current-tuple resolution. They must not mutate the logical
   `executionId` or reach a provider record belonging to another tuple.

### 5. Boundedness, diagnostics, and information exposure

All managed result/control responses and live supplements remain bounded and
authorized. Diagnostics distinguish, at minimum:

- unauthorized or out-of-scope access;
- stale attempt or generation;
- durable terminal precedence;
- durable state with no live provider record;
- unavailable live-only control;
- missing durable evidence; and
- capability missing, incompatible, or fail-closed.

Diagnostics must not expose `agentId`, raw provider internals, unbounded
transcripts, or guessed lifecycle conclusions. A missing live record is not
reported as `Agent not found` for a valid public `executionId` on the managed
result-read path.

## Selected and rejected alternatives

### Selected: bounded combination of Alternatives 2 and 3

This decision selects a bounded combination of the handoff's:

- **Alternative 2 — `executionId` alias in Alfie:** Alfie owns the exact
  tuple-to-provider live index and uses it to route managed live result/control
  operations without exposing or accepting provider-local `agentId` as the
  public identity.
- **Alternative 3 — Symphony durable LLM-callable result boundary:** Symphony
  owns authorization, durable current-tuple resolution, durable terminal/result
  continuity, and the live-versus-durable precedence described above.

The combination has one public identity, one durable authority, one exact live
provider mapping, and an explicit precedence rule. It is not permission to
create two competing result authorities or an unbounded cross-session lookup.

### Rejected

1. **Alternative 1 — minimal visible `agentId`/text fix:** rejected. It would
   make the provider-local identity appear canonical, preserve the namespace
   mismatch, and fail to provide durable result continuity after provider
   eviction or restart.
2. **Unbounded provider lookup or global scan:** rejected. Provider-local
   `agentId` lookup cannot authorize a public request, cross session boundaries,
   or survive eviction; a global scan would weaken boundedness and identity
   isolation.
3. **Provider-only durable/result authority:** rejected. Alfie's in-memory
   Manager is not durable authority and cannot replace Symphony's durable
   identity, authorization, current tuple, or terminal truth.
4. **Live provider precedence over durable terminal truth:** rejected. A live
   nonterminal observation cannot override a durably committed terminal
   outcome.
5. **Steer through queued/replayed/bootstrap state:** rejected. Control is
   exact-live-only and never creates or replays side effects.
6. **Silent compatibility acceptance of real `agentId`:** rejected. The
   deprecated `agent_id` field is a syntactic alias for `executionId` only; it
   is not a provider-identity migration.
7. **Partial managed capability fallback:** rejected. A managed composition
   without capability equivalent to `execution-identity-routing-v1` fails
   closed rather than claiming mixed semantics.

## Ticket 02 scope

Ticket 02 is the sole implementation frontier opened by this decision. Its
scope is limited to:

- binding `executionId` as the only managed public identity and removing
  provider-local `agentId` from managed public output/details;
- implementing the bounded managed `execution_id` input and deprecated
  `agent_id` syntactic alias, where the alias carries `executionId` only;
- implementing Symphony durable authorization/current-tuple/result continuity
  before provider access;
- implementing the exact Alfie live tuple index and its managed live result
  and control seam;
- enforcing durable-terminal precedence, durable fallback after live-record
  eviction/restart, exact-live-only steer, and stable bounded diagnostics;
- requiring and fail-closing capability equivalent to
  `execution-identity-routing-v1`; and
- producing deterministic, controlled-Alfie, and isolated real-Pi evidence for
  the contract and its failure surfaces.

Ticket 02 must preserve the existing journal-first terminal contract,
attempt/generation fencing, project/thread authorization, bounded payloads,
legacy unmanaged behavior, and inherited controlled-extension composition.

## Explicit non-goals and reserved boundaries

This decision does **not** authorize changes to:

- watchdog stages or escalation semantics;
- owned process-tree teardown, proof-before-fence, or teardown bands;
- explicit Resume eligibility, restart/reconnect policy, or provider bootstrap;
- a crash guardian, durable post-restart owner receipt, or orphan-terminal
  exception;
- automatic replay or automatic Resume;
- Symphony raw PID discovery, PID guessing, process-name kills, or new kill
  authority;
- the general Pi Agent UX or unrelated public API redesign; or
- final acceptance of Ticket 02 or the whole project.

Those concerns remain later ticket gates and may be changed only by their own
accepted decision or the project's final acceptance governance.

## Evidence obligations and acceptance boundary

Decision 0002 binds the contract; the following are Ticket 02 evidence
obligations, not claims that the evidence has already passed.

### Deterministic evidence

The deterministic suite must prove both normal and failure directions:

- the same public `executionId` resolves across detached output, result reads,
  and current-tuple records, while `agentId` is absent from managed output and
  details;
- `execution_id` works and deprecated `agent_id` accepts only the same
  `executionId` value;
- authorization and durable current-tuple resolution occur before provider
  access;
- terminal durable state wins over a conflicting live nonterminal state;
- a nonterminal exact live tuple may supplement durable state;
- live-record eviction returns durable state rather than `Agent not found`;
- missing durable evidence, stale tuples, unauthorized access, oversized
  payloads, unavailable live steer, and capability failure are bounded and
  diagnostic; and
- no queued/replayed/bootstrap steer or automatic replay/Resume is introduced.

### Controlled-Alfie evidence

The controlled pinned Alfie extension must prove the exact in-memory
`(executionId,attemptId,generation)->agentId` index, managed result/control
routing, no provider `agentId` leakage in managed output/details, deprecated
alias behavior, stale-tuple rejection, live-record eviction behavior, and
session isolation. Any changed Alfie runtime ownership surface requires the
provenance and re-pin obligations below.

### Isolated real-Pi evidence

The real-Pi acceptance must exercise the negotiated managed composition using
the controlled artifact and isolated runtime configuration. It must prove the
public `executionId` path, capability-equivalent routing, durable/live
precedence, and the material failure diagnostics at the actual provider
boundary. Fixture success must not be relabeled as real-Pi evidence, and no
real-Pi claim may include watchdog, teardown, Resume, guardian, or bootstrap
behavior outside Ticket 02.

## Compatibility and provenance

- Current conditional Alfie pin remains commit
  `aa6fa4a8540644d2509b10d6df854486ddc67d1d`,
  `@alfie/pi-subagents@0.15.0-alfie.4`, until Ticket 02 proves a required
  change.
- If Alfie changes `package.json`, `src/index.ts`, `src/agent-manager.ts`, or
  an equivalent runtime ownership surface, Ticket 02 must re-pin the exact
  commit/version and record hashes, clean-tree verification, controlled
  artifact provenance, and the paired Symphony/Alfie implementation report.
- A dirty, mutable, globally discovered, unpinned, or post-verification
  extension is not acceptance evidence.
- Mixed-version or missing-capability managed sessions fail closed. Legacy
  unmanaged sessions remain legacy and are not silently represented as having
  the Decision 0002 contract.

## Rollback and reopening

Rollback must preserve durable execution identity and immutable lifecycle and
terminal evidence. It must not delete, rewrite, or reinterpret persisted
`executionId`, attempt, generation, terminal, or result evidence as a provider
`agentId` or as proof of cleanup. A compatibility alias may be disabled only
through a versioned, fail-closed boundary that leaves existing durable reads
truthful and does not dispatch queued or replayed work.

Reopen Decision 0002 only if material evidence shows that:

1. `executionId` cannot remain the sole managed public identity while meeting
   durable continuity and authorization requirements;
2. the exact tuple-indexed live mapping is not sufficient to isolate provider
   records or creates a second public identity;
3. durable terminal/current-tuple precedence is incompatible with the accepted
   journal and lifecycle authority;
4. the capability-equivalent fail-closed boundary is absent or cannot be made
   version-compatible; or
5. a later accepted decision materially changes identity, authorization,
   terminal truth, process ownership, or explicit Resume boundaries.

A test failure, missing provider record, or implementation inconvenience alone
must not silently reopen or weaken this binding; it must be reported against
Ticket 02's evidence matrix.

## Downstream effect and routing

- Decision 0002 is authoritative for Ticket 02 and is now persisted in the
  Project Home.
- Ticket 02 changes from **blocked** to **ready-for-agent** and is the sole
  source implementation frontier.
- Ticket 01 remains accepted and read-only.
- Tickets 03–06 remain blocked behind Ticket 02 and their own dependency gates.
- No other ticket is opened, and no source implementation or final acceptance
  is implied by this routing change.

## Binding summary

`executionId` is the only public managed identity. Symphony owns durable
identity, authorization, result continuity, and the current
`(executionId,attemptId,generation)` tuple. Alfie owns only the exact live
in-memory tuple-to-`agentId` index. Managed tools use `execution_id`, with a
bounded deprecated `agent_id` syntactic alias carrying `executionId` only.
Authorization and durable tuple resolution precede provider access; durable
terminal truth wins; exact live provider state may supplement nonterminal
state; missing live state returns durable state rather than `Agent not found`;
and steer is exact-live-only. Capability equivalent to
`execution-identity-routing-v1` is required and fail-closed. The selected
contract is the bounded Alternatives 2+3 combination, with Alfie re-pin,
version, and provenance required for any relevant runtime change.
