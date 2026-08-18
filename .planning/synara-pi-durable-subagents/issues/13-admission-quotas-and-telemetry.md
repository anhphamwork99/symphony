# 13 — Admission quotas and safe telemetry

**What to build:** Managed admission enforces bounded concurrency, queue, and
wall-time policies before child spawn and reports predictable diagnostics under
load. Operators can observe execution counts, detach and cancellation timing,
progress coalescing and drops, lease expiry, and completion retries using safe
correlation identifiers without exposing prompt, result, or transcript
content.

**Blocked by:** 03 — Managed admission fails closed; 05 — Coalesced progress and
heartbeat leases.

**Status:** ready-for-agent

- [ ] **T13-AC1:** Per-provider concurrency retains an initial compatibility
      default of four running agents, while server-wide and per-project queue caps
      are configurable and enforced before spawn.
- [ ] **T13-AC2:** Queue or capacity exhaustion returns stable diagnostics and
      never starts a child outside the admitted budget.
- [ ] **T13-AC3:** Each execution has a configurable wall-time budget, initially
      two hours, whose expiry records a stable diagnostic and emits the durable
      escalation trigger consumed by ticket 15 rather than silently settling
      projection. This ticket does not implement the watchdog stages.
- [ ] **T13-AC4:** Operator telemetry exposes active, queued, cancelling,
      orphaned, and terminal counts plus detach duration, progress coalescing and
      drops, lease expiry, cancel latency, and completion retry metrics.
- [ ] **T13-AC5:** Metrics and default logs correlate execution, attempt,
      normalized thread, generation, and diagnostic code without prompt, result,
      transcript, or secret content.
- [ ] **T13-AC6:** Sustained admission and progress load keeps queues and memory
      bounded and preserves terminal delivery.
- [ ] **T13-AC7:** Invalid limits fall back to safe defaults and cannot create
      unlimited concurrency, queueing, or wall time.

## Testing Seams

**Approval status:** Pending — the owner approved admission, saturation, and
telemetry-safety seams in the ticket-breakdown review on 2026-08-16;
`/matt-implement` must identify the highest existing stable operator metrics
surface, persist the concrete AC4 mapping here, and obtain owner approval before
writing the first metrics-surface test.

- **T13-AC1, T13-AC2, T13-AC3, T13-AC7:** Server admission integration boundary
  with concurrency, queue, wall-time, and invalid-configuration fixtures.
- **T13-AC4:** Existing operator metrics surface — concrete mapping below
  (proposed by /matt-implement after repository exploration on 2026-08-18,
  **pending owner approval**; no metrics-surface test is written until the
  owner approves this mapping): no metrics registry, `/metrics` endpoint, or
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
