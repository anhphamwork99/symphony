# Ticket 15 — Watchdog escalation through provider-session stop

## Feature-level review evidence package (two-axis /matt-code-review)

- **Reviewed commit:** `262785a8` (ticket-15-only, self-contained; rebuilt from the
  contaminated first attempt `0fe8e7c9`/`e4c6b815` which had accidentally staged
  parallel Ticket-14 hunks — see remediation below).
- **Base:** `e6bbe868` (Decision 0020 planning commit).
- **Reviewer:** two independent reviewer subagents (Standards axis, Spec axis)
  against the first candidate `0fe8e7c9`; every finding was then dispositioned
  and remediated in the rebuilt commit `262785a8`.
- **Ticket:** `issues/15-watchdog-escalation.md` (approved Testing Seams,
  2026-08-16). Strategy record: `decisions/0001-testing-strategy-governance.md`.

## Standards axis (verbatim findings)

Verdict: FAIL (against the first candidate `0fe8e7c9`) — all three hard
violations remediated in `262785a8`:

1. **Commit not buildable** — `PiAdapter.ts:165` imported the untracked
   `piSubagentResumeCoordinator.ts` (parallel stream file). → Remediated:
   hunk-level split; the rebuilt commit typechecks 7/7 workspace tasks in a
   clean `git worktree` (`bun install --frozen-lockfile && bun typecheck`).
2. **Undisclosed parallel-stream payload** (cadence rule: document splits in
   the commit note). → Remediated: rebuilt as ticket-15-only; the parallel
   stream's working tree restored untouched; commit note documents the
   incident and the split.
3. **Journal band-70 collision** — the parallel Ticket-14 `recordResumeEvent`
   also journals sequence 70, colliding with watchdog band 70–74 under
   UNIQUE(execution, attempt, generation, sequence). → Dispositioned as a
   cross-stream coordination note in the commit message: Ticket-14 must
   re-band resume before its own acceptance; Ticket-15's allocation stands
   (committed first, tested, telemetry-keyed).

Judgement calls (Fowler, not violations): long `escalateOne`, small
duplications (cleanup-uncertain blocks, defaults, band literals), sweep option
forwarding (Middle Man), docblock wording, production
`isOwnerGenerationDead: () => false` (honest live-session seam, mirrors
ticket 06 wiring). Accepted at this stage; noted in the ticket report.

## Spec axis (verbatim findings, dispositioned)

1. Commit corruption (same as Standards F1/F2) → remediated as above.
2. Undisclosed Ticket-14 content → remediated as above.
3. **Idle trigger fired immediately on null heartbeat** (no age guard) →
   FIXED: the no-heartbeat age is measured from the aggregate's durable
   `updatedAt`; a fresh admission/resume gets the full lease+idle threshold.
   New test: first sweep does not escalate a freshly admitted execution.
4. **Journal-write failures swallowed without coverage** (Decision 0001
   material-failure rule) → FIXED: injected-outage test asserts the stable
   `pi_subagent_lifecycle_persistence_failed` diagnostic, the durable cancel
   intent (seq 90) still journals, and the chain still dispatches/settles.
5. **Diagnostic-code mislabeling + entry diagnostics dropped in production
   sweep** → FIXED: per-stage codes on band rows (trigger code at start,
   stage_timeout, session_stopped, cleanup_uncertain); the sweep forwards
   `onDiagnostic` to the adapter's safe-correlation
   `subagents/watchdog-diagnostic` runtime-warning + log path.
6. **Evidence-matrix overclaims** → CORRECTED in the ticket: AC3 line now
   states the acceptance test stubs the session stop as `"uncertain"` (a
   destructive live-stop acceptance belongs with Ticket 16's teardown
   proof); AC7 line states exactly which seam asserts the operator surface
   (sweep-driver operator-observation test; adapter wiring projects the same
   metadata into runtime warnings).
7. **AC7 lacked timing/retries** → latency added: escalation-start →
   teardown-handoff percentiles (`escalationLatencyMs` p50/p95/max) in the
   telemetry watchdog block; retries remain observable through the
   cancel-protocol journal (dispatch attempts in stage-1 diagnostics) and
   band counters.

## Post-remediation verification (clean worktree at `262785a8`)

- Workspace `bun typecheck`: 7/7 tasks pass.
- Ticket-focused server suites: 338 tests / 10 files pass (coordinator 13,
  sweep driver 4, telemetry 17, config 198, main 42, card surface 9,
  PiAdapter 39, wall-time/cancellation regression).
- Contracts: 20 files / 230 tests pass.
- Real-Pi wallclock acceptance `piSubagentWatchdogAcceptance.test.ts`:
  2/2 standalone per Decision 0008, pinned Alfie `489acd626`
  (`0.14.0-alfie.1`), proving stage-1 child-abort settlement exactly-once on
  child acknowledgement and timeout-only honest-cancelling progression.
- `bun fmt` clean; `bun lint` 0 errors (545 pre-existing warnings unchanged).

## Verdict

Standards axis: PASS after remediation (buildable, self-contained, cadence
documented). Spec axis: PASS after remediation (all seven findings closed or
correctly dispositioned; AC1–AC7 evidence intact at the approved seams).
