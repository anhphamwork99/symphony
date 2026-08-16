# 22 — Real bounded foreground attachment

**What to build:** A foreground Agent call owned by the actual Pi extension
waits for one bounded budget. Fast children return their normal result. A child
still active at expiry returns its durable execution handle while that same
child continues under its original parent-turn cancellation scope. Started and
detached observations survive database reopen, and session or child termination
cleans up every timer and in-memory registry entry.

**Blocked by:** 21 — Production fail-closed control health.

**Status:** ready-for-agent

- [ ] **T22-AC1:** An actual Pi child completing inside the budget returns the
      normal inline result and creates no unnecessary follow-up delivery.
- [ ] **T22-AC2:** An actual child exceeding the budget returns one execution
      handle within budget plus bounded scheduling tolerance, without spawning a
      replacement.
- [ ] **T22-AC3:** Detach changes only parent-tool attachment; child identity,
      attempt, generation, and default parent-turn cancellation scope remain
      unchanged.
- [ ] **T22-AC4:** Started and detached-running observations commit durably and
      database reopen recovers the same non-terminal execution aggregate.
- [ ] **T22-AC5:** Default foreground budget is 10 seconds; configured bounds
      and invalid-value fallback remain effective on the production path.
- [ ] **T22-AC6:** Concurrent managed executions and an adjacent legacy session
      retain independent results, timeouts, identities, and behavior.
- [ ] **T22-AC7:** Child settlement, session disposal, startup failure, and
      explicit cleanup remove heartbeat/progress timers and live registry entries
      without stopping unrelated children.
- [ ] **T22-AC8:** Synthetic replacement Agent tools cannot satisfy the
      real-Pi, production-call-chain, or reopen acceptance evidence.

## Testing Seams

**Approval status:** Approved — owner approved the remediation breakdown and
known seams on 2026-08-16.

- **T22-AC1, T22-AC2, T22-AC3, T22-AC5, T22-AC6, T22-AC8:** Actual Pi
  parent-tool boundary with fast, long, concurrent, invalid-config, and legacy
  executions.
- **T22-AC4:** Production persistence boundary — detach, close/reopen the
  database-backed harness, and recover the same aggregate and identities.
- **T22-AC7:** Session lifecycle and resource-observation boundary — verify no
  live timer/registry ownership after each cleanup condition.

## Implementation Report

**Implementation state:** not-started

### Delivered scope

_Implementer must distinguish bounded attachment from execution lifetime and
cancellation independence._

### Changed production call chain

_Required trace: admitted actual Agent child → bounded wait → inline result or
durable detach → continued child ownership → cleanup._

### Acceptance evidence matrix

| Criterion | Source evidence | Verification evidence | Result  |
| --------- | --------------- | --------------------- | ------- |
| T22-AC1   | Not reported    | Not run               | pending |
| T22-AC2   | Not reported    | Not run               | pending |
| T22-AC3   | Not reported    | Not run               | pending |
| T22-AC4   | Not reported    | Not run               | pending |
| T22-AC5   | Not reported    | Not run               | pending |
| T22-AC6   | Not reported    | Not run               | pending |
| T22-AC7   | Not reported    | Not run               | pending |
| T22-AC8   | Not reported    | Not run               | pending |

### Failure and diagnostic evidence

_Record invalid configuration, child failure, startup failure, session disposal,
and cleanup diagnostics._

### Verification commands and results

_Record exact commands, elapsed-time measurements, exit codes, test counts,
identity comparisons, and resource counts._

### Migration compatibility evidence

_Reference the accepted ticket 18 schema and reopen fixture._

### Real-Pi evidence

_Required: actual runtime/extension provenance, fast/long/concurrent results,
elapsed times, identities, and continued-child proof._

### Deviations and remaining risks

_Record timing tolerance, platform limits, and untested cleanup cases._

### Commits

_Record commit hashes and final working-tree status._

### Reviewer handoff

_Provide the shortest fast, detached, reopen, concurrent, and cleanup
reproductions._
