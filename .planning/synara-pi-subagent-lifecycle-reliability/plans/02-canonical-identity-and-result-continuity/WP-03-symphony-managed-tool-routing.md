# WP-03 — Symphony managed-tool routing

**State:** pending

**Owner role:** implementation worker

**Repository:** Symphony

**Baseline:** `93628e465866e9bf24610b4fca39b5c30f459221`; WP-01 Alfie commit and WP-02 Symphony commit must be recorded before starting.

**Dependencies:** WP-01 exact Alfie tuple index; WP-02 durable authorized read contract. This is the only WP that wires the managed provider path; WP-04 cannot repin until it passes.

**Authority:** [`../../decisions/0002-canonical-execution-identity-and-result-read-contract.md`](../../decisions/0002-canonical-execution-identity-and-result-read-contract.md), §§2–5.

## Objective

Bind the durable Symphony read contract and Alfie's exact live tuple seam into the managed Pi adapter. Require capability equivalent to `execution-identity-routing-v1`, fail closed for absent/incompatible/unbound managed sessions, route `execution_id` result/control requests through durable-first resolution, permit only exact-live supplements/steer, and preserve legacy/unmanaged behavior unchanged.

## Exact write set

- `apps/server/src/provider/Layers/PiAdapter.ts`
- `apps/server/src/provider/piSubagentManagedRuntimeBinding.ts`
- `apps/server/src/provider/Layers/PiAdapter.test.ts`
- `apps/server/src/provider/piSubagentManagedRuntimeBinding.test.ts`
- `apps/server/src/provider/piSubagentExecutionReadBoundary.test.ts` (narrow integration assertions only, if required to prove adapter ordering)
- `apps/server/src/provider/piSubagentCanonicalRouting.test.ts` (new focused managed-routing suite)
- `apps/server/src/provider/Layers/PiAdapterDesktopManagedBootstrap.test.ts` (synthetic capability fixtures/assertions only for the `execution-identity-routing-v1` hard gate)
- `packages/contracts/src/piSubagents.ts` (only if the WP-02 contract leaves a narrow command/diagnostic wiring gap; otherwise do not touch)
- `packages/contracts/src/piSubagents.test.ts` (only paired contract assertions for that gap)

The conditional contract files are in the allowed set but must remain unchanged if WP-02 already supplies the required vocabulary. No Alfie, migration, issue, Project Home, or provenance files are allowed.

## Prohibited changes

- No changes to durable schema, repository authority, journal/terminal order, watchdog, teardown, cancellation, Resume, provider bootstrap, replay, guardian, or general Agent UX.
- No provider lookup to determine authorization or identity; no `agentId` in public output/error/details.
- No global Manager scan, queued/replayed/reconstructed steer, child creation, or fallback to legacy semantics for a partial managed capability.
- No capability downgrade that claims the Decision 0002 contract, and no relabeling of legacy sessions as managed.

## Implementation contract

1. At managed session/bootstrap, require the exact capability token equivalent to `execution-identity-routing-v1` and bind the successful negotiation to the exact provider session. Missing, malformed, incompatible, or endpoint-unbound capability returns a stable bounded fail-closed diagnostic before managed tool use.
2. For managed result/control calls, normalize `execution_id` first. Allow the deprecated `agent_id` syntax only when equal to that public execution ID, mark it deprecated, and reject conflicting/provider-local values before any provider dispatch.
3. Invoke the WP-02 read boundary to authorize project/thread scope and derive the durable current tuple. The adapter must be able to prove this happens before its live provider callback; stale attempt/generation rejection happens at this boundary.
4. For result reads, return durable terminal/result evidence immediately when terminal. For a nonterminal durable aggregate, ask the exact Alfie tuple route for an optional bounded live supplement. Missing live record returns durable state plus unavailable-live diagnostic, not `Agent not found`.
5. For steer, require the same authorized current tuple and exact-live provider mapping. A missing/non-live mapping returns unavailable-control. The adapter must not queue, replay, bootstrap, reconstruct, or create a child.
6. Keep all outputs bounded and identity-safe. Include only stable public execution/tuple/state/diagnostic fields; remove provider `agentId`, raw provider error, and unbounded live result/transcript.
7. Preserve legacy/unmanaged branch behavior and test that a legacy session neither gains the alias nor receives partial managed capability semantics.
8. Keep routing additive to existing lifecycle reporting. This WP must not change terminal-before-cleanup behavior or infer terminality from a missing live record.

## Tests and evidence contract

Normal directions:

- managed `execution_id` resolves to the same public execution across detached output, durable read, live supplement, and exact-live steer;
- nonterminal live progress/result is bounded and supplements durable state;
- terminal durable success/failure wins over a conflicting live nonterminal report;
- exact tuple isolation holds across two sessions/executions.

Failure directions:

- capability missing, malformed, incompatible, or not bound to the session fails closed;
- unauthorized/out-of-scope and stale tuple are rejected before provider callback;
- provider-local `agentId` and conflicting alias are rejected;
- live eviction returns durable result/read state; steer reports unavailable-control;
- missing durable evidence returns stable uncertainty; oversized output is bounded;
- the desktop managed bootstrap synthetic capability fixture advertises `execution-identity-routing-v1`, its assertions cover the hard gate, and the focused suite passes with 0 failures; no real-pinned artifact test is added here;
- legacy/unmanaged call path remains its prior behavior and does not silently inherit the alias;
- no request causes queued/replayed/bootstrap work or a new child as a read/control fallback.

Add an ordering spy/assertion that records durable authorization/current-tuple resolution before any provider lookup. Include serialized-output assertions that recursively reject `agentId` keys/values in managed public responses.

## Verification commands

```bash
cd apps/server
bun run test src/provider/piSubagentCanonicalRouting.test.ts
bun run test src/provider/Layers/PiAdapterDesktopManagedBootstrap.test.ts
bun run test src/provider/Layers/PiAdapter.test.ts \
  src/provider/piSubagentManagedRuntimeBinding.test.ts \
  src/provider/piSubagentExecutionReadBoundary.test.ts

cd ../../packages/contracts
bun run test src/piSubagents.test.ts

cd ../../apps/server
git diff --check
```

Run with isolated controlled provider configuration when a real session is needed. Never use `bun test`; do not run fmt/lint/typecheck for this planning packet. Record capability request/response, ordering trace, test counts, and all stable diagnostics.

## Commit and self-review

Create exactly one Symphony commit:

```text
feat(pi): route managed tools through canonical execution identity
```

Self-review:

- exact write-set audit passes, including the desktop managed bootstrap fixture, and no conditional contract file changed unnecessarily;
- the desktop managed bootstrap fixture/assertions are synthetic-only, pass with 0 failures, and do not add real-pinned artifact coverage owned by WP-04;
- provider session capability is hard-bound before public managed behavior;
- durable auth/current tuple precedes all provider access;
- terminal precedence, eviction fallback, exact-live steer, alias rejection, and legacy bypass are all covered;
- no `agentId` leaks through output/details/errors;
- no later-ticket behavior changed and no database migration exists.

Report SHA, capability fingerprint/version, ordering trace, focused test commands/results, and the handoff inputs needed by WP-04 and WP-05.

## Escalation

Return `challenge` if the current Pi adapter cannot bind capability to the exact session, if the Alfie route requires a global scan, if durable-first ordering cannot be observed, or if any requested fix would alter lifecycle/Resume/teardown semantics. Do not ship a partial managed fallback.
