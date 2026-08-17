# 0007 — Ticket 22 real bounded foreground attachment final acceptance

**Status:** Accepted with recorded nonblocking risks

**Date:** 2026-08-17

**Decision type:** Project Supervisor final acceptance

**Integrated candidate:** `d2e7a768`

**Fixed point:** `3f10133b`

**Candidate commits:** `516bb3d3`, `ad28113a`, `c8252997`, `642bcba9`, `d2e7a768`

**Alfie HEAD commit:** `3cdfbdadcf0f7a1c7ab4af0f8c80ee470a0feadc`

**Publication:** Local integration only; not pushed or published.

## Question

Does the integrated Ticket 22 candidate satisfy T22-AC1 through T22-AC8
under the accepted Project Contract, approved Testing Seams, and Decision 0006,
including Alfie-owned foreground attachment arbitration, durable seq1/2/3
lifecycle ordering, parent-turn cancellation continuity across detach,
capability-gated legacy fallback, bounded configuration parsing, zero-leak timer
and registry cleanup, and cryptographic real-extension provenance?

## Governing references

- `../PROJECT.md` — authoritative routing and remediation frontier.
- `../spec.md` — normative behavior, durability, bounded foreground attachment,
  mixed-version, and fail-closed invariants.
- `0001-testing-strategy-governance.md` — accepted evidence and test-seam
  governance.
- `0002-t18-migration-lineage-final-acceptance.md` — accepted migration
  baseline.
- `0003-t19-real-pi-capability-final-acceptance.md` — accepted real-Pi and
  provenance baseline.
- `0004-t20-atomic-authorized-production-admission-final-acceptance.md` —
  accepted atomic admission baseline.
- `0005-t21-production-fail-closed-control-health-final-acceptance.md` —
  accepted production fail-closed control-health baseline.
- `0006-t22-bounded-foreground-attachment-technical-direction.md` — accepted
  cross-repository technical direction for Ticket 22.
- `../issues/22-real-bounded-foreground-attachment.md` — T22-AC1 through
  T22-AC8, approved Testing Seams, and completed Implementation Report.

Decisions 0001 through 0006 remain authoritative and are not reopened.

## Evidence

- Integrated local candidate HEAD `d2e7a768`, fixed point `3f10133b`, with
  commits `516bb3d3`, `ad28113a`, `c8252997`, `642bcba9`, and `d2e7a768`.
- Pinned Alfie HEAD `3cdfbdadcf0f7a1c7ab4af0f8c80ee470a0feadc` on branch `main`.
- The sole independent feature/ticket-level review package returned
  `accept-with-recorded-nonblocking-risks`, passed T22-AC1 through T22-AC8,
  and found no critical, high, or medium blocker.
- Focused verification passed 3 test files and 29 tests:
  - `src/provider/piSubagentRealExtension.test.ts` (11 tests passed);
  - `src/provider/piSubagentForegroundAcceptance.test.ts` (17 tests passed);
  - `src/provider/piSubagentForegroundReopen.test.ts` (1 test passed).
- Full Alfie extension suite passed 29 test files and 464 tests.
- Exact root `bun run test -- --env-mode=loose` passed all 8/8 workspace tasks,
  with server suite executing 368 files (4,386 passed, 0 failed, 17 skipped).
- Real-extension provenance and cryptographic integrity verified:
  - Repository origin matches `https://github.com/anhphamwork99/alfie.git`;
  - Package `@alfie/pi-subagents` version `0.10.0-alfie.1`;
  - SHA-256 hashes for `package.json`, `src/index.ts`, and `src/agent-manager.ts`
    match the pinned provenance manifest exactly.
- File-backed SQLite persistence across close and reopen proved recovery of the
  exact non-terminal running aggregate and ordered journal:
  `seq1 accepted` → `seq2 running (started)` → `seq3 running (detached)`.
- Real-Pi lifecycle timing and isolation verified:
  - Inline completion returns normal result within budget and records only seq1
    and seq2;
  - Detached child returns durable execution handle within budget plus bounded
    tolerance and preserves server-minted identities and `parent_turn`
    cancellation scope;
  - Concurrent managed executions and adjacent legacy sessions maintain
    independent identities, timers, journals, and behavior;
  - Zero live timers and registry entries remain after settlement, timeout,
    abortion, and session disposal paths.
- No database schema migrations were added or required; full backward
  compatibility with migrations 1–100 is preserved.

## Decision

Accept Ticket 22 with recorded nonblocking risks.

T22-AC1 through T22-AC8 pass:

1. **T22-AC1:** An actual Pi child completing inside budget returns the normal
   inline result with sequence 1 (accepted) and sequence 2 (started), and
   creates no follow-up delivery.
2. **T22-AC2:** An actual child exceeding the budget returns one execution
   handle within budget plus bounded scheduling tolerance, without spawning a
   replacement.
3. **T22-AC3:** Detach changes only parent-tool attachment; child identity,
   attempt, generation, and default `parent_turn` cancellation scope remain
   unchanged.
4. **T22-AC4:** Started and detached-running observations commit durably and
   database reopen recovers the same non-terminal execution aggregate.
5. **T22-AC5:** Default foreground budget is 10 seconds; configured bounds
   (100–60,000 ms) and invalid-value fallback remain effective on the
   production path.
6. **T22-AC6:** Concurrent managed executions and an adjacent legacy session
   retain independent results, timeouts, identities, and behavior.
7. **T22-AC7:** Child settlement, session disposal, startup failure, and
   explicit cleanup remove heartbeat/progress timers and live registry entries
   without stopping unrelated children.
8. **T22-AC8:** Synthetic replacement Agent tools cannot satisfy the real-Pi,
   production-call-chain, or reopen acceptance evidence.

No material contrary evidence requires Reassessment of Decisions 0001–0006.

## Recorded nonblocking risks

1. **Scheduling Jitter Under System Load:** Timer delivery in Node.js relies on
   the JavaScript event loop. High system load can introduce minor scheduling
   variations; test tolerances use a bounded envelope (`foregroundWaitMs - 50ms`
   to `foregroundWaitMs + 2000ms`) to accommodate real-world environments.
2. **Model Network Latency Margin:** In tests where mock models are not injected
   into the child context, child provider timeouts can take up to 15 seconds.
   Foreground wait configuration in tests must provide sufficient margin to
   distinguish between fast inline completion and detach.
3. **Hanging Store Uncertainty:** As noted in Decision 0005, an unbounded
   durable-store hang is a recorded operational uncertainty rather than an
   authorized speculative timeout in this ticket.
4. **Heavyweight Verification Guardrails:** `bun fmt` and `bun lint` were not run
   without explicit owner authorization, per repository governance.

## Rejected alternatives

- **Reject Ticket 22:** Rejected because all 8 acceptance criteria passed and
  the independent review found no blocking issues.
- **Symphony-side `Promise.race`:** Rejected by Decision 0006; Alfie-owned
  arbitration ensures atomic attachment ownership and avoids uncoordinated
  background leaks.
- **Speculative Persistence Grace Constant:** Rejected by Decision 0006; single
  budget-plus-tolerance envelope governs the boundary without adding unverified
  magic constants.
- **Clamping Invalid Foreground Configurations:** Rejected by Decision 0006 in
  favor of safe fallback to the 10,000 ms default.

## Assumptions and residual uncertainty

- Pinned Alfie commit `3cdfbdadcf0f7a1c7ab4af0f8c80ee470a0feadc` accurately
  reflects the tested extension source.
- All candidate commits remain local and unpushed.
- Terminal outcome persistence and coalesced progress delivery remain owned by
  downstream remediation tickets (Ticket 23 and subsequent tickets).

## Downstream effect

- Ticket 22 is accepted and marked completed.
- Ticket 23 (Production coalesced progress and heartbeat delivery) becomes the
  blocker-free remediation frontier.
- Ticket 06 remains blocked until Ticket 24 is accepted.
- Downstream subagent tickets may rely on:
  - Alfie-owned bounded foreground attachment;
  - `bounded-foreground-attachment` negotiated capability;
  - Non-terminal `running (detached)` sequence-3 lifecycle truth;
  - `parent_turn` cancellation continuity across detach; and
  - Deterministic timer/registry cleanup upon all settlement/disposal paths.

## Failure and rollback implications

The candidate and decision remain local. Rollback is local to fixed point
`3f10133b`. Rolling back Ticket 22 restores unbounded foreground wait without
affecting database schema or earlier accepted baselines (Tickets 18–21).

## Reopening conditions

Reopen this decision only for material evidence that:

- a detached child mutates its server-minted identity or attempt ID;
- detach breaks `parent_turn` cancellation propagation;
- an inline completion writes a sequence-3 detached observation;
- a sequence-3 detached observation commits without preceding sequence-2 started
  truth;
- timer or live attachment registry leaks occur across settlement or session
  disposal;
- legacy unhandshaked sessions are subjected to managed timeout/detach behavior;
  or
- candidate source diverges from reviewed HEAD `d2e7a768`.

## Superseded records

None. Decisions 0001 through 0006 remain unchanged.
