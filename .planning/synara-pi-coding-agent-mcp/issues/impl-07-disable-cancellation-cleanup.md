# impl-07 — Cancel MCP calls and revoke authority on disable

**What to build:** Disable Synara MCP with fence, cancellation, drainage, revocation, cleanup, and runtime reconciliation without aborting the whole Pi turn.

**Blocked by:** impl-04 — Bind Synara MCP authority to the authenticated subject; impl-06 — Implement single-session MCP lifecycle.

**Status:** ready-for-agent

- [ ] Fence new calls before asynchronous cleanup starts.
- [ ] Cancel and drain active Synara MCP calls, then revoke credentials before reload/clear.
- [ ] Return structured `synara_mcp_disabled` errors and ignore late callbacks.
- [ ] Keep the Pi turn alive, prevent replay, and leave the session disabled/unavailable on uncertain cleanup.

## Testing Seams

**Approval status:** Approved by owner on 2026-08-12, following designer review.

- **AC1:** Public session/provider disable boundary — new calls are fenced, active calls are cancelled and drained, authority is revoked only after drain, resources are cleaned up, and the runtime is reconciled at a safe boundary; late callbacks cannot mutate state or emit duplicate results and uncertain cleanup leaves the session disabled/unavailable.
- **AC2:** Narrow Pi tool-execution exception seam — a disabled MCP call returns structured `synara_mcp_disabled`, the non-MCP Pi turn continues without whole-session abort, and the cancelled call is not replayed.

The execution seam is limited to turn continuity and no-replay; it is not a general Pi execution test suite.
