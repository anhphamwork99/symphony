# impl-06 — Implement single-session MCP lifecycle

**What to build:** Activate and deactivate Synara MCP for one Pi runtime with safe boundaries, generation fencing, and all-or-nothing catalog exposure.

**Blocked by:** impl-03 — Remove default Synara tools and add dormant MCP extension; impl-04 — Bind Synara MCP authority to the authenticated subject.

**Status:** ready-for-agent

- [ ] Implement dormant, activating, active, deactivating, and unavailable transitions.
- [ ] Stage identity, credentials, connection, discovery, and schema validation before exposure.
- [ ] Apply tool-surface changes only at a safe boundary.
- [ ] Roll back failed activation to disabled without partial tools.

## Testing Seams

**Approval status:** Approved by owner on 2026-08-12, following designer review.

- **AC1:** Per-session lifecycle coordinator → provider runtime/session boundary — dormant, activating, active, deactivating, and unavailable transitions stage identity, credentials, connection, discovery, and schema validation; tool-surface changes apply only at a safe boundary and complete catalogs expose atomically.
- **AC2:** Activation failure/reload-recreate boundary — representative staging or recreation failures roll back without partial Synara tools or authority, stale completion cannot expose tools after rollback, and normal coding-agent tools remain usable.

Tests target the provider/session contract rather than concrete Pi SDK objects or private reload helpers. A lower runtime harness is allowed only when the public lifecycle call cannot observe the required invariant.
