# 02 — Durable execution admission and identity

**What to build:** For a managed-capable Pi session, every managed subagent
start is authorized and admitted before the child starts. Synara durably mints
one logical `executionId`, the first `attemptId`, parent thread/turn/tool
correlation, and the initial requested/accepted or rejected lifecycle. The
extension runs the child under exactly those identities, and redelivered spawn
commands cannot create duplicates.

**Blocked by:** 01 — Versioned managed-execution handshake.

**Status:** complete — re-completed per Decision 0010 (2026-08-18); remediation evidence in tickets 18–24, integrated proof in ticket 24's second matrix

**Review disposition (2026-08-16):** Failed. The repository and coordinator
were exercised only through tests, were not in the production Pi spawn call
chain, and did not provide atomic concurrent idempotency or complete authority
checks. The checkboxes below represent accepted review evidence.

- [x] **T02-AC1:** The execution record and `executionId` are durable before any
      child-start evidence can be observed.
- [x] **T02-AC2:** Every concrete spawn receives a distinct `attemptId`, and all
      lifecycle events identify their execution, attempt, generation, and unique
      event or attempt-local sequence.
- [x] **T02-AC3:** Requested-to-accepted is journal-first and deduplicated;
      rejected is terminal with a stable diagnostic; no half-admitted execution
      reaches projection.
- [x] **T02-AC4:** Project/thread ownership, active-turn, approval, and provider
      authority are enforced before child start; denial produces no child.
- [x] **T02-AC5:** Replaying a command identity returns already-applied with the
      original identities and creates neither a second execution nor attempt.
- [x] **T02-AC6:** A legacy or unhandshaked session bypasses this managed
      admission path entirely and keeps the existing extension behavior.

## Testing Seams

**Approval status:** Superseded by tickets 18 and 20 — the seams below are
retained as historical unit/integration evidence, but independent review on
2026-08-16 found that they did not prove the production Agent call chain,
atomicity, complete authority, or migration compatibility.

- **T02-AC1, T02-AC2, T02-AC5 (Contract Schemas & Identity Shapes):**
  - Seam: `packages/contracts/src/piSubagents.test.ts` validating `packages/contracts/src/piSubagents.ts`.
  - Proves: Schema validation for `executionId`, `attemptId`, `generation`, attempt sequence, parent thread/turn/tool correlation, `PiSubagentSpawnCommand`, `PiSubagentSpawnResult`, and lifecycle event shapes.
- **T02-AC1, T02-AC3, T02-AC5 (Durable Store & Journal-First Persistence):**
  - Seam: the historical repository test and pre-remediation Pi-subagent
    execution migration; migration lineage is now governed by ticket 18.
  - Proves: Execution record and first attempt are durably committed in SQLite before child start; journal events are sequentially written and deduplicated; replaying a `commandId` returns already-applied with original identities and creates no duplicate execution or attempt.
- **T02-AC1, T02-AC3, T02-AC4, T02-AC5 (Admission & Authorization Coordinator):**
  - Seam: `apps/server/src/provider/piSubagentAdmissionCoordinator.test.ts` validating `apps/server/src/provider/piSubagentAdmissionCoordinator.ts`.
  - Proves: Enforces project/thread ownership, active-turn check, and provider authority before child start; unauthorized/mismatched principals produce terminal rejection with stable diagnostic codes; replaying a command identity returns already-applied without creating a second child.
- **T02-AC2 (Extension Bridge Identities):**
  - Seam: `apps/server/src/provider/piSubagentBridge.test.ts` validating `apps/server/src/provider/piSubagentBridge.ts`.
  - Proves: Bridge accepts server-minted `executionId`, `attemptId`, `generation`, and emits lifecycle events identifying these.
- **T02-AC4, T02-AC6 (Provider Session Integration & Legacy Bypass):**
  - Seam: `apps/server/src/provider/piSubagentSession.test.ts`.
  - Proves: Managed session admits subagent start through the coordinator and runs child under server-minted identities; denial produces no child; unhandshaked/legacy session bypasses managed admission path entirely and keeps existing extension behavior.
