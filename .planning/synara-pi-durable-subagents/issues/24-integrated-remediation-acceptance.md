# 24 — Integrated remediation acceptance and review closure

**What to build:** One hermetically isolated acceptance path demonstrates that
the reviewed defects in tickets 01–05 are fixed in the integrated production
system. It uses the actual Pi Agent extension and real server persistence to
prove safe migration, complete capability negotiation, atomic authorized
admission, fail-closed degradation and recovery, bounded foreground detach,
coalesced progress, durable heartbeat lease, reconnect/reopen behavior, and
legacy fallback. It produces a complete reviewer-ready evidence package and is
the sole gate for starting ticket 06.

**Blocked by:** 18 — Reconcile released migration lineages; 19 — Complete
real-Pi capability negotiation; 20 — Atomic authorized production admission;
21 — Production fail-closed control health; 22 — Real bounded foreground
attachment; 23 — Production progress, heartbeat leases, and saturation control.

**Status:** accepted (Decision 0010, 2026-08-18) — Symphony 625d256a + Alfie d35644a3b

- [x] **T24-AC1:** Migration lineage and three-history compatibility evidence
      from ticket 18 passes in the integrated candidate.
- [x] **T24-AC2:** Actual Pi session negotiation proves complete required
      capabilities and safe compatible, partial, unsupported, failing, and legacy
      behavior.
- [x] **T24-AC3:** Actual managed Agent spawn proves trusted authorization,
      atomic durable identity, concurrent replay idempotency, and child start only
      after admission.
- [x] **T24-AC4:** Persistence failure proves no child start, no partial truth,
      degraded health, repeated fail-closed admission, existing-truth preservation,
      and successful fresh admission after recovery.
- [x] **T24-AC5:** Fast and long actual children prove inline completion and
      bounded detach with stable identity, parent-turn scope, durable running
      observation, and reopen recovery.
- [x] **T24-AC6:** Actual progress and heartbeat plus deterministic saturation
      prove rate limits, latest snapshot, durable lease, bounded memory, lifecycle
      reserve, transcript isolation, reconnect, and cleanup.
- [x] **T24-AC7:** Every original criterion in tickets 01–05 has a
      reviewer-reproducible source and verification evidence row; none relies only
      on a synthetic Agent fixture.
- [x] **T24-AC8:** All focused suites and migration checks pass from a clean,
      documented environment; every command, exit code, test count, relevant
      warning, and working-tree state is recorded.
- [x] **T24-AC9:** An independent reviewer finds no critical or high defect
      against tickets 01–05 and reconciles the implementation reports before this
      ticket can be accepted.
- [x] **T24-AC10:** Tickets 01–05 are marked complete again only after AC1–AC9
      pass; ticket 06 remains blocked before that point.

## Testing Seams

**Approval status:** Approved — owner approved the remediation breakdown and
known seams on 2026-08-16.

- **T24-AC1:** Integrated server startup over fresh, Symphony, and
  upstream-v0.7.2 database histories.
- **T24-AC2, T24-AC3, T24-AC4, T24-AC5, T24-AC6:** Hermetically isolated actual
  Pi Agent → production Synara server → durable persistence → WebSocket
  observation boundary.
- **T24-AC6:** Deterministic saturation harness remains a required secondary
  seam; it cannot replace actual-Pi progress evidence.
- **T24-AC7, T24-AC8, T24-AC9:** Implementation-report evidence package,
  focused verification commands, clean-state audit, and one independent
  criterion-level review.
- **T24-AC10:** Project tracker state — original tickets and downstream frontier
  change only after acceptance evidence is complete.

## Implementation Report

**Implementation state:** implemented — report complete pending independent
review (AC9/AC10 pending review + final acceptance)

### Delivered scope

One integrated acceptance path
(`apps/server/src/provider/piSubagentIntegratedAcceptance.test.ts`, 7 sequenced
stages over a shared hermetic fixture, wallclock project) chaining database
startup over three migration histories → real pinned-extension handshake matrix
(compatible / stripped-capability mismatch / failing bridge / legacy) → atomic
authorized admission with replay idempotency and denial → fail-closed
degradation and recovery → bounded detach with real-chain database reopen →
real progress/heartbeat/lease plus deterministic saturation, lifecycle reserve,
rate-capped runtime-event evidence, and cleanup. Plus the reviewer-ready
evidence package below (AC7 matrix, AC8 verification log).

### Changed production call chain

No production code changed in ticket 24 (acceptance gate). The integrated path
exercises the full production chain end-to-end on a file-backed database:
startup (Migrator over migrations 1→100 on fresh/Symphony/upstream histories)
→ PiAdapter.startSession with the real pinned extension (provenance-verified at
test start) → probePiSubagentBridge negotiation → wrapAgentTool →
admitSubagentSpawn → recordAdmission (atomic journal seq1 + aggregate) → real
child via AgentManager/startForeground against the loopback deterministic model
→ started(seq2)/detached(seq3) journal → producer progress/heartbeat →
PiAdapter dispatch → piSubagentProgressCoalescer → tool.progress runtime events

- UPDATE-only durable observation (migration-099 columns) → real-chain reopen
  (fresh persistence layer over the same SQLite file → same aggregate/journal/
  observation) → stopSession cleanup (attachments/timers/coalescer release).

### Acceptance evidence matrix

| Criterion | Source evidence                                                                                                                                                                                  | Verification evidence                                                                                                                                                                                                                                                                                                                                                                                 | Result  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| T24-AC1   | Integrated stage 1: three-history construction (fresh file / Symphony lineage `[90..100]` with 97 re-run / upstream v0.7.2 `[97,98,99,100]`) + Migrator boot + repository round-trip per history | `bun run test src/provider/piSubagentIntegratedAcceptance.test.ts` stage 1 green (convergence through 100, tracker complete, second-run no-op, observation round-trip with exact lease math per history); lineage checker `node scripts/check-migration-lineage.ts` exit 0                                                                                                                            | pass    |
| T24-AC2   | Integrated stage 2: real pinned extension + stripped-capability copy + failing bridge fixture + legacy no-bridge                                                                                 | Stage 2 green: managed_enabled with all four capabilities incl. coalesced-progress; stripped copy → capability_mismatch, Agent tool unwrapped, zero admissions/journal; failing bridge → pi_subagent_bridge_error; legacy → bridge_absent; provenance SHA-256 verified at start                                                                                                                       | pass    |
| T24-AC3   | Integrated stage 3: authority-bound fast child, same-commandId replay, second spawn, revoked authority                                                                                           | Stage 3 green: seq1 accepted → seq2 started; inline completion "ACK" with model request log growth; replay → same executionId/attemptId, already-applied, zero new journal rows; distinct identities for second spawn; revoked → pi_subagent_admission_unauthorized, zero model requests, durable rejected row                                                                                        | pass    |
| T24-AC4   | Integrated stage 4: injectable recordAdmission failure over the live file DB + shared control health                                                                                             | Stage 4 green: failure → no child (request log unchanged), pi_subagent_lifecycle_persistence_failed, health degraded; second attempt while degraded fails closed; stage-3 truth unchanged; fail-flag cleared + fresh commandId → admitted + started, health available                                                                                                                                 | pass    |
| T24-AC5   | Integrated stage 5: slow child (4 s/turn) with 300 ms budget + real-chain reopen                                                                                                                 | Stage 5 green: detach envelope 303–310 ms vs budget+500 = 800 ms (asserted, standalone method); stable executionId/attemptId/generation; cancellationScope parent_turn; journal [1,2,3] with detached metadata; reopen (fresh persistence layer over same file) → identical aggregate (running), journal [1,2,3], observation restored; inline-completion leg proven in stage 3                       | pass    |
| T24-AC6   | Integrated stage 6: real slow child progress/heartbeat + 2000-observation deterministic flood on the real schedule + duplicate-lifecycle + cleanup                                               | Stage 6 green: lastProgressJson non-null with real payload (no spinnerFrame), lastHeartbeatAt/leaseExpiresAt with lead exactly 3000 ms configured; flood → tool.progress ≤ ceil(elapsed×rateHz)+1, dropped+emitted == 2000 exactly; duplicate detached → journal idempotent [1,2,3]; bridge activeAttachmentCount/activeTimerCount 0; post-stop idle-TTL wait → no further events (coalescer release) | pass    |
| T24-AC7   | Second matrix below (31 criteria) — every row cites a real-Pi reproduction in RealExtension / ForegroundAcceptance / ProgressAcceptance / IntegratedAcceptance                                   | See matrix; none synthetic-only                                                                                                                                                                                                                                                                                                                                                                       | pass    |
| T24-AC8   | Verification log below                                                                                                                                                                           | All commands recorded with exit codes/counts; workspace fmt/lint/typecheck exit 0                                                                                                                                                                                                                                                                                                                     | pass    |
| T24-AC9   | Pending                                                                                                                                                                                          | Independent criterion-level review to run after this report                                                                                                                                                                                                                                                                                                                                           | pending |
| T24-AC10  | Pending                                                                                                                                                                                          | Tickets 01–05 status flips only after AC9 + final acceptance; PROJECT.md frontier then advances to ticket 06                                                                                                                                                                                                                                                                                          | pending |

### Second matrix — every original T01–T05 criterion mapped

Legend: evidence files — INT = piSubagentIntegratedAcceptance.test.ts (this
ticket), RE = piSubagentRealExtension.test.ts, FA = piSubagentForegroundAcceptance.test.ts,
PA = piSubagentProgressAcceptance.test.ts, FR = piSubagentForegroundReopen.test.ts,
PO = piSubagentProgressObservation.test.ts, PS = piSubagentProgressSaturation.test.ts,
AC = piSubagentAdmissionCoordinator.test.ts, AG = piSubagentAdmissionGuard.test.ts,
CH = piSubagentControlHealth.test.ts, REP = persistence/Layers/PiSubagentExecutionRepository.test.ts,
BR = piSubagentBridge.test.ts, SE = piSubagentSession.test.ts, MLR = Migrations/MigrationLineageReconciliation.test.ts,
CFG = config.test.ts + main.test.ts.

| Original criterion                                                                                                           | Remediation | Source evidence                                                                                              | Verification command                                                                                     | Result |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------ |
| T01-AC1 protocol version + capability set; compatible succeed, unsupported fail closed with offered-vs-supported diagnostics | 19          | BR (handshake matrix: version window, missing-capability diagnostics), RE §19, INT stage 2                   | `bun run test src/provider/piSubagentBridge.test.ts src/provider/piSubagentRealExtension.test.ts`        | pass   |
| T01-AC2 no handshake → legacy spawn/abort/completion/notification; no managed record                                         | 19          | RE §19 legacy probe, SE (T02-AC6), INT stage 2 legacy leg                                                    | `bun run test src/provider/piSubagentRealExtension.test.ts src/provider/piSubagentSession.test.ts` + INT | pass   |
| T01-AC3 bridge absent/error/unsupported distinct stable diagnostics, unrelated controls unaffected                           | 19          | BR (bridge_absent/bridge_error/unsupported_version/malformed), RE §19, INT stage 2 failing-bridge leg        | `bun run test src/provider/piSubagentBridge.test.ts` + INT                                               | pass   |
| T01-AC4 negotiated result stable for session lifetime, correlatable with admitted executions                                 | 19          | BR idempotent probe caching, RE §19, INT stages 2–6 (probe cache reused across admissions)                   | `bun run test src/provider/piSubagentBridge.test.ts` + INT                                               | pass   |
| T01-AC5 repeated probes idempotent, no side effects                                                                          | 19          | BR repeated-probe test, RE §19                                                                               | `bun run test src/provider/piSubagentBridge.test.ts`                                                     | pass   |
| T01-AC6 managed ownership inert until negotiation; mixed-version cannot half-enable                                          | 19          | SE mixed-version cases, INT stage 2 stripped-copy (capability_mismatch → tool stays legacy, zero admissions) | `bun run test src/provider/piSubagentSession.test.ts` + INT                                              | pass   |
| T02-AC1 execution record + executionId durable before child-start evidence                                                   | 20          | AC seq-1-before-start ordering, REP atomic admission, INT stage 3 (journal [1,2] present with the completed child; admission-before-child-start ordering is proven by the coordinator order + the stage-4 failure path's zero-child evidence)          | `bun run test src/provider/piSubagentAdmissionCoordinator.test.ts` + INT                                 | pass   |
| T02-AC2 distinct attemptId per spawn; events carry execution/attempt/generation/sequence                                     | 20          | REP journal identity columns, AC, INT stages 3+5                                                             | REP + INT                                                                                                | pass   |
| T02-AC3 requested→accepted journal-first deduplicated; rejected terminal stable; no half-admitted projection                 | 20          | REP dedup + rejected rows, AC, INT stage 3 replay + revoked legs                                             | REP + AC + INT                                                                                           | pass   |
| T02-AC4 ownership/active-turn/approval/provider authority before child start; denial → no child                              | 20          | AG, AC authority checks, INT stage 3 revoked-authority leg (zero model requests)                             | AG + AC + INT                                                                                            | pass   |
| T02-AC5 replay returns already-applied with original identities; no duplicates                                               | 20          | AC 8-way race convergence, REP (command_id, fingerprint) dedup, INT stage 3 replay leg                       | AC + REP + INT                                                                                           | pass   |
| T02-AC6 legacy/unhandshaked bypasses managed admission entirely                                                              | 20          | SE, RE §19, INT stage 2                                                                                      | SE + INT                                                                                                 | pass   |
| T03-AC1 lifecycle persistence failure prevents child spawn, stable diagnostic                                                | 21          | CH + AC failure containment, RE §21, INT stage 4 (no child, pi_subagent_lifecycle_persistence_failed)        | CH + AC + INT                                                                                            | pass   |
| T03-AC2 no execution projected accepted/running when admission did not complete                                              | 21          | AC, INT stage 4 (request log unchanged; no journal rows for the failed command)                              | AC + INT                                                                                                 | pass   |
| T03-AC3 control health degrades; new admissions fail closed while unavailable                                                | 21          | CH degrade/reject, AC, INT stage 4 second-attempt leg                                                        | CH + AC + INT                                                                                            | pass   |
| T03-AC4 existing records + terminal truth never rewritten by degradation                                                     | 21          | CH, AC, INT stage 4 stage-3-truth-unchanged assertion                                                        | CH + INT                                                                                                 | pass   |
| T03-AC5 after recovery, health returns available; NEW command admits without replaying rejected work                         | 21          | CH single-flight recovery, AC recovery probe, INT stage 4 recovery leg (fresh commandId admits + starts)     | CH + AC + INT                                                                                            | pass   |
| T03-AC6 legacy Pi behavior available per capability policy during degradation, never mislabeled                              | 21          | RE §21 (real legacy Agent executed during degraded window), INT stage 4                                      | RE + INT                                                                                                 | pass   |
| T04-AC1 child inside budget returns through existing inline result flow, no unnecessary follow-up                            | 22          | FA T22-AC1 (real child "ACK" inline), INT stage 3                                                            | FA + INT                                                                                                 | pass   |
| T04-AC2 child active at expiry returns handle within budget + bounded tolerance                                              | 22          | FA T22-AC2 (budget+500 ms envelope), INT stage 5 (303–310 ms vs 800 ms)                                      | FA + INT (standalone)                                                                                    | pass   |
| T04-AC3 handle spawns no replacement, stops no original, stays in parent-turn scope                                          | 22          | FA T22-AC3, RE §22, INT stage 5 (cancellationScope parent_turn in journal)                                   | FA + RE + INT                                                                                            | pass   |
| T04-AC4 started + detached observations durable; execution running not interrupted                                           | 22          | FR (journal [1,2,3], observedState running), INT stage 5 reopen leg                                          | FR + INT                                                                                                 | pass   |
| T04-AC5 default 10 s; config bounded; invalid falls back safely                                                              | 22          | CFG resolver matrix + ServerConfigLive wiring (main.test.ts), FA T22-AC5                                     | CFG + FA                                                                                                 | pass   |
| T04-AC6 managed detach affects only its execution; concurrent + legacy unaffected                                            | 22          | FA T22-AC6 (two concurrent managed + real adjacent legacy session)                                           | FA (standalone)                                                                                          | pass   |
| T05-AC1 no continuing 80 ms spinner-style publication in managed mode                                                        | 23          | PA onUpdate-never against pinned extension; Alfie managed-progress legacy regression test; INT stage 6       | PA + INT                                                                                                 | pass   |
| T05-AC2 progress capped at configured rate, trailing-edge latest snapshot                                                    | 23          | PO AC2 (5000-flood, 2 Hz cap, exact counters), PA real-path, INT stage 6 (flood cap on real schedule)        | PO + PA + INT                                                                                            | pass   |
| T05-AC3 heartbeat refreshes lease (~10 s / 30 s defaults) with no transcript messages / durable history / auto-follow        | 23          | PO AC3 (lease math exact, zero message-like events, journal [1,2]), PA real lease lead, INT stage 6          | PO + PA + INT                                                                                            | pass   |
| T05-AC4 desired vs observed separately readable, never overwritten                                                           | 23          | REP (UPDATE-only observation, states unchanged), PO AC5 interleave                                           | REP + PO                                                                                                 | pass   |
| T05-AC5 saturation coalesces/drops with counters; lifecycle + terminal reserved capacity                                     | 23          | PO AC5 (journal exact amid flood; failure containment), PS, INT stage 6 (duplicate detached idempotent)      | PO + PS + INT                                                                                            | pass   |
| T05-AC6 sustained progress load does not grow memory linearly                                                                | 23          | PS (20k × 8 executions structural bounds + RSS < 64 MB)                                                      | PS                                                                                                       | pass   |
| T05-AC7 invalid rate/heartbeat/lease config falls back to safe defaults                                                      | 23          | CFG three-resolver matrix + live env wiring; Alfie invalid-policy internal defaults                          | CFG + PA                                                                                                 | pass   |

Real-Pi coverage per original ticket: T01 → RE + INT stage 2; T02 → INT stage
3 (real child); T03 → RE §21 + INT stage 4; T04 → FA + INT stage 5 (real
children); T05 → PA + INT stage 6 (real child). No row is synthetic-only.

### Failure and diagnostic evidence

- Negative handshake: unsupported version (offered-vs-supported diagnostics),
  missing required capabilities (capability_mismatch with missing list), bridge
  error, malformed response, bridge absent — INT stage 2 + BR.
- Authorization denial: revoked authority → pi_subagent_admission_unauthorized,
  zero model requests, durable rejected row — INT stage 3.
- Concurrent replay: same commandId → already-applied, original identities, no
  duplicate journal — INT stage 3.
- Persistence failure: admission failure → no child, degraded health, repeated
  fail-closed, existing truth preserved, recovery on fresh command — INT stage 4.
- Child failure surfaces: legacy error-path results preserved (Alfie suite);
  lifecycle-write failure containment returns error-shaped results (ticket-22
  evidence, regression suite green in this candidate's full run).
- Invalid config: three knob resolvers fall back to defaults on the live path
  (CFG); foreground budget invalid fallback (ticket-22 CFG).
- Saturation: flood with exact drop accounting; lifecycle reserve proven by
  idempotent journal under flood — INT stage 6, PO, PS.
- Reconnect/reopen: real-chain reopen restores aggregate/journal/observation
  (INT stage 5); runtime-event stream rate-capped (what reconnect can deliver);
  web auto-follow guard unchanged.
- Resource cleanup: bridge activeAttachmentCount/activeTimerCount 0 after
  settlement; coalescer release after idle TTL — INT stage 6; PS.
- Legacy fallback: stripped-capability and no-bridge sessions keep legacy Agent
  behavior; real legacy child executed during degraded window (RE §21).

### Verification commands and results

Environment: Symphony checkout at the ticket-24 candidate commit on main,
working tree clean after commit; Alfie sibling checkout at pinned
`d35644a3b` (clean extension path); bun via ~/.bun/bin; no hosted-provider
credentials (loopback deterministic model per approved seam).

1. `cd apps/server && bun run test src/provider/piSubagentIntegratedAcceptance.test.ts`
   — 7/7 passed (×4 runs across development: worker twice, orchestrator twice
   after fmt/typecheck fixes; stage-5 envelope measurements 303–310 ms vs
   800 ms bound). Exit 0.
2. Per-file standalone wallclock (Decision 0008 method), all exit 0:
   piSubagentForegroundAcceptance 6/6; piSubagentProgressAcceptance 1/1;
   piSubagentForegroundReopen 1/1; piSubagentForegroundLifecycle 5/5;
   piSubagentRealExtension 11/11.
3. Focused deterministic suites, exit 0: piSubagentProgressObservation 4/4;
   piSubagentProgressSaturation 3/3; piSubagentBridge 42 total (with
   MigrationLineageReconciliation collateral run); PiSubagentExecutionRepository
   12/12; piSubagentAdmissionCoordinator 33/33; piSubagentControlHealth 6/6;
   piSubagentAdmissionGuard 6/6; piSubagentSession 10/10; config.test +
   main.test green.
4. Migration checks (run from the repo root): `node scripts/check-migration-lineage.ts` exit 0;
   `bun run test src/persistence/Migrations/MigrationLineageReconciliation.test.ts`
   4/4; Migrations.test.ts + Migrations/ 69 tests green (in full suite).
5. Full suite: `cd apps/server && bun run test` — 372 files, 4518 passed |
   17 skipped, exit 0 (single run on the final tree; includes the integrated
   file inside the wallclock project).
6. Workspace: `bun fmt` clean (2724 files); `bun lint` 0 errors (526 warnings
   pre-existing); `bun typecheck` exit 0 (fixed 3 strict-null errors in the new
   file during the final pass).
7. Alfie extension suite at d35644a3b: 30 files, 483/483, tsc clean (run
   during ticket-23 acceptance; unchanged — this ticket adds no Alfie changes
   and provenance re-verifies at every integrated run).
8. Warnings observed: node SQLite ExperimentalWarning (pre-existing);
   526 lint warnings (pre-existing, non-ticket).

### Migration compatibility evidence

Ticket 18's three histories exercised inside the integrated candidate (stage
1): fresh file history (migrations 1→100 converge, tracker complete,
second-run no-op), Symphony lineage (`[90..100]` with migration 97 re-run via
lineage alias), upstream-v0.7.2 history (`[97,98,99,100]` tail). Resulting
schema identical across histories (sqlite_master convergence per MLR);
pi_subagent_executions/journal/observation columns present and functional in
each (repository round-trip per history). Data survival: pre-existing rows
remain (MLR); second integrated run performs no duplicate work.

### Real-Pi evidence

- Runtime/extension provenance: Alfie `d35644a3b` /
  `@alfie/pi-subagents@0.11.0-alfie.1`; SHA-256 of package.json / src/index.ts
  / src/agent-manager.ts verified at the start of every integrated run
  (verifyExtensionGitProvenance local copy); synthetic Agent replacements
  cannot satisfy stages 2–6 (stages use the real pinned extension via symlink
  discovery; the companion capturing extension appears ONLY in the
  deterministic flood leg, which is the approved secondary seam, and is
  explicitly commented as such in-file).
- Agent invocations: real Agent tool execute calls through the production
  adapter chain (fast child completes inline with "ACK"; slow child detaches);
  identity/timing evidence: stage 3 journal [1,2] + replay identities; stage 5
  envelope 303–310 ms; stage 6 real progress payload + lease lead 3000 ms.
- Event counts over time: stage 6 flood — emitted ≤ ceil(elapsed × 10 Hz) + 1
  tool.progress events; dropped + emitted == 2000 exactly.

### Deviations and remaining risks

- The deterministic flood leg (stage 6) drives the server coalescer through a
  companion compatible-extension (production fixture module registered via the
  production extensionFactories seam) rather than the real extension's private
  binding object — the real binding is not externally observable. The
  actual-Pi progress evidence (rate cap, payload, lease) is carried by the
  real-extension legs of the same stage and by piSubagentProgressAcceptance
  (ticket 23). Commented in-file at the flood leg.
- Decision 0009 recorded obligation (heartbeat lease trusts producer-supplied
  occurredAt) remains open and is forwarded to ticket 06: ticket 24 adds no
  lease-based control, and no code reads lease_expires_at for control
  decisions; before any such consumer ships, lease authority must be
  validated/re-derived server-side.
- Stage sequencing: the 7 it() blocks share fixture state in file order
  (vitest executes sequentially in-file); this is documented in the file
  header and matches the wallclock project's single-file-serial execution.
- Per Decision 0008, wallclock evidence (including the stage-5 envelope) is
  binding only via per-file standalone invocations; the full-suite run is
  supporting evidence.

### Commits

- Symphony (pending) — `test(pi): add integrated remediation acceptance path
(issue 24)` + docs commit for this report.
- Alfie: none (pinned d35644a3b unchanged).

### Independent review verdict (2026-08-18)

RECOMMEND ACCEPT — high confidence. T24-AC1..AC8 PASS with directly re-run
evidence (integrated file standalone ×2 green — envelope 304–310 ms vs 800 ms;
wallclock + deterministic focused suites re-run with matching counts; workspace
fmt/lint/typecheck exit 0 re-verified). Second matrix: 31/31 rows audited —
28 direct-verified, 3 LOW/INFO flags (F2 T01-AC2 citation, F3 T02-AC1 phrasing,
F5 migration-command cwd) — none failing; no row is synthetic-only (the
stage-6 flood companion extension is the approved secondary seam and the
actual-Pi evidence for T05 rows is carried by the real-extension legs plus
piSubagentProgressAcceptance). Tickets 18–23 implementation reports
reconciled: all recorded commits present in history, all cited commands green
on this candidate. Zero critical, zero high defects (3 LOW, 2 INFO; F1
prior-ticket count nit fixed in the ticket-23 report, F2/F3/F5 doc touch-ups
applied, F4 formatting-only reformat committed with this report).

### Reviewer handoff

Reproduction order (apps/server, per-file standalone):

1. `bun run test src/provider/piSubagentIntegratedAcceptance.test.ts` (7/7;
   provenance self-verifies; watch stage-5 envelope printout).
2. Wallclock standalone: piSubagentForegroundAcceptance, piSubagentProgressAcceptance,
   piSubagentForegroundReopen, piSubagentForegroundLifecycle, piSubagentRealExtension.
3. Deterministic: piSubagentProgressObservation, piSubagentProgressSaturation,
   piSubagentBridge, piSubagentAdmissionCoordinator, piSubagentControlHealth,
   piSubagentAdmissionGuard, piSubagentSession, PiSubagentExecutionRepository.
4. Migration: `node scripts/check-migration-lineage.ts`; MigrationLineageReconciliation.
5. Config live path: config.test.ts, main.test.ts.
6. Workspace: bun fmt / lint / typecheck.
   Artifacts: this report (both matrices), PLAN
   plans/24-integrated-remediation-acceptance/PLAN.md, Decisions 0002–0009.
