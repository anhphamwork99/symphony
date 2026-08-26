# Ticket 02 Plan — canonical identity and durable result continuity

**State:** ready-for-agent (WP-01 complete; WP-02 is the current package frontier; Ticket 02 status unchanged)

**Project Home:** [`../../PROJECT.md`](../../PROJECT.md)

**Issue:** [`../../issues/02-canonical-identity-and-result-continuity.md`](../../issues/02-canonical-identity-and-result-continuity.md)

**Binding authority:** [`../../decisions/0002-canonical-execution-identity-and-result-read-contract.md`](../../decisions/0002-canonical-execution-identity-and-result-read-contract.md)

**Plan baseline:** Symphony `93628e465866e9bf24610b4fca39b5c30f459221`; Alfie `aa6fa4a8540644d2509b10d6df854486ddc67d1d`, `@alfie/pi-subagents@0.15.0-alfie.4`. These were the clean baselines recorded before implementation. WP-01 produced the immutable Alfie runtime commit and exact `0.15.0-alfie.5` version bump; WP-04 consumes that commit/version read-only while re-pinning Symphony provenance.

**Date:** 2026-08-26

## Objective

Implement and prove Decision 0002 without opening any later lifecycle ticket. A managed child has one public `executionId` from admission through detached output, result lookup, live observation/control, terminal settlement, reconnect, and restart. Symphony is the durable authority for identity, authorization, result continuity, and the current tuple. Alfie supplies only the exact session-scoped live mapping to its private provider `agentId`.

The implementation is deliberately sequential:

```text
WP-01 Alfie canonical live routing
  -> WP-02 Symphony durable authorized read contract
    -> WP-03 Symphony managed-tool routing and capability gate
      -> WP-04 Symphony provenance re-pin of exact Alfie commit
        -> WP-05 isolated real-Pi acceptance and report
```

No plan step implements Tickets 03–06, changes project status/frontier, or claims Ticket 02 acceptance.

## Baseline and grounding

Ticket 01 established the incident: detached public output exposes the server-minted `executionId`, while pinned Alfie result/control paths perform strict in-memory lookup by provider-local `agentId`; a valid public handle can therefore produce `Agent not found` while the child continues. Symphony already persists execution, attempt, generation, lifecycle, terminal/outbox, and restart evidence. Provider-record absence is not terminal evidence, cleanup proof, owner proof, or permission to replay/Resume.

Decision 0002 resolves the material gate with a bounded Alternatives 2+3 combination:

- one public managed identity (`executionId`);
- exact live tuple mapping `(executionId, attemptId, generation) -> agentId` in Alfie;
- durable-first authorized reads in Symphony;
- durable terminal precedence over live nonterminal state;
- exact-live-only steer;
- bounded deprecated `agent_id` syntax that accepts `executionId` only;
- hard capability boundary equivalent to `execution-identity-routing-v1`.

Supporting grounding: [`../../issues/01-baseline-reproduction-and-decision-matrix.md`](../../issues/01-baseline-reproduction-and-decision-matrix.md), [`../../research/001-live-incident-and-current-seam-map.md`](../../research/001-live-incident-and-current-seam-map.md), and [`../../research/002-candidate-solution-contract.md`](../../research/002-candidate-solution-contract.md). They are evidence, not authority.

## Source locators

### Symphony

- `apps/server/src/provider/Layers/PiAdapter.ts:4174-4235,4268-4435` — managed Agent wrapper, admission, detached identity projection, and provider bridge seam.
- `apps/server/src/provider/piSubagentExecutionReadService.ts` — existing bounded result/transcript read-service shape; inspect whether its authorization and payload contract can be reused rather than duplicating a read authority.
- `apps/server/src/provider/piSubagentExecutionReadBoundary.test.ts` — existing authorized read-boundary failure cases and bounded diagnostics.
- `apps/server/src/persistence/Services/PiSubagentExecutionRepository.ts:17-20,72-130,196-249,714-831` — admission, lifecycle, terminal evidence, current execution lookup, and result/read repository contracts.
- `apps/server/src/persistence/Layers/PiSubagentExecutionRepository.ts:223-559,653-722,1887-1965` — durable row/card conversion and journal/terminal queries; preserve tuple predicates and terminal precedence.
- `apps/server/src/provider/piSubagentManagedRuntimeBinding.ts` — negotiated managed capability and bounded binding diagnostics.
- `apps/server/src/provider/Layers/PiAdapter.ts` capability/bootstrap and managed wrapper seams around `:3588-3765,3997,4268-4435`.
- `packages/contracts/src/piSubagents.ts` — shared capability, execution-card, lifecycle, diagnostic, and managed command vocabulary.
- `apps/server/src/provider/piSubagentForegroundAcceptance.test.ts:905-940,1127-1130,1614-1660` — identity-shape and legacy split evidence.
- `apps/server/src/provider/piSubagentRealExtension.test.ts:138-264,487-493,684-791` — controlled extension provenance and synthetic/lookalike rejection.

### Alfie

- `/Users/anhpham99/alfie/agent/extensions/pi-subagents/src/index.ts:1237-1287` — current managed detail/public identity rendering.
- `/Users/anhpham99/alfie/agent/extensions/pi-subagents/src/index.ts:1948-2219` — Agent result construction and detached result details.
- `/Users/anhpham99/alfie/agent/extensions/pi-subagents/src/index.ts:2219-2255` — current `get_subagent_result` input and strict provider lookup.
- `/Users/anhpham99/alfie/agent/extensions/pi-subagents/src/index.ts:2310-2407` — current `steer_subagent` input and live routing/error behavior.
- `/Users/anhpham99/alfie/agent/extensions/pi-subagents/src/agent-manager.ts:326,1071-1145` — provider-local records and existing managed/owner endpoint resolution seams.
- `/Users/anhpham99/alfie/agent/extensions/pi-subagents/src/index.ts:3347-3492` — capability advertisement, negotiation, and fail-closed response.
- `/Users/anhpham99/alfie/agent/extensions/pi-subagents/test/identity.test.ts`, `agent-tool-execute.test.ts`, `extension-capabilities.test.ts`, `synara-bridge.test.ts` — focused extension contract seams.

Locators are implementation anchors, not permission to widen scope. Workers must re-confirm line ranges at their baseline and record changed symbol names in their reports.

## Immutable decisions

1. `executionId` is the only managed public logical identity. `agentId` is provider-local, never accepted as a public managed handle, and absent from managed output/details/diagnostics.
2. The durable current tuple is `(executionId, attemptId, generation)`. `executionId` remains stable across attempts; attempt and generation fence stale evidence and controls.
3. Symphony resolves authorization, project/thread scope, durable execution, and the current tuple before any provider lookup. Provider lookup cannot choose identity or authorize a request.
4. Alfie owns one exact, bounded, session-scoped tuple index. No global scan, cross-session lookup, durable authority, or provider identity leakage.
5. Managed tools use `execution_id`. A deprecated `agent_id` alias is syntactic only, observable, bounded, and valid only when its value equals the same public `executionId`.
6. Durable terminal evidence wins over conflicting live nonterminal state. Exact live state may supplement nonterminal durable state; missing live state falls back to applicable durable state.
7. Steer is exact-live-only. Missing live state is unavailable control; it never queues, replays, reconstructs, bootstraps, or creates a child.
8. Capability equivalent to `execution-identity-routing-v1` is required for managed composition. Missing, malformed, incompatible, or unbound capability fails closed. Legacy/unmanaged behavior remains legacy and is not relabeled.
9. Existing journal-first terminal truth, authorization, bounded payloads, stale fencing, proof-before-fence, and cleanup/owner uncertainty remain intact.
10. No database migration is authorized or needed for Ticket 02. No watchdog, lifecycle containment, teardown, Resume, bootstrap, guardian, replay, or general Agent UX work is included.

## Evidence-backed implementation choices

- **Alfie first:** make the provider boundary capable of accepting the server-owned tuple without changing the durable authority. This prevents Symphony from depending on an unproven provider-only identity alias.
- **Durable read before live supplement:** use the existing repository/read-service seams and return a bounded durable result/card plus explicit state/diagnostic. Live lookup is an optional supplement after authorization and tuple resolution, never the source of identity truth.
- **Separate routing from pinning:** WP-01 changes the runtime seam, bumps the package version, and commits the runtime plus version together; WP-04 records that exact immutable Alfie commit/version, hashes, clean tree, and controlled artifact in Symphony. A mutable checkout is never evidence.
- **One Symphony routing seam:** WP-03 binds the durable read service and exact provider mapping at the managed adapter boundary, rather than adding a second public tool or global provider registry.
- **Layered evidence:** deterministic repository/read tests prove ordering, fencing, precedence, bounds, and diagnostics; controlled Alfie tests prove the tuple index; real-Pi tests prove production composition. No fixture result is relabeled as real-Pi.

## Migration stance

**No DB migration.** Do not add, edit, reorder, or delete migrations, schema columns, indexes, or historical rows. Use the existing `pi_subagent_executions`/journal/terminal contracts and any already-present result metadata. If implementation appears to require schema change, stop with `challenge` and route the conflict to the owner; do not invent a migration or reinterpret durable evidence. Rollout is capability-gated and fail-closed, so mixed-version managed sessions cannot claim this contract.

## Candidate tuple and read/control algorithm

The candidate tuple is an opaque, validated:

```text
(executionId: public durable logical id,
 attemptId: concrete run id,
 generation: positive current generation)
```

The intended order is:

1. Parse `execution_id`; accept deprecated `agent_id` only as an equal-value alias and record deprecation use. Reject empty, oversized, conflicting, or provider-local values with a stable bounded diagnostic.
2. Resolve project/thread authorization and the durable execution by `executionId`; derive/validate the current `(executionId, attemptId, generation)` tuple. Reject unauthorized/out-of-scope and stale tuple requests before provider access.
3. For reads, load bounded durable aggregate/result/terminal evidence. If terminal, return it regardless of any live report. If nonterminal, consult Alfie's exact tuple index only when the managed capability/session binding is valid.
4. Add a bounded live progress/result supplement only for the exact live tuple. If absent, return the durable state with `live_record_unavailable`-class diagnostic, never public `Agent not found`. If durable evidence is absent, return stable missing-evidence/uncertainty without fabricating a result.
5. For steer, resolve the same durable tuple first, then require the exact live tuple-indexed record. Missing live state returns unavailable-control; no queued/replayed/bootstrap dispatch is allowed.
6. Serialize only bounded public fields. Never serialize `agentId`, raw provider errors, unbounded transcript, or cleanup/owner conclusions from identity absence.

This is a candidate implementation contract to be evidenced by the WPs, not a permission to change later lifecycle semantics.

## Current package frontier

WP-01 is complete in the Alfie repository at immutable commit
`73bc7744f` (`@alfie/pi-subagents@0.15.0-alfie.5`); its completion record and
accepted write-set amendment are recorded in
[WP-01](WP-01-alfie-canonical-live-routing.md). WP-02 is now the next package
and may consume WP-01's exact tuple/binding contract. This is package routing
only: Ticket 02 remains **ready-for-agent**, and neither Ticket 02 final
acceptance nor the Project frontier is changed.

## Dependency graph and work packages

| Order | Work package | Repository | Depends on | Owns |
| --- | --- | --- | --- | --- |
| 01 | [Alfie canonical live routing](WP-01-alfie-canonical-live-routing.md) | `/Users/anhpham99/alfie` | none | exact tuple index, managed public shape, canonical/alias inputs, live result/control seam, extension tests, package version `0.15.0-alfie.5`, one immutable Alfie commit |
| 02 | [Symphony durable read contract](WP-02-symphony-durable-read-contract.md) | Symphony | WP-01 contract shape | authorized durable lookup, current-tuple/fencing, terminal precedence, bounded read result/diagnostics, repository/read tests |
| 03 | [Symphony managed-tool routing](WP-03-symphony-managed-tool-routing.md) | Symphony | WP-02 and WP-01 | capability gate, managed adapter dispatch, live supplement/steer routing, legacy isolation, integration tests |
| 04 | [Provenance re-pin](WP-04-provenance-repin.md) | Symphony | WP-01 immutable Alfie commit/version and WP-03 candidate | read-only verification of exact `ALFIE_T02_COMMIT`/version plus Symphony provenance manifest and pin fixtures |
| 05 | [Real-Pi acceptance and report](WP-05-real-pi-acceptance-and-report.md) | Symphony | WP-04 | isolated real-Pi proof, deterministic/controlled/real evidence split, Issue 02 Implementation Report |

No WP may be started out of order, and no WP may modify another WP's owned files without a reported dependency repair.

## Acceptance traceability

| Ticket criterion | Required proof | Owning WP(s) |
| --- | --- | --- |
| T02-AC1 canonical public identity | detached output/details/result/diagnostic use only `executionId`; tuple stable; provider `agentId` absent | WP-01, WP-03, WP-05 |
| T02-AC2 exact routing and compatibility | `execution_id`; bounded observable alias equal-only; exact tuple index; provider `agentId` rejection | WP-01, WP-03, WP-05 |
| T02-AC3 durable-first authorized continuity | auth/scope/current tuple before provider; terminal precedence; eviction/restart fallback | WP-02, WP-03, WP-05 |
| T02-AC4 live supplement and control | exact live supplement only; missing-live durable fallback; unavailable exact-live steer; no replay/bootstrap | WP-01, WP-02, WP-03, WP-05 |
| T02-AC5 failure/fencing/legacy | stale, unauthorized, missing evidence, oversized, unavailable control, capability failure, legacy bypass | WP-02, WP-03, WP-05 |
| T02-AC6 evidence/provenance | deterministic + controlled Alfie + isolated real-Pi evidence, exact pins and reports | WP-04, WP-05 |

Each evidence row must identify normal and failure directions, exact command, exit code/test count, and source locator. A passing compile/typecheck alone is not evidence.

## Verification envelope

Planning verification is limited to link resolution, whitespace, and planning-only diff. For future implementation, use only focused `bun run test` commands (never `bun test`), in isolated worktrees/runtime configuration. Suggested gates are recorded in the WPs. The repository policy prohibits automatically running `bun fmt`, `bun lint`, or `bun typecheck` for this planning task; they are not part of this plan's proof.

## Rollback and reopening

Rollback is capability/version rollback, not durable-data rewrite. Disable or withdraw the managed capability at a version boundary, preserve all existing durable `executionId`, attempt, generation, terminal, and result evidence, and keep existing reads truthful. Do not map persisted identities back to `agentId`, delete journal rows, reclassify uncertainty, dispatch queued work, or replay a child. The deprecated alias may be disabled only in a bounded fail-closed release that retains canonical `execution_id` reads.

Stop and escalate rather than silently choosing a workaround if: no exact tuple can be carried to Alfie; authorization cannot precede provider access; terminal precedence conflicts with the existing journal contract; the provider seam requires global lookup; a database migration appears necessary; capability binding cannot be made exact; or real-Pi proof requires a synthetic Agent/lookalike artifact.

## Commit and handoff

Future workers commit only their owned implementation/evidence unit, in order, and report full SHA, clean status, exact changed files, and AC evidence. This planning update changes only this Ticket 02 `PLAN.md` and the WP-01
planning record. It does not update `PROJECT.md`, Ticket 02 status/frontier,
decisions, source, migrations, or any other project.

Planning commit:

```text
docs(planning): record Alfie canonical identity routing
```
