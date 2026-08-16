# 12 — Authorized paginated transcript and result view

**What to build:** A user can open a managed execution's result and transcript
from its card and read bounded pages by cursor. Every read enforces existing
project/thread authority; knowing an `executionId` grants no access. Large
results show stable truncation diagnostics and continue through the transcript
surface rather than lifecycle events or WebSocket push.

**Blocked by:** 11 — Reconnectable execution card.

**Status:** ready-for-agent

- [ ] **T12-AC1:** Result and transcript reads authorize the current user
  against the execution's project and thread before returning content.
- [ ] **T12-AC2:** Unknown-ID knowledge or access to a different project/thread
  cannot read metadata, result, transcript, or filesystem references.
- [ ] **T12-AC3:** Retrieval is cursor/page based with bounded page and response
  sizes; no unbounded read path is exposed.
- [ ] **T12-AC4:** A bounded result summary that omits content reports a stable
  truncation diagnostic and a retrievable continuation.
- [ ] **T12-AC5:** Full transcript or result content never appears in lifecycle
  events, execution snapshots, metrics, default logs, or WebSocket push.
- [ ] **T12-AC6:** Transcript availability is never interpreted as evidence that
  the execution is currently alive.
- [ ] **T12-AC7:** Missing, expired, corrupt, or unavailable transcript evidence
  produces stable diagnostics without changing execution outcome.

## Testing Seams

**Approval status:** Approved — owner approval in the ticket-breakdown review
on 2026-08-16.

- **T12-AC1, T12-AC2, T12-AC3, T12-AC7:** Authorized transcript-read command
  boundary with project/thread, pagination, missing, and corrupt fixtures.
- **T12-AC3, T12-AC4:** Browser result/transcript view boundary with large
  output and continuation fixtures.
- **T12-AC5:** Lifecycle, snapshot, and WebSocket contract suite proving full
  content fields are excluded.
- **T12-AC6:** Execution state mapping test using an available transcript for
  an orphaned execution.

