# Ticket 22 Implementation Plan — Real bounded foreground attachment

**Plan status:** ready-for-delegation

**Project baseline:** Symphony `3f10133b`; Alfie `2a3f69bd6`

**Normative ticket:** [Issue 22](../../issues/22-real-bounded-foreground-attachment.md)

**Technical authority:** [Decision 0006](../../decisions/0006-t22-bounded-foreground-attachment-technical-direction.md)

**Testing authority:** [Decision 0001](../../decisions/0001-testing-strategy-governance.md)

## Objective

Ship bounded foreground attachment on the actual Pi `Agent` path. A fast child
returns its normal inline result. A child still active at the foreground
deadline returns its durable execution handle while the same child continues
under the original `parent_turn` cancellation scope. Started and detached
observations are journaled durably and survive database reopen. Every
Ticket-22 timer and live attachment entry is cleaned without disturbing an
unrelated child.

## Deliverables and success model

1. **Actual extension behavior:** Alfie owns one attachment arbiter and one
   deadline timer per managed foreground invocation. Managed foreground no
   longer emits the legacy 80 ms spinner stream.
2. **Durable lifecycle:** existing admission remains sequence 1 `accepted`;
   actual child start records sequence 2 `running/started`; successful detach
   records sequence 3 `running/detached` before the handle returns.
3. **Production policy:** Symphony resolves
   `SYNARA_PI_SUBAGENT_FOREGROUND_WAIT_MS` once, with default `10000`, inclusive
   integer range `100..60000`, and invalid-value fallback to `10000`.
4. **Mixed-version safety:** managed semantics require
   `bounded-foreground-attachment`; missing or incompatible capability keeps
   the actual Agent on legacy unmanaged behavior.
5. **Failure containment:** a returned lifecycle-persistence failure degrades
   the shared Ticket-21 control health, aborts the exact affected child,
   preserves prior durable truth, returns
   `pi_subagent_lifecycle_persistence_failed`, and makes no terminal claim.
6. **Acceptance evidence:** exact pinned Alfie source, real-Pi fast/long/
   concurrent/legacy paths, disk reopen, config fallback, timing, cleanup, and
   provenance evidence satisfy T22-AC1 through T22-AC8.
7. **Governance closeout:** Ticket 22's Implementation Report is complete,
   one independent feature-level review is reconciled, and one Project
   Supervisor final-acceptance consultation is performed.

## Current-state grounding

- `apps/server/src/provider/Layers/PiAdapter.ts` wraps the negotiated real
  `Agent`, atomically admits a managed execution, injects server-minted
  execution/attempt/generation identities, then awaits `originalExecute`
  without a foreground bound.
- Production currently records sequence 1 admission only. The existing
  `PiSubagentExecutionRepository.recordLifecycleEvent` API already supports
  attempt/generation-local lifecycle sequence, idempotency, aggregate update,
  journal order, and reopen. Ticket 22 needs no schema or migration.
- Alfie's `agent/extensions/pi-subagents/src/index.ts` foreground Agent path
  starts an 80 ms spinner and awaits `AgentManager.spawnAndWait`.
- Alfie's `AgentManager` owns the concrete child record/session, operation
  token, promise, parent-abort listener, stale-settlement guards, live
  registry, and disposal. This is why the attachment race belongs in Alfie.
- The existing real-extension gate pins the exact Alfie commit and SHA-256 of
  `package.json`, `src/index.ts`, and `src/agent-manager.ts`.

## Binding implementation invariants

- Symphony must not place a `Promise.race` or second foreground timeout around
  `originalExecute`.
- Alfie owns exactly one foreground deadline timer. At expiry it verifies the
  captured operation is still active, awaits the durable sequence-3 write, and
  then returns the handle. `budget + 500 ms` is an acceptance envelope for a
  functioning event loop and local durable write, not another timeout.
- A non-settling lifecycle-store operation is a Decision-0006 reassessment
  trigger. Do not hide it with a late-writing timeout race.
- The managed runtime binding is immutable and per invocation. Symphony places
  it on the copied `effectiveCtx` under a private shared symbol; no global or
  session-wide mutable binding may be overwritten by concurrent Agent calls.
- Detach preserves execution ID, attempt ID, generation, concrete child,
  session, operation token, promise, abort listener, and `parent_turn` scope.
  It does not spawn, resume, clone, reparent, or abort the child.
- Sequence 2 commits before inline or detached publication. Sequence 3 commits
  before a detached handle returns. Both use retry-stable event identities and
  bounded metadata without prompt, result, transcript, or raw error content.
- Cleanup of execution A must not clear, abort, or remove execution B.
- Legacy and unhandshaked sessions retain their current behavior and receive no
  managed or durable labeling.

## Explicit non-goals

No Ticket-06 durable cancellation or acknowledgement; no Ticket-23 progress,
heartbeat, or saturation policy; no terminal lifecycle, completion outbox, or
follow-up coordinator; no queue, quotas, watchdog, UI, transcript pagination,
scheduled execution, or true continuation across server restart; no schema
migration; no remote push, publication, deployment, or release.

## Work-package graph

```text
WP-01 Alfie attachment arbiter ─────────────┐
                                            ├─> WP-03 production integration
WP-02 Symphony contract/config foundation ──┘        + provenance re-pin
                                                           │
                                                           v
                                              WP-04 integrated acceptance
                                                           │
                                                           v
                                              WP-05 review + final gate
```

- WP-01 and WP-02 are parallel-safe because they use separate repositories and
  disjoint write sets.
- WP-03 starts only after WP-01 has a clean committed Alfie hash and WP-02 is
  integrated.
- WP-04 and WP-05 are strictly sequential.
- No worker may write outside its declared write set. A newly discovered write
  need is a `challenge`, not implicit permission to expand scope.

## Acceptance traceability

| Criterion | Primary packages    | Required proof                                                   |
| --------- | ------------------- | ---------------------------------------------------------------- |
| T22-AC1   | WP-01, WP-04        | Actual fast child returns unchanged inline result; no follow-up  |
| T22-AC2   | WP-01, WP-03, WP-04 | One handle by budget + 500 ms; same child; spawn count one       |
| T22-AC3   | WP-01, WP-04        | Identity, token, promise, and parent scope unchanged             |
| T22-AC4   | WP-03, WP-04        | Ordered seq1/2/3 and same running aggregate after disk reopen    |
| T22-AC5   | WP-02, WP-03, WP-04 | Default/range/fallback and production-path elapsed evidence      |
| T22-AC6   | WP-03, WP-04        | Concurrent managed and adjacent legacy isolation                 |
| T22-AC7   | WP-01, WP-04        | Cleanup matrix, zero attachment resources, unrelated child alive |
| T22-AC8   | WP-03, WP-04, WP-05 | Exact clean pinned Alfie source; synthetic replacement rejected  |

## Verification ladder

1. Alfie focused arbiter, stale-settlement, lifecycle, and bridge tests.
2. Symphony contracts, config, bridge, adapter, control-health, and repository
   focused tests.
3. File-backed SQLite detach/reopen evidence.
4. Real-extension fast, long, concurrent, legacy, failure, and cleanup paths
   against the exact clean Alfie pin.
5. Full Alfie extension and Symphony server suites.
6. One independent review, followed by one Supervisor final acceptance.

Use `bun run test`; never use `bun test`. Do not run Symphony `bun fmt`,
`bun lint`, or `bun typecheck` unless the owner explicitly authorizes those
heavyweight checks. Alfie's tracked package `pretest` remains part of its own
normal `bun run test`.

## Commit and provenance strategy

1. WP-01 creates one local Alfie commit; no push.
2. WP-02 creates one local Symphony foundation commit; no push.
3. WP-03 pins the exact WP-01 Alfie commit and recomputes the existing tracked
   artifact hashes, then creates one local Symphony integration commit.
4. WP-04 may create one test commit and one report commit.
5. WP-05's reviewer and Supervisor are read-only. The main orchestrator
   persists the accepted final Decision Record and tracker updates in one
   planning commit after reconciling their outputs.

## Rollback

The change is additive and capability-gated. Reverting either implementation
side must cause capability negotiation to fall back to legacy unmanaged
behavior, not partially apply bounded semantics. Provenance prevents a
mismatched checkout from satisfying acceptance. No schema rollback is needed.

## Status

- [ ] WP-01 — Alfie bounded attachment arbiter
- [ ] WP-02 — Symphony contract/config/binding foundation
- [ ] WP-03 — Symphony production integration and Alfie re-pin
- [ ] WP-04 — Integrated acceptance evidence and Implementation Report
- [x] WP-05 — Independent review and Supervisor final acceptance (acceptance since reopened; see below)
- [x] WP-06 — Alfie post-detach settlement cleanup and failure-result shape (reopened AC7 + shape fix) — **accepted** in Decision 0008
- [x] WP-07 — Symphony production config wiring and acceptance-evidence hardening (reopened AC5 + AC1/AC2/AC6 evidence) — landed `e2239c6e`..`40016836`; challenge adjudicated to WP-08 — **accepted** in Decision 0008
- [x] WP-08 — Test-harness process isolation for wall-clock-sensitive suites (owner option (b)) — **challenge**: attribution disproven; config kept per owner option (A), envelope acceptance = per-file standalone. Evidence: `WP-08-challenge-evidence.md`

## Post-acceptance reopening (2026-08-17)

An independent post-acceptance review (evidence reproduced: Alfie 464, contracts
215, Symphony focused 29 passing; provenance hashes verified) reopened Decision
0007 under its own reopening conditions. Ticket 22 status returned to
remediation; see the disposition block in
[the ticket](../../issues/22-real-bounded-foreground-attachment.md). WP-06 and
WP-07 are the remediation packages; they are parallel-safe across repositories,
but WP-07's provenance re-pin must wait for the WP-06 Alfie commit. Ticket 23
must not start until ticket 22 is re-accepted.
