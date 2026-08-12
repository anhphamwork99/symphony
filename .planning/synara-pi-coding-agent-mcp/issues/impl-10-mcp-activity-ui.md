# impl-10 — Render MCP command activities in the work log

**What to build:** Show durable Synara MCP pending/success/failure activities in the UI work log while keeping them separate from Pi messages and sidebar summaries.

**Blocked by:** impl-05 — Implement Synara MCP commands and durable acknowledgements.

**Status:** ready-for-agent

- [ ] Retain all MCP acknowledgement kinds even with `turnId: null`.
- [ ] Make live events and replayed snapshots render equivalently.
- [ ] Render safe failure detail as a system/work row, never assistant content.
- [ ] Exclude MCP acknowledgements from sidebar summaries and pending-interaction state.

## Testing Seams

**Approval status:** Approved by owner on 2026-08-12, following designer review.

- **AC1:** WebSocket/domain-event reducer → work-log state — live and replayed pending/succeeded/failed activities produce equivalent state, retain `turnId: null`, and preserve activity identity.
- **AC2:** Work-log filtering/rendering boundary — activities render as system/work rows with bounded safe diagnostics and never become assistant content, sidebar summaries, or pending-interaction state; malformed or unknown activity data fails safely without corrupting unrelated work-log state.

Server journal durability is owned by `impl-05`; browser-wide replay smoke is confirmed by `impl-12`.
