# 17 — Integrated real-Pi acceptance smoke

**What to build:** Provide one hermetically isolated, repeatable acceptance path
against a real Pi runtime that proves the complete managed-execution first
slice: capability negotiation, durable identity, bounded detach, coalesced
progress, reconnectable execution card, real cancellation, batched completion,
restart reconciliation, watchdog escalation, owned cleanup, and legacy
fallback. The smoke reports each stage and stable diagnostic and cannot pass
using provider fakes alone.

**Blocked by:** 01 — Versioned managed-execution handshake; 02 — Durable
execution admission and identity; 03 — Managed admission fails closed; 04 —
Bounded foreground attachment; 05 — Coalesced progress and heartbeat leases;
06 — Durable parent-turn cancellation; 07 — Journal-first terminal lifecycle;
08 — Durable completion outbox; 09 — Per-thread completion coordinator; 10 —
Restart reconciliation to terminal or orphaned; 11 — Reconnectable execution
card; 13 — Admission quotas and safe telemetry; 15 — Watchdog escalation
through provider-session stop; 16 — Owned process-tree teardown and fencing.

**Status:** ready-for-agent

- [ ] **T17-AC1:** A compatible real Pi session negotiates managed capability
  and starts one identity-stamped long-running execution.
- [ ] **T17-AC2:** The foreground parent releases within the configured budget,
  progress remains bounded, and browser reconnect restores the execution card.
- [ ] **T17-AC3:** Parent Stop reaches the real child and the card remains
  cancelling until termination evidence.
- [ ] **T17-AC4:** Multiple real child completions create one bounded follow-up
  per thread and remain individually retrievable by execution identity.
- [ ] **T17-AC5:** Restart during a non-terminal execution reconciles to a
  proven live owner, recovered terminal, or honest orphan, with no automatic
  replay.
- [ ] **T17-AC6:** A deliberately wedged execution progresses through watchdog
  stages and leaves no owned child process after proven teardown.
- [ ] **T17-AC7:** A no-bridge or legacy-extension leg retains legacy semantics
  and is never labeled managed or recoverable.
- [ ] **T17-AC8:** The harness uses an isolated home, non-default ports, isolated
  process ownership, and does not read or mutate the user's active Synara/Pi
  instance or agent configuration.
- [ ] **T17-AC9:** Any stage failure reports the stage and stable diagnostic and
  fails loudly; a mock-only success is impossible.

## Testing Seams

**Approval status:** Approved — owner approval in the ticket-breakdown review
on 2026-08-16. Ticket 16's approved seam resolution remains a prerequisite for
the destructive stage.

- **T17-AC1–T17-AC9:** The hermetically isolated real-Pi acceptance harness is
  the public feature seam. Provider fakes may prepare deterministic lower-level
  coverage but cannot satisfy this ticket.
- **T17-AC8:** Local-instance isolation checks include dry-run configuration,
  non-default server and web ports, isolated home/state, and owned-process
  verification before execution.
