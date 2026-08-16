# 07 — Journal-first terminal lifecycle

**What to build:** Child terminal evidence becomes durable execution truth
before any completion notification. Terminal events are deduplicated and
generation-fenced; sequence gaps remain diagnosable; progress saturation cannot
discard terminal truth; and terminal payloads carry only bounded summaries and
authorized transcript references.

**Blocked by:** 06 — Durable parent-turn cancellation.

**Status:** ready-for-agent

- [ ] **T07-AC1:** A terminal lifecycle event is durably appended and applied
      before any completion delivery may begin.
- [ ] **T07-AC2:** Duplicate or replayed terminal events have exactly one state
      effect, and the first applicable terminal for an attempt wins.
- [ ] **T07-AC3:** Attempt event sequence gaps emit a stable diagnostic without
      deleting or delaying an already-persisted terminal.
- [ ] **T07-AC4:** Terminal from a superseded attempt or generation is ignored
      and counted and cannot overwrite current execution truth.
- [ ] **T07-AC5:** Terminal payload contains a bounded result summary and
      transcript reference, never unbounded raw transcript output.
- [ ] **T07-AC6:** Terminal persists when progress ingress is saturated or its
      observation sink is degraded.
- [ ] **T07-AC7:** Cancellation and normal completion racing for the same
      attempt resolve through one applicable terminal owner without state flip-flop.

## Testing Seams

**Approval status:** Approved — owner approval in the ticket-breakdown review
on 2026-08-16.

- **T07-AC1, T07-AC2, T07-AC3, T07-AC4, T07-AC7:** Server runtime-journal and
  orchestration integration boundary with replay, sequence-gap, stale attempt,
  and cancel-versus-complete race fixtures.
- **T07-AC2, T07-AC4:** Terminal lifecycle state-machine contract.
- **T07-AC5:** Isolated real-Pi completion boundary — emit a real completion and
  inspect bounded summary and transcript reference.
- **T07-AC6:** Shared provider-ingress saturation harness from ticket 05.
