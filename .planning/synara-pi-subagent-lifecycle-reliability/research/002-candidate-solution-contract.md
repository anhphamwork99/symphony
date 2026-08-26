# Research 002 — candidate solution contract

**Classification:** Supporting evidence only. The directions below are
hypotheses and decision gates, not accepted architecture.

## Candidate contract shape

A possible end-to-end contract would make `executionId` the only public
logical identity, retain `agentId` only as provider-local correlation, and
route reads through a bounded authorized durable service that can consult live
provider state when available and durable terminal/result evidence when not.
Terminal lifecycle would persist before notification; cleanup would remain a
separate proof axis; explicit Resume would create a new attempt only after
truthful provider/runtime eligibility.

This is a candidate contract to test, not an implementation authorization.

## Candidate directions requiring gates

| Direction | Potential benefit | Material risk / gate |
| --- | --- | --- |
| canonical `executionId` alias at provider boundary | fixes public/read mismatch with small surface | alias may hide incompatible provider record semantics; DG-1/G2 |
| durable-terminal-first result read | survives Manager eviction/restart for terminal work | must bound payloads, preserve auth, and distinguish partial output; DG-2 |
| terminal-before-cleanup ordering | prevents cleanup uncertainty from erasing outcome | must settle same-generation races and preserve bands 70–78; DG-3 |
| live lifecycle containment adapter | keeps progress/control truthful while provider lives | cannot create kill authority or claim owner from stale evidence; DG-4 |
| truthful Resume eligibility | avoids offer-then-reject UX and replay ambiguity | provider bootstrap may become hidden automatic replay; DG-5 |
| crash guardian | may improve observation after disconnect | ownership, liveness, and scope can become a new unaccepted authority; DG-6 |
| orphan-terminal exception | may reduce visible orphan states | risks fabricating terminal truth from uncertainty; DG-6 |
| durable post-restart owner receipt | may improve restart cleanup | receipt cannot replace live identity-capturing owner proof; DG-4/6 |
| provider-bootstrap Resume | may restore inactive runtime | risks turning recovery into automatic side-effect replay; DG-5 |

## Required contract tests before design acceptance

1. Public detached handle and hidden details must identify the same logical
   execution or expose an explicit, bounded compatibility mapping.
2. A terminal result remains readable after provider Manager eviction if durable
   evidence exists; missing terminal evidence remains honest unknown/orphan.
3. Duplicate reads, stale attempt reads, unauthorized reads, oversized output,
   and inactive provider runtime all have stable diagnostics.
4. Terminal evidence arriving before, during, and after cleanup handoff has one
   deterministic outcome and preserves proof-before-fence.
5. Resume is explicit-only, same execution/new attempt, authorized, and
   unavailable when provider/runtime prerequisites are absent.
6. Reconnect and restart never dispatch a new child implicitly.

## Evidence boundary

The contract must be proven in layers:

- deterministic repository/state-machine fixtures for identity, ordering,
  fencing, and diagnostics;
- controlled Alfie seam tests for provider-local mapping and result behavior;
- isolated real-Pi evidence for composition and lifecycle behavior;
- accepted manual destructive evidence for exact child-owner teardown where
  required by inherited Decisions 0028–0034.

No candidate direction is accepted by this research record. Ticket 01 must
first reproduce and classify the failure before Ticket 02 selects a contract.
