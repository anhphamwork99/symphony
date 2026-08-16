# 09 — Per-thread completion coordinator

**What to build:** Completion delivery is coordinated per parent thread.
Near-simultaneous managed child completions form one bounded follow-up, at most
one unacknowledged follow-up exists per thread, and a busy parent defers delivery
until no active parent turn remains. Legacy completion nudges are suppressed
only after Synara acknowledges ownership for that managed execution.

**Blocked by:** 08 — Durable completion outbox.

**Status:** ready-for-agent

- [ ] **T09-AC1:** Completions for one parent thread inside the configured
  batching window produce one follow-up containing bounded summaries and
  execution identities.
- [ ] **T09-AC2:** A thread has at most one pending or unacknowledged managed
  follow-up; later bursts wait or join a later batch.
- [ ] **T09-AC3:** Delivery occurs only when the parent has no active turn, or
  after the active turn's terminal lifecycle is durable; user-read state is not
  a delivery gate.
- [ ] **T09-AC4:** Delivery failure remains retryable and cannot duplicate
  follow-up content or change execution outcomes.
- [ ] **T09-AC5:** Legacy extension notification remains active until Synara has
  acknowledged completion-delivery ownership for that execution.
- [ ] **T09-AC6:** Superseded delivery entries create no follow-up effects, and
  their execution results remain retrievable by identity.

## Testing Seams

**Approval status:** Approved — owner approval in the ticket-breakdown review
on 2026-08-16, including the safe-boundary rule recorded in T09-AC3.

- **T09-AC1, T09-AC2, T09-AC3, T09-AC4, T09-AC6:** Server orchestration
  integration boundary with simultaneous completion, active-parent, idle-parent,
  busy-then-idle, failure, retry, and supersede fixtures.
- **T09-AC2, T09-AC4:** Completion-delivery state-machine contract.
- **T09-AC5:** Isolated real-Pi mixed managed/legacy boundary — ownership
  acknowledgement suppresses only the managed nudge.
