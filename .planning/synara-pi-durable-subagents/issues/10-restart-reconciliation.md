# 10 — Restart reconciliation to terminal or orphaned

**What to build:** On server restart, Synara reconciles every non-terminal
managed execution against live bridge ownership and transcript terminal
evidence. A proven live execution remains running, terminal evidence restores
the outcome, and an execution with neither becomes non-terminal `orphaned` with
an owner-loss and partial-side-effect warning. Reconciliation never replays the
delegation automatically.

**Blocked by:** 05 — Coalesced progress and heartbeat leases; 07 —
Journal-first terminal lifecycle.

**Status:** ready-for-agent

- [ ] **T10-AC1:** No live-owner or terminal evidence produces `orphaned` with a
  stable owner-loss diagnostic; `running` is never asserted without evidence.
- [ ] **T10-AC2:** A transcript terminal marker carrying matching identity and
  generation restores the applicable terminal outcome instead of orphaning.
- [ ] **T10-AC3:** A bridge `listActive` or describe result matching execution,
  attempt, and generation refreshes observation without creating a new attempt.
- [ ] **T10-AC4:** Startup reconciliation performs no spawn, resume, or other
  side-effecting delegation replay.
- [ ] **T10-AC5:** Late events from stale attempts or generations after
  reconciliation are ignored and counted.
- [ ] **T10-AC6:** The orphan diagnostic explains that partial external or
  workspace side effects may already exist and recommends inspection.
- [ ] **T10-AC7:** Lease expiry without renewed live-owner evidence enters the
  same owner-loss reconciliation instead of remaining running indefinitely;
  the initial orphan threshold is approximately 60 seconds and remains
  configurable.

## Testing Seams

**Approval status:** Approved — owner approval in the ticket-breakdown review
on 2026-08-16.

- **T10-AC1, T10-AC2, T10-AC3, T10-AC4, T10-AC5, T10-AC7:** Server
  orchestration kill/restart harness with active-owner, no-owner,
  terminal-marker, missing-marker, lease-expiry, and stale-event fixtures.
- **T10-AC1:** Execution state-machine contract — `orphaned` is non-terminal and
  can exit only through new evidence or explicit resume.
- **T10-AC3:** Isolated real-Pi bridge boundary — a live registry record is
  discoverable under the same execution, attempt, and generation.
- **T10-AC6:** Projected diagnostic contract.
