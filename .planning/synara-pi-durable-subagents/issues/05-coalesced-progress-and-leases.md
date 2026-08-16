# 05 — Coalesced progress and heartbeat leases

**What to build:** Managed subagents stop publishing the legacy 80 ms spinner
stream. Meaningful progress is rate-limited and coalesced to the latest
snapshot, heartbeats refresh an ownership lease without becoming transcript
content, and desired state remains distinct from observed queued/running
activity. Under pressure, observation may degrade while lifecycle and terminal
truth retain reserved delivery.

**Blocked by:** 04 — Bounded foreground attachment.

**Status:** ready-for-agent

- [ ] **T05-AC1:** Managed execution emits no continuing 80 ms spinner-style
  publication.
- [ ] **T05-AC2:** Progress is capped at the configured rate, initially two
  updates per second per execution, with trailing-edge latest-snapshot behavior.
- [ ] **T05-AC3:** Heartbeat refreshes the ownership lease, initially every
  approximately 10 seconds with a 30-second lease, without creating transcript
  messages, durable progress history, or auto-follow triggers.
- [ ] **T05-AC4:** Desired state and observed queued/running/cancel activity
  remain separately readable and cannot overwrite one another.
- [ ] **T05-AC5:** Saturation may coalesce or drop progress with counters, but
  lifecycle and terminal events retain reserved capacity.
- [ ] **T05-AC6:** Sustained progress load does not make server memory grow
  linearly with intermediate event count.
- [ ] **T05-AC7:** Invalid rate, heartbeat, or lease configuration falls back to
  safe project defaults.

## Testing Seams

**Approval status:** Approved — owner approval in the ticket-breakdown review
on 2026-08-16.

- **T05-AC1, T05-AC2:** Pi extension managed-event boundary plus isolated
  real-Pi regression — count emissions and prove spinner removal.
- **T05-AC3:** WebSocket execution snapshot and transcript-observation boundary
  — lease changes are visible while transcript content remains unchanged.
- **T05-AC4:** Execution state contract — assert desired/observed separation and
  forbidden overwrite transitions.
- **T05-AC5, T05-AC6:** Provider-event ingress saturation harness — deterministic
  progress flood, terminal reserve, drop counters, and bounded-memory evidence.
  This lower deterministic producer is justified because a real Pi runtime
  cannot reliably induce repeatable saturation; the public real-Pi progress
  test remains required.
- **T05-AC7:** Configuration contract.

