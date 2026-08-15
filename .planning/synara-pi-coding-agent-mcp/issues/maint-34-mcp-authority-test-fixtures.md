# maint-34 — Restore pre-existing server tests by supplying MCP session authority in test fixtures

**What to build:** Repair the 27 pre-existing `apps/server` failures (Decision 33
external blocker) by supplying valid deterministic MCP session
authority/bindings in test fixtures only. No production change, no new test,
no assertion change.

**Blocked by:** nothing — independent of impl-10 (per Decision 33 binding).

**Status:** done

- [x] Reproduce the focused red baseline (27 failed / 356 passed / 3 skipped).
- [x] Provide the `McpSessionAuthority` service through the shared orchestration
      integration test layer.
- [x] Supply deterministic thread-owned authority bindings to every real
      `AgentGatewayCredentials` session lease in the five red fixtures.
- [x] Verify the five focused files green with exact counts and no new
      skips/timeouts.
- [x] Repository completion gate: `bun fmt`, `bun lint`, `bun typecheck`, and
      the root suite must pass together with authorized owner verification.

## Why this ticket exists and what it is not

Decision 33 rejected impl-10 final acceptance because of an external,
pre-existing `apps/server` defect: the identical 27 failures reproduce at the
fixed point `f021e84b` with no server diff, and the missing
`synara/agentGateway/Services/McpSessionAuthority` / runtime receipts sit
outside impl-10's four web files. Decision 33 requires this to be tracked and
fixed separately, outside impl-10 scope.

This ticket **repairs test fixtures for existing tests only**: it changes no
production runtime/service file, no contract, no impl-10 file, no Decision 33
record, and no existing test expectation. Because no new test case is added,
the Decision 20 testing-governance first-new-test gate is **not triggered**;
no seam approval or owner approval claim is made here. This ticket records the
fixture repair and its evidence only; repository verification remains a
separate owner-authorized step.

## Public existing seams repaired (the five red files)

1. `apps/server/integration/orchestrationEngine.integration.test.ts` — 10
   failures: every turn start died with
   `Service not found: synara/agentGateway/Services/McpSessionAuthority` inside
   the reactor's `resolveMcpAuthorityBinding` (Decision 21), so no runtime
   receipt was ever emitted and `waitForReceipt` timed out.
2. `apps/server/src/provider/Layers/OpenCodeAdapter.test.ts` — 9 failures:
   `startSession` provided no `mcpAuthority`, so
   `acquireAgentGatewaySessionLease` failed closed (returned `undefined`) and
   no gateway token was minted/revoked/cancelled for managed sessions.
3. `apps/server/src/provider/Layers/ClaudeAdapter.test.ts` — 5 failures: same
   fail-closed lease seam; no gateway MCP server injected and no
   token/revocation/cancellation observed.
4. `apps/server/src/codexAppServerManager.test.ts` — 2 failures: the teardown
   tests acquired `acquireAgentGatewaySessionLease` without a binding, got
   `undefined`, and `release()` never invoked `revokeSessionToken`.
5. `apps/server/src/provider/Layers/AntigravityAdapter.test.ts` — 1 failure:
   per-turn gateway lease rotation never minted, so no bootstrap token reached
   the spawned process environment.

## Implementation (fixtures only)

New shared fixture helper (used by 5 files, so duplication is materially
removed):

- `apps/server/src/agentGateway/mcpSessionAuthority.testUtils.ts` —
  `makeTestMcpSessionAuthorityFixture()` returns a deterministic in-memory
  registry (`makeMcpSessionAuthorityRegistry` with injected `randomId`), the
  full `McpSessionAuthorityShape` (registry + `mintForLocalOwner` /
  `mintForAuthenticated`, mirroring the existing
  `ProviderCommandReactor.test.ts` and `AgentGateway.test.ts` precedents), and
  `bindingForThread({threadId, provider, projectId})` which mints one
  local-owner record owned by the exact fixture thread, binds the thread, and
  returns an admittable `bindingFor` snapshot. The fixture never weakens
  fail-closed authority validation: admission still requires the owning record
  to be active and unexpired, and a session started without a binding still
  gets no gateway credential.

Fixture wiring per file (nothing else changed):

- `apps/server/integration/OrchestrationEngineHarness.integration.ts` — the
  shared integration test layer now provides
  `Layer.succeed(McpSessionAuthority, fixture.shape)` to the
  `ProviderCommandReactorLive` tree. The registry stays empty by default so
  existing tests keep their unbound behavior (no authority record, no gateway
  credential minted; no identity invented for fixture threads), exactly like
  the `ProviderCommandReactor.test.ts` precedent. No harness path uses real
  `AgentGatewayCredentials`, so no thread binding is required there.
- `apps/server/src/provider/Layers/OpenCodeAdapter.test.ts` — the 9 failing
  tests pass `mcpAuthority: authorityFixture.bindingForThread({...})` into
  their exact `startSession` call (thread ids: `thread-gateway-a/b`,
  `thread-gateway-setup-failed`, `thread-kilo-gateway`,
  `thread-gateway-unexpected-exit`, `thread-gateway-failed-start`,
  `thread-gateway-interrupted-start`,
  `thread-gateway-interrupted-before-install`, `thread-gateway-interrupt`,
  `thread-session-idle`).
- `apps/server/src/provider/Layers/ClaudeAdapter.test.ts` — the 5 failing
  tests pass the same thread-owned binding into their 6 `startSession` calls
  (thread `thread-claude-1`).
- `apps/server/src/codexAppServerManager.test.ts` — the 2 teardown tests pass
  a fixture binding into `acquireAgentGatewaySessionLease`
  (`thread-codex-exit-proof`, `thread-codex-spontaneous-exit`).
- `apps/server/src/provider/Layers/AntigravityAdapter.test.ts` — the per-turn
  rotation test passes the binding into `startSession`
  (`thread-antigravity-turn-lease`).

Every session lease using real `AgentGatewayCredentials` now receives a
binding owned by the fixture thread/provider/session, as production derives at
trusted dispatch (`wsRpc.ts` `bindDispatch`/`bindThread` →
`resolveForCommand` → `bindingFor`). No timeout, skip, retry, fake sleep, or
expectation was introduced or weakened; token revocation and exactly-once
release assertions run against the same fixtures as before.

## Evidence

Red baseline (focused, 5 files, before any change):

```
$ bun run test integration/orchestrationEngine.integration.test.ts \
    src/provider/Layers/OpenCodeAdapter.test.ts \
    src/provider/Layers/ClaudeAdapter.test.ts \
    src/codexAppServerManager.test.ts \
    src/provider/Layers/AntigravityAdapter.test.ts
Test Files  5 failed (5)
     Tests  27 failed | 356 passed | 3 skipped (386)
```

Failure detail: 10 orchestration integration failures show
`Service not found: synara/agentGateway/Services/McpSessionAuthority` →
`IntegrationWaitTimeoutError` ("runtime receipt"); the 17 adapter/manager
failures show empty revoked/cancelled token arrays or `undefined` owner/token
lookups from the fail-closed lease seam.

Green (after fixture repair, same command):

```
Test Files  5 passed (5)
     Tests  383 passed | 3 skipped (386)
```

Per-file: orchestrationEngine.integration.test.ts 11 passed / 1 skipped;
OpenCodeAdapter.test.ts 76 / 0; ClaudeAdapter.test.ts 148 / 0;
codexAppServerManager.test.ts 126 / 2; AntigravityAdapter.test.ts 22 / 0.
The 3 skips are the same tests skipped in the red baseline (unchanged).

## Why no production change and no new test

- The failures are fixture omissions: the production code (fail-closed lease
  acquisition, authority service requirement, per-turn rotation) is the
  intended Decision 21 behavior and was never asserted against by these tests
  before the authority seam landed. Supplying valid fixture authority restores
  the pre-existing green behavior without touching production invariants.
- No new test is needed: these are pre-existing tests being restored; the
  authority/revocation invariants are already asserted by the existing green
  suites (`mcpSessionAuthority.test.ts`, `sessionLease.test.ts`,
  `AgentGateway.test.ts`, `ProviderCommandReactor.test.ts`,
  `wsRpc.connectionLifecycle.test.ts`).

## Invariants preserved

- Fail-closed authority validation is never weakened (fixture still requires
  an active, unexpired, server-minted record; unbound sessions get no lease).
- No missing/stale/foreign binding: every binding is minted by the fixture
  registry for the exact fixture thread/provider used by that test.
- Token revocation and exactly-once release assertions are unchanged and pass.
- No authorization bypass: the fixture mint path is the same registry contract
  production uses; no request-supplied identity is introduced anywhere.

## Out of scope / residual

- Final clean-worktree verification at `96f590a8` passed root test 8/8 tasks,
  `bun fmt`, lint with 0 errors, and typecheck 7/7 tasks.
- The real-Codex integration tests (`itLiveUnlessCi`) run only outside CI and
  were green in the focused run; they exercise the same fixed harness layer.

## Final acceptance

[Decision 37](../decisions/37-maint-34-final-acceptance.md) accepts maint-34 at
`23df500b`. The fixture repair remains outside impl-10 production ownership,
as recorded by Decision 36.
