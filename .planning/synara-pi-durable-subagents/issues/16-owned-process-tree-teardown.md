# 16 — Owned process-tree teardown and fencing

**What to build:** When provider-session stop cannot prove cleanup, Synara
tears down only the process tree owned by the managed execution/session,
verifies that it is dead, fences the terminated generation, and reports any
survivor explicitly. Late callbacks or terminal events cannot revive the
execution or reverse its settled projection.

**Blocked by:** 15 — Watchdog escalation through provider-session stop.

**Status:** ready-for-agent

- [ ] **T16-AC1:** Teardown targets only process groups proven owned by the
  execution/provider session and cannot kill unrelated Synara or user
  processes.
- [ ] **T16-AC2:** The final escalation stage requests teardown once,
  idempotently, and records request, result, and proof status.
- [ ] **T16-AC3:** Completion requires process-tree liveness verification, not
  only a successful kill API return.
- [ ] **T16-AC4:** Surviving processes produce a stable uncertain-cleanup
  diagnostic and remain operationally visible.
- [ ] **T16-AC5:** Proven teardown fences the attempt and generation before
  projection settles; late events are ignored and counted.
- [ ] **T16-AC6:** Graceful cancellation and normal terminal paths never invoke
  process-tree teardown.
- [ ] **T16-AC7:** Server restart performs bounded orphan-process discovery and
  cleanup only where ownership can still be proven.

## Testing Seams

**Approval status:** Pending — the owner approved the deterministic
process-supervisor seams in the ticket-breakdown review on 2026-08-16;
`/matt-implement` must prove whether destructive real-Pi teardown is hermetic
and deterministic in CI. If not, record the permitted deterministic-fixture
substitution here and obtain owner approval before writing the first substituted
test; retain an isolated manual real-Pi verification.

- **T16-AC1, T16-AC2, T16-AC3, T16-AC4, T16-AC6, T16-AC7:** Process supervisor
  integration boundary with owned, unrelated, surviving, graceful, and restart
  fixtures.
- **T16-AC5:** Runtime-generation and projection integration boundary with late
  callback injection after proven teardown.
- **T16-AC1, T16-AC3:** Isolated real-Pi destructive boundary if CI hermeticity
  is proven; otherwise deterministic process fixture plus manual-gated real-Pi
  evidence under the approved substitution.

