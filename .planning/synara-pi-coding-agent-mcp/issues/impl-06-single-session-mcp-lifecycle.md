# impl-06 — Implement single-session MCP lifecycle

**What to build:** Activate and deactivate Synara MCP for one Pi runtime with safe boundaries, generation fencing, and all-or-nothing catalog exposure.

**Blocked by:** impl-03 — Remove default Synara tools and add dormant MCP extension; impl-04 — Bind Synara MCP authority to the authenticated subject.

**Status:** done

- [x] Implement dormant, activating, active, deactivating, and unavailable transitions.
- [x] Stage identity, credentials, connection, discovery, and schema validation before exposure.
- [x] Apply tool-surface changes only at a safe boundary.
- [x] Roll back failed activation to disabled without partial tools.

**Implementation:** Coordinator core landed in `1975aa1f`; production Pi
session wiring landed in `1e6411a6`. Each Pi session owns one lifecycle
coordinator, stages a fresh subject-bound gateway credential and complete
catalog, exposes the catalog through the extension reload boundary only after
`agent_end`, and disposes/fences the coordinator before runtime teardown.
Focused verification passed 61 tests across `piSynaraMcpLifecycle.test.ts`,
`piSynaraMcpExtension.test.ts`, and `PiAdapter.test.ts`.

The standalone server typecheck still reports pre-existing errors outside the
impl-06 change surface in agent-gateway, orchestration, and WebSocket files;
all impl-06-local type errors found during this ticket were fixed.

**Final acceptance:** Accepted at `3dfc98d1` by
[Decision 23](../decisions/23-impl-06-final-acceptance.md).

## Testing Seams

**Approval status:** Approved by owner on 2026-08-12, following designer review.

- **AC1:** Per-session lifecycle coordinator → provider runtime/session boundary — dormant, activating, active, deactivating, and unavailable transitions stage identity, credentials, connection, discovery, and schema validation; tool-surface changes apply only at a safe boundary and complete catalogs expose atomically.
- **AC2:** Activation failure/reload-recreate boundary — representative staging or recreation failures roll back without partial Synara tools or authority, stale completion cannot expose tools after rollback, and normal coding-agent tools remain usable.

Tests target the provider/session contract rather than concrete Pi SDK objects or private reload helpers. A lower runtime harness is allowed only when the public lifecycle call cannot observe the required invariant.
