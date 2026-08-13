# impl-07 — Cancel MCP calls and revoke authority on disable

**What to build:** Disable Synara MCP with fence, cancellation, drainage, revocation, cleanup, and runtime reconciliation without aborting the whole Pi turn.

**Blocked by:** impl-04 — Bind Synara MCP authority to the authenticated subject; impl-06 — Implement single-session MCP lifecycle.

**Status:** done

- [x] Fence new calls before asynchronous cleanup starts.
- [x] Cancel and drain active Synara MCP calls, then revoke credentials before reload/clear.
- [x] Return structured `synara_mcp_disabled` errors and ignore late callbacks.
- [x] Keep the Pi turn alive, prevent replay, and leave the session disabled/unavailable on uncertain cleanup.

**Implementation:** The accepted solution is the per-session disable candidate
committed on branch `impl-06-single-session-mcp-lifecycle` on top of
`cb21f8e9` (see the commit record for this ticket). A public
`ProviderService.disableSynaraMcp` per-session operation routes through
`ProviderAdapterShape.disableSynaraMcp` to `PiAdapter`, which delegates to the
per-session lifecycle coordinator through `piSynaraMcpDisable.ts`:

- The coordinator synchronously fences new MCP admission (generation
  retirement, `deactivating` state, and the Pi-local execution registry
  fence), so a registration racing disable is rejected before its handler
  starts (`piSynaraMcpToolExecution.ts`).
- The Pi-local execution registry settles every in-flight Synara MCP tool
  execution exactly once with the structured `synara_mcp_disabled` result
  (`isError: true` via the Pi SDK's rejected-execute conversion) and the exact
  message `Synara MCP is disabled; ask the user to run /Enable Synara MCP`;
  late gateway callbacks are suppressed and calls are never replayed.
- Gateway-side cancellation and drainage use the shared agent-gateway
  in-flight request registry (session-scoped cancel keyed by the retired
  credential's session identity) with the existing two-second bounded
  timeout; credentials are revoked only after the drain barrier settles, or
  best-effort after the drain timeout.
- Resources are cleared immediately; the runtime reload that removes the live
  tool surface runs only at the safe boundary (`agent_end`) when a turn is
  active, or immediately for an idle session and for activation rollback after
  the apply seam ran.
- `session.abort()` is never called from disable: the Pi turn continues with
  coding-agent tools after the structured disabled result.
- Terminal state is `dormant` only when settlement, drain, cleanup, and
  boundary reload are all proven; any uncertainty (drain timeout, cleanup or
  reload failure) leaves the session `unavailable` with a sanitized stable
  detail. Duplicate disables are idempotent.
- The command boundary (`wsRpc.ts`) journals the durable desired-disabled
  acceptance before invoking the provider disable, and journals exactly one
  succeeded/failed terminal activity with `finalState: disabled` driven by the
  provider outcome (`planSynaraMcpDisableTerminal`), bounded by the project
  deadline.

impl-08 (project-wide fan-out/wait-set) and impl-09 (restart recovery) remain
out of scope.

**Focused verification:** `piSynaraMcpToolExecution.test.ts` 8/8,
`piSynaraMcpLifecycle.test.ts` 34/34, `piSynaraMcpDisable.test.ts` 8/8,
`piSynaraMcpExtension.test.ts` 9/9, `PiAdapter.test.ts` 36/36 (8 new AC1
tests), `ProviderService.test.ts` 86/86 (5 new AC1 routing tests),
`synaraMcpCommand.test.ts` 8/8 (2 new terminal tests), `wsRpc.auth.test.ts`
8/8 and `wsRpc.connectionLifecycle.test.ts` 26/26 (unchanged files). Focused
seam pass: 223/223. `git diff --check` passes. The workspace `bun run test`
stalls in the server suite (same as impl-06's acceptance record, Decision
23).

Full server suite evidence is inherited from the implementing agent's single
completed run: `27 failed | 3851 passed | 16 skipped`, with all failures in
five files outside the impl-07 change surface. Both captured rerun logs
(`/tmp/server-full-impl07.log` and the baseline log `/tmp/server-full-baseline.log`) stalled before completing; the captured baseline log shows the
same off-surface failure files failing before the stall
(`codexAppServerManager.test.ts` 2, `OpenCodeAdapter.test.ts` 9,
`ClaudeAdapter.test.ts` 5, `AntigravityAdapter.test.ts` 1) and no impl-07
surface file appears among any captured failure. Baseline equivalence of the
remaining reported failures was not re-proven by the captured reruns.

## Testing Seams

**Approval status:** Approved by owner on 2026-08-12, following designer review.

- **AC1:** Public session/provider disable boundary — new calls are fenced, active calls are cancelled and drained, authority is revoked only after drain, resources are cleaned up, and the runtime is reconciled at a safe boundary; late callbacks cannot mutate state or emit duplicate results and uncertain cleanup leaves the session disabled/unavailable.
- **AC2:** Narrow Pi tool-execution exception seam — a disabled MCP call returns structured `synara_mcp_disabled`, the non-MCP Pi turn continues without whole-session abort, and the cancelled call is not replayed.

The execution seam is limited to turn continuity and no-replay; it is not a general Pi execution test suite.
