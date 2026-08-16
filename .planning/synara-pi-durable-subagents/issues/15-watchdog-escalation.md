# 15 — Watchdog escalation through provider-session stop

**What to build:** A managed execution that exceeds idle or wall-time policy
enters a bounded, evidence-driven escalation sequence from child abort to
provider-turn interrupt to provider-session stop. Every stage is journaled,
waits for its stage-appropriate evidence, and preserves honest `cancelling`
state until termination is proved.

**Blocked by:** 06 — Durable parent-turn cancellation; 10 — Restart
reconciliation to terminal or orphaned; 13 — Admission quotas and safe
telemetry.

**Status:** ready-for-agent

- [ ] **T15-AC1:** Idle or wall-time expiry records a watchdog diagnostic and
  starts child abort with a configured stage timeout.
- [ ] **T15-AC2:** Missing child acknowledgement advances to provider-turn
  interrupt without claiming stopped or cancelled.
- [ ] **T15-AC3:** Missing provider-turn terminal evidence advances to
  provider-session stop, with each accepted command and result journaled.
- [ ] **T15-AC4:** Acknowledgement or applicable terminal evidence at any stage
  stops escalation and settles through normal lifecycle exactly once.
- [ ] **T15-AC5:** Timer expiry alone is never termination proof, and projection
  remains cancelling/uncertain until stage evidence exists.
- [ ] **T15-AC6:** Session-stop timeout or uncertain cleanup produces a stable
  diagnostic and hands the owned execution to the process-teardown stage
  without allowing late events to claim success.
- [ ] **T15-AC7:** Stage timing, outcome, retries, and diagnostics are observable
  through the safe telemetry established by ticket 13.

## Testing Seams

**Approval status:** Approved — owner approval in the ticket-breakdown review
on 2026-08-16.

- **T15-AC1, T15-AC2, T15-AC3, T15-AC4, T15-AC5, T15-AC6:** Server
  orchestration/process integration boundary with controllable child,
  provider-turn, and provider-session fixtures.
- **T15-AC1, T15-AC7:** Wall-time and operator-observation boundary from ticket
  13.
- **T15-AC2, T15-AC4:** Isolated real-Pi boundary for child abort and
  provider-turn interrupt, including acknowledgement timing.
- **T15-AC5:** Projection integration test proving no false stopped/cancelled
  state during timeout-only progression.

