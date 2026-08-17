# Decision 0009 — Ticket 23 final acceptance (production progress, heartbeat leases, and saturation control)

## Status

**accepted** (binding; Decisions 0001–0008 remain authoritative and unchanged)

**Date:** 2026-08-18

## Accepted candidate

- Symphony `6d646fe13d3f4958a13167411a48def6265dd687` (`6d646fe1`, feature commit, preceded by separated pre-existing fmt-debt commit `fa6878f0`; working tree clean at adjudication)
- Alfie `d35644a3b7af34c0dd1868afe652de50e62c8992` (pinned by `piSubagentExtensionProvenance.json`; extension `@alfie/pi-subagents@0.11.0-alfie.1`, capability `coalesced-progress`; local main, clean)

Provenance re-verified at adjudication: SHA-256 of `package.json` / `src/index.ts` / `src/agent-manager.ts` in the checked-out Alfie tree match the manifest byte-for-byte; `verifyExtensionGitProvenance` enforced at real-Pi acceptance start.

## Question

Does the Ticket 23 candidate at Symphony `6d646fe1` + Alfie `d35644a3b` satisfy T23-AC1 through T23-AC9 under Decision 0001 (testing strategy), Decision 0008 (accepted Ticket-22 baseline and acceptance conventions), and the owner-approved Testing Seams, with the single independent reviewer's recorded findings dispositioned?

## Governing references

Project Home; Issue 23 (normative ACs + implementer report + review verdict); Decision 0001 (testing strategy governance); Decision 0008 (Ticket-22 baseline, per-file standalone wallclock method, reopening discipline); Ticket 23 PLAN.md (settled design, binding); Alfie repo @ `d35644a3b` (pinned baseline, read-only).

## Lifecycle honored

Blocker cleared (Ticket 22 accepted via Decision 0008) → implementation per settled PLAN (WP-A Alfie producer; WP-B Symphony dispatch/persistence/config; WP-C provenance re-pin + real-Pi acceptance) → complete Implementation Report in Issue 23 → owner-approved Testing Seams (2026-08-16) → exactly one independent feature-level review (2026-08-18, RECOMMEND ACCEPT, high confidence, zero critical/high) → one Project Supervisor final-acceptance consultation (activation class 2) → ACCEPT.

## Settled verdict — **Accept Ticket 23. T23-AC1 through T23-AC9 all pass.**

- **AC1 (no 80 ms spinner stream; legacy unchanged):** managed branch passes a coalescer into `createActivityTracker` (`index.ts:1560` — "NO 80ms spinner interval!"); legacy 80 ms path (`index.ts:1846`) untouched and still covered by its dedicated legacy test; real-Pi acceptance proves `onUpdate` spy exactly 0 calls against the pinned extension.
- **AC2 (2 Hz cap, trailing-edge latest):** both layers implement single-latest-slot + trailing timer at 1/rateHz (Alfie producer coalescer; `piSubagentProgressCoalescer.ts`); 5000-observation flood → 20 flushes (2 Hz × 10 s + 1), latest payload, exact emitted+coalesced=N accounting; custom 0.5 Hz policy honored.
- **AC3 (≈10 s heartbeat, 30 s lease, no transcript/auto-follow/intermediate history):** extension interval armed after started observation, survives detach; `recordHeartbeatObservation` UPDATE sets `last_heartbeat_at`/`lease_expires_at = occurredAt + leaseMs` exactly; zero message-like runtime events, journal stays `[1,2]`; real-Pi acceptance proves real lease lead = configured 4 500 ms.
- **AC4 (desired/observed never touched):** observation methods are UPDATE-only on migration-099 columns with explicit no-journal/no-aggregate-mutation comments (repository `:566-611`); tests prove desired/observed unchanged after progress+heartbeat and after interleaved flood.
- **AC5 (saturation counters accurate; lifecycle never discarded):** lifecycle kinds never enter the coalescer (separate dispatch at PiAdapter `:3242-3252`); flood+interleave keeps journal exactly `[1,2,3]`; progress-sink failure swallowed (control health stays "available") while lifecycle failure still degrades+rejects with `pi_subagent_lifecycle_persistence_failed`.
- **AC6 (bounded memory/queue; release of ownership):** structural bounds ≤ executions for entries/pending/timers, 20k-observation × 8-execution flood with exact accounting, RSS delta < 64 MB, idle TTL `max(leaseMs, 2×intervalMs)` releases entries+timers, `dispose()` flushes trailing snapshot exactly once, late progress re-tracks.
- **AC7 (invalid config → safe defaults, live path):** three resolvers (defaults 2/10000/30000, validated ranges, invalid → default, no clamping) wired in both `config.ts` layerTest and `main.ts` ServerConfigLive (`:344-350`); extension-side malformed policy → internal defaults, never rejects the binding.
- **AC8 (reconnect/reopen restore latest without replay):** file-backed reopen restores latest progress + lease via `getObservation` with no intermediate history rows; no new WS schema (existing cursor-resume); auto-follow exclusion pre-existing and unchanged.
- **AC9 (actual-Pi evidence beyond deterministic producer):** `piSubagentProgressAcceptance.test.ts` drives the real extension through the production PiAdapter path against the deterministic loopback model server; negotiated capabilities contain `coalesced-progress`; real producer payload (no `spinnerFrame`); provenance self-verifies against the pinned commit.

## Evidence summary

Criterion-level matrix in the Issue 23 report; reviewer reproduced every criterion (suites re-run standalone, SHA-256 recomputed, source-level audit of UPDATE-only paths, lifecycle/progress separation, failure containment, legacy preservation, config fallback, no new migration, envelope untouched). Full apps/server suite green twice (371 files, 4511 passed | 17 skipped, exit 0); per-file standalone wallclock runs green (foreground acceptance 6/6, progress acceptance 1/1, reopen 1/1, lifecycle 5/5, real-extension 11/11 — one transient batch-run flake, green in three consecutive standalone invocations, consistent with Decision 0008's documented harness noise, and not applicable to the standalone method). Alfie suite 30 files, 483/483 (tsc clean). Workspace `bun fmt` clean, `bun lint` 0 errors (524 pre-existing warnings), `bun typecheck` exit 0.

**Supervisor independent spot-verification at adjudication:** verified Symphony HEAD and Alfie HEAD match the candidate hashes with clean trees; recomputed all three provenance SHA-256 hashes (match); audited source of the UPDATE-only repository observation paths, the PiAdapter dispatch/coalescer/heartbeat seams, the extension heartbeat timer lifecycle (`liveAttachments` entry, cleared on settle/failure/dispose, counted in `activeTimerCount`), and untouched legacy spinner path; re-ran `piSubagentProgressObservation` + `piSubagentProgressSaturation` (7/7), `piSubagentProgressAcceptance` (1/1 real-Pi), and the full Alfie extension suite (483/483). All green.

## Recorded nonblocking risks (findings dispositioned, none block acceptance)

1. **LOW — lease trusts producer-supplied `occurredAt`:** `lease_expires_at = occurredAt + leaseMs` uses extension-supplied time. Observation-only today: no lease consumer exists yet, so no control decision depends on it; producer is the live execution owner and handshake-gated. Deferred to Ticket 24 (terminal-outbox / lease consumer) by design scope. Recorded as a contract obligation for Ticket 24: any lease-based control decision must validate/re-derive lease authority server-side.
2. **LOW — report test-count arithmetic nit:** piSubagentBridge actual total is 38, all green; report prose said 16→28. Cosmetic documentation discrepancy only; all suites verified green directly.
3. **LOW — tracked `.pi/notifications.jsonl` runtime mutation:** pre-existing pattern across the repo (rides the fmt-debt/typecheck-cleanup commits); no behavior impact.
4. **INFO — admission-coordinator dual-shape `latestTurn` read:** behavior-identical simplification riding the in-area typecheck cleanup; 33/33 coordinator tests green.
5. **INFO — fire-and-forget session-stop `disposeAll`:** consistent with observation-not-control semantics; no lifecycle claim involved.
6. **Pre-existing, inherited:** Decision 0008's M2 wallclock/load sensitivity (per-file standalone method remains binding); 524 pre-existing lint warnings; in-area typecheck debt (63 + 13 errors) cleared as documented debt cleanup, workspace typecheck exit 0.

## Rejected alternatives

- **REASSESS:** no criterion, no settled-design invariant, and no Decision 0001/0008 requirement remains failed or unevidenced; the two LOW findings are observation-scope or cosmetic and have explicit downstream owners (Ticket 24) — no remediation cycle is warranted.
- **NOT-ACCEPT:** no criterion-level failure evidence exists; every criterion has deterministic + real-Pi evidence at the correct boundary per the approved Testing Seams.
- **Conditional acceptance with remediation riders:** the lease-consumer trust boundary is Ticket 24's deliverable surface (a lease consumer does not exist to harden against); gating Ticket 23 on Ticket 24 scope would invert the settled plan dependency order.
- **Another independent review:** the single-review lifecycle is satisfied (one reviewer, high confidence, all criteria reproduced); a second review would violate the project's review lifecycle.

## Assumptions

- Orchestrator-run verification outputs (full suite ×2, wallclock standalone runs, fmt/lint/typecheck) correspond to the candidate hashes; supervisor spot re-runs corroborate.
- All commits remain local-only; no publication, deployment, or release is in scope.
- The deterministic loopback model server exercises the real Pi runtime and provider protocol boundary (hosted-provider credentials unavailable) — the owner-approved Testing Seams substitution per Decision 0001.
- Heartbeat/lease semantics are advisory observation until Ticket 24 introduces a consumer; no control behavior currently reads `lease_expires_at`.

## Downstream effect

- Ticket 23 marked accepted/completed with evidence links; this record is the authoritative Ticket 23 acceptance.
- Blocker-free frontier advances to **Ticket 24** (integrated remediation acceptance; owns the terminal-outbox/lease-consumer obligations recorded above).
- **Ticket 06 remains blocked until Ticket 24 is accepted** (unchanged gate).
- Provenance pin now `d35644a3b` / `0.11.0-alfie.1`: any future Alfie change to `package.json` / `src/index.ts` / `src/agent-manager.ts` requires re-pinning + hash recompute before real-extension tests run.

## Failure and rollback implications

Change is additive, capability-gated, and migration-free (migration 099 columns already staged). Rolling back Ticket 23 returns managed progress to the Ticket-22 state (no coalescing, no heartbeat) while leaving Tickets 18–22 and schema intact. A mixed-version extension without `coalesced-progress` never sends the new kinds (handshake-gated), so Symphony's widened dispatch is inert against legacy extensions; legacy 80 ms spinner behavior is preserved. Observation failures swallow by construction and cannot degrade control health.

## Reopening conditions

Reopen (via a new numbered decision, never by editing this one) only for material evidence that: the final source differs materially from Symphony `6d646fe1` or Alfie `d35644a3b`; a managed execution resumes the 80 ms spinner stream or a legacy session loses its legacy behavior; progress or heartbeat writes touch `desired_state`/`observed_state` or the journal; lifecycle/terminal evidence is discarded or delayed by the progress queue under saturation; observation failures reject the producer or degrade control health; server memory/queue state grows with intermediate progress count or completed executions leak coalescer/timer entries; any of the three config knobs mis-resolves or clamps instead of falling back on the live path; reconnect/reopen replays intermediate progress or fails to restore the latest snapshot and lease; provenance no longer proves the exact Alfie source; the Ticket-22 envelope (`budget + 500 ms`, per-file standalone method) is violated reproducibly on a functioning event loop; or new evidence contradicts Decisions 0001–0008.
