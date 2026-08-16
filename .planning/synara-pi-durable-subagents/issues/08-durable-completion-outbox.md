# 08 — Durable completion outbox

**What to build:** Every applicable terminal creates a durable completion
outbox entry before parent notification. Execution outcome and completion
delivery are separate state machines, so delivery failure never rewrites a
successful child as failed. Delivery can retry idempotently, and superseded
entries cannot create follow-up effects.

**Blocked by:** 07 — Journal-first terminal lifecycle.

**Status:** ready-for-agent

- [ ] **T08-AC1:** Terminal persistence and outbox creation are atomic or
      equivalently journal-first recoverable before notification.
- [ ] **T08-AC2:** Delivery state is independently represented as pending,
      delivered, acknowledged, failed/retryable, or superseded without mutating
      execution outcome.
- [ ] **T08-AC3:** Replayed terminal or outbox processing creates no duplicate
      entry or follow-up effect.
- [ ] **T08-AC4:** Crash or failure between terminal persistence and delivery
      leaves the execution terminal and the outbox recoverably pending.
- [ ] **T08-AC5:** Retry uses a stable dedupe identity and can reach
      acknowledgement without duplicate parent content.
- [ ] **T08-AC6:** A completion superseded by a newer generation produces no
      delivery effect while its original execution evidence remains readable.

## Testing Seams

**Approval status:** Approved — owner approval in the ticket-breakdown review
on 2026-08-16.

- **T08-AC1, T08-AC3, T08-AC4, T08-AC5:** Server orchestration integration
  boundary with crash-before-delivery, replay, retry, and acknowledgement
  fault injection.
- **T08-AC2, T08-AC6:** Completion-delivery state-machine contract — prove
  outcome/delivery separation and supersede rules.
- **T08-AC5:** Parent completion-injection boundary — same dedupe identity
  cannot create duplicate parent effects.
