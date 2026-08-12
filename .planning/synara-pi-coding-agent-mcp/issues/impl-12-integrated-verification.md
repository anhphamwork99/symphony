# impl-12 — Verify the integrated Synara MCP flow

**What to build:** Prove the complete user journey from dormant default Pi through enable, multi-session activation, MCP use, disable during a call, recovery, and rollback.

**Blocked by:** impl-01 through impl-11.

**Status:** ready-for-agent

- [ ] Verify default dormant startup has no Synara catalog or MCP activity.
- [ ] Verify enable pending/terminal behavior, all-session success, and subject-bound MCP use.
- [ ] Verify disable cancellation continues the Pi turn and prevents replay.
- [ ] Verify reconnect/restart recovery and future-session waiting.
- [ ] Verify failed sibling activation rolls the whole project back to disabled.
- [ ] Run focused integration/manual smoke evidence and the permitted full test command.

## Testing Seams

**Approval status:** Approved by owner on 2026-08-12, following designer review.

- **AC1:** Integrated server/WebSocket/Pi boundary — a thin vertical slice covers dormant startup, successful enable, authorized MCP use, disable during an MCP call with Pi-turn continuity, reconnect/restart recovery, and failed-sibling global rollback.
- **AC2:** Browser/work-log smoke boundary — durable activity visibility, reconnect replay equivalence, and absence of assistant-message or sidebar contamination are verified without duplicating the focused suites from `impl-01` through `impl-11`.

Use representative success/failure journeys, including at least one authority or activation failure, one rollback/recovery path, and exactly-once terminal activity evidence. The full suite command remains `bun run test`.
