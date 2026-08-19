# 16 — Owned process-tree teardown and fencing

**What to build:** When provider-session stop cannot prove cleanup, Synara
tears down only the process tree owned by the managed execution/session,
verifies that it is dead, fences the terminated generation, and reports any
survivor explicitly. Late callbacks or terminal events cannot revive the
execution or reverse its settled projection.

**Blocked by:** 15 — Watchdog escalation through provider-session stop.

**Status:** ready-for-agent

- [ ] **T16-AC1:** Teardown targets only process groups proven owned by the
      execution/provider session and cannot kill unrelated Synara or user
      processes.
- [ ] **T16-AC2:** The final escalation stage requests teardown once,
      idempotently, and records request, result, and proof status.
- [ ] **T16-AC3:** Completion requires process-tree liveness verification, not
      only a successful kill API return.
- [ ] **T16-AC4:** Surviving processes produce a stable uncertain-cleanup
      diagnostic and remain operationally visible.
- [ ] **T16-AC5:** Proven teardown fences the attempt and generation before
      projection settles; late events are ignored and counted.
- [ ] **T16-AC6:** Graceful cancellation and normal terminal paths never invoke
      process-tree teardown.
- [ ] **T16-AC7:** Server restart performs bounded orphan-process discovery and
      cleanup only where ownership can still be proven.

## Testing Seams

**Approval status:** Pending (conditional real-Pi bullet under owner review) —

- The two deterministic seam bullets below are **Approved** (owner,
  ticket-breakdown review 2026-08-16) and are implemented:
  - _Process supervisor integration boundary with owned, unrelated,
    surviving, graceful, and restart fixtures_ →
    `piSubagentProcessTeardown.test.ts` (coordinator + repository seams),
    `piSubagentProcessTeardownSweep.test.ts` (driver),
    `piSubagentTeardownWiring.test.ts` (adapter wiring),
    plus the pre-existing deterministic
    `supervisedProcessTeardown.test.ts` (TERM-ignored escalation,
    PID-reuse identity guard) and `PiAdapter.test.ts` "Pi Bash process
    supervision" (proof-before-release of an aborted command).
  - _Runtime-generation and projection integration boundary with late
    callback injection after proven teardown_ → the T16-AC5 test injects a
    late same-generation terminal through `ingestPiSubagentTerminal` after
    the proven fence and asserts history-only journaling (no aggregate
    revival), paired with the exact band-76 durable row and the exact
    `teardown_proven` operator event.
- The third bullet — _isolated real-Pi destructive boundary_ — is **NOT
  proven hermetic and deterministic in CI** (finding below) and is
  **awaiting owner approval of the deterministic-fixture substitution**
  before any substituted destructive test may be written.

**Hermeticity finding (2026-08-19, `/matt-implement` investigation):**
driving the real-Pi chain to a teardown handoff requires the watchdog's
stage timeouts to elapse against a live session (ack racing the ~4s
slow-model settlement), and the destructive outcome itself flips between
`proven` and `survivors` under CI load: the supervisor's exit proof polls
real `ps` output with identity-matched descendants on a 1.5s SIGKILL grace
window, and a loaded runner can exceed the poll window
(`ProviderProcessExitUnprovenError` → survivors) without any defect. The
test would also dispatch real OS signals into a shared CI machine. This
matches the class of wall-clock sensitivity Decision 0008 solved with
per-file standalone invocation, but the proven/survivors flip is inherent
to the destructive boundary rather than the harness. **Proposed
substitution (pending owner approval):** the deterministic
process-supervisor fixtures above carry the AC1–AC7 evidence; retain an
**isolated manual real-Pi verification recipe** instead of a CI wallclock
file: (1) start a Synara dev instance with a managed Pi session whose
child runs `bash -c "trap '' TERM; sleep 300"`; (2) force the watchdog
chain (idle trigger) to the teardown handoff; (3) observe band-75/76 rows
and the supervisor's TERM→KILL escalation in the process table; (4)
confirm the execution card settles `cancelled` with generation advanced.
No substituted test has been written pending this approval.

### Implementation Report

Implemented 2026-08-19 at the Symphony working tree (server-side only;
Alfie unchanged at `489acd626` / `0.14.0-alfie.1`).

**Change surface**

- `apps/server/src/provider/piSubagentProcessTeardown.ts` — the owned
  process-tree teardown coordinator. Journal band 75 (request,
  `pi_subagent_teardown_requested`, journal-only, deterministic idempotent
  eventId `teardownreq_<exec>_<attempt>_gen<gen>`) and the outcome bands
  (76 proven, 77 survivors, 78 owner_unproven — each kind has its OWN
  sequence so a later pass can escalate an earlier uncertain outcome to
  proven).
  Entry predicate: non-terminal execution + band-74 handoff row for the
  CURRENT attempt/generation (T16-AC6 — graceful cancel settles seq 92 and
  normal terminal settles band 40; neither ever journals 74). Dispatch is
  exclusively the OWNED supervisor resolution (T16-AC1): `undefined` (no
  live session context) → no kill, honest `owner_unproven` outcome (also
  the bounded restart case, T16-AC7; pass capped at 64 executions).
  `proven` is the ONLY settle path (T16-AC3): the repository transaction
  settles terminal `cancelled` AND advances the generation (proof-before-
  fence, T16-AC5, Decision 0021 F3). `survivors` journals the bounded
  survivor PID list (cap 16) with `pi_subagent_teardown_survivors` and
  leaves the projection `cancelling` (T16-AC4). Every outcome emits a
  stage-scoped operator diagnostic (fixed vocabulary + safe correlation).
- `apps/server/src/provider/piSubagentProcessTeardownSweep.ts` — the
  adapter-lifetime periodic driver (30s default, same cadence as the
  watchdog sweep; injectable `schedule`/`intervalMs` for tests).
- `apps/server/src/persistence/{Services,Layers}/PiSubagentExecutionRepository.ts`
  — two new seams: `recordTeardownRequested` (band 75, journal-only, stale-
  generation guard) and `recordTeardownOutcome` (per-kind band 76/77/78;
  `proven` settles `cancelled` + generation fence in the same guarded
  transaction; `survivors`/`owner_unproven` journal-only; terminal-truth-
  wins and stale-generation guards; dedup-race replay like
  `recordOrphanedEvent`; proven settlement notifies the lifecycle listener
  on band 76). No migration: the existing journal table and its
  UNIQUE(execution, attempt, generation, sequence) constraint enforce the
  one-row-per-identity semantics.
- `apps/server/src/provider/Layers/PiAdapter.ts` — production wiring: the
  teardown sweep resolves the owning session's `processSupervisor`
  (`teardownAll()` — the only kill authority; `ProviderProcessExitUnprovenError`
  survivor PIDs map to the `survivors` outcome), emits
  `subagents/teardown-diagnostic` runtime warnings through the ticket-15
  safe-correlation path, and stops in `stopAll`. New test seams:
  `piSubagentTeardownClock` and `piSubagentTeardownResolver`.
- `apps/server/src/main.ts` — T16-AC7 startup wiring inside the ticket-10
  startup reconciliation fork: a bounded teardown-discovery pass with
  `dispatchOwnedTeardown: () => undefined` (at boot no live owned
  supervisor can exist — nothing is killed; the `owner_unproven` evidence
  is journaled once per handed-off execution and surfaced to the operator
  log).
- `apps/server/src/provider/piSubagentLifecycleStates.ts` — new shared
  terminal-state vocabulary (`isTerminalPiSubagentState`); the teardown,
  cancellation, restart-reconciliation, and watchdog coordinators now use
  the single definition (review remediation).
- `packages/contracts/src/piSubagents.ts` — four new diagnostic literals:
  `pi_subagent_teardown_requested`, `pi_subagent_teardown_proven`,
  `pi_subagent_teardown_survivors`, `pi_subagent_teardown_owner_unproven`.

### Acceptance evidence matrix

| Criterion | Verification evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Result |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| T16-AC1   | Coordinator test (owned-only): exactly the handed-off execution dispatches; the unrelated live execution in the same scan set is never signalled. Adapter wiring test: dispatch resolves through the owning session's supervisor (`piSubagentTeardownResolver` / `processSupervisor.teardownAll`); no live session → `undefined` → no kill. Pre-existing deterministic `supervisedProcessTeardown.test.ts` proves the supervisor's TERM→KILL escalation with PID-reuse identity guards.                                         | pass   |
| T16-AC2   | Coordinator test (idempotent request): exactly one band-75 row and one band-76 row (deterministic eventIds under the journal UNIQUE constraint); request journaled BEFORE dispatch; a second pass re-dispatches nothing. Repository seam test: `recordTeardownRequested` replay → `already_applied`, superseded generation → `stale_generation`.                                                                                                                                                                                | pass   |
| T16-AC3   | Coordinator test: `survivors` (kill ran, exit unproven) NEVER settles — projection stays `cancelling`; only the liveness-verified `proven` dispatch settles. `PiAdapter.test.ts` "Pi Bash process supervision" proves an aborted command stays pending until process-tree exit is proven.                                                                                                                                                                                                                                       | pass   |
| T16-AC4   | Coordinator test: `pi_subagent_teardown_survivors` durable band-76 row with the bounded survivor PID list (cap 16 asserted) + exact operator event (stage `teardown_survivors`) + projection stays `cancelling`. Adapter wiring forwards the diagnostic to the `subagents/teardown-diagnostic` runtime-warning path.                                                                                                                                                                                                            | pass   |
| T16-AC5   | Coordinator + repository seam tests: `proven` settles `cancelled` and advances the generation to 2 in the same transaction (fencedGeneration asserted); a late same-generation terminal through `ingestPiSubagentTerminal` journals history-only without reviving the aggregate; paired exact durable-row (`pi_subagent_teardown_proven`) + operator-event assertions. Boundary test: a terminal landing between handoff and dispatch settles as ordinary lifecycle evidence (no premature fence — Decision 0021 F3 preserved). | pass   |
| T16-AC6   | Coordinator test: graceful cancellation (seq 90/92) and normal terminal (band 40) executions dispatch NOTHING (no band-74 row → not owned by teardown). The scan's non-terminal filter also skips anything settled between passes.                                                                                                                                                                                                                                                                                              | pass   |
| T16-AC7   | Coordinator restart fixture: no live owned supervisor → nothing killed, `pi_subagent_teardown_owner_unproven` journaled once (second pass adds zero rows — deterministic identity dedupe), projection stays `cancelling`; bounded pass (maxPerPass=2 of 3 handed-off executions). Adapter wiring test (session-less production path) + `main.ts` startup discovery pass with the same never-kill resolver.                                                                                                                      | pass   |

### Review remediation (2026-08-19, two-axis /matt-code-review)

The Standards and Spec reviewer sub-agents returned findings; all were
remediated in the same change:

1. **Spec MAJOR — outcome retry structurally blocked:** all three outcome
   kinds previously shared journal sequence 76, so a pass-1
   `survivors`/`owner_unproven` row made a pass-2 `proven` settle as
   `already_applied` (never journaling, never fencing) while the coordinator
   still reported `settled_proven`. Remediated: each outcome kind now has
   its OWN band (76 proven, 77 survivors, 78 owner_unproven) under the
   journal UNIQUE constraint, so a later pass CAN escalate an earlier
   uncertain outcome to proven. New test: survivors → proven escalation
   settles with the fence, both rows coexisting as distinct evidence,
   exactly one request row across passes.
2. **Truthful proven sequencing (Spec 2 / Standards 2):** the proven
   operator diagnostic is now emitted only AFTER the repository commit
   succeeds; the adapter's `onOutcome` correlation code is derived from the
   outcome kind by the sweep driver (never a hardcoded `proven` literal —
   survivors/owner_unproven no longer log under the proof code). The
   replay path reports the already-fenced state without claiming a new
   fence, and a proven outcome that loses an intra-transaction race is
   reported as `failed` (never a false settlement).
3. **Truthful dispatch-crash evidence (Spec 3):** a rejected dispatch is
   journaled with reason `dispatch_failed` and a message stating the
   teardown did NOT complete — no "0 survivors" claim for a teardown that
   never ran.
4. **AC5 "counted" proven (Spec a):** the late-terminal test now asserts
   the durable `staleTerminalEvents` counter incremented (through
   `getTerminalEvidence`), not just non-application.
5. **Bounded discovery hardened (Spec a/AC7):** the pass now caps SCANNED
   executions (not just dispatched outcomes) at `maxPerPass`, so a large
   non-terminal table cannot turn the restart scan into an unbounded
   loop; new test proves noise executions consume the scan budget before a
   handed-off execution.
6. **Tautological assertion removed (Spec d):** the AC2 test now asserts
   the exact request/outcome diagnostic codes on the durable rows.
7. **Standards — shared terminal-state vocabulary:** the sixth duplicated
   `Set(["cancelled", "succeeded", "failed", "rejected"])` prompted a new
   shared module `piSubagentLifecycleStates.ts` (`isTerminalPiSubagentState`);
   the teardown coordinator, cancellation coordinator, restart
   reconciliation, and watchdog escalation now use the single definition
   (the persistence layer's SQL-side set and test fixtures stay local by
   design).
8. **Standards — speculative generality removed:** the unused exported
   dispatch type alias was deleted; the journal-only request seam is wired
   directly into the repository object (no passthrough wrapper).

Judgement calls accepted as local and readable (noted, matching the
Ticket-15 disposition pattern): the handed-off-scan loop shape shared with
the watchdog sweep (only the predicate differs; extraction would churn the
accepted Ticket-15 surface), and the 4-field execution-identity object
inlined at call sites (a named type would be churn without behavior gain
at this size).

### Verification on 2026-08-19

- Ticket-focused suites (after review remediation): coordinator/repository
  17/17, sweep driver 2/2, adapter wiring 2/2 (21 tests across 3 files) —
  all green.
- Regression: watchdog coordinator 16/16, watchdog sweep 4/4, restart
  reconciliation, cancellation coordinator, terminal lifecycle, resume
  coordinator (90 tests across 8 files), repository layers 16/16, main
  42/42, card surface 9/9, PiAdapter 39/39.
- Full server unit suite (`bunx vitest run --project unit`): 391 files,
  4742 passed / 17 skipped.
- Contracts: 20 files / 231 tests passed.
- `bun fmt` clean; `bun lint` 0 errors (548 warnings, pre-existing class);
  `bun typecheck` 7/7 workspace tasks.
- Real-Pi destructive boundary: NOT exercised (see the Testing Seams
  hermeticity finding — substitution pending owner approval; no
  substituted test written).

### Invariants and residual risk

- No schema migration: bands 75/76 ride the existing journal table; the
  UNIQUE(execution, attempt, generation, sequence) constraint IS the
  one-row-per-identity authority.
- The teardown coordinator NEVER settles without supervisor proof; a
  `survivors` or `owner_unproven` outcome is retryable by the next sweep
  pass (deterministic identities keep the journal bounded — at most one
  outcome row per outcome kind per attempt/generation).
- `recordTeardownOutcome(proven)` requires the CURRENT attempt/generation
  and a non-terminal aggregate; terminal truth and newer attempts always
  win (journal-only `already_applied`/`stale_generation`).
- The restart discovery pass intentionally kills nothing: after a true
  server restart no live owned supervisor can exist, and no durable
  PID-ownership record survives the process (Pi child environments carry
  no Synara ownership marker by design — control-plane keys are stripped).
  Documenting that marker (e.g. a per-session stamped env var) would be a
  future project-scoped decision, not a ticket-local seam.
