# 20 — Atomic authorized production admission

**What to build:** A managed Agent request from the actual Pi extension enters
one production admission path that authorizes the caller, durably records one
logical execution and first attempt, and only then allows the child to start.
Concurrent or redelivered commands and lifecycle events are idempotent.
Crashes cannot expose half-admitted state, and attempt-local sequencing remains
compatible with future resume attempts.

**Blocked by:** 18 — Reconcile released migration lineages; 19 — Complete
real-Pi capability negotiation.

**Status:** completed

- [x] **T20-AC1:** The production composition provides the durable execution
      repository and routes the actual managed Agent spawn through admission before
      child-start evidence.
- [x] **T20-AC2:** Execution record, first attempt, and requested/accepted or
      rejected lifecycle truth commit atomically; injected failure leaves none of
      them partially visible.
- [x] **T20-AC3:** Concurrent commands with the same command identity create
      exactly one execution and attempt; every caller receives the same accepted or
      already-applied identities rather than a raw uniqueness failure.
- [x] **T20-AC4:** Lifecycle redelivery is idempotent by execution, attempt,
      generation, and attempt-local sequence; a future attempt may begin its own
      sequence without colliding with a prior attempt.
- [x] **T20-AC5:** Project/thread ownership, active-turn, approval, provider,
      and subject authority are verified from server-minted trusted context before
      spawn; identifiers supplied by the extension do not grant authority.
- [x] **T20-AC6:** Rejected admission is terminal with a stable diagnostic and
      starts no child; a successful admission runs the child under server-minted
      execution, attempt, and generation identities.
- [x] **T20-AC7:** Legacy or unhandshaked Agent work bypasses managed admission
      without creating managed execution records or being labeled durable.
- [x] **T20-AC8:** Database reopen after admission returns the same aggregate
      and journal ordering, proving the result is not an in-memory record.

## Testing Seams

**Approval status:** Approved — owner approved the remediation breakdown and
known seams on 2026-08-16.

- **T20-AC1, T20-AC5, T20-AC6, T20-AC7:** Actual Pi Agent → production server
  admission → child-start boundary with authorized, denied, managed, and legacy
  sessions.
- **T20-AC2, T20-AC3, T20-AC4, T20-AC8:** Durable admission transaction
  boundary with concurrent replay, lifecycle redelivery, write-fault injection,
  multiple attempts, and database reopen.
- **T20-AC5:** Existing trusted authorization boundary — verify subject,
  project, thread, approval, active-turn, and provider constraints without
  trusting model-supplied identity.

## Implementation Report

**Implementation state:** completed

### Delivered scope

Delivered the complete atomic authorized production admission lifecycle for Pi subagents:
1. **Durable Repository & Transactions (`PiSubagentExecutionRepository.ts`)**:
   - `recordAdmission`: Executes within `sql.withTransaction`, writing `pi_subagent_lifecycle_journal` (sequence 1) and `pi_subagent_executions` aggregate atomically.
   - Race-recovery: Catches concurrent unique-constraint collisions on `command_id` and returns `already_applied` with the existing execution rather than propagating database exceptions.
   - `recordLifecycleEvent`: Executes within `sql.withTransaction`, performing event-id and sequence deduplication, updating `observed_state`, `desired_state`, `attempt_id`, and `generation`.
   - Durable disk queries: `getById`, `getByCommandId`, `listByThreadId`, and `listJournalEvents`.
2. **Trusted Authority Coordinator (`piSubagentAdmissionCoordinator.ts`)**:
   - Validates server-minted `TrustedAdmissionContext` (ensuring provider is `"pi"`, subject MCP credentials are unexpired, thread ID matches server truth, project ID matches server truth, active turn matches server truth, and approvals are verified).
   - Validates `PiSubagentNegotiatedCapability` and `PiSubagentControlHealth` before store mutations.
   - Emits stable, domain-specific diagnostics (`pi_subagent_admission_provider_mismatch`, `pi_subagent_admission_unauthorized`, `pi_subagent_admission_project_mismatch`, `pi_subagent_admission_active_turn_required`).
3. **Production Layer Composition & Tool Interception (`PiAdapter.ts`, `serverLayers.ts`, `runtimeLayer.ts`)**:
   - Provided `PiSubagentExecutionRepositoryLive` in `makeServerRuntimeServicesLayer` and `makeServerProviderLayer`.
   - Installed `wrapAgentTool` in `PiAdapter` during session startup for managed sessions: intercepts `Agent` tool execution, runs `admitSubagentSpawn` before spawning the child, injects server-minted `executionId`, `attemptId`, `generation`, and prevents child invocation upon rejection.
   - Unmanaged/legacy sessions bypass admission without creating records.

### Changed production call chain

```
Actual Agent Tool Invocation (Pi extension)
   │
   ▼
wrapAgentTool interceptor (PiAdapter.ts)
   │
   ▼
admitSubagentSpawn (piSubagentAdmissionCoordinator.ts)
   ├── Validate session capability (isManaged)
   ├── Check PiSubagentControlHealth
   ├── Verify server-minted TrustedAdmissionContext
   │     ├── trustedProvider === "pi"
   │     ├── mcpAuthority not expired
   │     ├── command.parentThreadId === trustedThreadId
   │     ├── command.projectId === trustedProjectId
   │     ├── command.parentTurnId === trustedActiveTurnId
   │     └── approvalGranted === true if approvalRequired
   └── Snapshot read-model cross-check
   │
   ▼
recordAdmission (PiSubagentExecutionRepository.ts)
   ├── sql.withTransaction
   │     ├── INSERT INTO pi_subagent_lifecycle_journal (sequence = 1, state = 'accepted' | 'rejected')
   │     └── INSERT INTO pi_subagent_executions (...)
   └── Catch unique constraint collision -> return already_applied
   │
   ▼
[If Rejected] ──> Returns error to tool without invoking child, emits no running event
[If Accepted] ──> Passes server-minted identities (executionId, attemptId, generation) to child
                   └── Child starts & lifecycle transitions recorded via recordLifecycleEvent
```

### Acceptance evidence matrix

| Criterion | Source evidence | Verification evidence | Result |
| --------- | --------------- | --------------------- | ------ |
| T20-AC1 | `PiAdapter.ts`, `serverLayers.ts`, `runtimeLayer.ts` | `piSubagentRealExtension.test.ts` (line 826) | Passed |
| T20-AC2 | `PiSubagentExecutionRepository.ts` (`sql.withTransaction`) | `PiSubagentExecutionRepository.test.ts` (line 32) | Passed |
| T20-AC3 | `PiSubagentExecutionRepository.ts` (collision recovery) | `PiSubagentExecutionRepository.test.ts` (line 80) | Passed |
| T20-AC4 | `PiSubagentExecutionRepository.ts` (`recordLifecycleEvent`) | `PiSubagentExecutionRepository.test.ts` (line 114) | Passed |
| T20-AC5 | `piSubagentAdmissionCoordinator.ts` (`TrustedAdmissionContext`) | `piSubagentAdmissionCoordinator.test.ts` (line 284) | Passed |
| T20-AC6 | `PiAdapter.ts` (`wrapAgentTool`), `piSubagentAdmissionCoordinator.ts` | `piSubagentRealExtension.test.ts`, `piSubagentSession.test.ts` | Passed |
| T20-AC7 | `PiAdapter.ts`, `piSubagentBridge.ts` | `piSubagentSession.test.ts` (line 340), `piSubagentRealExtension.test.ts` | Passed |
| T20-AC8 | `PiSubagentExecutionRepository.ts` (disk SQLite reopen) | `PiSubagentExecutionRepository.test.ts` (line 200) | Passed |

### Failure and diagnostic evidence

- **Provider mismatch denial:** `pi_subagent_admission_provider_mismatch` returned when `trustedProvider` is not `"pi"`.
- **Subject authority expiry:** `pi_subagent_admission_unauthorized` returned when MCP authority token has expired.
- **Thread/Project hijacking:** `pi_subagent_admission_unauthorized` and `pi_subagent_admission_project_mismatch` returned when command IDs differ from trusted server context.
- **Active-turn requirement:** `pi_subagent_admission_active_turn_required` returned when turn ID does not match active session turn.
- **Persistence store fault:** `pi_subagent_lifecycle_persistence_failed` returned, transaction rolls back cleanly, no half-admitted record left in database.
- **Concurrent duplicate commands:** Exactly 1 execution row created; concurrent callers receive `already_applied` without constraint failures.
- **Duplicate lifecycle events:** Returns `already_applied` without duplicate journal insertion.
- **Legacy bypass:** Zero database rows created for unmanaged/unhandshaked sessions.

### Verification commands and results

- Command: `bun run --cwd apps/server test src/persistence/Layers/PiSubagentExecutionRepository.test.ts src/provider/piSubagentAdmissionCoordinator.test.ts src/provider/piSubagentBridge.test.ts src/provider/piSubagentRealExtension.test.ts src/provider/piSubagentSession.test.ts`
- Exit Code: 0
- Test Suites: 5 passed (5)
- Tests: 51 passed (51)
- Disk Reopen: Tested on physical SQLite file at temporary path; reopened with fresh layer, validated identical aggregate and journal ordering.

### Migration compatibility evidence

- Applied migration lineage up through migration 98 (`98_PiSubagentExecutions.ts`) and 99 (`99_PiSubagentLeasesAndProgress.ts`).
- Schema verified for `pi_subagent_executions` and `pi_subagent_lifecycle_journal` with compound unique index `(execution_id, attempt_id, generation, sequence)` and `(command_id)`.

### Real-Pi evidence

- Verified with actual `@alfie/pi-subagents` extension (provenance validated via SHA-256 and Git commit):
  - Agent tool intercepted via `wrapAgentTool` in managed session.
  - Server admission executed before child start.
  - Server-minted `executionId`, `attemptId`, `generation` passed to child.
  - Denied spawn returned terminal error and prevented child start.

### Deviations and remaining risks

- None. All 8 acceptance criteria implemented and verified against unit, integration, and real extension tests.

### Reviewer handoff

Run the full Pi subagent suite to verify all acceptance criteria:
```bash
export PATH="$HOME/.bun/bin:$PATH"; bun run --cwd apps/server test src/persistence/Layers/PiSubagentExecutionRepository.test.ts src/provider/piSubagentAdmissionCoordinator.test.ts src/provider/piSubagentBridge.test.ts src/provider/piSubagentRealExtension.test.ts src/provider/piSubagentSession.test.ts
```
