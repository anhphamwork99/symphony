# Ticket 16 — Owned process-tree teardown and fencing review

## Review state

completed

## Candidate

- `d5cb137a` — initial Ticket-16 implementation
- `47388a98` — two-axis review remediation
- `73173b9c` — Decision 0027
- `a119a865` — owner-approved Decision 0028
- `2da6aa03` — startup-order remediation
- Alfie unchanged at `489acd626` / `0.14.0-alfie.1`

## Verdict

**PASS WITH NOTES** (reviewer taxonomy: PASS WITH GAPS).

No material acceptance criterion is contradicted or unmet. T16-AC1..AC7 are
supported by direct reproducible evidence. One MAJOR and two MINOR findings
must be supplied to the one Supervisor final-acceptance consultation. This
review is evidence, not final acceptance.

## Confidence and verification

Confidence: **high**.

The reviewer read every changed production file and test at `2da6aa03`, traced
the journal-band and generation-guard logic, and independently reran:

```text
vitest run --maxWorkers=1 --no-file-parallelism \
  src/main.test.ts \
  src/provider/piSubagentStartupRecoveryOrder.test.ts \
  src/provider/piSubagentProcessTeardown.test.ts \
  src/provider/piSubagentTeardownWiring.test.ts \
  src/provider/piSubagentRestartReconciliation.test.ts \
  src/provider/piSubagentProcessTeardownSweep.test.ts

6 files, 76 passed, 0 failed
```

The reviewer did not independently rerun the full suite or
`bun fmt`/`bun lint`/`bun typecheck`; project rules prohibit unsolicited
heavyweight checks. Earlier implementation evidence remains recorded in the
ticket report.

## Criterion evidence

### T16-AC1 — owned-only kill: PASS

- Production dispatch resolves only through the live session's
  `context.processSupervisor.teardownAll()` in
  `apps/server/src/provider/Layers/PiAdapter.ts`.
- No session resolves `undefined`, so no kill occurs.
- `supervisedProcessTeardown.ts` captures the owned tree before signalling,
  verifies the exact root and identity-matched descendants, and guards against
  PID reuse.
- Coordinator and adapter-wiring tests prove unrelated executions and
  session-less startup are never signalled.

### T16-AC2 — idempotent request and durable proof status: PASS

- Band 75 is journaled before dispatch with deterministic event identity.
- Per-kind outcomes use band 76 proven, band 77 survivors, and band 78
  owner-unproven.
- Replay and stale-generation repository guards are exercised directly.

### T16-AC3 — liveness verification before completion: PASS

- Only `proven` settles.
- A successful signal API is insufficient: exact root and captured descendant
  exit must be verified; otherwise `ProviderProcessExitUnprovenError` is
  produced.
- Survivors tests retain `cancelling`.

### T16-AC4 — stable uncertain-cleanup visibility: PASS with F1 note

- Survivors create a band-77 journal-only row and retain a non-terminal
  projection.
- Operator diagnostics use stable fixed vocabulary and safe correlation data.
- PID evidence is bounded to 16.
- F1 below identifies production under-reporting of that bounded PID evidence.

### T16-AC5 — proof-before-fence and stale containment: PASS

- One guarded repository transaction journals band 76, settles `cancelled`,
  and advances the generation.
- The proven operator diagnostic is emitted only after the commit succeeds.
- Late generation-1 terminal evidence cannot revive generation 2 and increments
  `staleTerminalEvents`.

### T16-AC6 — graceful and normal terminal exclusion: PASS

- Entry requires a current attempt/generation band-74 handoff.
- Graceful seq-92 and normal band-40 terminal paths never create that handoff.
- Focused tests prove they dispatch no teardown.

### T16-AC7 — bounded restart discovery: PASS

- Startup order at `2da6aa03` is:
  `recoverCompletionOutbox` → Ticket-16 no-owner discovery → Ticket-10
  reconciliation.
- `piSubagentStartupRecoveryOrder.test.ts` proves exactly one band-75 and one
  band-78 row at generation 1, no kill and no band-76/77/cancelled/proven
  claim, followed by non-terminal `orphaned` generation 2.
- Replay adds no rows or fence; a late generation-1 terminal is history-only
  and counted.
- Existing coverage proves the scan budget is capped at 64 executions.

## Decision reconciliation

### Decision 0027

- Per-kind bands 75–78 are implemented.
- Uncertain-to-proven escalation is proven by a survivors→proven test with both
  immutable rows coexisting and one request row.
- Startup ordering is remediated and covered by integrated deterministic
  evidence.
- One stale ticket-document range remains (F2).

### Decision 0028

- Deterministic CI fixtures carry the T16-AC1..AC7 evidence.
- The isolated manual real-Pi recipe is retained and explicitly not claimed as
  executed.
- No destructive real-Pi CI test is required or introduced.

## Findings

### F1 — MAJOR: production survivor-PID extraction is ineffective

`PiBashProcessSupervisor.teardownAll()` throws an `AggregateError` when any
owned teardown fails. The production teardown resolver in `PiAdapter.ts`
checks only whether the top-level cause is directly a
`ProviderProcessExitUnprovenError`.

As a result, the lifecycle outcome remains honestly uncertain and non-terminal,
but production can lose the known `remainingDescendantPids`; the persisted
survivors metadata is empty and the operator message may report “0 captured
survivors” even though the supervisor identified survivors.

Required final-acceptance disposition:

- remediate by unwrapping `AggregateError.errors`, collecting and bounding
  `remainingDescendantPids`, fixing the message, and covering the production
  resolver; or
- explicitly accept/document the diagnostic limitation as residual risk.

### F2 — MINOR: one stale band-range sentence

Ticket 16's residual-risk section still says bands `75/76` ride the journal.
Decision 0027 reserves `75–78`.

### F3 — MINOR: final formatting evidence is stale

`2da6aa03` introduced inconsistent indentation in the startup block and wiring
test. The recorded `bun fmt` result predates this commit. Project rules require
the final heavyweight verification only when explicitly requested.

### Notes

- The sweep fallback diagnostic for unreachable non-persistence outcomes is a
  cosmetic vocabulary nuance; `outcomeKind` remains truthful.
- Decisions 0027/0028 are routed from the Project Home frontier narrative but
  lack the older decision-list bullet pattern.
- SQL discovery is not limited, but the coordinator processes at most 64
  scanned executions per pass; this matches the accepted bounded model.
- The shared working tree contains unrelated pre-existing formatting edits and
  runtime notification noise; none are part of this candidate.

## Scope audit

- No journal migration.
- No web changes.
- No Alfie or dependency-pin changes.
- No destructive real-Pi CI test.
- Candidate source changes remain within Ticket-16 lifecycle, repository,
  adapter, startup, tests, and planning artifacts.

## Readiness

The candidate is ready for the one Supervisor final-acceptance consultation,
with F1, F2, and F3 presented explicitly. The reviewer grants no final
acceptance.
