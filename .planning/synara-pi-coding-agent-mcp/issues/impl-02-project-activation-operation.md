# impl-02 — Persist project MCP activation operations

**What to build:** Add the project-shared MCP desired state and durable activation operation record, including immutable wait-set and generation metadata.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Persist enabled/disabled desired state with legacy rows defaulting to disabled.
- [ ] Persist request ID, operation generation, absolute deadline, wait-set, outcomes, and aggregate status.
- [ ] Journal and project the state through the existing project metadata contract.
- [ ] Enforce strict schema validation, version/CAS rules, and receipt idempotency.

## Testing Seams

**Approval status:** Approved by owner on 2026-08-12, following designer review.

- **AC1:** Project command/decider → journal → projection/replay contract — valid desired state and activation operation records persist request ID, generation, absolute deadline, immutable wait-set, outcomes, and aggregate status; strict validation, CAS/version rules, receipt idempotency, and replay preserve the same durable identity and state.
- **AC2:** Migration/read-model compatibility case — legacy rows hydrate as `disabled`, while malformed payloads, invalid persisted states, stale versions, and duplicate receipts fail closed or remain idempotent.

This durable contract owns persistence correctness. Later orchestration tickets consume it without repeating the full journal/replay contract.
