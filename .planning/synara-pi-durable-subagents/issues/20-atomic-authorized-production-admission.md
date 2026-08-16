# 20 — Atomic authorized production admission

**What to build:** A managed Agent request from the actual Pi extension enters
one production admission path that authorizes the caller, durably records one
logical execution and first attempt, and only then allows the child to start.
Concurrent or redelivered commands and lifecycle events are idempotent.
Crashes cannot expose half-admitted state, and attempt-local sequencing remains
compatible with future resume attempts.

**Blocked by:** 18 — Reconcile released migration lineages; 19 — Complete
real-Pi capability negotiation.

**Status:** ready-for-agent

- [ ] **T20-AC1:** The production composition provides the durable execution
      repository and routes the actual managed Agent spawn through admission before
      child-start evidence.
- [ ] **T20-AC2:** Execution record, first attempt, and requested/accepted or
      rejected lifecycle truth commit atomically; injected failure leaves none of
      them partially visible.
- [ ] **T20-AC3:** Concurrent commands with the same command identity create
      exactly one execution and attempt; every caller receives the same accepted or
      already-applied identities rather than a raw uniqueness failure.
- [ ] **T20-AC4:** Lifecycle redelivery is idempotent by execution, attempt,
      generation, and attempt-local sequence; a future attempt may begin its own
      sequence without colliding with a prior attempt.
- [ ] **T20-AC5:** Project/thread ownership, active-turn, approval, provider,
      and subject authority are verified from server-minted trusted context before
      spawn; identifiers supplied by the extension do not grant authority.
- [ ] **T20-AC6:** Rejected admission is terminal with a stable diagnostic and
      starts no child; a successful admission runs the child under server-minted
      execution, attempt, and generation identities.
- [ ] **T20-AC7:** Legacy or unhandshaked Agent work bypasses managed admission
      without creating managed execution records or being labeled durable.
- [ ] **T20-AC8:** Database reopen after admission returns the same aggregate
      and journal ordering, proving the result is not an in-memory record.

## Testing Seams

**Approval status:** Approved — owner approved the remediation breakdown and
known seams on 2026-08-16.

- **T20-AC1, T20-AC5, T20-AC6, T20-AC7:** Actual Pi Agent → production server
  admission → child-start boundary with authorized, denied, managed, and legacy
  sessions.
- **T20-AC2, T20-AC3, T20-AC4, T20-AC8:** Durable admission transaction
  boundary with concurrent replay, lifecycle redelivery, write-fault injection,
  multiple attempts, and database reopen.
- **T20-AC5:** Existing trusted authorization boundary — verify subject,
  project, thread, approval, active-turn, and provider constraints without
  trusting model-supplied identity.

## Implementation Report

**Implementation state:** not-started

### Delivered scope

_Implementer must describe the complete admitted-spawn behavior, not only the
repository API._

### Changed production call chain

_Required trace: actual Agent invocation → trusted authority resolution →
atomic admission → committed identities → child start → lifecycle ingest._

### Acceptance evidence matrix

| Criterion | Source evidence | Verification evidence | Result  |
| --------- | --------------- | --------------------- | ------- |
| T20-AC1   | Not reported    | Not run               | pending |
| T20-AC2   | Not reported    | Not run               | pending |
| T20-AC3   | Not reported    | Not run               | pending |
| T20-AC4   | Not reported    | Not run               | pending |
| T20-AC5   | Not reported    | Not run               | pending |
| T20-AC6   | Not reported    | Not run               | pending |
| T20-AC7   | Not reported    | Not run               | pending |
| T20-AC8   | Not reported    | Not run               | pending |

### Failure and diagnostic evidence

_Required: authorization denial, persistence fault at each transactional edge,
concurrent duplicate command, duplicate lifecycle event, and legacy bypass._

### Verification commands and results

_Record exact commands, exit codes, test counts, concurrency counts, and
database reopen results._

### Migration compatibility evidence

_Reference ticket 18's accepted lineage and identify the exact schema version
used by these tests._

### Real-Pi evidence

_Required: actual Agent tool provenance and proof that child start occurred only
after durable admission._

### Deviations and remaining risks

_Record any authority dimension or concurrency case not exercised._

### Commits

_Record commit hashes and final working-tree status._

### Reviewer handoff

_Provide commands for the authorized success, denied spawn, concurrent replay,
write-fault, and reopen reproductions._
