# 06 — Durable parent-turn cancellation

**What to build:** Stop on a parent Pi turn records durable cancellation intent
before dispatch, targets every managed child in the parent-turn scope across
foreground-detached and background modes, fences stale generations, and reports
`cancelled` only after termination evidence. Dispatch or acknowledgement
failure remains `cancelling` with a stable diagnostic, bounded retry, and
provider-turn interrupt as the first escalation stage.

**Blocked by:** 04 — Bounded foreground attachment; 05 — Coalesced progress and
heartbeat leases.

**Status:** ready-for-agent

- [ ] **T06-AC1:** Desired cancellation is durable before dispatch; duplicate or
  replayed cancel commands are idempotent and do not repeat child abort effects.
- [ ] **T06-AC2:** Parent-turn Stop targets every managed child declaring that
  scope, for foreground-detached and background transport modes.
- [ ] **T06-AC3:** Cancel identifies the expected attempt and generation; stale
  cancel or late settlement cannot affect a newer attempt.
- [ ] **T06-AC4:** `cancelled` requires a child terminal acknowledgement carrying
  the same attempt/generation, or proof that the owner process generation is
  dead, the lease expired, and `listActive` no longer contains the execution.
- [ ] **T06-AC5:** `session.abort()` resolution or a temporary describe miss is
  insufficient termination proof.
- [ ] **T06-AC6:** Dispatch failure or acknowledgement timeout preserves
  `cancelling`, emits a stable diagnostic, retries within bounds, and may
  interrupt the provider turn without claiming success.
- [ ] **T06-AC7:** Background managed spawn receives and honors parent abort
  propagation.

## Testing Seams

**Approval status:** Approved — owner approval in the ticket-breakdown review
on 2026-08-16, including the termination-evidence rule recorded in T06-AC4.

- **T06-AC1, T06-AC3, T06-AC4:** Cancel command and execution state-machine
  contracts — desired/observed transitions, generation fencing, and evidence
  requirements.
- **T06-AC1, T06-AC2, T06-AC6:** Server orchestration integration boundary with
  deterministic acknowledgement success, timeout, dispatch failure, duplicate,
  and retry fixtures.
- **T06-AC2, T06-AC4, T06-AC5, T06-AC7:** Isolated real-Pi boundary — Stop reaches
  foreground-detached and background children, and state waits for child
  termination evidence.
- **T06-AC3:** Resume/cancel race fixture with a late stale settlement.

