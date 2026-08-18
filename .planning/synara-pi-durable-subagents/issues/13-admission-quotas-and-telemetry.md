# 13 — Admission quotas and safe telemetry

**What to build:** Managed admission enforces bounded concurrency, queue, and
wall-time policies before child spawn and reports predictable diagnostics under
load. Operators can observe execution counts, detach and cancellation timing,
progress coalescing and drops, lease expiry, and completion retries using safe
correlation identifiers without exposing prompt, result, or transcript
content.

**Blocked by:** 03 — Managed admission fails closed; 05 — Coalesced progress and
heartbeat leases.

**Status:** accepted and complete — Decision 0017

- [x] **T13-AC1:** Per-provider concurrency retains an initial compatibility
      default of four running agents, while server-wide and per-project queue caps
      are configurable and enforced before spawn.
- [x] **T13-AC2:** Queue or capacity exhaustion returns stable diagnostics and
      never starts a child outside the admitted budget.
- [x] **T13-AC3:** Each execution has a configurable wall-time budget, initially
      two hours, whose expiry records a stable diagnostic and emits the durable
      escalation trigger consumed by ticket 15 rather than silently settling
      projection. This ticket does not implement the watchdog stages.
- [x] **T13-AC4:** Operator telemetry exposes active, queued, cancelling,
      orphaned, and terminal counts plus detach duration, progress coalescing and
      drops, lease expiry, cancel latency, and completion retry metrics.
- [x] **T13-AC5:** Metrics and default logs correlate execution, attempt,
      normalized thread, generation, and diagnostic code without prompt, result,
      transcript, or secret content.
- [x] **T13-AC6:** Sustained admission and progress load keeps queues and memory
      bounded and preserves terminal delivery.
- [x] **T13-AC7:** Invalid limits fall back to safe defaults and cannot create
      unlimited concurrency, queueing, or wall time.

## Testing Seams

**Approval status:** Approved — owner `anhpham99` approved the persisted AC4
`serverGetDiagnostics` mapping on 2026-08-18 with the verbatim confirmation
**“okay duyệt AC4”**. The owner previously approved admission, saturation, and
telemetry-safety seams in the ticket-breakdown review on 2026-08-16.

- **T13-AC1, T13-AC2, T13-AC3, T13-AC7:** Server admission integration boundary
  with concurrency, queue, wall-time, and invalid-configuration fixtures.
- **T13-AC4:** Existing operator metrics surface — concrete mapping below
  (proposed by /matt-implement after repository exploration on 2026-08-18 and
  **approved by owner `anhpham99` on 2026-08-18**): no metrics registry,
  `/metrics` endpoint, or
  Prometheus-style exporter exists in the repository. The highest existing
  stable operator surface is the versioned contract RPC `serverGetDiagnostics`
  → `ServerDiagnosticsResult` (contract schema
  `packages/contracts/src/server.ts`, handler `apps/server/src/wsRpc.ts`,
  client binding `apps/web/src/wsNativeApi.ts`, additive `projection` counts
  block precedent). Proposal: extend `ServerDiagnosticsResult` with an optional
  `piSubagents` block (executionCounts: active/queued/cancelling/orphaned/
  terminal; leaseExpiryCount; detachLatencyMs p50/p95/max; cancelLatencyMs
  p50/p95/max; progress coalesced/dropped; completionRetries) derived from the
  durable repository plus in-adapter timing seams. Existing surfaces are
  sufficient; no new public endpoint is created.
- **T13-AC5:** Telemetry emission boundary — inspect emitted dimensions and
  default logs for safe correlation and forbidden content.
- **T13-AC6:** Saturation/load harness extending ticket 05's deterministic
  progress flood with admission pressure and terminal assertions.

## Implementation Report

### Delivered behavior

- Admission now applies three finite pre-spawn budgets: four admitted
  executions per Pi provider session by default (Pi sessions are thread-scoped),
  64 server-wide, and 16 per project. The count plus admission write is
  serialized by one process-lifetime Effect semaphore, so concurrent requests
  cannot all observe stale capacity and oversubscribe.
- Exact command replays bypass capacity rejection and retain the existing
  `already_applied` / command-identity-mismatch behavior; a replay never starts
  another child. Durable-store read failure fails closed with the distinct
  `pi_subagent_admission_quota_unavailable` diagnostic.
- The default wall-time budget is two hours. A periodic, unref'd adapter timer
  evaluates durable non-terminal records and writes deterministic journal-only
  sequence-60 `pi_subagent_walltime_expired` triggers. It does not mutate the
  execution aggregate or claim that the child stopped; ticket 15 owns staged
  interruption and final truth.
- The approved optional `ServerDiagnosticsResult.piSubagents` block is supplied
  by `serverGetDiagnostics`. SQLite computes bounded execution counts,
  nearest-rank p50/p95/max detach and cancellation latencies, current expired
  lease count, durable progress replacement count, and completion retry count
  without materializing an unbounded sample array in Node.
- `progress.coalesced` and `progress.dropped` intentionally expose the same
  current durable counter: every snapshot replaced by the latest-slot coalescer
  is both coalesced and dropped from emission. The separate fields preserve the
  approved API for a future distinct drop mode.
- Default warnings use one closed safe-correlation constructor containing only
  execution ID, attempt ID, normalized thread ID, generation, and diagnostic
  code. Prompt, result, transcript, summary, reason, and secret content are not
  included.

### Acceptance evidence

| Criterion           | Evidence                                                                                                                                                              | Result |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| T13-AC1 / AC2 / AC7 | Config resolver matrix; admission coordinator quota/race/replay/store-unavailable tests; production adapter wiring                                                    | Pass   |
| T13-AC3             | Pure wall-time policy, durable repository fencing/idempotency test, periodic sweep test, adapter lifecycle wiring                                                     | Pass   |
| T13-AC4             | Contract decode/rejection tests; repository aggregate fixture with exact counts/percentiles; `serverGetDiagnostics` closed result-builder test                        | Pass   |
| T13-AC5             | Closed safe-correlation forbidden-field test plus aggregate-only diagnostics result test                                                                              | Pass   |
| T13-AC6             | 100 concurrent admissions → exactly 4 accepted / 96 rejected; 5,000 progress observations retain one latest slot; terminal state and completion outbox remain durable | Pass   |

Verification on 2026-08-18:

- Ticket-focused server suites: **9 files / 298 tests passed**.
- Contract suites: **2 files / 16 tests passed**.
- Wall-clock suites, run standalone per Decision 0008:
  `piSubagentForegroundAcceptance.test.ts` **6/6 passed** and
  `piSubagentRealExtension.test.ts` **11/11 passed**.
- Workspace `bun fmt`, `bun lint`, and `bun typecheck`: exit 0; lint reported
  existing warnings only (0 errors), and all 7 typecheck tasks passed.
- The single workspace `bun run test` run reached **4,633 passed / 17 skipped /
  3 failed**. Two failures were Decision-0008 wall-clock contention artifacts
  (a concurrent child completed before the expected detach row; a 300 ms detach
  measured 951 ms under full-suite load) and both files passed standalone
  immediately afterward without widening thresholds. The third exposed a real
  stale fault-injection fixture missing the new quota read methods; the fixture
  was repaired and its complete real-extension file then passed 11/11
  standalone.

### Invariants and residual risk

- Admission atomicity is process-local. This matches Synara's current
  single-process server architecture; a future multi-process deployment sharing
  one SQLite database must replace the semaphore/count pair with a
  database-atomic quota reservation.
- No schema migration was added. Metrics derive from the existing execution,
  lifecycle journal, observation, and completion-outbox tables.

### Final acceptance

Binding Project Supervisor Decision 0017 accepts T13-AC1 through T13-AC7.
Ticket 13 is complete and its blocker on Ticket 15 is satisfied.

Completion commit: `8465b0fa`.
