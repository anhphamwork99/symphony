# 15 — Watchdog escalation through provider-session stop

**What to build:** A managed execution that exceeds idle or wall-time policy
enters a bounded, evidence-driven escalation sequence from child abort to
provider-turn interrupt to provider-session stop. Every stage is journaled,
waits for its stage-appropriate evidence, and preserves honest `cancelling`
state until termination is proved.

**Blocked by:** 06 — Durable parent-turn cancellation; 10 — Restart
reconciliation to terminal or orphaned; 13 — Admission quotas and safe
telemetry.

**Status:** needs-remediation

> **Decision 0021 (binding, 2026-08-19):** final acceptance returned
> NEEDS REMEDIATION — F1 (stage 2 must wait a bounded terminal-evidence
> window after interrupt dispatch, not advance on immediate observation),
> F2 (the terminal-evidence path must not journal the timeout diagnostic
> code), F3 (the AC6 evidence must not claim the teardown-handoff row fences
> same-generation terminals — Ticket 16 owns proof-before-fence). T15-AC1,
> T15-AC2, T15-AC5 stand accepted. See
> `decisions/0021-t15-watchdog-escalation-final-acceptance-remediation.md`.

### Implementation Report

Implemented 2026-08-19 at the Symphony working tree (files listed below).
All AC verification evidence is in the ticket-focused suites; wall-clock
real-Pi evidence runs standalone per Decision 0008.

**Change surface**

- `apps/server/src/provider/piSubagentWatchdogEscalation.ts` — the bounded
  escalation coordinator. Journal band 70–74 (one deterministic idempotent
  row per stage per attempt/generation): 70 escalation started, 71 child
  abort timeout, 72 provider-turn interrupt (command + observation), 73
  provider-session stop (command + result), 74 teardown handoff. Entry
  policy consumes the ticket 13 band-60 wall-time trigger for the CURRENT
  attempt/generation, or the re-derived idle policy
  (last_heartbeat_at + leaseDurationMs + orphanAfterMs against the server
  clock; the stored lease is never trusted). Stage 1 reuses the ticket 06
  `cancelParentTurnScope` protocol unchanged (seq 90/91/92 evidence
  settlement); stages 2–3 dispatch adapter-owned controls
  (`session.abort()`; `stopSession`) bounded by the stage timeout; uncertain
  or timed-out session stop journals the teardown handoff for Ticket 16 with
  the stable `pi_subagent_watchdog_cleanup_uncertain` diagnostic. The
  watchdog NEVER writes a terminal state — settlement flows exclusively
  through `recordCancelledAck` / `recordTerminalEvent` exactly once.
- `apps/server/src/provider/piSubagentWatchdogSweep.ts` — the adapter-
  lifetime periodic driver (30s default, same cadence as the wall-time
  sweep): this is the production lease-expiry sweep driver Ticket 10
  recorded as Ticket 15 scope.
- `apps/server/src/persistence/Services|Layers/PiSubagentExecutionRepository.ts`
  — new journal-only `recordWatchdogStageEvent` seam (mirrors the band-60
  pattern: eventId dedupe, current attempt/generation guard, NO aggregate
  mutation — a stage record is control evidence, never a lifecycle
  transition). No migration: the existing journal table and its
  UNIQUE(execution, attempt, generation, sequence) constraint enforce the
  one-row-per-stage identity.
- `packages/contracts/src/piSubagents.ts` — five new diagnostic-code
  literals (`pi_subagent_watchdog_walltime_escalation`,
  `…_idle_escalation`, `…_stage_timeout`, `…_cleanup_uncertain`,
  `…_session_stopped`).
- `apps/server/src/config.ts` + `main.ts` —
  `piSubagentWatchdogStageTimeoutMs` (`SYNARA_PI_SUBAGENT_WATCHDOG_STAGE_TIMEOUT_MS`,
  default 10s, 100–60000, invalid → default, never clamped). The idle
  threshold reuses `piSubagentOrphanAfterMs` (Ticket 10's knob — the
  driver it was waiting for).
- `apps/server/src/provider/Layers/PiAdapter.ts` — adapter wiring: the
  sweep resolves the live bridge per parent thread (managed +
  durable-cancellation capability only), stage 3 stops through the
  adapter's own `stopSession` (runtime disposal + process-tree teardown
  proof, reporting `"uncertain"` when the session is already gone or the
  stop fails), and every escalation offers one safe-correlation runtime
  warning (`subagents/watchdog-escalated`). Stopped in `stopAll`.
- `packages/contracts/src/server.ts` + repository `getTelemetrySnapshot` —
  `serverGetDiagnostics.piSubagents.watchdog` block: bounded journal-band
  counters plus escalation-start→teardown-handoff latency percentiles
  (T15-AC7).
- Each band row carries its own diagnostic code (escalation start uses the
  trigger code — wall-time/idle; child-abort timeout and timed-out stops use
  `pi_subagent_watchdog_stage_timeout`; a completed stop uses
  `pi_subagent_watchdog_session_stopped`; teardown handoffs use
  `pi_subagent_watchdog_cleanup_uncertain`), and the production sweep
  forwards every diagnostic through the adapter's safe-correlation
  `subagents/watchdog-diagnostic` runtime-warning path (AC1 entry
  diagnostics reach an operator surface durably).

### Acceptance evidence matrix

| Criterion | Verification evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Result |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| T15-AC1   | `piSubagentWatchdogEscalation.test.ts` (AC1): band-60 trigger consumed, entry diagnostic + journaled stage record, child abort via the ticket 06 protocol with the configured stage timeout; `piSubagentWatchdogSweep.test.ts` driver pass; config resolver matrix + production `ServerConfigLive` wiring test in `main.test.ts`                                                                                                                                                                                                                                  | pass   |
| T15-AC2   | `piSubagentWatchdogEscalation.test.ts` (AC2): missing child ack journals band 71 + dispatches the interrupt; desired stays `cancelling`, observed never terminal; real-Pi `piSubagentWatchdogAcceptance.test.ts` test 2 (300ms stage bound below the ~4s real settlement latency) advances through interrupt without any claim                                                                                                                                                                                                                                    | pass   |
| T15-AC3   | `piSubagentWatchdogEscalation.test.ts` (AC3): session-stop command + result journaled at band 73 (`dispatched`, `result: stopped/uncertain/timeout`); F1 test: the stage-2 evidence window fully elapsing without proof advances to exactly one session stop; real-Pi acceptance test 2 drives the full chain over a live session with the session-stop control stubbed `"uncertain"` (a live provider-session stop through the adapter's own `stopSession` is the production wiring; a destructive live-stop acceptance belongs with Ticket 16's teardown proof) | pass   |
| T15-AC4   | Coordinator tests (AC4 ×3): child ack settles through seq 92 exactly once with no further stages; terminal evidence between stages (band 40) stops the chain; F1 test: terminal evidence arriving on the second poll INSIDE the stage-2 evidence window stops the escalation before any session stop; real-Pi acceptance test 1: wall-time-expired REAL background child settles `cancelled` ONLY through the child acknowledgement, journal carries exactly one seq-92 row and no teardown handoff                                                               | pass   |
| T15-AC5   | Coordinator AC5 test (timeout-only: no evidence anywhere — projection non-terminal + desired cancelling through every stage); projection integration test in `piSubagentExecutionCardSurface.test.ts` (T15-AC5): the thread-detail snapshot card surfaces honest `cancelling` with the full band 70–74 journal and NO terminal journal row; real-Pi acceptance test 2 asserts the same against a live session                                                                                                                                                     | pass   |
| T15-AC6   | Coordinator AC6 test: hung session stop is bounded by the stage timeout, journaled `result: timeout`, stable `pi_subagent_watchdog_stage_timeout` + `pi_subagent_watchdog_cleanup_uncertain` diagnostics, teardown handoff at band 74. F3 boundary test (Decision 0021): the handoff row does NOT fence the current attempt/generation — a same-generation terminal before proven teardown still settles through the normal lifecycle; Ticket 16 owns proof-before-fence                                                                                          | pass   |
| T15-AC7   | Repository telemetry test (band-counter SQL aggregates + escalation-start→teardown-handoff latency percentiles) + `serverDiagnostics.test.ts` decode tests (both apps/server and packages/contracts) + sweep-driver operator-observation test asserting the safe-correlation diagnostic and escalation-outcome metadata that the adapter wiring projects into `subagents/watchdog-diagnostic` / `subagents/watchdog-escalated` runtime warnings                                                                                                                   | pass   |

### Verification on 2026-08-19

- Ticket-focused suites (after Decision 0021 remediation): coordinator 16/16,
  sweep driver 4/4, telemetry 17/17, config 198/198, main 42/42, card surface
  9/9, PiAdapter 39/39 — all green (341 tests across 10 files).
- Contracts suites: 20 files / 230 tests passed.
- Wall-clock real-Pi acceptance (`piSubagentWatchdogAcceptance.test.ts`),
  standalone per Decision 0008: **2/2 passed** against pinned Alfie
  `489acd626` (`0.14.0-alfie.1`).
- `bun fmt` clean; `bun lint` 0 errors (545 pre-existing warnings unchanged);
  `bun typecheck` passes for every workspace package this ticket touches
  (the remaining failures are the parallel Ticket-14 resume stream's
  in-flight edits in `apps/web` / orchestration files, outside this
  ticket's write set — see the commit note).

### Decision 0024 remediation (2026-08-19, fifth pass)

Decision 0024 found the terminal-evidence focused test captured but never
asserted its operator outcome (the assertions had landed in the wrong test
during the fourth pass). Remediated in the same commit: the
terminal-evidence test now asserts the exact stage-scoped operator pairing —
`pi_subagent_watchdog_terminal_evidence` @ `provider_turn_interrupt` present
and `pi_subagent_watchdog_stage_timeout` @ `provider_turn_interrupt` absent —
alongside its existing exact band-72 durable-row assertion. The no-evidence
test's stage-scoped pairing and band-71/band-72 distinction are unchanged;
F1/F3 protections are unchanged.

### Decision 0023 remediation (2026-08-19, fourth pass)

Decision 0023 reopened the acceptance (reopening condition 3 failed): the
band-72 no-evidence path had NO stage-2 operator emission, and neither
focused test asserted operator events. Remediated in the same commit:

1. The operator event now carries a fixed `stage` identity
   (`escalation_started` / `child_abort_timeout` / `provider_turn_interrupt`
   / `provider_session_stop` / `teardown_handoff` / `failure`), so codes
   shared across stages (notably `pi_subagent_watchdog_stage_timeout` at
   bands 71 and 72) are unambiguous on the operator surface.
2. The band-72 no-evidence window expiry now emits its OWN
   `provider_turn_interrupt`-stage `pi_subagent_watchdog_stage_timeout`
   operator event before stage 3 (previously the only emission of that code
   was the band-71 child-abort timeout).
3. The no-evidence test captured the operator stream and asserted the exact
   outcome-specific event by stage identity (`stage_timeout` @
   `provider_turn_interrupt` present, distinct band-71 `stage_timeout` @
   `child_abort_timeout` present, `terminal_evidence` absent). The
   terminal-evidence test's operator assertions were initially missing
   (caught by Decision 0024) and added in the fifth pass below.

### Decision 0022 remediation (2026-08-19, third pass)

Decision 0022 reopened the acceptance and closed F1/F3 while keeping F2 open
(the terminal-evidence path falsely used
`pi_subagent_watchdog_session_stopped`). Remediated in the same commit: new
contract literal `pi_subagent_watchdog_terminal_evidence` used consistently
on the band-72 terminal-evidence journal row and its operator diagnostic;
the timeout path keeps `pi_subagent_watchdog_stage_timeout`; both tests
assert the exact durable row and the exact operator event. Focused suites
16/16 + contracts 21/21 + standalone real-Pi acceptance 2/2 pass.

### Decision 0021 remediation (2026-08-19, second pass)

Supervisor final acceptance returned NEEDS REMEDIATION (Decision 0021) with
three findings; all three are remediated in the same commit:

- **F1 (stage-2 evidence window):** the provider-turn stage now covers BOTH
  the command dispatch and a bounded post-dispatch terminal-evidence window
  (poll-count-bounded `stageTimeoutMs / evidencePollMs`, injectable `wait`
  seam). A quickly resolving interrupt no longer advances while durable
  terminal evidence is inbound. New tests: delayed-before-deadline evidence
  prevents the session stop and settles by evidence; absent evidence through
  the window advances to exactly one session stop.
- **F2 (truthful diagnostics):** the interrupt band-72 row now records
  `pi_subagent_watchdog_terminal_evidence` (the new Decision-0022 literal:
  "applicable terminal evidence ended escalation" — neither a timeout nor a
  session stop that never happened) on the terminal-evidence path and
  `pi_subagent_watchdog_stage_timeout` on the timeout path, with assertions
  on the exact durable journal row for both outcomes; Decision 0023
  subsequently required and added the stage-2 operator emission and exact
  stage-scoped operator assertions for both outcomes.
- **F3 (proof-before-fence honesty):** the module docblock, this report, and
  a boundary test now state that the teardown-handoff row does NOT fence the
  current attempt/generation — a same-generation terminal before proven
  teardown remains ordinary first-applicable terminal evidence (Decision
  0012), and Ticket 16 owns proof-before-fence (T16-AC5).

### Review remediation (2026-08-19)

The two-axis `/matt-code-review` pass (Standards + Spec, independent
reviewer subagents) returned findings; all were dispositioned:

- Commit hygiene (Standards F1/F2): the first commit attempt accidentally
  included uncommitted parallel Ticket-14 hunks in shared files. Rebuilt as
  a ticket-15-only commit (`4373ed83` lineage) via hunk-level separation;
  the parallel stream's working tree was restored untouched, and the commit
  was verified buildable in a clean worktree (workspace `bun typecheck`
  7/7; 338 server + 230 contracts tests; wallclock acceptance 2/2).
- Cross-ticket band collision (Standards F3): the parallel Ticket-14
  stream's `recordResumeEvent` also journals sequence band 70, colliding
  with this ticket's watchdog band 70–74 under the journal UNIQUE
  constraint. Recorded as a coordination note in the commit message: the
  Ticket-14 stream must re-band resume before its acceptance; this ticket's
  band allocation stands as committed first.
- Idle trigger age guard (Spec S3): fixed — a null heartbeat no longer
  fires on the first sweep; the no-heartbeat age is measured from the
  aggregate's durable `updatedAt` (new test).
- Journal-failure coverage (Spec S4): added an injected-outage test proving
  the stable `pi_subagent_lifecycle_persistence_failed` diagnostic and an
  unwedged chain (Decision 0001 material failure coverage).
- Diagnostic-code fidelity + operator surface (Spec S5): per-stage codes on
  the band rows; production sweep forwards diagnostics to the adapter's
  safe-correlation `subagents/watchdog-diagnostic` runtime-warning path.
- Evidence-matrix accuracy (Spec S6): AC3/AC7 matrix lines corrected to
  state exactly what each seam proves.
- AC7 timing (Spec S7): escalation-start→teardown-handoff latency
  percentiles added to the telemetry watchdog block.
- Judgement-call smells (long escalateOne, small duplications, sweep option
  forwarding): accepted at this stage as local and readable; noted for a
  future refactor pass if the coordinator grows another stage.

### Invariants and residual risk

- No schema migration was added: the watchdog band rides the existing
  journal table; the UNIQUE(execution, attempt, generation, sequence)
  constraint IS the one-row-per-stage identity.
- Stage records are journal-only by design; if a future writer needs to
  mutate the aggregate from a watchdog stage, that is a new decision, not
  an extension of this seam.
- The idle trigger fires when a non-terminal execution has no heartbeat at
  all (missing heartbeat is never liveness evidence) — the age of the
  no-heartbeat state is measured from the aggregate's durable `updatedAt`,
  so a freshly admitted or just-resumed execution gets the full
  lease + idle threshold before escalation (review remediation: no
  first-sweep firing).
- Stage journal-record write failures are best-effort by design: the
  durable cancel intent (seq 90) is the authoritative control write, a lost
  observation row surfaces `pi_subagent_lifecycle_persistence_failed`, and
  the chain still dispatches (covered by an injected-outage test).

- [ ] **T15-AC1:** Idle or wall-time expiry records a watchdog diagnostic and
      starts child abort with a configured stage timeout.
- [ ] **T15-AC2:** Missing child acknowledgement advances to provider-turn
      interrupt without claiming stopped or cancelled.
- [ ] **T15-AC3:** Missing provider-turn terminal evidence advances to
      provider-session stop, with each accepted command and result journaled.
- [ ] **T15-AC4:** Acknowledgement or applicable terminal evidence at any stage
      stops escalation and settles through normal lifecycle exactly once.
- [ ] **T15-AC5:** Timer expiry alone is never termination proof, and projection
      remains cancelling/uncertain until stage evidence exists.
- [ ] **T15-AC6:** Session-stop timeout or uncertain cleanup produces a stable
      diagnostic and hands the owned execution to the process-teardown stage
      without allowing late events to claim success.
- [ ] **T15-AC7:** Stage timing, outcome, retries, and diagnostics are observable
      through the safe telemetry established by ticket 13.

## Testing Seams

**Approval status:** Approved — owner approval in the ticket-breakdown review
on 2026-08-16.

- **T15-AC1, T15-AC2, T15-AC3, T15-AC4, T15-AC5, T15-AC6:** Server
  orchestration/process integration boundary with controllable child,
  provider-turn, and provider-session fixtures.
- **T15-AC1, T15-AC7:** Wall-time and operator-observation boundary from ticket 13.
- **T15-AC2, T15-AC4:** Isolated real-Pi boundary for child abort and
  provider-turn interrupt, including acknowledgement timing.
- **T15-AC5:** Projection integration test proving no false stopped/cancelled
  state during timeout-only progression.
