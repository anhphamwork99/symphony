# impl-05 — Implement Synara MCP commands and durable acknowledgements

**What to build:** Intercept `/Enable Synara MCP` and `/Disable Synara MCP` in Synara and report their lifecycle through durable system activities.

**Blocked by:** impl-02 — Persist project MCP activation operations.

**Status:** done

- [x] Commands are handled by Synara and never sent to Pi or model history.
- [x] Emit pending only when waiting is required, then exactly one terminal activity.
- [x] Use the accepted pending/succeeded/failed activity contract with stable request IDs and deterministic phase IDs.
- [x] Keep activities journal-first, replayable, `turnId: null`, and diagnostically safe.

**Implementation:** Merged in `e132b663`, with the planning-miss command-boundary
fix in `de7830d6`. Focused verification after the fix passed 6 tests in
`synaraMcpCommand.test.ts`; broader orchestration verification passed 61 tests.
The main checkout cannot rerun the suite because its workspace toolchain lacks
`turbo`/local Vitest. A pre-existing `decider.ts` typecheck error remains
unrelated to this ticket.

## Testing Seams

**Approval status:** Approved by owner on 2026-08-12, following designer review.

- **AC1:** Synara command boundary → orchestration journal — `/Enable Synara MCP` and `/Disable Synara MCP` are owned by Synara, never forwarded to Pi/model history, and use stable request identity with receipt idempotency.
- **AC2:** Activity journal/projection/replay contract — pending is emitted only when waiting is required, exactly one terminal activity follows, phase IDs are deterministic, activities are journal-first and replayable with `turnId: null`, and they remain separate from assistant messages. Duplicate commands, malformed commands, failed operations, and replay do not create duplicate terminal activities.

UI rendering is owned by `impl-10`; this ticket verifies the durable server/activity contract only.
