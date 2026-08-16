# 23 — Production progress, heartbeat leases, and saturation control

**What to build:** Managed execution in the actual Pi extension stops producing
the legacy 80 ms spinner stream. Meaningful progress is coalesced at both
producer and server, heartbeat refreshes a durable ownership lease without
becoming transcript content, and lifecycle/terminal evidence retains a
non-coalescing path under pressure. Latest observations survive reconnect and
database reopen while intermediate progress history and memory remain bounded.

**Blocked by:** 22 — Real bounded foreground attachment.

**Status:** ready-for-agent

- [ ] **T23-AC1:** The actual managed Agent producer emits no continuing 80 ms
      spinner publication; bridge-absent legacy behavior remains unchanged.
- [ ] **T23-AC2:** Producer and server cap progress at the configured rate,
      initially two updates per second per execution, with trailing-edge latest
      snapshot semantics.
- [ ] **T23-AC3:** Heartbeat occurs approximately every 10 seconds and refreshes
      a 30-second durable ownership lease without creating transcript messages,
      auto-follow triggers, or durable intermediate progress history.
- [ ] **T23-AC4:** Desired and observed execution states remain separately
      persisted/readable and cannot be overwritten by progress or heartbeat.
- [ ] **T23-AC5:** Saturation coalesces or drops progress with accurate counters,
      while accepted, started, cancellation, and terminal lifecycle evidence is
      never discarded by the progress queue.
- [ ] **T23-AC6:** A sustained deterministic progress flood keeps server memory
      and queue depth bounded; completed executions release coordinator, timer, and
      observation ownership.
- [ ] **T23-AC7:** Invalid progress rate, heartbeat interval, and lease duration
      fall back to safe defaults on the live production path.
- [ ] **T23-AC8:** Browser reconnect and database reopen restore the latest
      useful progress and lease observation without replaying every intermediate
      update.
- [ ] **T23-AC9:** Actual-Pi progress evidence is required in addition to the
      deterministic lower-level saturation producer.

## Testing Seams

**Approval status:** Approved — owner approved the remediation breakdown and
known seams on 2026-08-16.

- **T23-AC1, T23-AC2, T23-AC3, T23-AC7, T23-AC9:** Actual Pi execution
  producer → production ingress boundary with managed, invalid-config, and
  legacy cases.
- **T23-AC3, T23-AC4, T23-AC8:** Durable execution snapshot, WebSocket
  reconnect, transcript observation, and database reopen boundary.
- **T23-AC5, T23-AC6:** Deterministic provider-ingress saturation harness —
  flood progress, interleave lifecycle/terminal events, inspect counters,
  memory/queue bounds, and post-terminal cleanup.
- **T23-AC3:** Focused transcript auto-follow boundary — heartbeat and nested
  progress do not use the real-message/live-text follow path.

## Implementation Report

**Implementation state:** not-started

### Delivered scope

_Implementer must describe producer coalescing, server coalescing, durable lease
updates, reserved lifecycle delivery, and cleanup._

### Changed production call chain

_Required trace: actual child progress/heartbeat → extension bridge → server
ingress → durable latest observation → WebSocket snapshot/reconnect._

### Acceptance evidence matrix

| Criterion | Source evidence | Verification evidence | Result  |
| --------- | --------------- | --------------------- | ------- |
| T23-AC1   | Not reported    | Not run               | pending |
| T23-AC2   | Not reported    | Not run               | pending |
| T23-AC3   | Not reported    | Not run               | pending |
| T23-AC4   | Not reported    | Not run               | pending |
| T23-AC5   | Not reported    | Not run               | pending |
| T23-AC6   | Not reported    | Not run               | pending |
| T23-AC7   | Not reported    | Not run               | pending |
| T23-AC8   | Not reported    | Not run               | pending |
| T23-AC9   | Not reported    | Not run               | pending |

### Failure and diagnostic evidence

_Record progress-sink failure, heartbeat failure, saturation, invalid config,
terminal-during-flood, reconnect gap, and cleanup behavior._

### Verification commands and results

_Record exact commands, exit codes, test counts, event rates, dropped/coalesced
counters, queue depth, memory evidence, and reopen/reconnect results._

### Migration compatibility evidence

_Reference ticket 18 and identify the durable lease/progress schema exercised._

### Real-Pi evidence

_Required: actual producer provenance, event counts over time, heartbeat/lease
timestamps, and proof that no synthetic Agent replacement supplied the result._

### Deviations and remaining risks

_Record platform timing variance, untested load ranges, and observation sinks._

### Commits

_Record commit hashes and final working-tree status._

### Reviewer handoff

_Provide the shortest actual-Pi progress, durable reconnect/reopen, saturation,
terminal-reserve, and cleanup reproductions._
