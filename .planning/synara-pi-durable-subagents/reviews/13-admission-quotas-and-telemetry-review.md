# Ticket 13 — Admission quotas and safe telemetry final review

**Date:** 2026-08-18
**Reviewer role:** independent feature-level reviewer
**Scope:** complete uncommitted Ticket 13 candidate in Symphony
**Verdict:** **PASS**
**Confidence:** high

## Criterion verdict

| Criterion | Verdict | Principal evidence |
| --- | --- | --- |
| T13-AC1 | PASS | Finite 4/64/16 defaults; production policy wiring; durable budget-state count; provider/project/server cap tests |
| T13-AC2 | PASS | Stable capacity and store-unavailable diagnostics; rejection before child construction; durable rejected audit; replay identity preserved under full quota |
| T13-AC3 | PASS | Pure fail-safe policy; deterministic fenced journal-only sequence-60 trigger; unref'd sweep; no aggregate settlement or control dispatch |
| T13-AC4 | PASS | Owner-approved optional `serverGetDiagnostics.piSubagents` contract; bounded SQL aggregates; exact count/percentile fixture; production handler wiring |
| T13-AC5 | PASS | Closed five-field safe-correlation constructor; aggregate-only metrics; forbidden-content tests |
| T13-AC6 | PASS | 100 concurrent admissions produce exactly 4 accepted / 96 rejected; 5,000 progress observations retain one latest slot; terminal outbox survives |
| T13-AC7 | PASS | Nullish, non-finite, fractional, and out-of-range values fall back to finite defaults through unit and production config seams |

## Independent verification

- Ticket-focused server suites: **9 files / 298 tests passed**.
- Contract suites: **2 files / 16 tests passed**.
- Decision-0008 standalone wall-clock verification:
  `piSubagentForegroundAcceptance.test.ts` **6/6 passed** and
  `piSubagentRealExtension.test.ts` **11/11 passed**.
- Reviewer confirmed the current fault-injection fixture delegates the new
  `getByCommandId` and `listNonTerminalExecutions` reads before injecting the
  intended admission-write failure.
- Reviewer executed the telemetry SQL against an empty migrated schema and
  confirmed every exposed metric returns zero rather than `NULL` or an error.
- No new migration, endpoint, prompt/result/transcript field, or ticket-15
  watchdog action was introduced.

## Findings

No blocking findings.

1. **Low — telemetry query history scan:** detach/cancel percentile CTEs scan
   lifecycle history without a sequence/state partial index or time window.
   Decision 0014 leaves windows to implementation; optimize only if diagnostics
   latency becomes material.
2. **Low — diagnostics coupling:** a Pi telemetry SQL failure currently fails
   the full `serverGetDiagnostics` request through `Effect.all`, matching the
   existing projection-count behavior. A future best-effort optional block may
   improve degradation behavior.
3. **Trivial — defensive fallbacks:** several adapter-side `?? DEFAULT_*`
   fallbacks are unreachable after `ServerConfigLive` resolves the validated
   values, but remain harmless.
4. **Documented invariant:** quota atomicity is process-local. A future
   multi-process server sharing SQLite requires database-atomic reservation.

The reviewer initially noted that `completionRetries` sums `attempt_count`.
Repository semantics establish that outbox entries start at zero and increment
only on retryable delivery failure, so this is the durable retry count rather
than a count including the initial delivery attempt.

## Scope audit

The source diff is Ticket-13-scoped: config, production config wiring,
repository service/layer, Pi adapter, WebSocket diagnostics handler, contracts,
focused tests, and this ticket's planning artifacts. The runtime-generated
`apps/server/.pi/notifications.jsonl` file is explicitly excluded and remains
unstaged.
