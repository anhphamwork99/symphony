# 07 — Journal-first terminal lifecycle

**What to build:** Child terminal evidence becomes durable execution truth
before any completion notification. Terminal events are deduplicated and
generation-fenced; sequence gaps remain diagnosable; progress saturation cannot
discard terminal truth; and terminal payloads carry only bounded summaries and
authorized transcript references.

**Blocked by:** 06 — Durable parent-turn cancellation.

**Status:** ready-for-agent → implemented → **complete (accepted)**

**Final acceptance:** Accepted — Decision 0012 (2026-08-18), Symphony
`fe4d1fa3` + `d44f624f`, Alfie `bcfe6edda` + `608c1c57d` (`0.13.0-alfie.1`);
review F1/F2 remediated, F3–F5 recorded with follow-up owners (tickets
08/10).

- [x] **T07-AC1:** A terminal lifecycle event is durably appended and applied
      before any completion delivery may begin.
- [x] **T07-AC2:** Duplicate or replayed terminal events have exactly one state
      effect, and the first applicable terminal for an attempt wins.
- [x] **T07-AC3:** Attempt event sequence gaps emit a stable diagnostic without
      deleting or delaying an already-persisted terminal.
- [x] **T07-AC4:** Terminal from a superseded attempt or generation is ignored
      and counted and cannot overwrite current execution truth.
- [x] **T07-AC5:** Terminal payload contains a bounded result summary and
      transcript reference, never unbounded raw transcript output.
- [x] **T07-AC6:** Terminal persists when progress ingress is saturated or its
      observation sink is degraded.
- [x] **T07-AC7:** Cancellation and normal completion racing for the same
      attempt resolve through one applicable terminal owner without state flip-flop.

## Testing Seams

**Approval status:** Approved — owner approval in the ticket-breakdown review
on 2026-08-16.

- **T07-AC1, T07-AC2, T07-AC3, T07-AC4, T07-AC7:** Server runtime-journal and
  orchestration integration boundary with replay, sequence-gap, stale attempt,
  and cancel-versus-complete race fixtures.
- **T07-AC2, T07-AC4:** Terminal lifecycle state-machine contract.
- **T07-AC5:** Isolated real-Pi completion boundary — emit a real completion and
  inspect bounded summary and transcript reference.
- **T07-AC6:** Shared provider-ingress saturation harness from ticket 05.

## Implementation Report

**Implementation state:** accepted — Decision 0012 (2026-08-18)

### Delivered scope

Journal-first terminal lifecycle for managed Pi subagent executions, spanning
both repositories (Symphony + Alfie extension). On the Symphony side: a
dedicated `recordTerminalEvent` repository seam (one transaction: dedup →
sequence-continuity evidence → journal insert → guarded aggregate UPDATE),
first-applicable-terminal-wins with a durable `stale_terminal_events` counter
(migration 101 adds the counter plus `terminal_summary` /
`terminal_transcript_ref` bounded-evidence columns), a fix for the pre-existing
flip-flop hole in the generic `recordLifecycleEvent` terminal path (a terminal
journal event can no longer overwrite an already-terminal aggregate), a new
`piSubagentTerminalCoordinator` (`ingestPiSubagentTerminal`) that bounds the
summary server-side, journals first, emits the stable
`pi_subagent_event_sequence_gap` diagnostic WITHOUT deleting or delaying the
terminal, counts stale terminals with `pi_subagent_terminal_stale_ignored`,
and notifies completion consumers (`onTerminalPersisted` — the Ticket 08
outbox seam) ONLY after the durable commit. Terminal persistence failure
degrades control health (`pi_subagent_terminal_persistence_failed`) and never
notifies. `PiAdapter.reportObservation` gained the `terminal` kind routed
directly to the coordinator — it never enters the progress coalescer
(T07-AC6). Config knob `SYNARA_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS`
(default 2000, range 64–32768, nullish→default / range-check /
invalid→default). Contracts: capability `journal-terminal-lifecycle`,
diagnostic codes `pi_subagent_event_sequence_gap` /
`pi_subagent_terminal_stale_ignored` /
`pi_subagent_terminal_persistence_failed`, and the bounded
`PiSubagentTerminalEvidence` schema. On the Alfie side (commit `bcfe6edda`,
`0.13.0-alfie.1`): a `terminal` observation kind carrying ONLY a bounded
summary (2000-char producer cap) plus the output-file transcript reference;
`buildManagedTerminalPayload` maps completed/steered→succeeded,
error→failed, and yields NO payload for aborted/stopped records (the durable
cancel path owns cancellation settlement — T07-AC7); the INLINE foreground
settlement awaits the terminal observation BEFORE returning the result handle
(persistence failure returns an error-shaped result); the post-detach
settlement continuation reports the terminal exactly once (fire-and-forget);
managed BACKGROUND spawns register an identity-fenced terminal reporter
consumed exactly-once by the generation-guarded AgentManager `onComplete`
callback; managed foreground children now stream their transcript to an
output file so terminal evidence carries an authorized transcript reference.
Attempt-local terminal sequence band: 40 (deterministic eventId
`terminal_<execution>_<attempt>_gen<gen>_<state>`; dedup also by the
attempt/generation/sequence key).

### Changed production call chain

Extension child settlement → `reportObservation({kind: "terminal", terminal:
{state, summary, transcriptRef, outcomeState, diagnosticMessage}})` →
`PiAdapter.reportObservation` terminal branch (validation: state
succeeded|failed + string summary) → `ingestPiSubagentTerminal`
(piSubagentTerminalCoordinator: server-side truncation at the resolved config
cap → `repository.recordTerminalEvent` transaction → continuity/gap +
ignored-stale diagnostics → post-commit `onTerminalPersisted` → adapter emits
`subagents/terminal-settled` runtime event). Failure path:
`onTerminalPersistenceFailed` → `adapterControlHealth.markDegraded` +
`offerSubagentControlHealthWarning` + producer rejection
(`pi_subagent_terminal_persistence_failed`). Terminal evidence sources on the
extension: inline foreground settlement (awaited), post-detach continuation
(fire-and-forget), background `onComplete` (registered reporter, identity
fenced, generation guarded).

### Review disclosure (pre-review)

- **Mixed-version safety:** an extension without `journal-terminal-lifecycle`
  never reports `terminal` observations; the server's terminal branch then
  simply never fires for that session (legacy behavior, no diagnostics). The
  capability is structural gating (the extension only sends what it
  implements), not a server-side dispatch decision.
- **Detached-terminal failure surface:** for a DETACHED foreground child or a
  BACKGROUND child, terminal observation delivery is fire-and-forget — the
  host degrades control health on persistence failure, but the extension
  cannot reject a tool call that already returned. Restart reconciliation
  (Ticket 10) owns recovery of un-persisted terminals after process death.
- **Sequence-gap diagnostic is advisory:** the gap is reported with a stable
  code but the journal accepts the event regardless (per T07-AC3 the terminal
  is never delayed); ordering repair belongs to diagnostics consumers.

### Acceptance evidence matrix

| Criterion | Source evidence                                                                                                                                                                                                                                | Verification evidence                                                                                                                                                                                                                                                                                                                        | Result |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| T07-AC1   | `recordTerminalEvent` single-transaction journal+aggregate; `ingestPiSubagentTerminal` notifies only post-commit; inline extension path awaits the terminal observation before returning the handle                                            | piSubagentTerminalLifecycle.test.ts: notify ordering assertion (notify precedes `after-ingest` while durable state is already terminal); real-Pi acceptance test 1 asserts `succeeded` durable with NO settling sleep before the handle returns; failure-surface test proves persistence failure never notifies                              | pass   |
| T07-AC2   | Deterministic eventId + attempt/generation/sequence dedup; sequence-dedup returns already_applied; first-terminal-wins guard on the aggregate UPDATE; stale counter for racing terminals                                                       | piSubagentTerminalLifecycle.test.ts: exact replay → already_applied, no new journal row; different-state racer at the same attempt-local sequence → already_applied with zero state effect; generic-path guard test proves a second distinct terminal cannot overwrite `cancelled`                                                           | pass   |
| T07-AC3   | `continuity` evidence (attempt-local prior max) computed pre-insert; `pi_subagent_event_sequence_gap` stable diagnostic; no deletion/delay anywhere in the path                                                                                | piSubagentTerminalLifecycle.test.ts: gap test (terminal at 40 after admission at 1 → diagnostic fired, terminal persisted, aggregate succeeded); control test (sequences 2..39 filled → no diagnostic)                                                                                                                                       | pass   |
| T07-AC4   | Stale classification pre-mutation: superseded attempt/generation → journaled history + `stale_terminal_events` increment, aggregate untouched                                                                                                  | piSubagentTerminalLifecycle.test.ts: late attempt-1 terminal after resume to attempt-2 → ignored_stale (superseded_attempt), newer attempt still running, counted=1, then attempt-2 terminal applies                                                                                                                                         | pass   |
| T07-AC5   | Server-side truncation at the resolved cap before persistence/emission; `terminal_summary`/`terminal_transcript_ref` columns; extension 2000-char producer bound + output-file reference                                                       | piSubagentTerminalLifecycle.test.ts: 50 000-char summary stored ≤512 at knob 512 and ≤2000 at default; real-Pi acceptance tests 1+2 assert bounded summary ≤1500 and a real on-disk transcript artifact (existsSync)                                                                                                                         | pass   |
| T07-AC6   | Terminal branch bypasses the progress coalescer entirely; reserved durable path independent of observation-sink health                                                                                                                         | piSubagentTerminalLifecycle.test.ts: degraded-sink test (200 failing progress writes, terminal still persists, exactly one terminal row); saturation-harness test (5 000-observation flood on the REAL coalescer with structural bounds asserted mid-flood, terminal persists while a progress slot is pending, flood accounting reconciles) | pass   |
| T07-AC7   | Extension sends no terminal for aborted/stopped (cancel owns settlement); repository first-terminal-wins guard means late terminal vs settled `cancelled` → ignored_stale, and late cancelled-ack vs settled `succeeded` journals history only | piSubagentTerminalLifecycle.test.ts race A (cancelled settles first → late succeeded terminal ignored_stale, counted, no flip-flop) and race B (succeeded terminal first → late cancelled ack cannot regress); Alfie managed-terminal.test.ts proves no payload for aborted/stopped                                                          | pass   |

### Failure and diagnostic evidence

- Terminal persistence failure: `pi_subagent_terminal_persistence_failed`,
  control-health degradation, producer rejection (inline) — never a silent
  success-shaped handle (coordinator test + Alfie managed-terminal test 3).
- Sequence gap: `pi_subagent_event_sequence_gap` runtime warning with prior
  max and attempt/generation context; the terminal remains persisted.
- Stale terminal: `pi_subagent_terminal_stale_ignored` runtime warning with
  reason and count; current truth unchanged.
- Malformed terminal observation at the adapter: explicit throw (invalid
  kind/state/summary shape), never a silent drop.
- Mixed-version extension: no terminal observations sent; no terminal
  claims made (structural gating via capability).

### Verification runs

- `npx vitest run src/provider/piSubagentTerminalLifecycle.test.ts` — 12/12
  pass (state machine + degraded sink + saturation harness over the REAL
  repository/coalescer).
- `npx vitest run src/provider/piSubagentTerminalAcceptance.test.ts` — 2/2
  pass (wallclock project, per-file standalone against the pinned extension
  `0.13.0-alfie.1` @ Alfie `bcfe6edda`; deterministic loopback model).
- All wallclock suites, per-file standalone (Decision 0008 binding method):
  ForegroundAcceptance 6/6, ForegroundReopen 1/1, ForegroundLifecycle 5/5,
  RealExtension 11/11, ProgressAcceptance 1/1, IntegratedAcceptance 7/7,
  CancellationAcceptance 2/2, TerminalAcceptance 2/2.
- Alfie extension suite: 31 files / 491 tests pass (including the new
  3-test managed-terminal suite; bounded-foreground + synara-bridge
  expectations updated for the terminal kind and version).
- Migration suites updated for migration 101 and green: Migrations.test.ts
  21/21, MigrationLineageReconciliation 4/4, MigrationReplay 3/3;
  PiSubagentExecutionRepository 12/12, piSubagentBridge 38, cancellation
  coordinator 12, progress observation/saturation green.
- Config suite: 171/171 (3 new knob tests); main.test.ts 39/39 (new
  ServerConfigLive resolution test for the terminal knob).
- Full server unit project: 4514 passed / 7 failed — the 7 failures are the
  pre-existing `CursorTextGeneration.test.ts` environment failures (Cursor
  ACP unavailable; the same pre-existing set documented in the Ticket 06
  report, reproduced identically without this ticket's changes).
- `bun run typecheck` (workspace, 7 packages): pass. `bun run lint`: 0
  errors (527 warnings, matching the pre-change baseline). `oxfmt`: applied;
  planning/notification reformat noise reverted.
- Harness note: full-file wallclock runs under the Pi-agent environment can
  crash the vitest worker via the `~/.pi` runtime's epipe-guard/signal-exit
  shim (`process.exit(1)` from a fatal exception in `.pi/agent/extensions/…`).
  With a clean environment (`env -i PATH HOME`), the identical invocation is
  green and stable (verified repeatedly for RealExtension 11/11). This is
  harness-environment noise, not a regression; standalone per-file invocation
  in a clean environment is the verification method recorded above.

### Independent review outcome (2026-08-18)

**Verdict:** PASS — T07-AC1..AC7 all pass, confidence High (reviewer
independently reproduced every verification claim: terminal lifecycle 12/12,
terminal acceptance 2/2 wallclock, all eight wallclock suites per-file,
Alfie 31 files/491 tests, migration suites, config/main, full unit project
with only the 7 pre-existing CursorTextGeneration environment failures, tsc
exit 0 both repos, provenance hashes recomputed byte-exact). Full report:
[reviews/07-journal-first-terminal-lifecycle-review.md](../reviews/07-journal-first-terminal-lifecycle-review.md).

Findings F1 (MEDIUM), F2–F4 (LOW), F5 (INFO) — none blocking.

**Review remediation applied:**

- **F1 (MEDIUM, mixed-version skew):** the server handshake now advertises
  `journal-terminal-lifecycle` in `optionalCapabilities`, and the extension
  records that advertisement at handshake time and gates ALL terminal
  reporting (inline, post-detach, background) on it. Old server + new
  extension degrades to legacy behavior: no terminal observations sent, the
  inline tool result keeps its success shape (Alfie commit `608c1c57d`, new
  mixed-version gate test in managed-terminal.test.ts, suite 31/492).
- **F2 (LOW, unbounded metadata strings):** the coordinator now bounds
  `transcriptRef` (1024), `outcomeState` (256), and `diagnosticMessage`
  (2048) server-side in addition to the summary cap; terminal lifecycle and
  acceptance suites re-run green.
- **F3 (LOW, coordinator MAX guard asymmetry), F4 (LOW, cancelled-background
  reporter entry retention), F5 (INFO):** recorded for the Ticket 08/10
  touchpoints; no correctness effect.
