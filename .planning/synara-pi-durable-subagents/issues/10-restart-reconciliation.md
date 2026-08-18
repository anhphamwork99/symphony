# 10 — Restart reconciliation to terminal or orphaned

**What to build:** On server restart, Synara reconciles every non-terminal
managed execution against live bridge ownership and transcript terminal
evidence. A proven live execution remains running, terminal evidence restores
the outcome, and an execution with neither becomes non-terminal `orphaned` with
an owner-loss and partial-side-effect warning. Reconciliation never replays the
delegation automatically.

**Blocked by:** 05 — Coalesced progress and heartbeat leases; 07 —
Journal-first terminal lifecycle.

**Status:** ready-for-agent → implemented (awaiting review)

- [x] **T10-AC1:** No live-owner or terminal evidence produces `orphaned` with a
      stable owner-loss diagnostic; `running` is never asserted without evidence.
- [x] **T10-AC2:** A transcript terminal marker carrying matching identity and
      generation restores the applicable terminal outcome instead of orphaning.
- [x] **T10-AC3:** A bridge `listActive` or describe result matching execution,
      attempt, and generation refreshes observation without creating a new attempt.
- [x] **T10-AC4:** Startup reconciliation performs no spawn, resume, or other
      side-effecting delegation replay.
- [x] **T10-AC5:** Late events from stale attempts or generations after
      reconciliation are ignored and counted.
- [x] **T10-AC6:** The orphan diagnostic explains that partial external or
      workspace side effects may already exist and recommends inspection.
- [x] **T10-AC7:** Lease expiry without renewed live-owner evidence enters the
      same owner-loss reconciliation instead of remaining running indefinitely;
      the initial orphan threshold is approximately 60 seconds and remains
      configurable.

## Testing Seams

**Approval status:** Approved — owner approval in the ticket-breakdown review
on 2026-08-16.

- **T10-AC1, T10-AC2, T10-AC3, T10-AC4, T10-AC5, T10-AC7:** Server
  orchestration kill/restart harness with active-owner, no-owner,
  terminal-marker, missing-marker, lease-expiry, and stale-event fixtures.
- **T10-AC1:** Execution state-machine contract — `orphaned` is non-terminal and
  can exit only through new evidence or explicit resume.
- **T10-AC3:** Isolated real-Pi bridge boundary — a live registry record is
  discoverable under the same execution, attempt, and generation.
- **T10-AC6:** Projected diagnostic contract.

## Implementation Report

**Implementation state:** implemented — awaiting independent review (2026-08-18)

### Delivered scope

Restart / lease-expiry reconciliation to terminal or orphaned, Symphony-side
only (Alfie unchanged at the pinned `608c1c57d` / `0.13.0-alfie.1`; no
extension change required — `getActiveExecutions` already exists on the
negotiated bridge).

New coordinator `piSubagentRestartReconciliation.ts`
(`reconcilePiSubagentExecutions`) with the evidence ladder per non-terminal
execution (current attempt/generation only):

1. **Live owner (T10-AC3):** a bridge `listActive` record matching
   executionId + attemptId + generation AND `isRunning` keeps the execution
   running and refreshes the observation server-side
   (`recordHeartbeatObservation` at the server clock: heartbeat touch +
   re-derived lease). No state change, no new attempt. An identity-mismatched
   active record is NOT evidence.
2. **Terminal evidence (T10-AC2):** durable journal terminal rows for the
   current attempt/generation first (production path), then the injectable
   transcript-marker reader seam (approved Testing Seams fixture surface).
   Restoration goes through the idempotent journal-first terminal path
   (`recordTerminalEvent`), which applies the aggregate and creates the
   completion-outbox entry in the same transaction — a restored outcome
   immediately enters the fenced delivery path. A marker whose
   identity/generation does not match restores nothing.
3. **Neither → `orphaned` (T10-AC1/AC5/AC6):** new repository seam
   `recordOrphanedEvent` — one transaction (deterministic idempotent eventId
   `orphan_<exec>_<attempt>_gen<gen>`, sequence band 50): journal `orphaned`
   event + aggregate `observed_state = 'orphaned'` + the stable
   `pi_subagent_owner_loss_orphaned` diagnostic (T10-AC6 message: partial
   external/workspace side effects may already exist; inspect before
   resuming; not automatically replayed) + **generation advance by one**
   (reconciliation fence, spec Implementation Decision 27) so late events
   from the orphaned attempt/generation are stale: late terminals are
   `ignored_stale` AND counted (`stale_terminal_events`, T10-AC5); late
   generic lifecycle events journal as history only. Terminal aggregates can
   never be orphaned. Idempotent: re-reconciling an already-orphaned SAME
   attempt/generation does NOT fence again (no unbounded generation drift).
   A concurrent resume (newer attempt) is protected by a stale_generation
   guard.

Modes: `"restart"` settles owner-loss immediately (process death is
owner-loss proof; no in-process Pi child can be proven alive after server
restart). `"lease_expiry"` (T10-AC7) requires the re-derived lease
(`last_heartbeat_at + leaseDurationMs` against the SERVER clock — stored
producer-supplied `lease_expires_at` is never trusted, per the standing
Decisions 0009–0013 lease-authority obligation) to have been expired beyond
the configured orphan threshold; live-owner evidence still wins in that
mode. Threshold knob `SYNARA_PI_SUBAGENT_ORPHAN_AFTER_MS` (default 60000,
range 1000–3600000, same resolver contract: nullish→default / range-check /
invalid→default, never clamped).

**Startup wiring (Decision 0013 F3 ticket-10 obligation):** `main.ts`
`makeServerProgram` forks the reconciliation child right after the server is
live: `recoverCompletionOutbox` (journal-first outbox recovery) runs FIRST,
then `reconcilePiSubagentExecutions({mode: "restart"})` with empty live-owner
probes (no session can exist at boot) and the configured summary bound. A
summary log line reports recovered/reconciled counts when nonzero. Recovered
pending outbox entries enter the fenced delivery path (the production
delivery consumer is Ticket 09's scope, per Decision 0013).

**Decision 0013 dispositions (owned by this ticket):**

- **F1 (clamp at journal→outbox recovery boundary):** `recoverCompletionOutbox`
  now re-clamps journal-extracted `summary` (default 2000, injectable within
  the accepted config range) and `transcriptRef` (1024) before creating
  entries — recovered outbox content can never exceed the bounded-evidence
  envelope even from legacy or future generic journal producers.
- **F2 (stale-terminal applicability):** `listTerminalEventsWithoutOutbox`
  now joins the current aggregate (`j.attempt_id = e.attempt_id AND
  j.generation = e.generation`), so inapplicable stale terminals are excluded
  from recovery outright — no transiently-pending stale entries, no
  superseded accounting churn; the first pump cannot deliver them.
- **F3 (startup invocation):** wired as described above.

**Ticket 07 F4 disclosure (cancelled-background reporter entry retention):**
out of this ticket's write set; it concerns the extension-side reporter
registry, not server reconciliation. Recorded as unchanged follow-up.

Contracts: new diagnostic codes `pi_subagent_owner_loss_orphaned`,
`pi_subagent_restart_reconciliation_failed`; new schemas
`PiSubagentLiveOwnerEvidence`, `PiSubagentTranscriptTerminalMarker`,
`PiSubagentReconciliationOutcome` (kind: `orphaned` / `running_refreshed` /
`terminal_restored` / `already_terminal` / `lease_not_expired`). No
migration: the orphan event reuses the journal table and existing columns
(generation advance is data, not schema).

### Changed production call chain

Server boot → `makeServerProgram` → forked child → `recoverCompletionOutbox`
(journal-first, clamped) → `reconcilePiSubagentExecutions(mode: "restart")` →
per execution: `listActive` probe match → `recordHeartbeatObservation`
(running_refreshed) | journal/transcript terminal → `recordTerminalEvent`
(terminal_restored, outbox atomic) | `recordOrphanedEvent` (orphaned,
fenced). Diagnostics surface: `Effect.logInfo("pi.subagent.startup-reconciliation")`
+ journal `diagnostic_code`/`diagnostic_message` on the execution record
(the projected diagnostic contract surface) + `onDiagnostic` observer seam
for session-attached paths.

### Review disclosure (pre-review)

- **No true process-kill test:** the accepted kill/rerestart seam is exercised
  as the honest post-restart VIEW (same durable state reconciled without any
  live-owner probe — exactly what a restarted process sees, since no
  in-process Pi child can survive server death) plus a REAL live child for
  the active-owner fixture. A real `kill -9` harness would test the OS, not
  the reconciliation contract; the durable-state view is the seam the
  approved Testing Seams describe.
- **Transcript-marker reader is an injectable seam, not production-wired:**
  production restart recovery restores outcomes from durable journal truth
  (already identity+generation-stamped). A production transcript-file reader
  requires the extension to report its output-file path at admission/started
  (an Alfie contract change) and belongs with the transcript surface
  (Ticket 12); the approved Testing Seams supply terminal-marker fixtures at
  this seam. The restoration code path is identical for both sources.
- **Journal-terminal restoration is defensive:** with the current atomic
  terminal writers, a current-attempt terminal journal row with a
  non-terminal aggregate is unreachable through public seams (recorded
  terminals always settle atomically); the journal branch protects future
  generic producers, and its `restoreTerminalOutcome` path is proven through
  the transcript-marker tests (same function).
- **Lease-expiry sweep driver:** Ticket 10 delivers the coordinator + config
  threshold; the periodic sweep DRIVER is Ticket 15 (watchdog escalation)
  scope. Ticket 10 wires the startup invocation (its Decision 0013
  obligation) and proves the lease-expiry reconciliation behavior at the
  seam.
- **Working-tree isolation note:** this implementation was completed while
  a parallel Ticket 09 stream worked in the same tree. Part of the
  ticket-10 infrastructure landed inside the ticket-09 stream's commit
  `98b9e990` (see the commit note below); the ticket-10 completion commit is
  `e58ff719`.

### Acceptance evidence matrix

| Criterion | Source evidence | Verification evidence | Result |
| --------- | --------------- | --------------------- | ------ |
| T10-AC1 | `recordOrphanedEvent` (journal band 50 + aggregate + diagnostic, guarded non-terminal, stale-generation guard, idempotent no-refence); coordinator evidence ladder — `running` is only ever kept by live-owner proof | piSubagentRestartReconciliation.test.ts AC1: orphan outcome + `observedState='orphaned'` + `diagnosticCode='pi_subagent_owner_loss_orphaned'` + durable diagnostic message + still in `listCancellableByParentTurn` (non-terminal) + second pass does not re-fence (same generation, one journal row); real-Pi acceptance: the no-owner view orphans the REAL detached child | pass |
| T10-AC2 | Coordinator terminal-evidence branch: journal rows for current attempt first, then transcript-marker seam with identity+generation+state matching; restore via idempotent `recordTerminalEvent` (aggregate + outbox atomic) | piSubagentRestartReconciliation.test.ts AC2: matching marker → `terminal_restored`/`succeeded` + pending outbox entry exists; stale-generation marker → orphaned (restores nothing) | pass |
| T10-AC3 | `findLiveOwnerEvidence`: executionId+attemptId+generation+isRunning match across probes; refresh via `recordHeartbeatObservation` (server clock) | piSubagentRestartReconciliation.test.ts AC3: `running_refreshed`, observed stays running, SAME attemptId/generation, heartbeat + re-derived lease updated; mismatched identity → orphaned; real-Pi acceptance: REAL bridge `listActive` record for the live detached child matches identity, refresh keeps running | pass |
| T10-AC4 | Coordinator input contract exposes NO dispatch surface (no spawn/resume/cancel calls anywhere); writes are journal/aggregate/orphan/heartbeat only | piSubagentRestartReconciliation.test.ts AC4: journal states exactly `[accepted, running, orphaned]`, no new attempts; coordinator source has no bridge dispatch invocation (structural) | pass |
| T10-AC5 | Orphan settlement advances generation (fence); repository generation gates make late events history-only; terminal path counts stale | piSubagentRestartReconciliation.test.ts AC5: late gen-1 terminal → `ignored_stale`/`superseded_generation`, `staleTerminalEvents=1`, aggregate stays `orphaned`; late generic `running` event → journaled, observed unchanged, generation still 2; real-Pi acceptance: the REAL child's late terminal after the no-owner orphan is counted (staleTerminalEvents ≥ 1) and observed stays `orphaned` | pass |
| T10-AC6 | `PI_SUBAGENT_OWNER_LOSS_DIAGNOSTIC_MESSAGE` (partial external/workspace side effects may already exist; inspect before resuming; not automatically replayed) persisted on the execution record (`rejectionReason`) + journal + `onDiagnostic` seam | piSubagentRestartReconciliation.test.ts AC6: message content assertions (side-effects/inspect/not-replayed) + durable persistence on the record + diagnostic observer receives it; real-Pi acceptance asserts the same message on the orphaned REAL execution | pass |
| T10-AC7 | Lease-expiry mode: server-side lease re-derivation (`last_heartbeat_at + leaseDurationMs + orphanAfterMs` vs server clock; stored lease never trusted; missing heartbeat = not liveness); live-owner still wins; `SYNARA_PI_SUBAGENT_ORPHAN_AFTER_MS` resolver (default 60000, 1000–3600000) + ServerConfigLive wiring | piSubagentRestartReconciliation.test.ts AC7: below threshold → `lease_not_expired` untouched; past threshold → orphaned; live owner past threshold → `running_refreshed`; configurable shorter threshold orphans earlier; config.test.ts 3 knob tests; main.test.ts production resolution test | pass |
| (Decision 0013 F1) | `recoverCompletionOutbox` clamps summary (≤2000 default) + transcriptRef (≤1024) at the journal→outbox boundary | F1 test: 50 000-char journal summary + 5 000-char ref recover bounded (≤2000/≤1024) | pass |
| (Decision 0013 F2) | `listTerminalEventsWithoutOutbox` applicability join (attempt/generation = current) | F2 test: stale superseded-attempt terminal journal row → recovery creates NO entry | pass |
| (Decision 0013 F3) | `main.ts` startup fork: recovery then restart reconciliation | main.test.ts config resolution; startup wiring compiled + typechecked; unit suites | pass |

### Failure and diagnostic evidence

- Settlement write failure: `pi_subagent_restart_reconciliation_failed`
  diagnostic + counted in `failures` (reconciliation never throws; the next
  pass retries).
- Orphan diagnostic: stable `pi_subagent_owner_loss_orphaned` with the
  T10-AC6 message, durable on the execution record and journal.
- Restore failure: terminal restoration write failure counts as a failure
  with no partial state (recordTerminalEvent is transactional).
- No-heartbeat execution in lease-expiry mode: treated as not-liveness
  (orphan-eligible once past the threshold), never as proof of running.
- Mixed-version extension: no bridge / no `getActiveExecutions` → probe
  absent → honest no-evidence path (orphan at restart), never a fabricated
  liveness claim.

### Verification runs

- `npx vitest run src/provider/piSubagentRestartReconciliation.test.ts` —
  12/12 pass (state machine + fixtures + F1/F2/delivery-path).
- `npx vitest run --project wallclock src/provider/piSubagentRestartAcceptance.test.ts`
  — 1/1 pass (real pinned extension `0.13.0-alfie.1`, provenance verified;
  real detached child, live bridge identity match, no-owner orphan, late
  stale terminal counted; 10.0s).
- Regression: PiSubagentExecutionRepository 12/12, piSubagentCompletionOutbox,
  piSubagentTerminalLifecycle, piSubagentCancellationCoordinator,
  piSubagentBridge, piSubagentRestartReconciliation — 98/98; config.test.ts +
  main.test.ts — 243/243; contracts piSubagents.test.ts — 13/13; wallclock
  per-file standalone: TerminalAcceptance 2/2, CancellationAcceptance 2/2
  (Decision 0008 binding method, clean env `env -i PATH HOME`).
- Server typecheck (`tsc --noEmit`): zero errors at the final commit.
- Full server unit project (pre-commit run): 4,558 passed / 7 failed /
  17 skipped — the 7 failures are the documented pre-existing
  `CursorTextGeneration.test.ts` environment failures (identical to the
  Ticket 07/08 reports).

### Commit note (shared working tree)

Ticket 10 was implemented while a parallel ticket-09 stream worked in the
same tree. The ticket-10 persistence/contract/config seams
(`listNonTerminalExecutions`, `recordOrphanedEvent`, the F1/F2 recovery
changes, the diagnostic literals, the orphan-after resolver and its tests)
landed inside the ticket-09 stream's commit `98b9e990` when it committed the
shared tree first; commit `e58ff719` adds the reconciliation coordinator,
startup wiring, wallclock acceptance file, and the ticket document that
complete ticket 10. Both commits are on `main`.
