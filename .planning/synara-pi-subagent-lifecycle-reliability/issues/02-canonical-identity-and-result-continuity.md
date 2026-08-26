# Ticket 02 — canonical identity and durable result-read continuity

**Status:** blocked
**Blocked by:** Ticket 01 accepted; DG-1 and DG-2
**Implementation:** forbidden while blocked

## Objective

Select and implement, only after explicit decision-gate discharge, one
canonical identity/result-read contract that makes public `executionId`
usable without conflating it with provider-local `agentId`.

## Acceptance criteria

- **T02-AC1:** One explicit canonical identity contract is accepted; any alias
  or mapping is bounded, versioned, and observable.
- **T02-AC2:** Detached public output and hidden details are consistent or carry
  an explicit compatibility mapping; strict provider lookup no longer causes
  a false `Agent not found` for a valid public handle.
- **T02-AC3:** Durable terminal/result evidence is readable by authorized
  `executionId` after provider record eviction/restart, with bounded metadata.
- **T02-AC4:** Live provider reads, durable reads, missing evidence, stale
  attempts, unauthorized access, oversized payloads, and inactive provider
  runtime have stable diagnostics.
- **T02-AC5:** Existing attempt/generation fences and legacy unmanaged behavior
  remain intact; no automatic replay or Resume is introduced.

## Testing seams

Deterministic contract/repository tests; pinned Alfie controlled-extension
suite if Alfie changes; authorized read-path integration; provider-record
present/evicted fixtures; bounded payload and failure-direction tests.

## Implementation Report placeholder

- Candidate Symphony/Alfie commits and exact pin:
- Changed files and ownership split:
- Identity contract and compatibility version:
- AC evidence matrix (normal + failure/diagnostic):
- Provenance and dirty-tree checks:
- Review findings/disposition:
- Explicit non-goals preserved:

## Unlock gate

Ticket 01's accepted matrix must establish the chosen contract boundary. A
new decision record is required if the choice changes public identity,
provider authority, or durable read authorization.
