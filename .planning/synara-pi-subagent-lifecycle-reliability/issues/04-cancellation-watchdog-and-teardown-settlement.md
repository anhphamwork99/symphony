# Ticket 04 — cancellation, watchdog, and owned teardown retry settlement

**Status:** ready-for-agent
**Dependencies:** Ticket 03 accepted; inherited Decisions 0021–0034, DG-4, and this evidence-first plan remain binding
**Plan:** [`../plans/04-cancellation-watchdog-and-teardown-settlement/PLAN.md`](../plans/04-cancellation-watchdog-and-teardown-settlement/PLAN.md)
**Execution authorization:** evidence-only WPs below; no source/test remediation is authorized without the PLAN §9 challenge/replan gate

## Objective

Complete the failure-path lifecycle so cancellation, watchdog escalation, owned
teardown retries, survivors, and owner-unproven outcomes settle durably and
truthfully without killing outside the approved owner boundary.

## Acceptance criteria

- **T04-AC1:** Cancellation intent is journal-first, authorized, idempotent,
  and remains `cancelling` until accepted termination evidence.
- **T04-AC2:** Watchdog stages 70–74 remain bounded, observable, and non-terminal
  until terminal evidence or approved cleanup proof settles them.
- **T04-AC3:** Teardown request/outcomes 75–78 preserve owned-only dispatch,
  proof-before-fence, bounded survivor evidence, retry escalation, and no
  parent/PID fallback.
- **T04-AC4:** Persistence outage, provider stop failure, timeout, owner loss,
  survivor, and late terminal paths each produce stable diagnostics and no
  fabricated cancellation.
- **T04-AC5:** Graceful terminal/cancel paths never invoke destructive teardown;
  replay and duplicate sweeps do not duplicate effects.

## Testing seams

Deterministic cancellation/watchdog/teardown coordinator and repository
fixtures; adapter owner endpoint fixtures; injected timeout and write failure;
accepted isolated manual real-Pi destructive boundary only where required by
inherited Decisions 0028–0034.

## Implementation Report

Evidence base: WP-01 frozen candidate `08b65ebb466470d71814c4467d74e68f43991138` (deterministic 11-file/177-test focused run, producer exit 0) + WP-02 controlled-provider provenance and current-session non-destructive real-Pi run. Evidence paths: `../plans/04-cancellation-watchdog-and-teardown-settlement/evidence/WP-01-workspace-state.txt`, `.../WP-01-focused-deterministic.log`, `.../WP-01-ac-diagnostic-matrix.md`, `.../WP-02-controlled-provider-provenance.txt`, `.../WP-02-nondestructive-real-pi-disposition.md`, `.../WP-02-nondestructive-real-pi.log`.

### 1. Baseline, candidate, commits, and controlled provenance

- Router baseline: Symphony `83620ab07760ac45cdf314a4d0df8d96f83a1300`.
- Execution candidate (WP-01 HEAD at run): Symphony `08b65ebb466470d71814c4467d74e68f43991138` ("docs(planning): plan Ticket 04 cancellation settlement").
- Evidence/report commit: Symphony `bab07af82d31c7fc128fd561fc0dc06eed0f7300` (WP-01, "test(pi): record Ticket 04 deterministic settlement evidence").
- Controlled Alfie: exact HEAD `3fe340b401ca86bcbe8b55abd4de107e1d93482e`, origin `https://github.com/anhphamwork99/alfie.git`, clean tree, published extension manifest `agent/extensions/pi-subagents/package.json` = `@alfie/pi-subagents@0.15.0-alfie.6`; all five fixture SHA-256 hashes match (`piSubagentExtensionProvenance.json`). Pi SDK pin: `@earendil-works/pi-coding-agent@0.83.0` (`apps/server/package.json` + `bun.lock`).

### 2. No-source-change assertion

`83620ab07..08b65ebb4` changed only Ticket 04 planning/routing files plus unrelated Synara Whiteboard planning (classified in `WP-01-workspace-state.txt`); `08b65ebb4..bab07af82` changed only WP-01 planning evidence (classified in `WP-02-controlled-provider-provenance.txt`). No Ticket 04 production, contract, test, manifest, lockfile, migration, config, or Alfie path changed. Working tree at report time carries only unrelated owner changes (`apps/web/package.json`, `apps/web/src/main.tsx`, `bun.lock`), unstaged and untouched by this ticket. The candidate equals current production truth.

### 3. Inherited decision/invariant matrix (exact tuple before provider access)

Inherited and respected: Decisions 0025 (owner-endpoint authority), 0027 (durable cancel intent), 0028 (destructive isolation/manual), 0033 (owner_unproven non-terminal), 0034 (deterministic fixtures authoritative); local Decision 0006 (test envelopes); DG-4. Invariant 1 — durable authorization and the exact current `(executionId, attemptId, generation, providerSessionInstance)` tuple are resolved BEFORE provider access — is proven at `piSubagentCanonicalRouting.test.ts:101,304,329,475` (fails closed before provider on incomplete/session-isolated/wrong-thread/stale tuples; provider never invoked outside authorized exact-live tuples) and `piSubagentCancellationCoordinator.test.ts:100` (durable intent before dispatch).

### 4. Band and identity matrix (sole 76 fence)

- 90 durable cancel intent (`cancelling`, journal-first, before dispatch) — `piSubagentCancellationCoordinator.ts:231`.
- 92 cancel settlement — only `child_ack` or `owner_death` evidence channels — `piSubagentCancellationCoordinator.ts:374`.
- 70–74 watchdog stages (escalation start, child-abort timeout, provider-turn interrupt, provider-session stop, teardown handoff) — bounded, observable, NON-terminal, non-fencing — `piSubagentWatchdogEscalation.ts:61-67`.
- 75 teardown request (journal-first), 76 proven, 77 survivors, 78 owner_unproven — `piSubagentProcessTeardown.ts:68-73`. **Only a committed proven-76 outcome settles `cancelled` and atomically advances the generation fence** (full fence matrix in `WP-01-ac-diagnostic-matrix.md` "Cross-cutting proof"); 90/92/70–74/75/77/78 never fence.

### 5. T04-AC1–AC5 test matrix — verdicts

Full criterion-level matrices with named cases, locators, and normal/failure proof live in `WP-01-ac-diagnostic-matrix.md`; summary verdicts:

- **T04-AC1 — PASS.** Journal-first seq-90 intent before dispatch; idempotent replay (1 intent, 1 dispatch, 0 re-abort, `dispatchCount === 1` across card re-cancel); same-identity ack requirement (mismatched attempt/generation stays `cancelling` with `pi_subagent_cancel_ack_timeout`); owner-death conjunction with both negative boundaries; stale settlement journaled as history only. Evidence: `WP-01-ac-diagnostic-matrix.md` A1-1..A1-9 (`piSubagentCancellationCoordinator.test.ts:100,156,272,300,340,389,506,535,570,690`); normal+failure proof present.
- **T04-AC2 — PASS.** Stages 70–74 bounded (stage timeouts), observable (fixed per-stage diagnostic codes, operator observers), non-terminal (timer-only progression never claims stopped/cancelled, coordinator + projection twins), idempotent replay, no premature fence at handoff. Evidence: A2-1..A2-13 (`piSubagentWatchdogEscalation.test.ts`, `piSubagentWatchdogSweep.test.ts`, `piSubagentExecutionCardSurface.test.ts:1034`); normal+failure proof present.
- **T04-AC3 — PASS.** Owned-only dispatch (zero parent-supervisor calls across 13 invalid-owner-reply cases), proof-before-fence (only 76 fences), bounded survivors (cap 16, `MAX_PI_SUBAGENT_TEARDOWN_SURVIVOR_PIDS`), retry escalation (survivors→proven with exactly one 75 request; failed proven-write retains owner), no parent/PID fallback. Evidence: A3-1..A3-19 (`piSubagentProcessTeardown.test.ts`, `piSubagentProcessTeardownSweep` coverage via sweep rows, `piSubagentChildOwnerTeardownWiring.test.ts`, `piSubagentTeardownWiring.test.ts`, `piSubagentBridge.test.ts` teardown slice); normal+failure proof present.
- **T04-AC4 — PASS**, with one recorded residual (see §15/§7): persistence outage (teardown request + watchdog stage records), provider stop timeout, owner loss, survivor, and late terminal all have dedicated named cases with stable fixed diagnostic codes and no fabricated cancellation; the `stopProviderSession` promise-rejection ("failed") sub-branch shares its entire proven code path with the timeout case but lacks a dedicated named case. Evidence: A4-1..A4-12.
- **T04-AC5 — PASS.** Graceful terminal/cancel paths produce zero teardown effects; every duplicate/replay surface records its effect count (1 intent / 1 request / 1 outcome / 1 event / journal delta 0) and dedupes at journal identity or publication boundary. Evidence: A5-1..A5-15.

Conditional non-destructive real-Pi corroboration (current session, separate evidence class): cancellation 2/2 PASS (12.01s) and watchdog 2/2 PASS (6.62s) against the controlled Alfie checkout — see §9.

### 6. Owned-only endpoint, no-fallback, survivor cap, retry escalation, retained owner

Dispatch goes only through the current exact, opaque, live child-owner endpoint: `piSubagentProcessTeardown.test.ts:198` (unrelated executions never dispatched), `piSubagentChildOwnerTeardownWiring.test.ts:616` (every invalid owner reply → band 78 with `processSupervisorCalls === 0` — no parent supervisor fallback), `:797` (timeout → durable 78; subsequent sweep re-dispatches the SAME retained endpoint), `:942` (durable proven-write failure retains the exact owner; next sweep re-dispatches same identity and settles proven). Survivor PIDs capped to 16 before journaling (`piSubagentProcessTeardown.test.ts:317`); missing PID = unavailable, never fabricated zero survivors (`:347,:405`). Retry escalation: 77→76 settles with fence gen 2 using exactly one 75 request across both passes (`:501`); thrown dispatch → band 78, never synthetic 77, never a fence (`:837`).

### 7. Fixed diagnostic matrix

All material failure paths produce stable fixed codes and no fabricated cancellation: persistence outage `pi_subagent_lifecycle_persistence_failed` (teardown request `piSubagentProcessTeardown.test.ts:808`; watchdog stage records `piSubagentWatchdogEscalation.test.ts:1002` — seq-90 intent stays durable); provider stop timeout `pi_subagent_watchdog_stage_timeout` (journaled band-73 `result: "timeout"`, band-74 handoff, `cleanup_uncertain`, `piSubagentWatchdogEscalation.test.ts:549`); owner loss — owner-death conjunction (`piSubagentCancellationCoordinator.test.ts:340,389,570`) + orphaned-card truth (`piSubagentExecutionCardSurface.test.ts:297`) + stale-generation history-only (`piSubagentProcessTeardown.test.ts:953`); survivor `pi_subagent_teardown_survivors` with bounded durable PIDs (`piSubagentProcessTeardown.test.ts:270,347`); late terminal ignored AND durably counted (`staleTerminalEvents >= 1`, `:427`) and never reversing terminal truth; per-stage watchdog codes `pi_subagent_watchdog_walltime_escalation` / `..._stage_timeout` / `..._session_stopped` / `..._cleanup_uncertain` (`piSubagentWatchdogEscalation.test.ts:1070`); cancel ack-timeout/dispatch-failure `pi_subagent_cancel_ack_timeout` / `pi_subagent_cancel_dispatch_failed` (`piSubagentCancellationCoordinator.test.ts:426,474`); live-lifecycle unavailable/outcome-unknown/stale `pi_subagent_live_lifecycle_*` with no provider text or secret leakage (`piSubagentLiveLifecycleContainment.test.ts`, `piSubagentCanonicalRouting.test.ts` twins; `sk-provider-secret` asserted absent).

### 8. Replay and graceful-path evidence

Graceful cancel (90+92 child_ack) and normal band-40 terminal never enter teardown — `outcomes` 0, `requests` 0 (`piSubagentProcessTeardown.test.ts:601`); terminal between handoff and teardown wins without fence (`:662`); duplicate cancel idempotent (`piSubagentCancellationCoordinator.test.ts:156`); re-cancel replay + unknown `not_found` without state writes (`:690`); duplicate watchdog sweep skips handed-off execution, unique stage eventIds (`piSubagentWatchdogEscalation.test.ts:1125`); duplicate teardown pass → 0 new outcomes (`piSubagentProcessTeardown.test.ts:233`); owner_unproven duplicate pass → journal delta 0 (`:703`); repository replay identities `already_applied`/`stale_generation` (`:915,:953,:991,:1026`); truthful already-fenced replay (`:567`); card-event duplicates reduce to one card with zero false publication (`piSubagentExecutionCardSurface.test.ts:1170,1262,742`); graceful ack settles escalation exactly once (`piSubagentWatchdogEscalation.test.ts:370,404`); retired/cleared late responses never become truth (`piSubagentLiveLifecycleContainment.test.ts:300,333,355,576,387`).

### 9. Evidence-class separation

- **Deterministic (authoritative):** WP-01 focused 11-file/177-test unit run at frozen candidate, producer exit 0 — `evidence/WP-01-focused-deterministic.log`.
- **Controlled-Alfie:** provenance verification (origin/HEAD/clean/identity/hashes) — `evidence/WP-02-controlled-provider-provenance.txt`.
- **Conditional non-destructive real-Pi (current session):** cancellation 2/2 PASS (12.01s), watchdog 2/2 PASS (6.62s), producer exit 0, isolated temp state + loopback model + existing cleanup hooks, run from `apps/server` with `ALFIE_REPO_DIR=/Users/anhpham99/alfie` via repository-pinned Vitest (`--project wallclock --maxWorkers=1 --no-file-parallelism`) — `evidence/WP-02-nondestructive-real-pi.log` + `evidence/WP-02-nondestructive-real-pi-disposition.md`. Corroborative only; criterion verdicts rest on deterministic evidence.
- **Destructive manual real-Pi:** `not run` — see §10.

### 10. Manual-run record

**`not run for Ticket 04`.** No owner-operated destructive real-Pi run occurred; no environment/operator destructive run record exists. Per Decisions 0028 and 0034, destructive real-Pi coverage remains isolated/manual; this ticket neither requires nor claims such a run, and no inference refreshes that claim.

### 11. Owner-death live-adapter disposition

Coordinator/restart owner-death evidence is accepted: the full conjunction (dead owner + expired re-derived lease + absent from `listActive`) settles `cancelled_owner_death` without dispatch, with both negative boundaries proven (`piSubagentCancellationCoordinator.test.ts:340,389,570`), and post-restart no-live-owner teardown records bounded `owner_unproven` once without killing (`piSubagentProcessTeardown.test.ts:703`). Live cancel adapters intentionally pass `isOwnerGenerationDead: false` (conservative: a live adapter cannot prove its own owner's death); no new live-adapter authority is invented by this ticket.

### 12. Ticket-level review/Supervisor disposition

Ticket-level independent review and Supervisor acceptance are intentionally not activated, per Plan §2 item 10. One integrated project review and exactly one Supervisor final-acceptance consultation remain reserved for the complete multi-ticket project (Project Home). No review or Supervisor artifact was created for Ticket 04.

### 13. Heavyweight checks

`bun fmt`, `bun lint`, `bun typecheck`, and the package-wide `bun run test` were **not run — no current-session authorization** (Plan §7 authorizes them only on separate explicit owner authorization). This is an evidence/docs-only ticket with zero source delta, so their absence gates nothing here and is not converted into a source-remediation gate.

### 14. Residual uncertainty and reopening conditions

- **Named-case gap (only recorded residual):** no dedicated named case drives a rejecting `stopProviderSession` (journaled `"failed"` vs `"timeout"` metadata string). The branch is shared verbatim with the proven timeout branch (`piSubagentWatchdogEscalation.ts:560`: `stopRace.status === "timed_out" || stopRace.status === "failed"`), whose diagnostic, band-73/74 journaling, handoff, and non-terminal disposition are proven by `piSubagentWatchdogEscalation.test.ts:549`. Does not defeat AC4.
- Reopen/replan on: any Ticket 04 seam change after the frozen candidate; a failed criterion; dirty/unpinned controlled Alfie; nondeterministic evidence; any request for destructive automation; or any proposed change to the accepted identity, band, proof, owner, fallback, replay, Resume, migration, or governance contracts (Plan §11). `cleanup_uncertain`, `survivors`, and `owner_unproven` remain immutable non-terminal evidence (Unlock gate respected).

### 15. Per-AC conclusion

PASS only from recorded evidence: **T04-AC1 PASS, T04-AC2 PASS, T04-AC3 PASS, T04-AC4 PASS (with the §14 named-case residual), T04-AC5 PASS.** Every verdict cites executed named cases in `WP-01-ac-diagnostic-matrix.md`; nothing is inferred from inherited totals, and no destructive manual run is claimed or required.

## Unlock gate

No new cleanup authority may be introduced without an explicit decision. This
ticket cannot reinterpret `cleanup_uncertain`, `survivors`, or
`owner_unproven` as terminal.
