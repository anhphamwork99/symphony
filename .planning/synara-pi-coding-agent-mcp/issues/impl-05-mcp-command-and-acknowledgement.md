# impl-05 — Implement Synara MCP commands and durable acknowledgements

**What to build:** Intercept `/Enable Synara MCP` and `/Disable Synara MCP` in Synara and report their lifecycle through durable system activities.

**Blocked by:** impl-02 — Persist project MCP activation operations.

**Status:** ready-for-agent

- [ ] Commands are handled by Synara and never sent to Pi or model history.
- [ ] Emit pending only when waiting is required, then exactly one terminal activity.
- [ ] Use the accepted pending/succeeded/failed activity contract with stable request IDs and deterministic phase IDs.
- [ ] Keep activities journal-first, replayable, `turnId: null`, and diagnostically safe.

## Testing Seams

**Approval status:** Approved by owner on 2026-08-12, following designer review.

- **AC1:** Synara command boundary → orchestration journal — `/Enable Synara MCP` and `/Disable Synara MCP` are owned by Synara, never forwarded to Pi/model history, and use stable request identity with receipt idempotency.
- **AC2:** Activity journal/projection/replay contract — pending is emitted only when waiting is required, exactly one terminal activity follows, phase IDs are deterministic, activities are journal-first and replayable with `turnId: null`, and they remain separate from assistant messages. Duplicate commands, malformed commands, failed operations, and replay do not create duplicate terminal activities.

UI rendering is owned by `impl-10`; this ticket verifies the durable server/activity contract only.
