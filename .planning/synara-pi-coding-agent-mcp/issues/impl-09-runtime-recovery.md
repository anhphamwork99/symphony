# impl-09 — Recover MCP operations across restart and reconnect

**What to build:** Resume or safely roll back pending project operations and Pi runtimes after restart, reconnect, resume, or runtime replacement.

**Blocked by:** impl-08 — Propagate project activation across the all-session wait-set.

**Status:** ready-for-agent

- [ ] Recover pending operations from durable state and persisted deadline.
- [ ] Reconcile future sessions only after the current operation is terminal.
- [ ] Use fresh subject-bound credentials and generations after recreation.
- [ ] Suppress stale callbacks, duplicate terminal activities, and activation replay.

## Testing Seams

**Approval status:** Approved by owner on 2026-08-12, following designer review.

- **AC1:** Startup/replay reconciliation orchestration boundary — pending operations converge or roll back within the persisted absolute deadline, future sessions wait for terminal state, fresh subject-bound credentials are used, and terminal activities are not duplicated.
- **AC2:** Runtime/session generation boundary — recreated runtimes reject old credentials and callbacks, old catalogs cannot reattach, and stale activation cannot restore enabled state or replay completed work.

Use representative recovery states rather than duplicating the full wait-set matrix from `impl-08`.
