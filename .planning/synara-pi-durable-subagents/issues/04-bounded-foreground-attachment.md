# 04 — Bounded foreground attachment

**What to build:** Managed foreground `Agent` calls wait only for a bounded
budget. A child that finishes inside the budget returns its normal result. A
child still running at expiry releases the parent tool call with its execution
handle while the same child continues under its parent-turn cancellation scope
and remains durably observable as running.

**Blocked by:** 03 — Managed admission fails closed.

**Status:** complete — re-completed per Decision 0010 (2026-08-18); remediation evidence in tickets 18–24, integrated proof in ticket 24's second matrix

**Review disposition (2026-08-16):** Failed. Bounded foreground behavior was
implemented in a synthetic extension fixture, not the actual production Pi
Agent path, and no restart recovery evidence was produced. Configuration
resolution in AC5 was independently verified. The checkboxes below represent
accepted review evidence.

- [x] **T04-AC1:** A child finishing inside the wait budget returns through the
      existing inline result flow without creating unnecessary follow-up delivery.
- [x] **T04-AC2:** A child still active at expiry returns an execution handle
      within the configured budget plus a bounded scheduling tolerance.
- [x] **T04-AC3:** Returning the handle does not spawn a replacement, stop the
      original child, or detach it from the default parent-turn cancellation scope.
- [x] **T04-AC4:** Started and detached observations are durable, and the
      execution is represented as running rather than interrupted.
- [x] **T04-AC5:** The initial default is 10 seconds; configuration is bounded,
      and invalid values fall back safely instead of disabling detach.
- [x] **T04-AC6:** Managed detach affects only its execution; concurrent managed
      executions and legacy sessions retain their own behavior.

## Testing Seams

**Approval status:** Superseded by ticket 22 — the seams below express the
original intent, but independent review on 2026-08-16 found that synthetic
Agent fixtures and in-memory observations did not satisfy real-Pi or restart
acceptance.

- **T04-AC1, T04-AC2, T04-AC3:** Isolated real-Pi parent-tool boundary — run one
  fast child and one child exceeding the budget; measure return time and prove
  the long child continues under the same identity.
- **T04-AC4:** Server orchestration integration boundary — restart the harness
  after detach and recover the running execution aggregate.
- **T04-AC5:** Managed execution configuration contract — validate defaults,
  bounds, and invalid-value fallback.
- **T04-AC6:** Real-Pi concurrent execution fixture with one managed long child
  and an unaffected peer or legacy session.
