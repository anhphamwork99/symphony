# 03 — Managed admission fails closed

**What to build:** Managed execution admission refuses to start a Pi child when
Synara cannot persist the lifecycle truth required to control it. The user
receives a stable rejection instead of an untrackable child, while existing
executions remain represented and the managed control plane exposes degraded
health until durable writes recover.

**Blocked by:** 02 — Durable execution admission and identity.

**Status:** ready-for-agent

- [ ] **T03-AC1:** Failure to persist requested or accepted lifecycle prevents
  child spawn and returns a stable lifecycle-persistence diagnostic.
- [ ] **T03-AC2:** No execution is projected as accepted or running when its
  durable admission did not complete.
- [ ] **T03-AC3:** Managed control health becomes degraded and new managed
  admissions fail closed while persistence remains unavailable.
- [ ] **T03-AC4:** Existing execution records and terminal truth are not deleted,
  rewritten, or misreported by admission degradation.
- [ ] **T03-AC5:** Once durable writes recover, health can return to available
  and a new command can be admitted without replaying prior rejected work.
- [ ] **T03-AC6:** Legacy Pi behavior remains available according to the
  negotiated capability policy and is never mislabeled managed.

## Testing Seams

**Approval status:** Approved — owner approval in the ticket-breakdown review
on 2026-08-16.

- **T03-AC1, T03-AC2, T03-AC3:** Orchestration command boundary with durable
  store fault injection — the highest stable command surface observes rejection
  while a lower injected store failure induces the otherwise nondeterministic
  condition.
- **T03-AC4:** Durable execution snapshot boundary — existing aggregates remain
  unchanged during admission failure.
- **T03-AC5:** Recovery integration boundary — restore persistence, issue a new
  command identity, and observe one new child.
- **T03-AC6:** Managed-capability boundary — verify degradation does not convert
  legacy work into managed work.

