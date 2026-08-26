# WP-02 — Symphony durable authorized read contract

**State:** pending

**Owner role:** implementation worker

**Repository:** Symphony (the assigned current checkout)

**Baseline:** `93628e465866e9bf24610b4fca39b5c30f459221`; confirm the worktree is clean except for no unrelated changes.

**Dependencies:** WP-01 complete and its exact tuple/binding contract documented. WP-03 consumes this durable service; do not implement provider routing or repin Alfie here.

**Authority:** [`../../decisions/0002-canonical-execution-identity-and-result-read-contract.md`](../../decisions/0002-canonical-execution-identity-and-result-read-contract.md), §§1, 3, and 5. Reuse inherited journal-first, authorization, attempt/generation, and bounded-payload rules.

## Objective

Make Symphony the durable authority for managed execution identity, project/thread authorization, current-tuple resolution, and bounded result continuity. Resolve durable state before any provider access; return terminal evidence after provider eviction/restart; supplement only nonterminal durable state with exact live data later; and expose stable diagnostics for missing evidence, stale tuples, authorization failures, and unavailable live state.

## Exact write set

- `apps/server/src/persistence/Services/PiSubagentExecutionRepository.ts`
- `apps/server/src/persistence/Layers/PiSubagentExecutionRepository.ts`
- `apps/server/src/persistence/Layers/PiSubagentExecutionRepository.test.ts`
- `apps/server/src/provider/piSubagentExecutionReadService.ts`
- `apps/server/src/provider/piSubagentExecutionReadBoundary.test.ts`
- `apps/server/src/provider/piSubagentExecutionReadService.test.ts` (new, if the existing boundary test cannot own the service-level matrix)
- `packages/contracts/src/piSubagents.ts`
- `packages/contracts/src/piSubagents.test.ts`

No migration file is in the write set.

## Prohibited changes

- No `apps/server/src/persistence/Migrations/*`, schema/index changes, data rewrite, or new durable identity column.
- No edits to `PiAdapter.ts`, Alfie, managed capability negotiation, watchdog, teardown, Resume, restart dispatch, replay, bootstrap, or general API redesign; WP-03/WP-05 own those concerns.
- No provider lookup before authorization/current-tuple resolution and no authorization by provider `agentId`.
- No unbounded transcript/result payload, raw SQL error, provider error, `agentId`, or guessed terminal/cleanup conclusion in a public response.
- No weakening of existing repository sequence uniqueness, journal-first terminal ordering, or stale generation behavior.

## Implementation contract

1. Define/reuse a bounded public read result carrying `executionId`, current `attemptId`/generation where applicable, durable lifecycle state, terminal/result evidence, and a closed diagnostic vocabulary. The public shape must not contain provider `agentId`.
2. Normalize only the public `executionId` at this boundary. A deprecated `agent_id` alias, if represented in shared input, is accepted only when equal to `executionId`; provider-local values are rejected before repository/provider work and alias use is observable.
3. Perform authorization and project/thread scope checks first, then load the durable execution/current tuple. Derive the current tuple from durable state rather than trusting caller-supplied attempt/generation. Reject stale tuple reads deterministically without changing the logical ID.
4. Read the durable aggregate and terminal/result evidence first. Terminal durable state is authoritative even if a later live supplement reports nonterminal. For nonterminal state, return a bounded durable snapshot and a seam for an exact live supplement; do not require a live provider record for a valid durable read.
5. Distinguish `unauthorized_or_out_of_scope`, `stale_attempt_or_generation`, `durable_terminal_precedence`, `live_record_unavailable`, `missing_durable_evidence`, `payload_bounded`, and capability-related diagnostics using stable bounded codes/messages. Missing live state must not become `Agent not found`.
6. Keep read behavior idempotent and side-effect free. No read may enqueue, replay, Resume, create a child, mutate lifecycle state, or mark cleanup/owner proof.
7. Preserve existing repository contracts and use current table/journal fields. If result payload is unavailable after restart, return an honest bounded uncertainty/missing-evidence result rather than fabricate output.

## Tests and evidence contract

Prove the ordering and failure surface with repository/service fixtures:

- authorized execution resolves by `executionId` with the same current tuple as admission/journal;
- project/thread mismatch and missing authorization deny before a provider callback could be invoked;
- stale attempt and generation are rejected deterministically and cannot read another tuple;
- durable terminal success and failure win over conflicting live nonterminal observations;
- nonterminal durable state can be returned without a live provider record;
- provider-record eviction/restart preserves readable durable terminal/result evidence;
- missing durable aggregate/evidence is bounded and explicitly uncertain, never fabricated;
- oversized IDs/results/diagnostics are bounded;
- canonical input and equal-only deprecated alias behavior is represented without accepting a real provider ID;
- read calls do not dispatch, replay, bootstrap, Resume, or mutate lifecycle/cleanup state;
- public encoded output contains no `agentId` and legacy/unmanaged contracts are not relabeled.

Use the live repository layer where SQLite locking matters; do not open a second `DatabaseSync` against a live WAL writer. For reopen assertions, dispose the live repository before external read-only inspection or use the repository's own reopen seam.

## Verification commands

```bash
cd apps/server
bun run test src/provider/piSubagentExecutionReadBoundary.test.ts \
  src/provider/piSubagentExecutionReadService.test.ts
bun run test src/persistence/Layers/PiSubagentExecutionRepository.test.ts

cd ../../packages/contracts
bun run test src/piSubagents.test.ts

cd ../../apps/server
bun run test src/provider/piSubagentExecutionReadBoundary.test.ts \
  src/persistence/Layers/PiSubagentExecutionRepository.test.ts \
  ../../packages/contracts/src/piSubagents.test.ts

git diff --check
```

Use `bun run test`, never `bun test`. Do not run fmt/lint/typecheck for this planning packet. Capture exit codes, test counts, diagnostics, and the proof that authorization precedes provider access.

## Commit and self-review

Create exactly one Symphony commit:

```text
feat(pi): add durable canonical execution read contract
```

Self-review:

- `git diff --name-only` is exactly within the listed write set;
- no migration/schema source changed;
- repository and read-service public types expose only `executionId` plus bounded tuple/result fields;
- durable terminal precedence and missing-live fallback are tested in both success and conflict directions;
- auth and tuple resolution happen before any live-provider seam;
- legacy behavior and existing terminal/cleanup semantics are preserved;
- all failure diagnostics are closed, bounded, stable, and do not leak provider internals.

Report SHA, changed symbols, focused test output/counts, and any contract that WP-03 must consume.

## Escalation

Return `challenge` if durable result continuity cannot be implemented without a migration, if current repository state cannot distinguish terminal evidence from cleanup/owner uncertainty, or if authorization cannot be proven before provider access. Do not silently add a second durable result authority.
