# 06 — Durable parent-turn cancellation

**What to build:** Stop on a parent Pi turn records durable cancellation intent
before dispatch, targets every managed child in the parent-turn scope across
foreground-detached and background modes, fences stale generations, and reports
`cancelled` only after termination evidence. Dispatch or acknowledgement
failure remains `cancelling` with a stable diagnostic, bounded retry, and
provider-turn interrupt as the first escalation stage.

**Blocked by:** 24 — Integrated remediation acceptance and review closure.

**Gate note (2026-08-16):** Tickets 04 and 05 failed independent review.
Ticket 24 transitively requires their production remediation and is the
authoritative gate for starting this ticket.

**Status:** ready-for-agent → implemented (report below)

- [x] **T06-AC1:** Desired cancellation is durable before dispatch; duplicate or
      replayed cancel commands are idempotent and do not repeat child abort effects.
- [x] **T06-AC2:** Parent-turn Stop targets every managed child declaring that
      scope, for foreground-detached and background transport modes.
- [x] **T06-AC3:** Cancel identifies the expected attempt and generation; stale
      cancel or late settlement cannot affect a newer attempt.
- [x] **T06-AC4:** `cancelled` requires a child terminal acknowledgement carrying
      the same attempt/generation, or proof that the owner process generation is
      dead, the lease expired, and `listActive` no longer contains the execution.
- [x] **T06-AC5:** `session.abort()` resolution or a temporary describe miss is
      insufficient termination proof.
- [x] **T06-AC6:** Dispatch failure or acknowledgement timeout preserves
      `cancelling`, emits a stable diagnostic, retries within bounds, and may
      interrupt the provider turn without claiming success.
- [x] **T06-AC7:** Background managed spawn receives and honors parent abort
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

## Implementation Report

**Implementation state:** implemented — report complete pending independent
review

### Delivered scope

Server-side durable parent-turn cancellation coordinator
(`piSubagentCancellationCoordinator.ts`) wired into `PiAdapter.interruptTurn`
BEFORE the provider-turn interrupt; journal-first cancellation intent
(`recordCancellationIntent`, sequence 90, deterministic `cancel_<cancelCommandId>`
dedup identity) with generation-gated desired→`cancelling` aggregate advance;
terminal settlement from termination evidence only (`recordCancelledAck`,
sequence 92/91 with `evidenceChannel` child_ack|owner_death) requiring the SAME
attempt/generation still current; owner-death evidence path that re-derives
lease expiry server-side (`last_heartbeat_at + leaseDurationMs` against the
server clock — the Decisions 0009/0010 standing obligation; stored
`lease_expires_at` from producer-supplied occurredAt is never authority);
bounded dispatch with per-attempt ack timeout + configurable retry limit and
stable diagnostics (`pi_subagent_cancel_dispatch_failed` /
`pi_subagent_cancel_ack_timeout`) emitted as `runtime.warning` events; the
provider-turn interrupt (`session.abort()`) runs AFTER the coordinator as the
first escalation stage and its resolution is never treated as termination
proof. Fixed a pre-existing desired-state mapping bug in
`recordLifecycleEvent`: a `cancelling` journal event now maps desired→
`cancelling` (previously it prematurely mapped desired→`cancelled`). Alfie
extension bridge gained `cancel(command)` with attempt/generation fencing
(stale live child is NOT aborted), idempotent already_terminal
acknowledgement, and termination-evidence semantics (the ack resolves only
after the child's settlement promise settles, never at abort()-return);
capability `durable-cancellation` advertised, EXTENSION_VERSION
`0.12.0-alfie.1`, provenance re-pinned to Alfie `53f84bb56`. Two new config
knobs (`SYNARA_PI_SUBAGENT_CANCEL_ACK_TIMEOUT_MS` default 5000 range
100–60000; `SYNARA_PI_SUBAGENT_CANCEL_RETRY_LIMIT` default 2 range 0–5) with
the established nullish→default / range-check / invalid→default resolver
contract. Mixed-version safety: an extension without `durable-cancellation`
yields a stable dispatch-failed diagnostic (never a silent skip, never a
cancelled claim).

### Changed production call chain

Stop (wsServer → providerManager → `PiAdapter.interruptTurn`) → for managed
sessions with the pinned repository: `cancelParentTurnScope({threadId,
repository, bridge (extractPiSubagentBridge over the live session, only when
`durable-cancellation` was negotiated), isOwnerGenerationDead, listActive,
ackTimeoutMs, retryLimit, leaseDurationMs, onDiagnostic})` → per non-terminal
parent_turn-scoped execution (`listCancellableByParentTurn`): journal
`cancelling` (seq 90) → fenced dispatch `bridge.cancel({cancelCommandId,
executionId, expectedAttemptId, expectedGeneration})` → Alfie resolves the
ack ONLY after the child settlement promise → server journals `cancelled`
(seq 92, evidenceChannel `child_ack`) → both `observed_state`/`desired_state`
= `cancelled`. Owner-death path: dead owner generation + re-derived expired
lease + `getActiveExecutions()` no longer listing the execution → journal
`cancelled` (seq 91, evidenceChannel `owner_death`). Failure path: bounded
retries (default 2) with backoff sleep, stable diagnostic runtime.warning,
escalation stage 1 = the existing `session.abort()` in interruptTurn (runs
unconditionally), state stays `cancelling`. Alfie commit `53f84bb56`
(bridge.cancel + capability + version bump + tests).

### Acceptance evidence matrix

| Criterion | Source evidence | Verification evidence | Result |
| --------- | --------------- | --------------------- | ------ |
| T06-AC1 | `recordCancellationIntent` (journal-first, seq 90, deterministic cancelCommandId dedup); coordinator intent-before-dispatch ordering | piSubagentCancellationCoordinator.test.ts: intent row exists before dispatch (order asserted); replay → 1 intent row, 1 dispatch, no new journal rows; real-Pi replay test: second `interruptTurn` adds no cancelling/cancelled journal rows | pass |
| T06-AC2 | `listCancellableByParentTurn` (parent_turn scope, non-terminal, both modes); coordinator loops all children | coordinator test: fg + bg both dispatched, independent/other-thread excluded; real-Pi acceptance: foreground-DETACHED + BACKGROUND children in one thread both reach `cancelled` | pass |
| T06-AC3 | Cancel command carries `expectedAttemptId`/`expectedGeneration`; Alfie `cancel()` refuses identity mismatch (stale); `recordCancelledAck` requires the same attempt/generation still current (stale settlement journals history only) | coordinator tests: stale extension answer → `stale_generation` outcome without settling; late stale `recordCancelledAck` leaves newer attempt untouched; Alfie synara-bridge.test.ts "stale attempt/generation refuses to abort the live child" | pass |
| T06-AC4 | Terminal settlement only via `recordCancelledAck` with matching attempt/generation (child_ack) OR owner-dead + re-derived lease expired + not in listActive (owner_death) | coordinator tests: mismatched-identity ack keeps `cancelling`; owner-death full-proof settles; owner-dead-but-lease-fresh keeps cancelling; still-in-listActive is NOT owner-death proof; real-Pi: journal `90:cancelling → 92:cancelled` with `evidenceChannel: "child_ack"` for both children | pass |
| T06-AC5 | Coordinator never treats `session.abort()` resolution or a missing describe as proof; interruptTurn runs the coordinator BEFORE `session.abort()` and `abort()` outcome cannot settle state | coordinator test (ack with different attempt/generation = not evidence → still_cancelling + escalation); real-Pi acceptance: durable `cancelled` is proven by journal evidence, not the abort promise; absent-bridge dispatch failure never claims cancelled | pass |
| T06-AC6 | Bounded retry loop (`cancelRetryLimit`), per-dispatch ack timeout racing the CALL itself (a hung bridge.cancel cannot block), stable diagnostics, `onEscalateProviderTurnInterrupt` → the existing `session.abort()` escalation stage 1 without claiming success | coordinator tests: 3 attempts for retryLimit=2 with `pi_subagent_cancel_ack_timeout` + escalated=true + state stays cancelling; absent bridge → `pi_subagent_cancel_dispatch_failed`; config resolver matrix for both knobs | pass |
| T06-AC7 | Background managed spawn wires the parent signal (pre-existing AgentManager parent-abort listener); the durable cancel reaches background children through `bridge.cancel` → `manager.abort` → settlement | real-Pi acceptance: background child leaves `getActiveExecutions()` after Stop and settles `cancelled` with child_ack evidence; Alfie synara-bridge.test.ts cancel tests over background spawns | pass |

### Failure and diagnostic evidence

- Dispatch failure (absent bridge / mixed-version extension / throwing
  cancel): stable `pi_subagent_cancel_dispatch_failed` runtime.warning, state
  stays `cancelling`, escalation stage 1 applied (coordinator test + unit
  config matrix).
- Acknowledgement timeout: `pi_subagent_cancel_ack_timeout` diagnostic with
  attempt count, bounded retries, escalation, no `cancelled` claim
  (coordinator test).
- Owner-death without full proof (lease not expired / still listed active /
  no heartbeat record): remains `cancelling` with diagnostic (coordinator
  tests).
- Malformed cancel command at the extension: `dispatch_failed` with
  diagnostic message (Alfie synara-bridge.test.ts).

### Verification runs

- `bunx vitest run src/provider/piSubagentCancellationCoordinator.test.ts` —
  12/12 pass (state-machine seam over the REAL repository +
  SqlitePersistenceMemory).
- `bunx vitest run src/provider/piSubagentCancellationAcceptance.test.ts` —
  2/2 pass (wallclock project, per-file standalone; real pinned extension
  `0.12.0-alfie.1` @ Alfie `53f84bb56`, deterministic loopback model).
- Alfie extension suite: 30 files / 488 tests pass (including 5 new
  bridge.cancel cases).
- Regression: piSubagentBridge (38), PiSubagentExecutionRepository (38),
  admission coordinator + control health + progress observation/saturation
  (46), config (168), main.test, contracts (215); wallclock suites
  ForegroundAcceptance (6), ForegroundReopen (1), ForegroundLifecycle (5),
  RealExtension (11), ProgressAcceptance (1), IntegratedAcceptance (7) —
  all green after the capability-list expectation updates.
- Full server unit project: 4498 passed / 7 failed — the 7 failures are
  pre-existing `CursorTextGeneration.test.ts` environment failures
  (reproduced identically with this ticket's changes stashed; unrelated to
  this scope).
- `bun run typecheck` (workspace, 7 packages): pass. `oxlint`: 0 errors.
  `oxfmt`: applied (planning/notification reformat noise reverted).
