# Ticket 03 Plan — terminal-before-cleanup and live lifecycle containment

**State:** in progress (WP-01 and WP-02 complete; WP-03 is the current package frontier)

**Project Home:** [`../../PROJECT.md`](../../PROJECT.md)

**Issue:** [`../../issues/03-terminal-before-cleanup-and-live-lifecycle-containment.md`](../../issues/03-terminal-before-cleanup-and-live-lifecycle-containment.md)

**Binding authority:** [`../../decisions/0006-live-lifecycle-containment-linearization-contract.md`](../../decisions/0006-live-lifecycle-containment-linearization-contract.md), preserving local Decision 0003 and inherited durable-subagent Decisions 0012, 0021, 0025, and 0027–0034.

**Plan baseline:** Symphony `541fe4d34dffe8d1c81eb3f53f4d6f0745cd1be6`; intervening commits after Decision 0006 are documentation/whiteboard work and do not alter the grounded Ticket 03 source seams. Re-ground if those seams change before execution.

**Controlled provider boundary:** Alfie `3fe340b401ca86bcbe8b55abd4de107e1d93482e`, `@alfie/pi-subagents@0.15.0-alfie.6`; Pi SDK `@earendil-works/pi-coding-agent@0.83.0`.

**Date:** 2026-08-27

## Objective

Implement Decision 0006's volatile exact-tuple/session-instance live lifecycle containment proxy without changing Alfie.

Preserve three independent truth axes:

1. terminal truth linearizes only at the existing sequence-band-40 journal/aggregate transaction;
2. live observation/control is available only through an active exact `(executionId, attemptId, generation, providerSessionInstance)` registration; and
3. cleanup proof and generation fencing remain exclusive to the successful band-76 transaction.

Provider inactivity, callback absence/retirement, timeout, lost response, persistence failure, bands 70–75, band 77, and band 78 remain uncertainty rather than terminal or cleanup proof.

## Accepted implementation seam

- New `piSubagentLiveLifecycleContainment.ts` owns the process-local registry, exact session/tuple revalidation, pre/post-acceptance classification, synchronous retirement, session clearing, fixed internal reasons, and injected trace seam.
- `piSubagentManagedRuntimeBinding.ts` remains the durable-first provider-call boundary. It captures the existing managed result/steer callbacks and delegates authorized nonterminal live access through containment.
- `Layers/PiAdapter.ts` composes one containment instance per provider session, uses `runtime.session` object identity as the opaque session instance, activates only after durable sequence-2 `started`, retires synchronously before terminal ingest, and clears before runtime disposal.
- `piSubagentTerminalCoordinator.ts`, repository transactions, watchdog, and teardown remain authoritative and unchanged unless a bounded plan amendment is approved.
- Alfie `.6` remains unchanged; its exact tuple/live guard and Decision 0003 synchronous steer insertion are consumed as provider-owned boundaries.

## Immutable constraints

- No Alfie/provenance change, migration, schema change, new band, lifecycle state, public API/identity, or timeout configuration.
- No `agentId`, raw session/PID/process group, provider scan, parent fallback, durable callback/owner receipt, buffering, replay, reconstruction, bootstrap, automatic Resume, guardian, or new child.
- No server-clock liveness lease; a bounded invocation deadline only limits one call.
- No automatic retry after provider acceptance may have occurred.
- Callback absence/retirement never implies terminal, cancellation, cleanup, owner loss, or zero owned processes.
- Terminal notification remains post-commit; only successful band 76 proves cleanup and fences generation.
- Destructive zero-owned-child proof and Tickets 04–06 remain out of scope.

## Required containment behavior

A session-scoped containment instance must support endpoint capture, exact activation, observe/control invocation, synchronous retirement, and exact session clearing. Capture alone does not activate. Activation follows successful durable sequence 2. Entry and post-await response paths revalidate tuple, registration identity/epoch, active state, and provider-session object identity. Retirement is permanent and precedes terminal ingress. Clearing precedes provider runtime disposal.

Classifications:

- `pi_subagent_live_lifecycle_unavailable`: proven pre-acceptance failure; zero provider effect. Reasons: `provider_inactive`, `callback_missing`, `callback_disposed`, `callback_mismatched`, `callback_timeout_before_acceptance`.
- `pi_subagent_live_lifecycle_outcome_unknown`: acceptance may have occurred; no retry or zero-effect claim. Reasons: `callback_lost_after_acceptance`, `callback_timeout_after_acceptance`, `callback_failed_after_acceptance`.
- `pi_subagent_live_lifecycle_stale_ignored`: tuple/session/registration revalidation failed; no current mutation or follow-up action.
- Optional `pi_subagent_terminal_late_applied`: emitted only after a current same-generation terminal commits following volatile route retirement; observational only.

Required causal trace points:

```text
durable_authorization
current_tuple_resolved
callback_lookup
callback_entered
callback_revalidated
provider_acceptance
callback_retired
journal_commit | journal_failure
notification | notification_suppressed
response_revalidated
return_unavailable | return_outcome_unknown | return_stale | return_applied
session_cleared
```

Elapsed time is never causal proof.

## Dependency graph

```text
WP-01 containment core and diagnostics
  -> WP-02 production lifecycle integration and deterministic races
    -> WP-03 controlled-Alfie + isolated real-Pi evidence/report
      -> WP-04 independent review
        -> WP-05 ticket closure and routing
```

All packages are serial. No parallel write overlap is permitted.

## Work packages

| Order | Package | Primary output |
| --- | --- | --- |
| 01 | [Containment core and diagnostics](WP-01-containment-core-and-diagnostics.md) | **complete** — reusable registry, managed binding integration, diagnostics, unit evidence |
| 02 | [Production lifecycle integration](WP-02-production-lifecycle-integration.md) | **complete** — PiAdapter activation/retirement/disposal and deterministic lifecycle races |
| 03 | [Controlled and real-Pi evidence/report](WP-03-controlled-and-real-pi-acceptance-report.md) | unchanged `.6` proof, isolated real-Pi evidence, Ticket 03 report |
| 04 | [Independent review](WP-04-independent-review.md) | criterion-level review artifact and disposition |
| 05 | [Ticket closure and routing](WP-05-ticket-closure-and-routing.md) | accepted Ticket 03 and Ticket 04 frontier, only after PASS |

## Acceptance traceability

| Criterion | Owning packages |
| --- | --- |
| T03-AC1 journal-first bounded terminal | WP-02, WP-03, WP-04 |
| T03-AC2 deterministic terminal/cleanup/current/stale races | WP-02, WP-03, WP-04 |
| T03-AC3 bands 70–78 and cleanup uncertainty preserved | WP-02, WP-03, WP-04 |
| T03-AC4 exact owned runtime only | WP-01, WP-02, WP-03, WP-04 |
| T03-AC5 stable inactive/loss/persistence/late diagnostics | WP-01, WP-02, WP-03, WP-04 |

## Verification policy

Use `bun run test`, never `bun test`. Start with the smallest owning feature and failure proofs. Real-Pi runs use Node Vitest, isolated roots/home/agent/database/workspace, loopback model endpoint, and serialized wallclock execution.

Repository policy requires `bun fmt`, `bun lint`, and `bun typecheck` before Ticket 03 closure. Current project instructions prohibit running them without explicit owner authorization, so WP-03 must request that authorization at the final verification gate; WP-05 remains blocked until they pass.

## Rollback and reopening

Rollback disables the containment path fail-closed while retaining durable evidence. It must not restore global lookup, retry accepted controls, recreate routes, reinterpret uncertainty, change bands, or alter Alfie provenance.

Return `challenge` if exact session identity, sequence-2 activation, synchronous pre-ingest retirement, pre/post acceptance distinction, band-40/band-76 authority, bounded diagnostics, or no-Alfie-change feasibility is contradicted by source evidence.
