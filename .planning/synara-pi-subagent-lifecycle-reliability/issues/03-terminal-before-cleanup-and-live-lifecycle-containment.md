# Ticket 03 — terminal-before-cleanup and live lifecycle containment

**Status:** blocked
**Blocked by:** Ticket 01 accepted; Ticket 02 accepted; DG-3 and DG-4
**Implementation:** forbidden while blocked

## Objective

Make terminal outcome, live lifecycle observation, and cleanup proof compose
truthfully under races without weakening inherited journal-first, fencing, or
owned-only authority.

## Acceptance criteria

- **T03-AC1:** Terminal evidence is persisted before delivery/public terminal
  notification and remains bounded.
- **T03-AC2:** Terminal-before-cleanup, cleanup-before-terminal, same-generation
  race, and stale-generation race each have deterministic outcomes.
- **T03-AC3:** Watchdog handoff and cleanup uncertainty remain non-terminal and
  preserve bands 70–74; teardown proof remains bands 75–78.
- **T03-AC4:** Live lifecycle containment observes/control only the exact owned
  runtime; no PID guessing, parent fallback, or Symphony PID kill authority.
- **T03-AC5:** Provider inactivity, callback loss, persistence failure, and
  late callback diagnostics are stable and do not falsely claim liveness or
  cancellation.

## Testing seams

Repository transaction/state-machine fixtures; injected event ordering;
controlled live-bridge owner fixtures; watchdog/teardown deterministic seams;
real-Pi non-destructive lifecycle through teardown handoff where inherited
acceptance requires it.

## Implementation Report placeholder

- Candidate baseline and cross-repo pin:
- Lifecycle ordering contract:
- Owner boundary and proof statement:
- AC evidence matrix and failure diagnostics:
- Band allocation compatibility:
- Review findings/disposition:
- Residual uncertainty and reopening conditions:

## Unlock gate

Requires accepted identity/read contract and a new decision if terminal/cleanup
ordering or owner authority changes inherited semantics.
