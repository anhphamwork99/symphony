# 02 — Durable execution admission and identity

**What to build:** For a managed-capable Pi session, every managed subagent
start is authorized and admitted before the child starts. Synara durably mints
one logical `executionId`, the first `attemptId`, parent thread/turn/tool
correlation, and the initial requested/accepted or rejected lifecycle. The
extension runs the child under exactly those identities, and redelivered spawn
commands cannot create duplicates.

**Blocked by:** 01 — Versioned managed-execution handshake.

**Status:** ready-for-agent

- [ ] **T02-AC1:** The execution record and `executionId` are durable before any
  child-start evidence can be observed.
- [ ] **T02-AC2:** Every concrete spawn receives a distinct `attemptId`, and all
  lifecycle events identify their execution, attempt, generation, and unique
  event or attempt-local sequence.
- [ ] **T02-AC3:** Requested-to-accepted is journal-first and deduplicated;
  rejected is terminal with a stable diagnostic; no half-admitted execution
  reaches projection.
- [ ] **T02-AC4:** Project/thread ownership, active-turn, approval, and provider
  authority are enforced before child start; denial produces no child.
- [ ] **T02-AC5:** Replaying a command identity returns already-applied with the
  original identities and creates neither a second execution nor attempt.
- [ ] **T02-AC6:** A legacy or unhandshaked session bypasses this managed
  admission path entirely and keeps the existing extension behavior.

## Testing Seams

**Approval status:** Approved — owner approval in the ticket-breakdown review
on 2026-08-16.

- **T02-AC1, T02-AC2, T02-AC5:** Managed spawn contract and execution
  state-machine boundary — prove identity shape, ordering, and idempotency.
- **T02-AC1, T02-AC3, T02-AC5:** Server orchestration integration boundary —
  inspect durable state before child start, replay the command, and restart the
  harness without duplicating work.
- **T02-AC4:** Orchestration authorization boundary with authorized and denied
  project/thread principals.
- **T02-AC2:** Pi extension bridge boundary — accept and emit the server-minted
  execution and attempt identities.
- **T02-AC6:** Provider-session capability boundary — compare managed and legacy
  session admission behavior.

