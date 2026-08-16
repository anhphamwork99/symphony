# 11 — Reconnectable execution card

**What to build:** Synara exposes managed execution aggregates and lifecycle
cursors through its WebSocket snapshot/replay surface, and the web application
renders an execution card with honest lifecycle and diagnostics. Refresh or
reconnect restores the latest card and resumes lifecycle without replaying
intermediate progress. Card cancellation drives the durable cancel path, and
background execution activity never hijacks transcript auto-follow.

**Blocked by:** 06 — Durable parent-turn cancellation; 09 — Per-thread
completion coordinator; 10 — Restart reconciliation to terminal or orphaned.

**Status:** ready-for-agent

- [ ] **T11-AC1:** The snapshot exposes execution identity, desired and observed
      state, latest progress, lease state, terminal summary, delivery state, and
      stable diagnostics as a bounded aggregate.
- [ ] **T11-AC2:** Lifecycle replay resumes after the client cursor; intermediate
      progress history is not replayed, and duplicate event identities have one
      projection effect.
- [ ] **T11-AC3:** Replay-window gaps produce an explicit resync/gap diagnostic
      and snapshot recovery rather than silent loss.
- [ ] **T11-AC4:** The card renders requested, queued, running, cancelling,
      cancelled, succeeded, failed, and orphaned with their applicable diagnostics.
- [ ] **T11-AC5:** Refresh or browser reconnect restores the card and latest
      progress without requiring the parent tool row to remain active.
- [ ] **T11-AC6:** Authorized cancel is idempotent and remains visibly
      `cancelling` until server acknowledgement; denial is visible without state
      corruption.
- [ ] **T11-AC7:** Heartbeat, resource usage, card state, and nested tool
      progress do not trigger transcript auto-follow; real message arrival and
      live assistant text retain existing behavior.
- [ ] **T11-AC8:** Legacy agents are labeled unmanaged/non-durable only in the
      execution-card experience and are not represented as managed records.

## Testing Seams

**Approval status:** Approved — owner approval in the ticket-breakdown review
on 2026-08-16.

- **T11-AC1, T11-AC2, T11-AC3:** WebSocket orchestration snapshot/replay
  harness with disconnect, cursor resume, duplicate, and replay-gap fixtures.
- **T11-AC4, T11-AC8:** Web execution-card component boundary over complete
  lifecycle and legacy fixtures.
- **T11-AC5, T11-AC6:** Browser reconnect and cancel-flow boundary with
  authorized and denied principals.
- **T11-AC7:** Focused transcript auto-follow browser tests preserving the
  repository's live-output guardrails.
- **T11-AC1:** Contract test proving snapshot and push payloads remain bounded
  and exclude full transcript content.
