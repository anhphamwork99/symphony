# WP-01 — containment core and diagnostic vocabulary

**State:** pending

**Owner role:** implementation worker

**Dependencies:** persisted Ticket 03 plan; controlled Alfie `.6` available read-only.

## Objective

Implement the reusable volatile exact-tuple/session-instance containment core and route the existing managed result/steer wrapper through it, without changing PiAdapter lifecycle ordering yet.

## Exact allowed write set

- `apps/server/src/provider/piSubagentLiveLifecycleContainment.ts` — new
- `apps/server/src/provider/piSubagentLiveLifecycleContainment.test.ts` — new
- `apps/server/src/provider/piSubagentManagedRuntimeBinding.ts`
- `apps/server/src/provider/piSubagentCanonicalRouting.test.ts`
- `apps/server/src/provider/piSubagentManagedRuntimeBinding.test.ts`
- `packages/contracts/src/piSubagents.ts`
- `packages/contracts/src/piSubagents.test.ts`

## Prohibited changes

No `PiAdapter.ts`, terminal/repository/watchdog/teardown/cancellation/Resume source, real-Pi helpers, migration, schema, public route, capability token, timeout knob, planning status, Alfie, or provenance change. No global registry, provider scan, `agentId`, PID, parent fallback, durable registration, queue, retry, replay, bootstrap, Resume, or child creation.

## Implementation contract

1. Add a pure containment module with no Pi SDK, SQL, filesystem, or provider-global import.
2. Construct one explicit instance per provider session; no module-global mutable state.
3. Use exact public tuple plus opaque provider-session object identity and an internal registration identity/epoch.
4. Capture original managed result and steer callbacks once; capture does not activate.
5. Expose activate, observe, control, retire, and clear-session operations for WP-02.
6. Revalidate tuple/session/registration/active state before invocation and before exposing a late response.
7. Retired/disposed/replaced routes are permanent and cannot be reconstructed.
8. Classify pre-acceptance failure as unavailable with proven zero provider effect.
9. Classify possible post-acceptance response loss as outcome unknown and never retry.
10. Preserve Decision 0003: steer guard rejection before insertion is unavailable; synchronous insertion first is accepted exactly once.
11. Add four fixed diagnostic codes to the closed contract vocabulary; keep reason enums internal.
12. Extend managed binding so durable authorization/current tuple and terminal precedence remain before containment access; legacy/unmanaged behavior remains unchanged.
13. Bound and sanitize all output/metadata; expose no provider identity or arbitrary error text.
14. Trace observation is dependency-injected for tests only; no environment hook or public API.

## Required evidence

Normal: exact observation, one applied steer, idempotent activation, sibling and equal-public-tuple cross-session isolation, durable terminal provider bypass.

Failure: all unavailable/outcome-unknown reasons; stale attempt/generation/session; zero provider calls for missing/disposed/mismatched; no retry after possible acceptance; retirement during in-flight call cannot restore route; session clear removes registrations/endpoints; no `agentId`, raw session, PID, stack, or unbounded provider output.

## Acceptance mapping

T03-AC4 and T03-AC5; primitives for AC1/AC2.

## Verification

```bash
cd apps/server
bun run test src/provider/piSubagentLiveLifecycleContainment.test.ts \
  src/provider/piSubagentCanonicalRouting.test.ts \
  src/provider/piSubagentManagedRuntimeBinding.test.ts

cd ../../packages/contracts
bun run test src/piSubagents.test.ts

git diff --check
```

Record exact tests, provider call counts, diagnostic/reason matrix, and boundedness scan.

## Commit boundary

```text
feat(pi): add exact live lifecycle containment proxy
```

## Handoff

Commit SHA, changed symbols, containment API, diagnostic matrix, dispatch counters, no-Alfie/no-PiAdapter proof, and WP-02 integration instructions.

## Escalation

Return `challenge` if the exact callback/session seam requires Alfie change, cannot distinguish pre/post acceptance, or requires global/durable routing, migration, public API, new capability, retry, or bootstrap.