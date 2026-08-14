# impl-10 — Render MCP command activities in the work log

**What to build:** Show durable Synara MCP pending/success/failure activities in the UI work log while keeping them separate from Pi messages and sidebar summaries.

**Blocked by:** impl-05 — Implement Synara MCP commands and durable acknowledgements.

**Status:** implementation-verified-final-acceptance-blocked

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

- [Decision 33](../decisions/33-impl-10-final-acceptance.md) rejects final
  acceptance at candidate commit `6b132f83`; the rejection is an acceptance-
  gate rejection, not a source/behavior defect finding.
- Candidate commit `6b132f83` (one commit above fixed point `f021e84b`,
  clean working tree, four web files) passes focused worker + reviewer runs
  150/150 and the web suite 3796/3796.
- Final acceptance is blocked by the root suite's `apps/server` failures
  (external/pre-existing, reproduced at the fixed point) and by missing
  authorized `bun fmt`/`bun lint`/`bun typecheck` passing evidence; screenshots
  are required before PR handoff.
