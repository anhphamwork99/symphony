# Independent Review — Ticket 07: Journal-first Terminal Lifecycle

**Reviewer:** independent feature-level reviewer (reviewer subagent, 2026-08-18)
**Candidate:** Symphony `fe4d1fa3` + Alfie `bcfe6edda` (`0.13.0-alfie.1`)
**Verdict:** PASS — T07-AC1..AC7 all pass; findings F1 (MEDIUM), F2–F4 (LOW), F5 (INFO); confidence HIGH.

---

## 1. Verdict

**PASS** — all seven criteria (T07-AC1..AC7) are supported by evidence I independently reproduced; no material failure. Four non-blocking findings (1 MEDIUM, 3 LOW) and one informational note are listed in §4.

## 2. Confidence

**High.** Basis: (a) every verification claim in the Implementation Report was re-executed and matched exactly (test counts, tsc exits, the 7 pre-existing failures); (b) I read the full changed production source in both repos — the transactional ordering, dedup identity, guard clauses, and both flip-flop directions were verified in source, not just via green tests; (c) provenance hashes recomputed with `shasum -a 256` against the alfie working tree. Limitation: ForegroundReopen/ForegroundLifecycle were verified green but not diffed line-by-line (not in this commit's change set beyond capability pins elsewhere); lint/oxfmt claims were not re-run.

## 3. Baseline (normalized)

- **Objective:** durable terminal truth before any completion delivery; dedup + generation fencing; gap diagnostics without deletion/delay; stale counting; bounded summaries + real transcript references; terminal independence from progress-sink health; cancel-vs-complete single-owner resolution.
- **Boundary (per packet):** completion _delivery_ (outbox/follow-up turns) is Tickets 08–09 — only the post-commit seam (`onTerminalPersisted` / `subagents/terminal-settled`) is in scope. Restart reconciliation is Ticket 10; sequence-gap _repair_ is out of scope (diagnostic only).
- **Verification method:** Decision 0008 per-file standalone vitest invocations, `env -i PATH HOME` prefix (documented epipe-guard harness noise).
- **Non-goals:** outbox absence, orphan recovery absence — not judged.

## 4. Evidence Matrix (all evidence personally reproduced unless labeled)

| Criterion   | Expected outcome                                                                          | Observed evidence (command → result)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Status   |
| ----------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **T07-AC1** | Terminal durably appended+applied before any completion delivery                          | `piSubagentTerminalLifecycle.test.ts` 12/12 — notify-ordering test proves `onTerminalPersisted` fires only after durable `succeeded`; failure-surface test proves persistence failure never notifies + emits `pi_subagent_terminal_persistence_failed`. `piSubagentTerminalAcceptance.test.ts` (wallclock) 2/2 — real inline completion asserts durable `succeeded` with **no settling sleep** before handle return. Source: `recordTerminalEvent` = one `sql.withTransaction` (dedup → continuity → journal INSERT → guarded aggregate UPDATE); coordinator notifies strictly post-commit (piSubagentTerminalCoordinator.ts:167); adapter awaits the ingest before resolving the observation (PiAdapter.ts:3253–3364) | **PASS** |
| **T07-AC2** | Duplicate/replayed terminal → exactly one state effect; first applicable terminal wins    | Lifecycle test: exact replay → `already_applied`, 0 new journal rows, stale counter 0; different-state racer at same attempt-local sequence → `already_applied` via `(execution_id, attempt_id, generation, sequence)` dedup key (Layers/PiSubagentExecutionRepository.ts:790–816, 1072); generic-path guard test proves a second distinct terminal cannot overwrite `cancelled` (fixed pre-existing flip-flop hole, Layers:455–483). Acceptance test 1 replays a terminal observation live → no second effect                                                                                                                                                                                                         | **PASS** |
| **T07-AC3** | Sequence gaps → stable diagnostic, no deletion/delay                                      | Lifecycle gap test: terminal@40 after admission@1 → `pi_subagent_event_sequence_gap` fired, terminal persisted, aggregate `succeeded`; contiguity control test (seq 2–39 filled) → no diagnostic. Source: continuity computed pre-insert (Layers:1097–1104); diagnostic is advisory-only (coordinator:119–128); no DELETE or retry/delay anywhere in the path                                                                                                                                                                                                                                                                                                                                                          | **PASS** |
| **T07-AC4** | Superseded attempt/generation terminal ignored + counted, truth preserved                 | Lifecycle stale test: late attempt-1 terminal after resume to attempt-2 → `ignored_stale(superseded_attempt)`, aggregate still `running`/`att_t07_2`, `stale_terminalEvents=1`, then attempt-2 terminal applies. Stale classification is pre-mutation (Layers:1126–1177); counter is durable (migration 101 `stale_terminal_events`). Acceptance test 1 covers the live-path stale observation through the same ingest seam                                                                                                                                                                                                                                                                                            | **PASS** |
| **T07-AC5** | Bounded summary + transcript reference, never unbounded output                            | Lifecycle: 50 000-char summary → ≤512 at knob 512, ≤2000 at default; server-side truncation before persistence _and_ journal metadata. Acceptance test 1 (real-Pi, knob 1500): `terminalSummary ≤ 1500`, `terminalTranscriptRef` truthy and **`existsSync(...) === true`** (real on-disk artifact); journal metadata summary ≤1500. Producer side (alfie index.ts:347–369): 2000-char cap, `transcriptRef = record.outputFile`. Config knob matrix reproduced: config.test.ts 171/171, main.test.ts 39/39 (ServerConfigLive resolution: valid preserved, 4 invalid classes + unset → 2000)                                                                                                                             | **PASS** |
| **T07-AC6** | Terminal persists under progress saturation / degraded sink                               | Lifecycle degraded-sink test (200 failing progress writes → terminal persists, exactly 1 terminal row) + saturation-harness test (5 000-observation flood on the **real** coalescer, structural bounds asserted mid-flood, terminal persists while a progress slot is pending, flood accounting reconciles: `totalCoalesced + totalEmitted === 5000`). Source: adapter terminal branch returns before the coalescer is ever touched (PiAdapter.ts:3253 vs 3371); terminal path is the reserved durable journal path, not the observation sink                                                                                                                                                                          | **PASS** |
| **T07-AC7** | Cancel-vs-complete race → one applicable terminal owner, no flip-flop in either direction | Lifecycle race A (durable `cancelled` first → late succeeded terminal `ignored_stale`, counted, stays `cancelled`) and race B (succeeded first → late `recordCancelledAck` journals history but the guarded `NOT IN ('cancelled','succeeded','failed','rejected')` UPDATE cannot regress). Alfie `managed-terminal.test.ts` (in 491/491 green suite): `buildManagedTerminalPayload` returns `undefined` for aborted/stopped; background test proves exactly-once reporter delivery; inline-rejection test proves error-shaped result. Acceptance test 2: background child settles `succeeded` through the onComplete reporter + `subagents/terminal-settled` runtime event                                             | **PASS** |

**Reproduced verification inventory** (all with `env -i PATH="$PATH" HOME="$HOME"`, Decision 0008 standalone method for wallclock):

- `npx vitest run src/provider/piSubagentTerminalLifecycle.test.ts` → **12/12**
- `npx vitest run src/provider/piSubagentTerminalAcceptance.test.ts` (wallclock) → **2/2**
- `piSubagentCancellationCoordinator.test.ts` **12/12** · `PiSubagentExecutionRepository.test.ts` **12/12** · `Migrations.test.ts` **21/21** · `Migrations/MigrationLineageReconciliation.test.ts` **4/4** · `Migrations/MigrationReplay.test.ts` **3/3** · `config.test.ts` **171/171** · `main.test.ts` **39/39** · `piSubagentBridge.test.ts` **38/38** · `piSubagentProgressObservation.test.ts` **4/4**
- Wallclock per-file: ForegroundAcceptance **6/6**, ForegroundReopen **1/1**, ForegroundLifecycle **5/5**, RealExtension **11/11**, ProgressAcceptance **1/1**, IntegratedAcceptance **7/7**, CancellationAcceptance **2/2**
- Full unit project (`--project unit`): **4514 passed / 7 failed / 17 skipped** — all 7 failures confirmed in `src/git/Layers/CursorTextGeneration.test.ts` (Cursor ACP unavailable), the documented pre-existing set
- Alfie `agent/extensions/pi-subagents`: `npx vitest run` → **31 files / 491 tests passed**
- `./node_modules/.bin/tsc --noEmit` in apps/server → **exit 0**; same in alfie extension → **exit 0**; workspace `turbo run typecheck` → **7/7 packages successful**
- Provenance: `shasum -a 256` on package.json / src/index.ts / src/agent-manager.ts → **all three match the manifest**; `git rev-parse HEAD` = `bcfe6eddabad…` = pinned; package `0.13.0-alfie.1`; extension path clean; origin URL matches. Both repos' working trees clean at the review commits.

## 5. Prioritized Findings

**F1 — MEDIUM · Mixed-version disclosure is one-directional; old-server + new-extension degrades the inline tool result.**
`apps/server/src/provider/Layers/PiAdapter.ts:3234–3239` — a pre-Ticket-07 server throws `Invalid observation kind` for `kind: "terminal"`. Alfie `src/index.ts:1837–1858` awaits that observation on the INLINE foreground path and converts any rejection into `errorResult("pi_subagent_terminal_persistence_failed")`. Net effect under version skew (extension ≥0.13.0, server < fe4d1fa3): a **successfully completed child returns an error-shaped tool result**. Detached/background paths swallow (safe reporter). The report's disclosure ("an extension without journal-terminal-lifecycle never reports terminal…") covers only old-extension/new-server. Impact: operator-facing wrong result shape under skew; no durable-state corruption (old server never applies anything). Next action: either add `journal-terminal-lifecycle` to the server handshake's `optionalCapabilities` (piSubagentBridge.ts:261 area) so the extension can gate on negotiated server support, or amend the disclosure + deployment note that the pair must upgrade in lockstep (server first).

**F2 — LOW · No server-side length bound on `transcriptRef` / `outcomeState` / `diagnosticMessage`.**
Coordinator truncates only `summary` (piSubagentTerminalCoordinator.ts:96–99, 110). The other three strings pass through unbounded into `terminal_transcript_ref`, the aggregate, and journal `metadata_json`. Today the only producer (alfie) sends an output-file path, but the seam is a producer-facing contract. Next action: cap these server-side (e.g. 1024/256 chars) when touching this file for Ticket 08.

**F3 — LOW · Coordinator `summaryMaxChars` guard enforces MIN but not MAX.**
piSubagentTerminalCoordinator.ts:104–108 accepts any integer ≥64 (e.g. 999 999) — asymmetric with `resolvePiSubagentTerminalSummaryMaxChars` (64–32768). The only production caller passes already-resolved config, so unreachable today. Next action: mirror the MAX check when convenient.

**F4 — LOW · Cancelled managed background child leaves its terminal-reporter entry unconsumed.**
Alfie `agent-manager.ts:1024–1070`: `abort(id)` marks `stopped` without firing onComplete (token invalidated), so `managedTerminalReporters` (index.ts:688–696) keeps the closure for the session's lifetime. Session-scoped (per-extension-instance map), no correctness effect — a later consumer would need the same executionId, which belongs to the dead execution. Next action: optional cleanup in the stop/cancel RPC path.

**F5 — INFO.** (a) `PiSubagentTerminalEvidence` contract schema is currently unreferenced in apps — acceptable as the Ticket-08 consumer surface. (b) `subagents/terminal-settled` is typed `runtime.warning`, consistent with the existing diagnostics event pattern. (c) Sequence band 40 does not collide with admission(1)/started(2)/detached(3) or the cancel band 90/91/92; attempt-local numbering (migration 100 uniqueness) makes cross-attempt reuse correct.

## 6. Report-Accuracy Audit

| Report claim                                                                                                                                                 | My reproduction                                                      | Judgment          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ----------------- |
| TerminalLifecycle 12/12                                                                                                                                      | 12/12                                                                | ✔                 |
| TerminalAcceptance 2/2 (pinned ext, wallclock)                                                                                                               | 2/2                                                                  | ✔                 |
| All wallclock suites per-file: 6/6, 1/1, 5/5, 11/11, 1/1, 7/7, 2/2, 2/2                                                                                      | identical                                                            | ✔                 |
| Alfie 31 files / 491 tests                                                                                                                                   | identical                                                            | ✔                 |
| Migrations 21/21, Lineage 4/4, Replay 3/3, Repo 12/12, bridge 38, cancel-coordinator 12, progress obs green                                                  | identical                                                            | ✔                 |
| Config 171/171; main 39/39                                                                                                                                   | identical                                                            | ✔                 |
| Full unit 4514 passed / 7 failed (pre-existing Cursor set)                                                                                                   | identical; all 7 in CursorTextGeneration.test.ts                     | ✔                 |
| Workspace typecheck 7 packages pass; tsc clean                                                                                                               | turbo 7/7; tsc exit 0 (both repos)                                   | ✔                 |
| Provenance pin + hashes                                                                                                                                      | recomputed, all match                                                | ✔                 |
| Structural claims (transaction, guards, ordering, bands, caps, no-terminal-for-aborted/stopped, exactly-once reporters, identity fencing, outputFile wiring) | verified in source at cited locations                                | ✔                 |
| Mixed-version safety disclosure                                                                                                                              | accurate for old-ext/new-server; **silent on the reverse direction** | ✖ incomplete → F1 |

No overclaims detected. The acceptance-matrix rows are conservative and match what the tests actually assert (e.g. AC1's "no settling sleep" is a real assertion, not a timing artifact).

## 7. Verification & Scope Audit

- **Negative/diagnostic paths covered:** persistence failure (never notifies, degrades control health, producer rejection both sides), malformed terminal observation (explicit throw), gap/stale diagnostics, degraded sink, flood. All reproduced green.
- **Scope drift:** none. No outbox/reconciliation implementation leaked into this ticket; the seam is exactly `onTerminalPersisted` + runtime event. Migration 101 is additive with `columnExists` idempotence; lineage tests updated everywhere 100→101.
- **Unrelated work preserved:** the only pre-existing-behavior change is the `recordLifecycleEvent` terminal guard (Layers:455–483), which the report discloses as a pre-existing flip-flop hole fix — justified and tested.
- **Stale artifacts:** none; both working trees clean at the pins.

## 8. Unreviewable Items / Limitations

- `bun run lint` (527-warning baseline) and `oxfmt` claims not re-run — non-blocking hygiene claims.
- ForegroundReopen/ForegroundLifecycle verified green only (their diffs are outside this commit).
- Multi-file wallclock invocations not re-attempted (Decision 0008 establishes standalone as the binding method; epipe-guard noise is documented and was not observed under `env -i`).

---

**State:** completed

**Result:** Full criterion-level review of Ticket 07 delivered above. All T07-AC1..AC7 judged **PASS** on independently reproduced evidence (every cited command re-run; all counts matched). Implementation Report audited accurate with one disclosure gap. Four non-blocking findings (F1 MEDIUM mixed-version skew hazard on the inline path, F2–F4 LOW) with concrete next actions. Provenance manifest verified byte-exact. No files modified in either repository.

**Needs:** None for this review's completion. For the Supervisor final-acceptance consultation: (1) decide whether F1 (old-server/new-extension inline error-shape under version skew) warrants a remediation note in the ticket or a handshake `optionalCapabilities` addition before Decision 0012 is recorded — it does not block acceptance since no T07 criterion covers mixed-version behavior in that direction; (2) F2–F4 can be folded into Ticket 08/10 touchpoints.
