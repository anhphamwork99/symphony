# impl-08 — Propagate project activation across the all-session wait-set

**What to build:** Make one project-level enable/disable operation reconcile every current Pi session, wait for all current sessions, and roll back globally on any failure.

**Blocked by:** impl-02 — Persist project MCP activation operations; impl-05 — Implement Synara MCP commands and durable acknowledgements; impl-06 — Implement single-session MCP lifecycle; impl-07 — Cancel MCP calls and revoke authority on disable.

**Status:** ready-for-agent

- [ ] Snapshot the current session wait-set and exclude future sessions.
- [ ] Reconcile sessions independently with a 120-second absolute deadline.
- [ ] Commit enabled only after every session succeeds.
- [ ] On any failure, timeout, or unsafe disappearance, commit disabled and clean every session, including successful siblings.
- [ ] Serialize races and ignore stale operation/session generations.

## Testing Seams

**Approval status:** Approved by owner on 2026-08-12, following designer review.

- **AC1:** Project lifecycle command → provider reconciliation orchestration — the current session wait-set is captured immutably, each member is reconciled independently, future sessions are excluded from that operation, all-session success commits enabled, and one terminal outcome is journaled.
- **AC2:** Orchestration failure/restart boundary — a failed, timed-out, or unsafe-disappearing session causes global rollback and sibling cleanup; absolute deadline, operation/session generations, race serialization, and no replay are preserved. Use a controllable clock rather than a real 120-second wait.

This ticket owns project-wide atomic behavior; per-session lifecycle and durable persistence details remain owned by `impl-02`, `impl-06`, and `impl-07`.
