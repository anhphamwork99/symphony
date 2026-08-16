# 24 — Integrated remediation acceptance and review closure

**What to build:** One hermetically isolated acceptance path demonstrates that
the reviewed defects in tickets 01–05 are fixed in the integrated production
system. It uses the actual Pi Agent extension and real server persistence to
prove safe migration, complete capability negotiation, atomic authorized
admission, fail-closed degradation and recovery, bounded foreground detach,
coalesced progress, durable heartbeat lease, reconnect/reopen behavior, and
legacy fallback. It produces a complete reviewer-ready evidence package and is
the sole gate for starting ticket 06.

**Blocked by:** 18 — Reconcile released migration lineages; 19 — Complete
real-Pi capability negotiation; 20 — Atomic authorized production admission;
21 — Production fail-closed control health; 22 — Real bounded foreground
attachment; 23 — Production progress, heartbeat leases, and saturation control.

**Status:** ready-for-agent

- [ ] **T24-AC1:** Migration lineage and three-history compatibility evidence
      from ticket 18 passes in the integrated candidate.
- [ ] **T24-AC2:** Actual Pi session negotiation proves complete required
      capabilities and safe compatible, partial, unsupported, failing, and legacy
      behavior.
- [ ] **T24-AC3:** Actual managed Agent spawn proves trusted authorization,
      atomic durable identity, concurrent replay idempotency, and child start only
      after admission.
- [ ] **T24-AC4:** Persistence failure proves no child start, no partial truth,
      degraded health, repeated fail-closed admission, existing-truth preservation,
      and successful fresh admission after recovery.
- [ ] **T24-AC5:** Fast and long actual children prove inline completion and
      bounded detach with stable identity, parent-turn scope, durable running
      observation, and reopen recovery.
- [ ] **T24-AC6:** Actual progress and heartbeat plus deterministic saturation
      prove rate limits, latest snapshot, durable lease, bounded memory, lifecycle
      reserve, transcript isolation, reconnect, and cleanup.
- [ ] **T24-AC7:** Every original criterion in tickets 01–05 has a
      reviewer-reproducible source and verification evidence row; none relies only
      on a synthetic Agent fixture.
- [ ] **T24-AC8:** All focused suites and migration checks pass from a clean,
      documented environment; every command, exit code, test count, relevant
      warning, and working-tree state is recorded.
- [ ] **T24-AC9:** An independent reviewer finds no critical or high defect
      against tickets 01–05 and reconciles the implementation reports before this
      ticket can be accepted.
- [ ] **T24-AC10:** Tickets 01–05 are marked complete again only after AC1–AC9
      pass; ticket 06 remains blocked before that point.

## Testing Seams

**Approval status:** Approved — owner approved the remediation breakdown and
known seams on 2026-08-16.

- **T24-AC1:** Integrated server startup over fresh, Symphony, and
  upstream-v0.7.2 database histories.
- **T24-AC2, T24-AC3, T24-AC4, T24-AC5, T24-AC6:** Hermetically isolated actual
  Pi Agent → production Synara server → durable persistence → WebSocket
  observation boundary.
- **T24-AC6:** Deterministic saturation harness remains a required secondary
  seam; it cannot replace actual-Pi progress evidence.
- **T24-AC7, T24-AC8, T24-AC9:** Implementation-report evidence package,
  focused verification commands, clean-state audit, and one independent
  criterion-level review.
- **T24-AC10:** Project tracker state — original tickets and downstream frontier
  change only after acceptance evidence is complete.

## Implementation Report

**Implementation state:** not-started

### Delivered scope

_Implementer must summarize the integrated behavior and identify the exact
review findings closed._

### Changed production call chain

_Required end-to-end trace: database startup → actual extension load →
handshake → trusted atomic admission → child execution → bounded attachment →
progress/heartbeat ingress → durable observation → reconnect/reopen/cleanup._

### Acceptance evidence matrix

| Criterion | Source evidence | Verification evidence | Result  |
| --------- | --------------- | --------------------- | ------- |
| T24-AC1   | Not reported    | Not run               | pending |
| T24-AC2   | Not reported    | Not run               | pending |
| T24-AC3   | Not reported    | Not run               | pending |
| T24-AC4   | Not reported    | Not run               | pending |
| T24-AC5   | Not reported    | Not run               | pending |
| T24-AC6   | Not reported    | Not run               | pending |
| T24-AC7   | Not reported    | Not run               | pending |
| T24-AC8   | Not reported    | Not run               | pending |
| T24-AC9   | Not reported    | Not run               | pending |
| T24-AC10  | Not reported    | Not run               | pending |

_Add a second matrix mapping every T01–T05 criterion to its remediation ticket,
source evidence, verification command, and final result._

### Failure and diagnostic evidence

_Required: all negative handshake cases, authorization denial, concurrent
replay, persistence failure, degraded recovery, child failure, invalid config,
saturation, reconnect/reopen, resource cleanup, and legacy fallback._

### Verification commands and results

_Record the complete reproducible command set, environment/isolation inputs,
exit codes, test counts, timings, warnings, and clean-state checks._

### Migration compatibility evidence

_Required: ticket 18's three histories, lineage rows, resulting schema, data
survival, and second-run results._

### Real-Pi evidence

_Required: actual runtime and extension versions/provenance, Agent invocation,
identity/timing/event evidence, and proof that no synthetic Agent replacement
fulfilled acceptance._

### Deviations and remaining risks

_Any unresolved critical/high finding makes the state blocked and keeps ticket
06 closed. Record lower risks with owner-visible impact._

### Commits

_Record every included commit hash, branch, final working-tree status, and
whether changes were pushed._

### Reviewer handoff

_Provide a concise reproduction order and exact artifacts for an independent
criterion-level review. Do not mark this report complete before that review._
