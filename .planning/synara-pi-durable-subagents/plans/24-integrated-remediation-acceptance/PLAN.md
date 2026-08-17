# Ticket 24 — Integrated remediation acceptance and review closure

**Status:** in implementation
**Date:** 2026-08-18
**Governed by:** Issue 24, Decisions 0001–0009, approved Testing Seams (owner 2026-08-16).

## Settled design (orchestrator decisions, binding)

Ticket 24 is an acceptance gate, not a feature: it must prove the integrated
production system fixes the reviewed defects of tickets 01–05 and produce the
reviewer-ready evidence package that reopens ticket 06.

### 1. One integrated acceptance file (WP-A)

New `apps/server/src/provider/piSubagentIntegratedAcceptance.test.ts` in the
`wallclock` vitest project. It chains, in ONE file with sequenced `it()` blocks
sharing a hermetic fixture, the full production path:

```
(1) DB startup over three histories (fresh temp / Symphony lineage /
    upstream-v0.7.2) → migrations converge → repository ready   [T24-AC1]
(2) real pinned extension load → handshake matrix (compatible; partial/
    unsupported; failing; legacy stripped-capability copy)      [T24-AC2]
(3) managed spawn: authority binding → atomic admission → child starts
    only after admission; concurrent replay idempotency        [T24-AC3]
(4) injected persistence failure → no child start → degraded health →
    fail-closed re-admission attempts → existing truth preserved →
    recovery via fresh authorized command                       [T24-AC4]
(5) fast child inline completion + slow child bounded detach (budget +
    500 ms envelope, per-file standalone method) → stable identity →
    parent_turn scope → real-chain DB reopen (close + reopen repository
    on the same file → same aggregate/journal/observation)      [T24-AC5]
(6) real progress + heartbeat (loopback deterministic slow model) →
    durable observation + lease; deterministic saturation flood with
    lifecycle reserve; runtime-event stream contains ≤ rate-capped
    tool.progress (reconnect evidence); cleanup releases timers/
    attachments/coalescer entries                              [T24-AC6]
```

Reuse patterns (NOT cross-file imports — copy locally): deterministic loopback
model server + agent dirs + ModelRuntime registry context
(piSubagentProgressAcceptance.test.ts), stripped-capability extension copy +
provenance verification (piSubagentForegroundAcceptance.test.ts), three-history
DB construction (Migrations/MigrationLineageReconciliation.test.ts), control
health injection (piSubagentProgressObservation.test.ts observing repo layer).

### 2. Settled interpretation decisions

- **AC1 "in the integrated candidate":** the integrated file boots the real
  migration + repository chain over all three histories (convergence + schema
  verification per history), then runs the runtime chain on the fresh
  history. The Symphony/upstream histories prove lineage convergence at
  startup; the fresh history carries the live chain.
- **AC6 "reconnect":** no new WS server is booted. Evidence = (a) real-chain
  repository reopen restoring latest observation without intermediate
  history; (b) the runtime-event stream during the flood contains at most
  rate-capped tool.progress events (what any reconnect snapshot/cursor-resume
  could ever deliver); (c) pre-existing web auto-follow guard (unchanged).
  Same argument the ticket-23 reviewer accepted for T23-AC8.
- **Decision 0009 obligation (lease trusts producer occurredAt):** ticket 24
  adds NO lease-based control. Report records the standing obligation and
  forwards it to ticket 06 (first potential lease consumer). Server-side
  clamp is deferred until a consumer exists.
- **AC7 second matrix:** 31 criteria (T01 6, T02 6, T03 6, T04 6, T05 7) each
  mapped: remediation ticket → source evidence (file:anchor) → verification
  command → result. None may rely only on a synthetic Agent fixture; every
  ticket 01–05 group must include at least one real-Pi reproduction
  (RealExtension / ForegroundAcceptance / ProgressAcceptance /
  IntegratedAcceptance file).
- **AC8 clean environment:** verification recorded from the current checkout
  at the final commit; commands, exit codes, counts documented in the report;
  workspace fmt/lint/typecheck exit 0; full apps/server suite green; Alfie
  extension suite green at the pinned commit.
- **AC9/AC10:** exactly one independent criterion-level review after the
  report is complete; tickets 01–05 statuses move to complete (with Decision
  reference) only after review + final acceptance; ticket 06 gate documented.

### 3. Work packets

- **WP-A (Symphony worker):** the integrated acceptance file + its local
  helpers; wallclock project registration; per-file standalone green; full
  suite green.
- **WP-B (orchestrator):** AC7 matrix in the issue report; AC8 verification
  log; reviewer dispatch; Supervisor final acceptance; tickets 01–05 status
  updates; PROJECT.md frontier update.

## Verification gates

- `bun run test src/provider/piSubagentIntegratedAcceptance.test.ts`
  standalone green (wallclock convention), twice.
- Full apps/server suite green; workspace fmt/lint/typecheck exit 0.
- Alfie suite green at d35644a3b (no new Alfie changes permitted in this
  ticket — provenance pin must remain valid).
