# impl-02 — Persist project MCP activation operations

**What to build:** Add the project-shared MCP desired state and durable activation operation record, including immutable wait-set and generation metadata.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] Persist enabled/disabled desired state with legacy rows defaulting to disabled.
- [x] Persist request ID, operation generation, absolute deadline, wait-set, outcomes, and aggregate status.
- [x] Journal and project the state through the existing project metadata contract.
- [x] Enforce strict schema validation, version/CAS rules, and receipt idempotency.

**Implementation:** Merged in `05d60e9c` with public-boundary review repairs in
`68e17531`. Focused worker verification passed 124 tests across 10 server test
files, followed by 45 public-boundary tests and 2 migration tests. The main
checkout could not rerun Vitest because the local `vitest` dependency is
unavailable.

## Testing Seams

**Approval status:** Approved by owner on 2026-08-12, following designer review.

- **AC1:** Project command/decider → journal → projection/replay contract — valid desired state and activation operation records persist request ID, generation, absolute deadline, immutable wait-set, outcomes, and aggregate status; strict validation, CAS/version rules, receipt idempotency, and replay preserve the same durable identity and state.
- **AC2:** Migration/read-model compatibility case — legacy rows hydrate as `disabled`, while malformed payloads, invalid persisted states, stale versions, and duplicate receipts fail closed or remain idempotent.

This durable contract owns persistence correctness. Later orchestration tickets consume it without repeating the full journal/replay contract.
