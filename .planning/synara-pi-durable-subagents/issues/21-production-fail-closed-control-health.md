# 21 — Production fail-closed control health

**What to build:** When managed lifecycle persistence becomes unavailable, the
production control plane records degraded health and rejects every new managed
admission before child start. Existing execution truth remains unchanged.
After durable writes recover, health returns to available and a fresh command
can be admitted without replaying prior rejected work. Legacy behavior remains
available but is never represented as managed.

**Blocked by:** 20 — Atomic authorized production admission.

**Status:** ready-for-agent

- [ ] **T21-AC1:** A persistence failure at requested or accepted lifecycle
      commit prevents actual child start and returns a stable persistence
      diagnostic at the production Agent boundary.
- [ ] **T21-AC2:** Failed admission projects neither accepted nor running state,
      and atomic rollback leaves no partial execution or journal truth.
- [ ] **T21-AC3:** Production managed control health becomes degraded and
      prevents subsequent managed admissions while persistence remains unavailable.
- [ ] **T21-AC4:** Existing running, orphaned, and terminal aggregates and
      journal entries are unchanged during degraded admission.
- [ ] **T21-AC5:** Recovery returns health to available and admits one fresh
      command without replaying rejected commands or duplicating children.
- [ ] **T21-AC6:** Health and rejection diagnostics are observable through an
      existing stable operator/runtime surface without leaking prompt or result
      content.
- [ ] **T21-AC7:** Legacy sessions remain usable according to negotiated policy
      and are never mislabeled managed, durable, or restart-recoverable.

## Testing Seams

**Approval status:** Approved — owner approved the remediation breakdown and
known seams on 2026-08-16.

- **T21-AC1, T21-AC2, T21-AC3, T21-AC5:** Highest production Agent admission
  boundary with durable-store fault injection and recovery.
- **T21-AC4:** Durable aggregate snapshot before/during/after degradation —
  prove byte-for-byte or field-equivalent preservation of existing truth.
- **T21-AC6:** Existing operator/runtime observation boundary — verify stable
  diagnostics and forbidden content.
- **T21-AC7:** Managed-capability boundary comparing compatible and legacy
  sessions during degraded persistence.

## Implementation Report

**Implementation state:** not-started

### Delivered scope

_Implementer must describe how degradation is entered, observed, recovered, and
kept separate from execution outcomes._

### Changed production call chain

_Required trace: Agent admission → lifecycle persistence failure → durable
rollback → control-health gate → diagnostic surface → recovery._

### Acceptance evidence matrix

| Criterion | Source evidence | Verification evidence | Result  |
| --------- | --------------- | --------------------- | ------- |
| T21-AC1   | Not reported    | Not run               | pending |
| T21-AC2   | Not reported    | Not run               | pending |
| T21-AC3   | Not reported    | Not run               | pending |
| T21-AC4   | Not reported    | Not run               | pending |
| T21-AC5   | Not reported    | Not run               | pending |
| T21-AC6   | Not reported    | Not run               | pending |
| T21-AC7   | Not reported    | Not run               | pending |

### Failure and diagnostic evidence

_Record each injected write failure, resulting health state, child-start count,
projected state, diagnostic code, and recovery result._

### Verification commands and results

_Record exact commands, exit codes, test counts, and state snapshots._

### Migration compatibility evidence

_Reference the accepted ticket 18 schema version._

### Real-Pi evidence

_Required: actual Agent invocation proves persistence failure prevents child
start. A coordinator-only test is insufficient._

### Deviations and remaining risks

_Record unavailable operator surfaces or recovery cases._

### Commits

_Record commit hashes and final working-tree status._

### Reviewer handoff

_Provide the shortest degrade, repeated rejection, existing-truth preservation,
and recovery reproductions._
