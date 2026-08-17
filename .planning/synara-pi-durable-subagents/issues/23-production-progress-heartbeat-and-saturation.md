# 23 — Production progress, heartbeat leases, and saturation control

**What to build:** Managed execution in the actual Pi extension stops producing
the legacy 80 ms spinner stream. Meaningful progress is coalesced at both
producer and server, heartbeat refreshes a durable ownership lease without
becoming transcript content, and lifecycle/terminal evidence retains a
non-coalescing path under pressure. Latest observations survive reconnect and
database reopen while intermediate progress history and memory remain bounded.

**Blocked by:** 22 — Real bounded foreground attachment.

**Status:** accepted (Decision 0009, 2026-08-18) — Symphony 6d646fe1 + Alfie d35644a3b

- [x] **T23-AC1:** The actual managed Agent producer emits no continuing 80 ms
      spinner publication; bridge-absent legacy behavior remains unchanged.
- [x] **T23-AC2:** Producer and server cap progress at the configured rate,
      initially two updates per second per execution, with trailing-edge latest
      snapshot semantics.
- [x] **T23-AC3:** Heartbeat occurs approximately every 10 seconds and refreshes
      a 30-second durable ownership lease without creating transcript messages,
      auto-follow triggers, or durable intermediate progress history.
- [x] **T23-AC4:** Desired and observed execution states remain separately
      persisted/readable and cannot be overwritten by progress or heartbeat.
- [x] **T23-AC5:** Saturation coalesces or drops progress with accurate counters,
      while accepted, started, cancellation, and terminal lifecycle evidence is
      never discarded by the progress queue.
- [x] **T23-AC6:** A sustained deterministic progress flood keeps server memory
      and queue depth bounded; completed executions release coordinator, timer, and
      observation ownership.
- [x] **T23-AC7:** Invalid progress rate, heartbeat interval, and lease duration
      fall back to safe defaults on the live production path.
- [x] **T23-AC8:** Browser reconnect and database reopen restore the latest
      useful progress and lease observation without replaying every intermediate
      update.
- [x] **T23-AC9:** Actual-Pi progress evidence is required in addition to the
      deterministic lower-level saturation producer.

## Testing Seams

**Approval status:** Approved — owner approved the remediation breakdown and
known seams on 2026-08-16.

- **T23-AC1, T23-AC2, T23-AC3, T23-AC7, T23-AC9:** Actual Pi execution
  producer → production ingress boundary with managed, invalid-config, and
  legacy cases.
- **T23-AC3, T23-AC4, T23-AC8:** Durable execution snapshot, WebSocket
  reconnect, transcript observation, and database reopen boundary.
- **T23-AC5, T23-AC6:** Deterministic provider-ingress saturation harness —
  flood progress, interleave lifecycle/terminal events, inspect counters,
  memory/queue bounds, and post-terminal cleanup.
- **T23-AC3:** Focused transcript auto-follow boundary — heartbeat and nested
  progress do not use the real-message/live-text follow path.

## Implementation Report

**Implementation state:** implemented — report complete pending independent
review

### Delivered scope

Producer-side coalescing + heartbeat in the actual Alfie extension (managed
branch only, legacy 80 ms spinner path untouched); server-side dispatch in
PiAdapter.wrapAgentTool with a per-execution trailing-edge coalescer emitting
only `tool.progress`; durable UPDATE-only observation persistence
(latest-progress snapshot + counters, lease refresh) on the migration-099
columns; three new live-config knobs with invalid-fallback; deterministic
saturation/release harness; provenance re-pin; real-Pi acceptance against the
deterministic loopback model server.

### Changed production call chain

Actual child activity (tool/text/turn/usage callbacks via
`createActivityTracker` funnel, index.ts managed branch) → producer
trailing-edge coalescer (≤ rateHz, no spinnerFrame) →
`binding.reportObservation({kind:"progress", progressJson})` →
PiAdapter.wrapAgentTool dispatch (PiAdapter.ts ~:3241) →
`piSubagentProgressCoalescer` (single latest slot + flush timer 1/rateHz) →
on flush: `offerRuntimeEvent("tool.progress")` (mirrors emitPluginProgress
shape) + `recordProgressObservation` UPDATE (last_progress_json/at,
dropped_progress_count += coalesced). Heartbeat: extension timer
(intervalMs, survives detach) → `reportObservation({kind:"heartbeat"})` →
fire-and-forget `recordHeartbeatObservation` UPDATE (last_heartbeat_at,
lease_expires_at = occurredAt + leaseMs). Lifecycle kinds (started/detached)
keep the ticket-22 non-coalescing journal path unchanged. Alfie: commit
`d35644a3b` (binding widened + optional policy fields, capability
`coalesced-progress`, EXTENSION_VERSION `0.11.0-alfie.1`, heartbeat timer in
liveAttachments cleared on all settle/failure/dispose paths, counted in
getResourceSnapshot().activeTimerCount). Symphony: config.ts + main.ts env
wiring; piSubagentBridge.ts observation-kind/policy widening with guard
validation; PiSubagentExecutionRepository (Services+Layers) three new
observation methods + reader.

### Acceptance evidence matrix

| Criterion | Source evidence                                                                                                                 | Verification evidence                                                                                                                                                                                                                                                                                                                                                           | Result |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| T23-AC1   | Alfie index.ts managed branch passes coalescer into createActivityTracker; onUpdate spy in piSubagentProgressAcceptance.test.ts | Alfie test/managed-progress.test.ts "legacy path starts the 80ms interval…" (legacy unchanged) + onUpdate-never (bounded-foreground test 8) + Symphony real-Pi acceptance `expect(onUpdateCalls).toHaveLength(0)` against pinned extension                                                                                                                                      | pass   |
| T23-AC2   | piSubagentProgressCoalescer.ts (server), Alfie producer coalescer                                                               | piSubagentProgressObservation.test.ts AC2: 5000-observation flood → 20 flushes (cap 2 Hz × 10 s + 1), trailing-edge latest payload (turnCount ≥ N−2), exact counters (emitted + coalesced = N); Alfie managed-progress.test.ts flood ≤ rateHz×duration+1 with custom 0.5 Hz policy honored                                                                                      | pass   |
| T23-AC3   | Extension heartbeat timer; PiAdapter heartbeat dispatch (~:3251); repository recordHeartbeatObservation                         | piSubagentProgressObservation.test.ts AC3: 3 heartbeats → leaseExpiresAt = occurredAt + 30000 exactly, getObservation durable, ZERO tool.progress/message-like events, journal stays [1,2]; Alfie managed-progress.test.ts heartbeat interval/cadence + survives detach + stops after settlement; real-Pi acceptance proves real lease refresh with leaseLead = leaseDurationMs | pass   |
| T23-AC4   | Repository observation methods are UPDATE-only on 099 columns                                                                   | PiSubagentExecutionRepository.test.ts: desired/observed unchanged after progress+heartbeat; piSubagentProgressObservation.test.ts AC5: after 500-observation interleave flood desiredState=observedState="running" from lifecycle events only                                                                                                                                   | pass   |
| T23-AC5   | Lifecycle never enters the coalescer (separate dispatch)                                                                        | piSubagentProgressObservation.test.ts AC5: journal [1,2,3] exact amid flood; progress persistence failure swallowed (no throw, control health "available") while lifecycle failure still degrades + rejects with pi_subagent_lifecycle_persistence_failed                                                                                                                       | pass   |
| T23-AC6   | Coalescer structural bounds + idle TTL max(leaseMs, 2×intervalMs)                                                               | piSubagentProgressSaturation.test.ts: 20k observations × 8 executions → tracked ≤ executions, pending ≤ executions at every point, emitted ≤ rateHz×duration+1 each, exact accounting 20 000, RSS delta < 64 MB, idle TTL releases all entries + timers (pendingCount 0), dispose flushes trailing snapshot exactly once, late progress re-tracks cleanly                       | pass   |
| T23-AC7   | resolvePiSubagentProgressRateHz / HeartbeatIntervalMs / LeaseDurationMs (config.ts) + main.ts ServerConfigLive env wiring       | config.test.ts resolver matrix (defaults 2/10000/30000, range endpoints, invalid → default, no clamping); main.test.ts live env resolution for the three knobs; Alfie-side invalid-policy → internal defaults (managed-progress.test.ts)                                                                                                                                        | pass   |
| T23-AC8   | getObservation reader; WS cursor-resume unchanged (activity path)                                                               | PiSubagentExecutionRepository.test.ts observation reopen (file-backed): latest progress + lease restored, no intermediate history rows; observation test proves no intermediate journal/runtime events exist to replay; web auto-follow already excludes non-message activity (pre-existing ChatView guard + browser test, unchanged)                                           | pass   |
| T23-AC9   | piSubagentProgressAcceptance.test.ts against pinned extension d35644a3b / 0.11.0-alfie.1 with deterministic loopback SSE model  | Real session: negotiated capabilities contain coalesced-progress; real onUpdate spy zero; durable observation with real producer payload (no spinnerFrame, status running); real heartbeat lease lead = 4 500 ms configured; no message-like runtime events                                                                                                                     | pass   |

### Failure and diagnostic evidence

- Progress-sink failure: injected recordProgressObservation failure →
  swallowed, no throw to producer, control health stays "available", counters
  keep exact (piSubagentProgressObservation.test.ts AC5).
- Heartbeat failure: injected recordHeartbeatObservation failure → swallowed,
  no journal/runtime events; extension-side observation rejection never kills
  the child and later heartbeats still fire (Alfie managed-progress.test.ts).
- Saturation: flood + terminal interleave → lifecycle journal exact; terminal
  emission path never queues behind progress (separate dispatch paths).
- Invalid config: all three knob resolvers fall back to defaults on the live
  path (main.test.ts); malformed binding policy on the extension side →
  internal defaults, never rejects the binding (Alfie).
- Terminal-during-flood: dispose() flushes the pending trailing snapshot
  exactly once and cancels timers; idle cleanup emits nothing new
  (piSubagentProgressSaturation.test.ts).
- Invalid observation kinds: reportObservation rejects "spinner"/null with
  "Invalid observation kind" (piSubagentProgressObservation.test.ts).

### Verification commands and results

- Alfie extension suite (`npm test` in agent/extensions/pi-subagents at
  d35644a3b): 30 files, 483 tests passed, tsc --noEmit clean.
- Symphony focused (per-file, apps/server): piSubagentProgressObservation 4/4;
  piSubagentProgressSaturation 3/3; PiSubagentExecutionRepository 12/12;
  piSubagentBridge 16→28 tests green; config.test + main.test green;
  piSubagentForegroundLifecycle, piSubagentSession, admission coordinator,
  control-health suites green (92 tests).
- Per-file standalone wallclock verification (Decision 0008 method):
  piSubagentForegroundAcceptance 6/6, piSubagentProgressAcceptance 1/1,
  piSubagentForegroundReopen 1/1, piSubagentForegroundLifecycle 5/5,
  piSubagentRealExtension 11/11 (one transient 1-fail in a tight back-to-back
  batch run; green in three consecutive standalone invocations — the
  documented multi-invocation contention is not applicable here).
- Symphony full suite (`bun run test` in apps/server), run twice green: 371
  files passed | 3 skipped, 4511 tests passed | 17 skipped, exit 0 (includes
  the five-file wallclock project with the new piSubagentProgressAcceptance).
- Workspace: `bun fmt` clean; `bun lint` 0 errors (524 warnings pre-existing);
  `bun typecheck` exit 0 (63 pre-existing apps/server errors + 13 pre-existing
  contracts errors fixed as in-area debt cleanup — see deviations).

### Migration compatibility evidence

No new migration: migration 099 (ticket 20) already stages
`last_heartbeat_at`, `lease_expires_at`, `last_progress_json`,
`last_progress_at`, `dropped_progress_count` on `pi_subagent_executions`;
ticket 23 adds only consumers. Repository reopen test exercises the columns on
a file-backed database (ticket-18 lineage intact).

### Real-Pi evidence

- Provenance manifest re-pinned: Alfie `d35644a3b7af34c0dd1868afe652de50e62c8992`,
  package `@alfie/pi-subagents@0.11.0-alfie.1`, SHA-256 recomputed for
  package.json / src/index.ts / src/agent-manager.ts and verified by
  `verifyExtensionGitProvenance` at test start (synthetic replacements cannot
  satisfy it).
- piSubagentProgressAcceptance.test.ts drives the actual extension through the
  production PiAdapter managed path with a real loopback OpenAI-completions
  model (slow model 4 s/turn): onUpdate spy 0 calls, real progress observation
  persisted (no spinnerFrame), real heartbeat lease lead exactly the configured
  4 500 ms, journal [accepted, started(+detached)], no message-like runtime
  events.

### Deviations and remaining risks

- `bun typecheck` at HEAD carried 63 pre-existing errors in apps/server
  pi-subagent files (masked by fail-fast at @synara/contracts, which itself
  carried 13 pre-existing errors — both now fixed in this ticket's commits as
  debt cleanup within the same area). Final state: workspace typecheck exit 0.
- Terminal-state journaling for detached children (terminal outbox) remains
  downstream work (ticket 24 / capability `terminal-outbox`); ticket 23 proves
  lifecycle/terminal evidence is never DISCARDED by the progress queue, per AC.
- Memory bound in the saturation test is structural (entries/pending/timers ≤
  executions) plus a coarse <64 MB RSS guard; allocator-noise-sensitive tight
  RSS bounds were deliberately avoided.
- Heartbeat interval/lease are server-config-driven policy pushed through the
  binding; a mixed-version extension without `coalesced-progress` never sends
  the new kinds (handshake-gated), so Symphony's widened dispatch is inert
  against legacy extensions.

### Commits

- Alfie `d35644a3b` — feat(pi-subagents): coalesced managed progress and
  heartbeat lease observations (issue 23) [local main]
- Symphony `fa6878f0` — chore(fmt): apply workspace formatting (pre-existing
  fmt debt) [local main]
- Symphony (this change) — feat(server): pi subagent progress coalescing,
  heartbeat leases, and saturation control (issue 23) [pending commit]
- Final working-tree status: clean after commit.

### Independent review verdict (2026-08-18)

RECOMMEND ACCEPT — high confidence. All criteria T23-AC1..AC9 PASS with
directly reproduced evidence (focused suites re-run standalone; provenance
SHA-256 recomputed and matched; source-level audit of UPDATE-only observation
paths, lifecycle/progress separation, failure containment, legacy-path
preservation, invalid-config fallback, no new migration, budget-envelope
untouched). No critical or high defects. Recorded low/info findings:
heartbeat lease trusts producer-supplied occurredAt (observation-only until a
lease consumer exists — ticket 24 scope), report test-count arithmetic nit
(piSubagentBridge actual total 38, all green), tracked .pi/notifications.jsonl
runtime mutation (pre-existing pattern), admission-coordinator dual-shape
latestTurn read (behavior-identical, 33/33 tests), fire-and-forget
session-stop disposeAll consistent with observation-not-control semantics.

### Reviewer handoff

Shortest reproductions (apps/server, `bun run test <file>` per file):

1. Real-Pi progress/heartbeat: `src/provider/piSubagentProgressAcceptance.test.ts`
   (requires sibling alfie checkout at d35644a3b — provenance self-verifies).
2. Server dispatch/caps/counters: `src/provider/piSubagentProgressObservation.test.ts`.
3. Saturation/release: `src/provider/piSubagentProgressSaturation.test.ts`.
4. Durable reopen: `src/persistence/Layers/PiSubagentExecutionRepository.test.ts`
   (observation reopen describe block).
5. Config fallback live path: `src/main.test.ts` + `src/config.test.ts`.
6. Terminal-reserve + failure containment: observation test AC5 case.
7. Producer-side (Alfie repo): `npm test` in agent/extensions/pi-subagents →
   managed-progress.test.ts, bounded-foreground.test.ts, synara-bridge.test.ts.
