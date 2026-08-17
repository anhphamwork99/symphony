# SPEC — Antigravity terminal-answer recovery

Status: implementation-ready

Audience: Synara server/runtime coding agent and reviewer

Repository: `/Users/anhpham99/symphony`

Grounded revision: `main@3f10133b` on 2026-08-17

## 1. Reader outcome

After reading this document, a fresh coding agent must be able to implement,
test, diagnose, and report the Antigravity missing-terminal recovery without
access to the originating conversation.

This specification is normative for behavior and acceptance. The neighboring
`HANDOFF.md` is the concise entry point. If they conflict, this specification
wins unless current source evidence makes a requirement impossible; in that
case the agent must stop and challenge the contract with exact evidence.

Normative words `MUST`, `MUST NOT`, `SHOULD`, and `MAY` carry their usual RFC
meaning.

## 2. Problem statement

Synara invokes Antigravity through `agy -p`. Normally, Antigravity writes
transcript and hook records, emits a Stop hook or exits, and Synara settles the
turn. Intermittently, `agy 1.1.13` writes a complete final
`PLANNER_RESPONSE` but emits neither Stop nor child-process `close`. The answer
is visible, yet the session remains `running`, so the UI displays `working...`
indefinitely from the user's perspective.

This is a runtime lifecycle defect, not a rendering defect.

### 2.1 Confirmed local evidence

- Turn `f5f3055d-5947-4c9a-89e1-125b8c2dd007` started at `07:07:57Z`.
- All observed tool calls completed and the final `PLANNER_RESPONSE` was
  persisted at `07:10:35Z`.
- No provider terminal event followed; the last provider event was the final
  assistant `item.completed`.
- The projected turn remained running until reconciliation/interruption at
  `07:14:00Z`, approximately 363 seconds after start.
- Two other same-day turns had the same signature and remained running for
  approximately 117 and 217 seconds.
- Neighboring healthy turns emitted `turn.completed` about 0.2–0.4 seconds
  after final output, proving that the issue is intermittent.
- A later old-generation terminal was ignored after lifecycle replacement.
  This is a secondary race; it did not initiate the wedge.

No diagnostic added by this work may include prompts, response text,
credentials, tokens, account identifiers, hook payload contents, or transcript
contents.

## 3. Existing architecture and exact gap

The primary implementation surface is
`apps/server/src/provider/Layers/AntigravityAdapter.ts`.

### 3.1 Current lifecycle

1. `sendTurn` initializes active-turn state, creates a run directory, starts
   `agy`, captures stdout/stderr, and polls the hook file every 75ms.
2. `pollHookFile` reads complete hook records and then calls `readTranscript`.
3. `readTranscript` parses only complete newline-delimited records and passes
   unseen steps to `processTranscriptStep`.
4. `processTranscriptStep` maps a tool-free `PLANNER_RESPONSE` to a completed
   assistant item. A tool-bearing response is emitted as reasoning.
5. A Stop hook asks `teardownChildProcessTree` to stop the child.
6. The child `close` handler final-drains hook/transcript/stdout and invokes
   `settleActiveTurn`.
7. `settleActiveTurn` uses `turnTerminalEmitted` to emit one terminal event,
   clear the active turn/process, and transition the adapter session.

### 3.2 Missing behavior

- A final `PLANNER_RESPONSE` is not treated as candidate terminal evidence.
- If Stop and `close` never arrive, no adapter-owned watchdog settles the turn.
- `--print-timeout 30m` belongs to `agy`; Synara cannot rely on it.
- Generic runtime reconciliation intentionally trusts a matching live
  `running` turn and only uses the 45-minute abandonment escape hatch.
- The child `error` handler emits `runtime.error` but does not guarantee turn
  settlement when `close` never follows.

The fix MUST live primarily in AntigravityAdapter. It MUST NOT weaken generic
reconciliation or alter other providers.

## 4. Goals and non-goals

### 4.1 Goals

- Clear a qualifying wedged turn within a bounded time after final answer.
- Never infer success from silence alone.
- Preserve legitimate long-running reasoning and tool execution.
- Emit assistant output and terminal state exactly once.
- Bound process-tree teardown and retain honest cleanup state.
- Fence unconfirmed processes so they cannot overlap a newer turn.
- Make every async action safe across turn/session/generation replacement.
- Repair `error` without `close` as part of the same implementation.
- Provide content-free diagnostics and deterministic verification.

### 4.2 Non-goals

- Changing `agy`, its hook protocol, or `--print-timeout 30m`.
- Lowering the global 15-second stale or 45-minute abandonment thresholds.
- Adding a generic inactivity watchdog to other providers.
- Adding a public `quarantined` provider-session status.
- Changing DB schema, provider contracts, UI protocol, or projections.
- Treating arbitrary stdout, partial lines, reasoning, or tool-bearing output as
  final-answer evidence.
- Replaying or modifying assistant text.
- Persisting quarantine across a full server-process restart. Restart recovery
  remains governed by existing reconciliation; this change must still perform
  best-effort final teardown during adapter disposal.

## 5. Product behavior

### 5.1 Healthy turn

Nothing visible changes. Stop or `close` arrives during the grace period, the
normal path wins, no recovery warning appears, and the watchdog is cancelled.

### 5.2 Wedged turn after final answer

1. Synara displays the complete answer.
2. Synara waits 15 seconds for normal provider finalization.
3. If no relevant activity appears, Synara final-drains provider files.
4. Synara tears down the exact owned process tree using the supervised helper.
5. Synara emits one `completed/model_stop` terminal event and one non-fatal
   recovery warning.
6. `working...` clears no later than approximately 25 seconds after the last
   qualifying activity. Existing teardown defaults may clear it sooner.

### 5.3 Active reasoning or tool execution

No recovery occurs. Tool-bearing responses, pending tools, and new activity
cancel or reset eligibility. A later qualifying final response may create a new
candidate.

### 5.4 Process death cannot be proven

The answer remains completed and `working...` clears, but the session becomes
publicly `error` and internally quarantined. Synara blocks another Antigravity
child for that session until cleanup proves the old child is gone. The user sees
an actionable provider-recovery warning rather than a silent hang.

## 6. State model

Each active Antigravity turn has one recovery state:

```text
INELIGIBLE
    │ qualifying final PLANNER_RESPONSE
    ▼
GRACE ── relevant activity ───────────► GRACE(reset) or INELIGIBLE
    │ 15s quiet
    ▼
FINAL_DRAIN ── new/disqualifying data ► GRACE or INELIGIBLE
    │ still qualified
    ▼
TEARDOWN ── confirmed death ──────────► SETTLED(completed)
    │ unconfirmed death
    ▼
QUARANTINED ── later death proof ─────► IDLE/READY
```

Any normal Stop/close/error, user interrupt, session stop, ownership loss, or
prior settlement cancels watchdog work. Session stop owns lifecycle shutdown;
the watchdog MUST NOT emit recovered completion after Stop has claimed control.
Existing stop-session projection/reconciliation semantics need not be
redesigned by this issue.

## 7. Candidate and activity contract

### 7.1 Candidate predicate

A candidate exists only when all are true:

1. `readCompleteAntigravityLines` produced a complete transcript line.
2. JSON parsing succeeded.
3. The latest relevant step is `PLANNER_RESPONSE`.
4. `trim(step.content)` is non-empty.
5. `step.tool_calls` is null/absent/empty.
6. `context.pendingTools.length === 0`.
7. The step belongs to the active turn after its latest `USER_INPUT` boundary.
8. The owning session context, lifecycle generation, turn ID, and child are
   unchanged.

An incomplete line, malformed JSON, empty response, reasoning response, generic
stdout, elapsed time, or absence of events MUST NOT create a candidate.

### 7.2 Per-turn recovery fields

Use private adapter fields or equivalent typed structures. Required logical
data:

- `activityRevision`: monotonically increases on relevant activity.
- `lastActivityAtMs`: monotonic timestamp used for grace calculation.
- `completionCandidate`: qualifying planner step index and activity revision.
- `recoveryIntent`: latched ownership tuple once recovery claims settlement.
- `recoveryInFlight`: prevents overlapping final-drain/teardown executions.
- `quarantineRecord`: child, turn/generation identity, run directory, gateway
  lease, retry state, and whether session Stop was requested.

Avoid several independent booleans that can represent impossible combinations.
Prefer discriminated unions for candidate/recovery/quarantine state.

### 7.3 Relevant activity

Increment `activityRevision` and update `lastActivityAtMs` for:

- Any newly consumed complete transcript record for the active turn.
- Any newly consumed hook record.
- stdout or stderr data.
- Assistant or reasoning item emission.
- pre-tool or post-tool transition.
- Any change to pending-tool membership.

Tool start, a later tool-bearing planner response, interrupt, Stop, close/error,
session replacement, or ownership loss invalidates the candidate. Activity that
does not invalidate it restarts the full 15-second grace period.

The qualifying response itself is activity and establishes the first grace
deadline.

### 7.4 Scheduling

The implementation MAY reuse the existing 75ms poll loop or use a dedicated
timer, provided that:

- Poll/recovery executions cannot overlap.
- The grace deadline is based on monotonic time, not poll-count assumptions.
- All timers/intervals are tracked and cancelled on every terminal/disposal
  path.
- Tests can inject/advance time deterministically; no test sleeps for 15s.

Recommended dependency seams are an injected clock and grace duration, or
Vitest fake timers with an explicit single-flight poll guard. Do not add a new
runtime dependency solely for scheduling.

## 8. Recovery algorithm

At grace expiry:

1. Capture the ownership tuple:
   `threadId + turnId + lifecycleGeneration + child identity`.
2. Revalidate tuple, candidate, pending tools, interruption, terminal state,
   and inactivity duration.
3. Set `recoveryInFlight`; do not yet mark the turn terminal.
4. Capture `activityRevision`, final-drain hooks/transcript, then compare the
   revision and candidate again.
5. If activity appeared, clear `recoveryInFlight`; invalidate or re-arm based on
   the new state. Do not kill the process.
6. Latch `recoveryIntent = completed/model_stop` before sending any signal.
7. Invoke the existing supervised process-tree teardown. Its current confirmed
   exit behavior and shorter default phase durations satisfy the maximum 5s
   graceful + 5s forced budget. Widen the seam only if source/tests prove
   necessary; do not add ad-hoc PID killing.
8. After every `await`, revalidate ownership before touching current state.
9. If the child closes, let the close handler perform its final drain and
   settle through `settleActiveTurn`, but make it honor `recoveryIntent` so a
   watchdog-caused signal/non-zero code is classified as completed, not
   interrupted/failed.
10. If teardown confirms death but the close handler did not settle, settle
    directly through the same `settleActiveTurn` gate.
11. Emit one content-free `runtime.warning` identifying missing-terminal
    recovery. Ordering MAY be warning then terminal, but tests must lock the
    chosen order and ensure both appear once.

Recovery warning/terminal `raw` metadata MUST NOT reuse the existing close-path
shape containing full stdout/stderr. Include only the operational allowlist in
§13; AC-18 must inspect both canonical payload and compacted/raw metadata.

`processedSteps` and existing item IDs remain the output dedupe boundary. Final
drain MUST occur before terminal emission.

## 9. Settlement and race contract

`settleActiveTurn` remains the single terminal gate. Extend its input/state only
as necessary; do not add another function that independently emits
`turn.completed`.

### 9.1 First-writer rule

| First claimant | Result | Later signals |
|---|---|---|
| Normal Stop/close | Existing classification | Cleanup-only/no-op |
| User interrupt | `interrupted` | Watchdog cancels |
| Watchdog after final evidence | `completed/model_stop` | Stop/close/error cleanup-only |
| Process error without output | `failed/error` | Late close cleanup-only |
| Process error after existing `turnOutputProduced` evidence | `completed/model_stop` + warning | Late close cleanup-only |
| Session stop | Existing session-stop lifecycle | Watchdog cancels |

Signal type alone does not override the first valid claimant. In particular, a
SIGTERM/SIGKILL generated by watchdog teardown MUST NOT turn recovered output
into `interrupted`.

### 9.2 Ownership rule

Before each async drain, signal, settlement, cleanup, quarantine transition, or
new-turn admission, compare all four ownership dimensions. A stale callback is
a diagnosed no-op. Generation N MUST NOT inspect, signal, settle, clean, or
release authority belonging to N+1.

## 10. Error-without-close contract

The child `error` handler MUST no longer rely indefinitely on a later `close`.
It SHOULD allow one deferred microtask/tick for a racing `close`, then revalidate
ownership and classify:

- No usable output: emit existing `runtime.error`, settle `failed/error`, and
  perform the same lease/run-directory cleanup as terminal failure.
- Any existing `turnOutputProduced` evidence: mirror the current non-zero-exit
  policy, settle `completed/model_stop`, and emit a warning stating that the
  process errored after delivering usable output. This intentionally includes
  assistant output and tool activity, preserving the existing regression
  contract; it is broader than the watchdog candidate predicate.

A racing real `close` and the deferred error settlement MUST still produce one
terminal event.

## 11. Quarantine design and event ordering

Quarantine is adapter-internal cleanup state; `ProviderSessionStatus` has no
`quarantined` literal and contracts MUST NOT change.

### 11.1 Enter quarantine

When supervised teardown returns exit-unproven evidence:

1. Capture a quarantine record before clearing active-turn ownership.
2. Emit the recovered `turn.completed(completed/model_stop)` exactly once so
   ingestion clears `activeTurnId` and `working...`.
3. Emit `session.state.changed(state=error, reason=...)` after the terminal
   event. This ordering overrides ingestion's normal `ready` state for a
   completed turn while keeping the answer completed.
4. Keep the child fenced and block `sendTurn`/session replacement for the same
   session with an actionable `ProviderAdapterValidationError`.
5. Preserve the run directory and gateway lease until death is proven.

Do not use `session.exited` merely to represent quarantine: the adapter still
owns a cleanup record and may recover the session.

`startSession` replacement MUST treat a quarantine record as owned process
state even though `settleActiveTurn` cleared `activeProcess`. The default action
is to reject replacement. An explicit recovery/Stop path may replace only after
it proves child death and releases the quarantine resources; it must never drop
the record by replacing the session context.

### 11.2 Reap and release

Maintain a single bounded retry loop or registry per quarantined child. On
confirmed death:

- Release the retained gateway lease exactly once.
- Remove the retained run directory exactly once.
- Remove listeners/timers and clear the quarantine record.
- If session Stop was not requested, set adapter state ready and emit
  `session.state.changed(ready)` so new turns may be admitted.
- If Stop was requested, complete existing stop-session cleanup, emit the normal
  `session.exited`, and remove the session.
- Emit a content-free quarantine-reaped diagnostic.

If `stopSession` or adapter disposal occurs while quarantined, mark Stop intent,
cancel scheduled retries, make one final bounded teardown attempt, and preserve
honest diagnostics if exit remains unproven. Do not lose the process record
silently during the adapter lifetime.

## 12. Configuration and rollout modes

Extend the existing server configuration seam only if needed. Recommended
configuration:

- `SYNARA_ANTIGRAVITY_TERMINAL_RECOVERY_MODE=off|shadow|enforce`
- `SYNARA_ANTIGRAVITY_TERMINAL_RECOVERY_GRACE_MS`, default `15000`

Semantics:

- `off`: no candidate tracking or recovery; emergency rollback.
- `shadow`: detect candidates and log what would happen, but never signal or
  settle; normal behavior remains authoritative.
- `enforce`: execute this specification.

The product default SHOULD be `enforce` once acceptance passes so the released
desktop build fixes the issue. QA/canary validation SHOULD exercise `shadow`
first. Invalid configuration MUST fail to a safe documented default and produce
one startup warning, not per-poll log spam.

The seam spans `apps/server/src/config.ts` (`ServerConfigShape`) and
`apps/server/src/main.ts` (environment parsing), with parsing tests in
`apps/server/src/main.test.ts`. New shape fields SHOULD be optional and resolved
to defaults inside the adapter/config layer so existing `ServerConfig.layerTest`
fixtures remain source-compatible unless intentionally updated.

The 5s+5s teardown values are maximum safety budgets. Existing supervised
teardown defaults are shorter and MAY remain unchanged if exit proof and tests
meet this contract.

## 13. Diagnostics and observability

Emit structured, content-free diagnostics for:

- `antigravity.completion_candidate_started`
- `antigravity.completion_candidate_cancelled` with reason
- `antigravity.missing_terminal_recovery_started`
- `antigravity.missing_terminal_recovery_completed`
- `antigravity.missing_terminal_teardown_failed`
- `antigravity.quarantine_entered`
- `antigravity.quarantined_process_reaped`
- `antigravity.stale_recovery_ignored`

Allowed fields: provider/CLI version, thread ID, turn ID, lifecycle generation,
candidate step index, quiet duration, pending-tool count, teardown stage,
exit code/signal, remaining descendant count, capture-complete flag, settlement
source, and cancellation reason.

Track activation, reset/cancel, recovered completion, forced teardown,
quarantine, blocked admission, late activity, stale callback, and duplicate
terminal suppression counts. Routine healthy turns produce no recovery warning.

## 14. Implementation surface

### 14.1 Required writes

- `apps/server/src/provider/Layers/AntigravityAdapter.ts`
- `apps/server/src/provider/Layers/AntigravityAdapter.test.ts`

### 14.2 Conditional supporting writes

Modify only when exact implementation evidence requires it, and report why:

- `apps/server/src/config.ts` for recovery mode/grace configuration.
- `apps/server/src/main.ts` and `apps/server/src/main.test.ts` if environment
  parsing is added.
- `apps/server/src/provider/supervisedProcessTeardown.ts` only if the existing
  API cannot express required exit proof or budgets.
- `apps/server/src/provider/providerRuntimeReconciliation.ts`,
  `apps/server/src/provider/terminalTurnApplicability.ts`, or
  `apps/server/src/provider/Layers/ProviderService.ts` only if integration tests
  prove an adapter terminal/session event cannot satisfy existing semantics.
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts` is the
  read-only source of truth for verifying that ordered `turn.completed` then
  `session.state.changed(error)` clears the turn and leaves session error; edit
  it only if an integration test proves the documented event order insufficient.

Contracts, DB, projections, UI, other adapters, and global thresholds are
prohibited write surfaces for this issue.

### 14.3 Symbol responsibilities

- `AntigravitySessionContext`: typed recovery/quarantine state, not scattered
  inconsistent booleans.
- `processTranscriptStep`: update latest planner evidence and candidate state
  after normal item emission.
- `readTranscript` / `pollHookFile`: activity revision and final-drain support.
- stdout/stderr/pre-tool/post-tool handlers: activity/reset signals.
- turn poll/timer: single-flight `maybeRecoverTerminalAnswer` execution.
- child `close`: honor recovery intent and quarantine identity.
- child `error`: deferred terminal classification if `close` never arrives.
- `settleActiveTurn`: remain the idempotent terminal gate and cancel recovery
  scheduling.
- `sendTurn` / `startSession`: block admission over quarantine.
- `interruptTurn`, `stopSession`, adapter finalizer: cancel recovery and perform
  quarantine-aware cleanup.

## 15. Work packages

### WP0 — Baseline and deterministic harness

Create fake wedged child/transcript/hook/time helpers in the existing adapter
test file. The fake child emits no `close` until driven. Capture current test
baseline before production edits. Sequential and first.

### WP1 — Candidate, activity, scheduling, modes

Add typed recovery state, pure candidate predicate, activity revision, grace
scheduling, ownership token, mode/grace configuration, and content-free
candidate diagnostics. No process teardown until eligibility tests pass.
Depends on WP0.

### WP2 — Final drain and recovered settlement

Implement recovery intent, final-drain revision check, supervised teardown,
close-handler classification, warning, and single settlement. Cover both race
orders for Stop/close/interrupt. Depends on WP1.

### WP3 — Error without close

Implement deferred error classification and cleanup. It may be developed after
WP1 in parallel with WP2 if write conflicts are serialized before merge.

### WP4 — Quarantine and admission fencing

Add unconfirmed-death record, ordered terminal/error session events, blocked
admission, reap/release flow, and stop/disposal behavior. Depends on WP2.

### WP5 — Ownership and lifecycle hardening

Prove replacement of context/generation/turn/child makes old callbacks harmless.
Extract a reusable ownership check if necessary. Run existing stale-generation
tests. Depends on WP2; serialize with WP4 where handlers overlap.

### WP6 — Integrated diagnostics and acceptance

Complete event coverage, leak assertions, targeted integration/regression tests,
typecheck, changed-code review, and broader server gates. Sequential and last.

Recommended spine: `WP0 → WP1 → WP2 → WP4 → WP5 → WP6`, with WP3 integrated
after WP1.

## 16. Verification matrix

Use Vitest fake time or injected clock/scheduler. Tests MUST NOT sleep for real
15s/5s windows.

| ID | Situation | Expected result |
|---|---|---|
| AC-01 | Final tool-free response; no Stop/close; grace expires | Final drain, bounded teardown, one completed terminal, one warning |
| AC-02 | Healthy Stop/close inside grace | Normal path wins; no recovery warning |
| AC-03 | Partial/malformed/empty response | No candidate, no teardown |
| AC-04 | Tool-bearing response or pending tool | No recovery; turn remains running |
| AC-05 | Transcript/hook/stdout/stderr/tool activity in grace | Full grace resets or candidate invalidates |
| AC-06 | New activity found by final drain | No teardown; output emitted once; state re-arms/invalidates correctly |
| AC-07 | Watchdog signal causes non-zero/signal close | Completed, not interrupted/failed |
| AC-08 | Stop/close/interrupt races watchdog in both orders | First valid claimant wins; one terminal event |
| AC-09 | Generation/turn/process/session replaced | Stale callback cannot drain, kill, settle, release, or clean current owner |
| AC-10 | Graceful teardown proves death | No unnecessary further escalation |
| AC-11 | Death remains unproven | Answer completed; session error; quarantine retained; admission blocked |
| AC-12 | Quarantined child later dies | Lease/runDir released once; ready or pending Stop completes |
| AC-13 | `error` without `close`, no output | runtime.error + failed terminal + cleanup |
| AC-14 | `error` without `close`, existing `turnOutputProduced` evidence | Preserve non-zero-exit policy: completed + warning + cleanup; no duplicate on late close |
| AC-15 | Mode off/shadow/enforce | Off inert; shadow logs only; enforce recovers |
| AC-16 | Session stop/disposal in every watchdog state | No timer/listener/interval/lease/runDir leaks |
| AC-17 | Existing cancel/Stop/zero/non-zero close/stdout fallback | Existing behavior remains green |
| AC-18 | Diagnostics payload inspection | Required operational fields only; no content/secrets |

Boundary tests must include activity exactly at grace expiry, ownership change
during final drain, ownership change during teardown, and late close after
quarantine settlement.

## 17. Verification commands

Run from repository root:

```bash
/Users/anhpham99/.bun/bin/bun run --cwd apps/server test -- \
  src/provider/Layers/AntigravityAdapter.test.ts \
  src/provider/providerRuntimeReconciliation.test.ts \
  src/provider/terminalTurnApplicability.test.ts \
  src/provider/supervisedProcessTeardown.test.ts

/Users/anhpham99/.bun/bin/bun run --cwd apps/server typecheck
```

Then run proportional broader gates based on the final diff, including
ProviderService/ProviderRuntimeIngestion tests if those modules are touched, and
the full `apps/server` test suite before final acceptance. Compile/typecheck is
not sufficient proof.

Failure evidence must name the violated AC, ownership tuple, settlement source,
and remaining resource state without printing provider content.

## 18. Rollout and rollback

1. Run all deterministic acceptance tests in `enforce` mode.
2. Exercise `shadow` in QA/canary and inspect candidate cancellation and late
   activity. A candidate that frequently sees valid late work indicates an
   unsafe predicate or grace policy.
3. Enable `enforce` for a small cohort/build, watching force, quarantine,
   duplicate suppression, and blocked admission.
4. Widen only after no false completion or cross-generation effect is observed.

Emergency rollback is configuration mode `off`; it restores existing runtime
behavior without reverting code. `error`-without-`close` is an independent bug
fix and SHOULD remain active unless it causes a separate regression.

## 19. Definition of done and report contract

Implementation is done only when:

- AC-01 through AC-18 pass deterministically.
- Existing adapter, reconciliation, applicability, and teardown tests pass.
- Server typecheck and proportional broader tests pass.
- The diff stays within the approved write surfaces or documents evidence for
  each supporting-file expansion.
- Review finds no duplicate terminal, stale-generation damage, process/lease/
  timer/run-directory leak, content-bearing diagnostic, or generic timeout.
- Normal completions remain behaviorally unchanged and silent.

The implementing agent must report:

1. Files changed and one-line mechanism per file.
2. State/data model implemented.
3. Exact commands and pass/fail counts.
4. AC-to-test mapping.
5. Diagnostics/events added.
6. Any deviation with source evidence and approval status.
7. Residual risk or unverified real-CLI behavior.

Do not commit unless the orchestrator explicitly requests it.
