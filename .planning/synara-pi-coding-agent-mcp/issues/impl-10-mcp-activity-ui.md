# impl-10 — Render MCP command activities in the work log

**What to build:** Show durable Synara MCP pending/success/failure activities in the UI work log while keeping them separate from Pi messages and sidebar summaries.

**Blocked by:** impl-05 — Implement Synara MCP commands and durable acknowledgements.

**Status:** done

- [x] Retain all MCP acknowledgement kinds even with `turnId: null`.
- [x] Make live events and replayed snapshots render equivalently.
- [x] Render safe failure detail as a system/work row, never assistant content.
- [x] Exclude MCP acknowledgements from sidebar summaries and pending-interaction state.

## Testing Seams

**Approval status:** Approved by owner on 2026-08-12, following designer review.

- **AC1:** WebSocket/domain-event reducer → work-log state — live and replayed pending/succeeded/failed activities produce equivalent state, retain `turnId: null`, and preserve activity identity.
- **AC2:** Work-log filtering/rendering boundary — activities render as system/work rows with bounded safe diagnostics and never become assistant content, sidebar summaries, or pending-interaction state; malformed or unknown activity data fails safely without corrupting unrelated work-log state.

Server journal durability is owned by `impl-05`; browser-wide replay smoke is confirmed by `impl-12`.

## Implementation evidence

- Production implementation: `6b132f83`.
- Accepted clean-worktree verification point: `96f590a8`; root test 8/8 tasks,
  focused impl-10 tests 150/150, `bun fmt` exit 0, lint 0 errors, and typecheck
  7/7 tasks.
- External test-fixture repair: `23df500b` under maint-34, outside impl-10
  production ownership.
- Chromium before/after evidence: `782ee225`; the acknowledgement renders as a
  system/work row and DOM evidence reports zero matching assistant messages.
- [Decision 33](../decisions/33-impl-10-final-acceptance.md) records the
  historical repository-gate rejection.
- [Decision 36](../decisions/36-impl-10-final-acceptance-reassessment.md) is the
  binding Reassessment that resolves Decision 33's reject gate and finally
  accepts impl-10.
