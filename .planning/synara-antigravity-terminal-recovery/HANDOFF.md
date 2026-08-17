# IMPLEMENTATION HANDOFF — Antigravity terminal-answer recovery

## Recipient and goal

Synara server/runtime coding agent. In `/Users/anhpham99/symphony`, implement an
Antigravity-only recovery path so a structurally complete final answer clears
`working...` even when `agy` emits neither Stop nor `close`. Preserve the answer
exactly once, clean up the owned process, and prevent stale/cross-turn damage.

Read `SPEC.md` in this directory before changing source. `SPEC.md` is the
normative implementation, state-machine, rollout, and verification contract;
this handoff is only the concise entry point. If they conflict, `SPEC.md` wins.

## Current state (2026-08-17)

- Inspected `main` at `3f10133b`; worktree was clean before this handoff.
- Installed CLI: `agy 1.1.13`.
- Investigation/design are complete. No app code, DB, logs, or production state
  has been changed for this issue.
- This package is self-contained; challenge it only with contrary source
  evidence. Do not reopen product discovery by default.

## Confirmed incident

- Turn `f5f3055d-5947-4c9a-89e1-125b8c2dd007` started at `07:07:57Z`, emitted
  a complete `PLANNER_RESPONSE` after all observed tools at `07:10:35Z`, then
  emitted no provider terminal event. It remained running until reconciliation/
  interruption at `07:14:00Z` (~363s).
- Two other same-day turns had the same signature and remained running for
  ~117s and ~217s. Neighboring successful turns emitted `turn.completed`
  ~0.2–0.4s after final output, so the defect is intermittent.
- A late old-generation terminal was also ignored after lifecycle replacement.
  That is a secondary recovery race, not the initiating cause.
- Never put prompt/response contents, credentials, or account identifiers in
  diagnostics or fixtures.

## Root cause and source evidence

`apps/server/src/provider/Layers/AntigravityAdapter.ts`:

- `processTranscriptStep` (~794) maps tool-free `PLANNER_RESPONSE` to an
  assistant item but does not treat it as terminal evidence.
- `pollHookFile` (~860) tears down only after `eventName === "stop"` (~972); the
  failed turns had no Stop hook.
- The `close` handler (~1265) final-drains and calls `settleActiveTurn`; a live
  wedged child never reaches it.
- `settleActiveTurn` (~699) already guards single terminal emission with
  `turnTerminalEmitted`; extend this mechanism, do not create a parallel one.
- `interruptTurn` (~1370) explains why user action eventually unlocks the turn.
- The child `error` handler emits `runtime.error` but may leave the turn running
  forever if `close` never follows. Repair this in the same change.
- `--print-timeout 30m` belongs to the CLI and is not a Synara watchdog.

`apps/server/src/provider/providerRuntimeReconciliation.ts` intentionally trusts
a matching live `running` turn. Its stale threshold is 15s and abandonment
threshold is 45m, so the honestly-running wedged adapter is skipped until
abandonment. Keep generic reconciliation unchanged; the adapter is the seam.

## Binding behavior contract

Implement a **terminal-answer quiescence watchdog**. Silence alone never means
success.

### Candidate and grace

A candidate requires one complete parsed transcript record that is the latest
relevant `PLANNER_RESPONSE`, has non-whitespace content, zero `tool_calls`, no
pending tools, and belongs to the currently owned session context, generation,
turn, and child identity. Partial/malformed lines, reasoning, arbitrary stdout,
elapsed time, or silence are insufficient.

- Start a configurable 15,000ms grace period after qualification.
- Reset/cancel on owned-turn transcript/hook/stdout/stderr activity, new output,
  tool lifecycle/pending tool, later tool-bearing response, Stop, close/error,
  interrupt, session replacement, ownership loss, or prior settlement.
- Timer callbacks must revalidate candidate, inactivity, ownership,
  interruption, and settlement state.
- At expiry, final-drain hooks/transcript. Any new activity returns to the
  appropriate non-terminal state.

### Teardown, settlement, quarantine

If eligibility survives final drain:

1. Latch recovered-completion intent so watchdog-caused signals cannot
   reclassify the answer as interrupted.
2. Request graceful owned process-tree teardown (maximum 5s), then forced
   teardown (maximum 5 additional seconds) if death is unconfirmed.
3. Emit final-drained output before terminal settlement.
4. Settle once as `completed/model_stop` with a non-fatal missing-terminal
   warning; never duplicate assistant content.

Reuse `supervisedProcessTeardown.ts` and its exit-proof model; do not implement
ad-hoc PID killing. The 5s values are phase caps, not mandatory waits: shorter
existing confirmed teardown is valid. A wedge should clear `working...` within
~25s of last qualifying activity (15s grace + at most 10s teardown).

If death remains unconfirmed, keep the answer completed, set public
`ProviderSessionStatus` to `error` (do not add a `quarantined` status), retain
adapter-internal quarantine/ownership state, fence the child, preserve its run
directory/gateway lease, block another child, continue safe reap attempts, and
surface an actionable warning. Never silently orphan it.

### Race and generation invariants

- Settlement is first-writer-wins across watchdog, Stop/close/error, interrupt,
  and session stop. Exactly one path emits terminal state and owns cleanup.
- Before every async drain/kill/settle/cleanup/admission action, revalidate
  `threadId + turnId + lifecycleGeneration + child identity`.
- Generation N cannot affect N+1. A stale terminal may settle only the exact
  turn still active in durable binding (or when no newer generation can be
  harmed). Diagnose and ignore a different active turn.
- Never admit a newer turn while an older child is owned or quarantined.
- `error` without `close`: no usable output → `failed/error`; existing
  `turnOutputProduced` evidence → preserve current non-zero-exit policy and
  settle `completed/model_stop` with warning. Never wait indefinitely for
  `close`.

## Write set

Required:

- `apps/server/src/provider/Layers/AntigravityAdapter.ts`
- `apps/server/src/provider/Layers/AntigravityAdapter.test.ts`

Supporting; modify only with concrete need and report why:

- `apps/server/src/config.ts` (existing seam for kill switch/grace only)
- `apps/server/src/main.ts` and `apps/server/src/main.test.ts` (only if recovery
  mode/grace environment parsing is added)
- `apps/server/src/provider/supervisedProcessTeardown.ts`
- `apps/server/src/provider/providerRuntimeReconciliation.ts`
- `apps/server/src/provider/terminalTurnApplicability.ts`
- `apps/server/src/provider/Layers/ProviderService.ts`

Do not change contracts, DB schema, projections, UI protocol, other providers,
or global reconciliation thresholds.

## Required deterministic tests

1. Qualifying final response + no Stop/close → after grace/final drain, one
   `completed/model_stop`, one recovery warning, bounded teardown.
2. Transcript/hook/stdout/stderr/tool activity resets/cancels grace.
3. Partial, malformed, empty, tool-bearing, or tool-pending responses never
   trigger recovery; final-drain activity prevents teardown and emits once.
4. Stop/close/interrupt/watchdog races in both orderings preserve the first
   claimant and one terminal event; watchdog-caused signals do not reclassify.
5. Replaced generation/turn/process/session makes stale watchdog a harmless
   no-op.
6. Graceful success avoids force; failure escalates within the second cap.
7. Unconfirmed death completes output, sets session error, fences/reaps the
   child, preserves authority cleanup, and blocks replacement admission.
8. `error` without `close` covers no-output failure and recovery under the
   existing `turnOutputProduced` policy.
9. Existing Cancel, Stop, close, stdout fallback, non-zero-exit-with-output,
   and stale-generation tests remain green.
10. No timer/listener/interval/lease/run-dir/child-handle leak on every terminal,
    quarantine cleanup, session stop, and adapter disposal path.

## Verification

From repo root:

```bash
/Users/anhpham99/.bun/bin/bun run --cwd apps/server test -- \
  src/provider/Layers/AntigravityAdapter.test.ts \
  src/provider/providerRuntimeReconciliation.test.ts \
  src/provider/terminalTurnApplicability.test.ts \
  src/provider/supervisedProcessTeardown.test.ts
/Users/anhpham99/.bun/bin/bun run --cwd apps/server typecheck
```

Then run broader server/full gates appropriate to the final diff. Compile/
typecheck alone is not completion; prove feature and failure/diagnostic paths.

## Diagnostics, rollout, and don'ts

Emit structured events for candidate start/cancel, recovery start/complete,
teardown failure, and quarantined-process reap. Record operational IDs, CLI
version, quiet time, pending-tool count, teardown result, exit signal/code, and
settlement source—never content. Track recovery, force, quarantine, late
activity, stale-event, and duplicate-terminal suppression counts.

Use a server kill switch/configurable grace. Roll out shadow-only first, then a
small cohort, then widen while monitoring false completion, force/quarantine,
late activity, and duplicate settlement. Normal completion stays silent.

Do not reduce the CLI timeout, lower global abandonment, infer success from
generic inactivity, recover tool-bearing responses, generalize to other
providers, bypass ownership checks, admit over an unconfirmed child, edit user
state/logs, or silently convert no-output failure to success.

## Implementation sequence and report

1. Confirm current HEAD and preserve unrelated user changes.
2. Add deterministic candidate/activity state using existing settlement and
   teardown primitives; implement fencing and `error`-without-`close`.
3. Add fake-time/race/failure tests before broad refactoring.
4. Run targeted verification, typecheck, then proportional broader gates.
5. Review the diff for duplicate settlement, generation damage, leaks, and
   scope drift. Do not commit unless explicitly requested.
6. Report files/mechanism, exact commands/results, deviations, and residual
   risks. Challenge binding items with source evidence rather than substituting
   a generic timeout or reconciliation-only workaround.
