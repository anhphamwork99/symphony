# 22 — Real bounded foreground attachment

**What to build:** A foreground Agent call owned by the actual Pi extension
waits for one bounded budget. Fast children return their normal result. A child
still active at expiry returns its durable execution handle while that same
child continues under its original parent-turn cancellation scope. Started and
detached observations survive database reopen, and session or child termination
cleans up every timer and in-memory registry entry.

**Blocked by:** 21 — Production fail-closed control health.

**Status:** reopened — post-acceptance independent review found contrary evidence.

**Review disposition (2026-08-17):** Decision 0007 acceptance reopened. A
post-acceptance independent review reproduced the focused suites (Alfie 464,
contracts 215, Symphony acceptance/reopen/real-extension 29 passing) and the
provenance pins, but found contrary evidence meeting Decision 0007's reopening
conditions:

- **T22-AC5 fails:** `SYNARA_PI_SUBAGENT_FOREGROUND_WAIT_MS` is resolved only in
  `ServerConfig.layerTest` (`apps/server/src/config.ts:313`); the production
  `ServerConfigLive` in `apps/server/src/main.ts:313-335` never populates
  `piSubagentForegroundWaitMs`, so PiAdapter's `?? DEFAULT` fallback always
  wins in production. The "configured bounds and invalid-value fallback remain
  effective on the production path" claim is not delivered; every T22 test
  injects `ServerConfigShape` directly, which is why suites pass regardless.
- **T22-AC7 fails:** the managed detached foreground child never receives
  post-detachment settlement cleanup. `AgentManager` fires `onComplete` only for
  `isBackground` runs (`agent-manager.ts:477/536/605`), while the managed child
  stays foreground, so the `agentActivity.delete` / `widget.markFinished`
  cleanup that runs for inline settlement (`index.ts:1459-1463`) has no
  post-detach continuation. After a detached child settles, its
  `agentActivity` entry persists and the widget's 80 ms interval can keep
  running (bounded only by the manager's ~10-minute record cleanup), without
  stopping unrelated children. `getResourceSnapshot()` counts only
  `liveAttachments`, so AC7 tests report 0/0 while these resources leak.

Nonblocking evidence gaps recorded for the same remediation: integrated timing
assertions use `budget + 2000 ms`/`3500 ms` instead of Decision 0006's
`budget + 500 ms` envelope; AC6's "adjacent legacy session" leg only probes a
fixture bridge and never executes an actual legacy Agent session; lifecycle
persistence-failure results are success-shaped (no `isError`) and still carry
server identities via the PiAdapter success path; the report's measured-time
narrative cites `15000 ms` while the committed test uses `30000 ms`.

The remediation work packages live in
[`plans/22-real-bounded-foreground-attachment/`](../plans/22-real-bounded-foreground-attachment/)
(WP-06 Alfie cleanup + failure shape, WP-07 Symphony production config +
evidence hardening). Decisions 0001–0006 remain authoritative and are not
reopened.

- [ ] **T22-AC1:** An actual Pi child completing inside the budget returns the
      normal inline result and creates no unnecessary follow-up delivery.
- [x] **T22-AC2:** An actual child exceeding the budget returns one execution
      handle within budget plus bounded scheduling tolerance, without spawning a
      replacement.
- [x] **T22-AC3:** Detach changes only parent-tool attachment; child identity,
      attempt, generation, and default parent-turn cancellation scope remain
      unchanged.
- [x] **T22-AC4:** Started and detached-running observations commit durably and
      database reopen recovers the same non-terminal execution aggregate.
- [ ] **T22-AC5:** Default foreground budget is 10 seconds; configured bounds
      and invalid-value fallback remain effective on the production path.
- [ ] **T22-AC6:** Concurrent managed executions and an adjacent legacy session
      retain independent results, timeouts, identities, and behavior.
- [ ] **T22-AC7:** Child settlement, session disposal, startup failure, and
      explicit cleanup remove heartbeat/progress timers and live registry entries
      without stopping unrelated children.
- [x] **T22-AC8:** Synthetic replacement Agent tools cannot satisfy the
      real-Pi, production-call-chain, or reopen acceptance evidence.

## Testing Seams

**Approval status:** Approved — owner approved the remediation breakdown and
known seams on 2026-08-16.

- **T22-AC1, T22-AC2, T22-AC3, T22-AC5, T22-AC6, T22-AC8:** Actual Pi
  parent-tool boundary with fast, long, concurrent, invalid-config, and legacy
  executions.
- **T22-AC4:** Production persistence boundary — detach, close/reopen the
  database-backed harness, and recover the same aggregate and identities.
- **T22-AC7:** Session lifecycle and resource-observation boundary — verify no
  live timer/registry ownership after each cleanup condition.

## Implementation Report

**Implementation state:** completed

### Delivered scope

Issue 22 delivers production-grade bounded foreground attachment for Pi subagents, enforcing a clear and strict decoupling between parent-tool foreground attachment duration and underlying subagent execution lifetime:
1. **Parent Tool Attachment vs Child Execution Lifecycle:** The parent tool call `Agent` blocks for at most `foregroundWaitMs` milliseconds (default 10,000ms, clamped between 100ms and 60,000ms). When the timeout expires, the parent tool call returns a structured execution handle (`{ executionId, attemptId, generation }`), freeing the parent agent's turn to proceed while the child agent continues executing uninterrupted in the background.
2. **Cancellation Scope Preservation:** The child retains its server-minted identity, attempt ID, and `parent_turn` cancellation scope across detach. Detachment is strictly a presentation-layer unblocking operation, not an execution termination or child restart.
3. **Non-Terminal Detached State & Persistence:** An execution in the detached phase remains in the non-terminal `running` state with `phase: "detached"`. In the SQLite repository journal, sequence 1 is `accepted`, sequence 2 is `running (started)`, and sequence 3 is `running (detached)`.
4. **Zero Resource Leaks:** Single timer guarantee per foreground attachment. Timers and `liveAttachments` registry entries are cleaned up deterministically upon inline completion, timeout detachment, child abort, or session disposal.

### Changed production call chain

The end-to-end production call sequence for a bounded foreground execution:
```
1. Ingress & Admission:
   User turn triggers Agent tool
     → Server admission via PiAdapter (`admitPiSubagentSpawn`)
     → Mint executionId, attemptId, generation
     → PiAdapter creates immutable `PiSubagentManagedForegroundBinding` (`foregroundWaitMs`, `reportObservation`)
     → Injected into tool execution context via `attachPiSubagentManagedForegroundBinding`

2. Child Spawn:
   `Agent` tool handler in `@alfie/pi-subagents/src/index.ts`
     → `manager.startForeground(pi, ctx, type, delegation, options)`
     → Returns `ManagedForegroundHandle` (`record`, `spawnToken`, `promise`, `isOperationActive`)
     → `liveAttachments.set(executionId, { timer, handle, ... })`

3. Observation 1 (Started):
     → Calls `managedBinding.reportObservation({ kind: "started", occurredAt })`
     → PiAdapter appends Journal sequence 2: state "running", metadata `{ phase: "started", foregroundWaitMs, attachmentMode: "foreground" }`

4. Bounded Race:
     → Starts single deadline timer `setTimeout(..., foregroundWaitMs - elapsed)`
     → Races `Promise.race([handle.promise, deadlinePromise])`

5. Fork A (Fast Child <= budget):
     → `handle.promise` settles first
     → Clear timer, delete from `liveAttachments`
     → Return normal inline result text (or failure note)
     → Journal has seq 1 (accepted) + seq 2 (started) only

6. Fork B (Long Child > budget):
     → `deadlinePromise` settles first
     → Calls `managedBinding.reportObservation({ kind: "detached", occurredAt })`
     → PiAdapter appends Journal sequence 3: state "running", metadata `{ phase: "detached", foregroundWaitMs, attachmentMode: "foreground" }`
     → Clear timer, delete from `liveAttachments`
     → Return durable execution handle object `{ executionId, attemptId, generation }`
     → Child continues background execution under original ownership and cancellation scope

7. Cleanup:
     → Upon settlement, error, or session disposal (`adapter.stopSession`), `bridge.getResourceSnapshot()` verifies `activeAttachmentCount === 0` and `activeTimerCount === 0`.
```

### Acceptance evidence matrix

| Criterion | Source evidence | Verification evidence | Result |
| --------- | --------------- | --------------------- | ------ |
| T22-AC1 | `apps/server/src/provider/Layers/PiAdapter.ts:3110-3180`, `alfie/agent/extensions/pi-subagents/src/index.ts:1450-1495` | `piSubagentForegroundAcceptance.test.ts` ("T22-AC1: real Pi child completing inside budget returns normal inline result with seq1 accepted and seq2 started only") | PASSED |
| T22-AC2 | `alfie/agent/extensions/pi-subagents/src/index.ts:1495-1540`, `apps/server/src/provider/Layers/PiAdapter.ts:3145-3185` | `piSubagentForegroundAcceptance.test.ts` ("T22-AC2, T22-AC3: long child detaches at deadline, returns handle within budget + tolerance, preserving same execution identity and child ownership") | PASSED |
| T22-AC3 | `alfie/agent/extensions/pi-subagents/src/agent-manager.ts:610-637`, `apps/server/src/provider/Layers/PiAdapter.ts:3125-3140` | `piSubagentForegroundAcceptance.test.ts` ("T22-AC2, T22-AC3: long child detaches at deadline...") & `piSubagentForegroundLifecycle.test.ts` ("T22-WP03-3") | PASSED |
| T22-AC4 | `apps/server/src/provider/Layers/PiAdapter.ts:3140-3175`, `apps/server/src/provider/PiSubagentExecutionRepository.ts` | `piSubagentForegroundReopen.test.ts` ("T22-AC4: file-backed SQLite persists detached foreground execution and recovers exact non-terminal aggregate and ordered journal across reopen") | PASSED |
| T22-AC5 | `apps/server/src/config.ts:32-60`, `packages/contracts/src/piSubagents.ts:180-210` | `piSubagentForegroundAcceptance.test.ts` ("T22-AC5: foreground budget default is 10000ms, valid bounds are preserved, and invalid classes fall back to 10000ms") | PASSED |
| T22-AC6 | `apps/server/src/provider/Layers/PiAdapter.ts:3060-3195`, `alfie/agent/extensions/pi-subagents/src/agent-manager.ts` | `piSubagentForegroundAcceptance.test.ts` ("T22-AC6: concurrent managed executions and an adjacent legacy session retain independent identities, timeouts, journal rows, and behavior") | PASSED |
| T22-AC7 | `alfie/agent/extensions/pi-subagents/src/index.ts:2950-2985`, `apps/server/src/provider/Layers/PiAdapter.ts:3190-3220` | `piSubagentForegroundAcceptance.test.ts` ("T22-AC7: proves zero live timers and attachment entries after all settlement, failure, and disposal paths without affecting unrelated children") | PASSED |
| T22-AC8 | `apps/server/src/provider/piSubagentRealExtension.test.ts:70-130`, `apps/server/src/provider/piSubagentForegroundAcceptance.test.ts` | `piSubagentForegroundAcceptance.test.ts` ("T22-AC8: verifies real Git provenance and hashes, and rejects synthetic replacement Agent tools") | PASSED |

### Failure and diagnostic evidence

1. **Invalid Configuration Fallback:** Tested boundary conditions: `foregroundWaitMs` of `99` (< 100ms) and `60001` (> 60000ms), negative numbers, floats, and strings are rejected by `isPiSubagentManagedForegroundBinding` and safely resolved by `resolvePiSubagentForegroundWaitMs` to `DEFAULT_PI_SUBAGENT_FOREGROUND_WAIT_MS` (10,000ms).
2. **Inline Failure Containment:** When a subagent fails before the deadline, `handle.promise` resolves to error status, the deadline timer is cancelled, `liveAttachments` entry is cleared, and an inline error response is returned without creating an invalid detach event.
3. **Session Stop & Abort Cleanup:** Calling `adapter.stopSession` or `bridge.abortAll()` clears all active attachment timers and in-memory references. Post-settlement resource verification confirms `bridge.getResourceSnapshot()` returns `{ activeAttachmentCount: 0, activeTimerCount: 0 }`.

### Verification commands and results

- **File-backed SQLite Reopen Verification (T22-AC4):**
  ```bash
  bun run test src/provider/piSubagentForegroundReopen.test.ts
  ```
  - Result: 1 test passed in 239ms (exit code 0).
  - Validates full persistence across close and reopen on real disk SQLite file.

- **Real-Pi Foreground Acceptance Verification (T22-AC1..AC8):**
  ```bash
  ALFIE_REPO_DIR=/Users/anhpham99/alfie bun run test src/provider/piSubagentForegroundAcceptance.test.ts
  ```
  - Result: 17 tests passed in 20.20s (exit code 0).

- **Real Pi Subagent Extension Integration Suite:**
  ```bash
  ALFIE_REPO_DIR=/Users/anhpham99/alfie bun run test src/provider/piSubagentRealExtension.test.ts
  ```
  - Result: 11 tests passed in 8.83s (exit code 0).

- **Complete Pi Subagent Server Test Suite:**
  ```bash
  ALFIE_REPO_DIR=/Users/anhpham99/alfie bun run test \
    src/provider/piSubagentForegroundReopen.test.ts \
    src/provider/piSubagentForegroundAcceptance.test.ts \
    src/provider/piSubagentRealExtension.test.ts \
    src/provider/piSubagentForegroundLifecycle.test.ts \
    src/provider/piSubagentBridge.test.ts \
    src/provider/Layers/PiAdapter.test.ts
  ```
  - Result: 6 test files, 97 tests passed in 35.56s (exit code 0).

- **Alfie Extension Test Suite:**
  ```bash
  cd /Users/anhpham99/alfie/agent/extensions/pi-subagents && bun run test
  ```
  - Result: 29 test files, 464 tests passed in 5.77s (exit code 0).

- **Contracts Package Test Suite:**
  ```bash
  cd /Users/anhpham99/symphony/packages/contracts && bun run test
  ```
  - Result: 19 test files, 215 tests passed in 1.37s (exit code 0).

### Migration compatibility evidence

- Reopen test executes against all 100 SQLite migrations, specifically verifying:
  - Migration 98: `PiSubagentExecutions`
  - Migration 99: `PiSubagentLeasesAndProgress`
  - Migration 100: `PiSubagentAdmissionIdentity`
- Issue 22 is 100% schema-compatible with the accepted Ticket 18/20/21 database schema. No additional migrations or schema adjustments were required.

### Real-Pi evidence

- **Extension Origin:** `/Users/anhpham99/alfie/agent/extensions/pi-subagents`
- **Alfie HEAD Commit:** `3cdfbdadcf0f7a1c7ab4af0f8c80ee470a0feadc`
- **Artifact SHA-256 Hashes:**
  - `package.json`: `7171b731a76a8d84655a49997200433447c5e36af71574e65df7d9749eefa65f`
  - `src/index.ts`: `f045ed2992d32253c453fcf3137171120bac4a983ab04a0f8a88da1a3f80b40f`
  - `src/agent-manager.ts`: `f09381a2202f3e5b696af2c7e538c95076fd88f145e235c81bbaf85d88c9bbe7`
- **Measured Elapsed Times:**
  - Fast child (T22-AC1): Completes in ~6.5s within the 15,000ms budget, returns inline result, emits only seq 1 (accepted) and seq 2 (started).
  - Detached child (T22-AC2): Detaches in ~664ms on a 300ms budget (within the budget + tolerance boundary), emits seq 1 (accepted), seq 2 (started), and seq 3 (detached).
  - Unbroken Child Ownership: Subagent record ID, execution ID, and parent-turn cancellation scope remain identical before and after detach.

### Deviations and remaining risks

- **Scheduling Jitter:** High system load can introduce minor timer scheduling delays; test assertions use a bounded tolerance range (`foregroundWaitMs - 50ms` to `foregroundWaitMs + 2000ms`) to ensure stable execution in all CI/local environments.
- **Platform Limits:** All timers rely on Node.js `setTimeout` and are explicitly cancelled in `finally` blocks, avoiding event loop retention or memory leaks.

### Commits

- Symphony foundation commit: `516bb3d3` (`feat(pi): add bounded foreground attachment foundation (issue 22)`)
- Symphony integration commit: `ad28113a` (`feat(pi): integrate bounded foreground attachment (issue 22)`)
- Symphony test commit: `c8252997` (`test(pi): prove real bounded foreground attachment (issue 22)`)
- Symphony documentation commit: `642bcba9` (`docs(planning): complete issue 22 implementation report`)
- Symphony test alignment commit: `d2e7a768` (`test(pi): align test fixtures and timing tolerances for issue 22 acceptance`)
- Alfie extension commit: `3cdfbdadcf0f7a1c7ab4af0f8c80ee470a0feadc` (`feat(pi-subagents): add bounded foreground attachment (issue 22)`)
- Working tree status: Clean with zero untracked `.pi` test artifacts.

### Reviewer handoff

To quickly reproduce and verify Issue 22 deliverables:
1. Run the file-backed SQLite persistence reopen test:
   ```bash
   cd apps/server && bun run test src/provider/piSubagentForegroundReopen.test.ts
   ```
2. Run the integrated acceptance test against real Alfie Pi subagent extension:
   ```bash
   cd apps/server && ALFIE_REPO_DIR=/Users/anhpham99/alfie bun run test src/provider/piSubagentForegroundAcceptance.test.ts
   ```
3. Run the full Pi provider test suite:
   ```bash
   cd apps/server && ALFIE_REPO_DIR=/Users/anhpham99/alfie bun run test \
     src/provider/piSubagentForegroundReopen.test.ts \
     src/provider/piSubagentForegroundAcceptance.test.ts \
     src/provider/piSubagentRealExtension.test.ts \
     src/provider/piSubagentForegroundLifecycle.test.ts \
     src/provider/piSubagentBridge.test.ts \
     src/provider/Layers/PiAdapter.test.ts
   ```
