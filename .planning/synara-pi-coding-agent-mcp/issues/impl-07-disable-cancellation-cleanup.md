# impl-07 — Cancel MCP calls and revoke authority on disable

**What to build:** Disable Synara MCP with fence, cancellation, drainage, revocation, cleanup, and runtime reconciliation without aborting the whole Pi turn.

**Blocked by:** impl-04 — Bind Synara MCP authority to the authenticated subject; impl-06 — Implement single-session MCP lifecycle.

**Status:** done

**Final acceptance:** Accepted at `fe0c6ba7` by
[Decision 24](../decisions/24-impl-07-final-acceptance.md).

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
  in-flight request registry: the exact active turn's write authority is
  retired first (`retireSessionTurn(token, turnId)`, tombstones the bearer
  synchronously and returns the exact-turn drain barrier), awaited inside
  the bounded drain, then the session-scoped cancel settles the remaining
  requests; credentials are revoked only after the drain barrier settles, or
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

**Follow-up (reviewer finding — no-wait/idle disable):** The reviewer found
that a no-wait disable (empty wait-set) created the operation aggregate with
`aggregateStatus: succeeded` before the provider outcome existed, so an
unavailable/timeout provider result journaled a failed activity while the
durable operation could never be updated (`planSynaraMcpFailure` only
transitions pending operations). Decision 14 requires timeout/uncertain
cleanup to be failed-disabled, never clean success. Fixed in
`synaraMcpCommand.ts`/`wsRpc.ts`: an idle disable now joins the issuing
session to the wait-set as its single member (the contracts aggregate status
derives from wait-set outcomes, so pending/failed cannot be represented with
an empty wait-set), keeping the operation pending until the provider outcome;
the shared `planSynaraMcpDisableResolution` maps dormant -> succeeded,
unavailable/timeout -> failed-disabled with a sanitized detail, replays the
deterministic terminal for already-settled operations without re-transition,
and is used by both the inline and pending provider-disable paths, removing
the duplicated wsRpc orchestration shape found by standards review. Journal-
first ordering and deterministic request/activity IDs are preserved; impl-05
idle-enable immediate settlement is unchanged; a session-less issuing thread
keeps its schema-valid terminal aggregate (its provider outcome is dormant by
construction).

**Focused verification:** `piSynaraMcpToolExecution.test.ts` 8/8,
`piSynaraMcpLifecycle.test.ts` 35/35 (1 new Decision 14 exact-turn identity
handoff test), `piSynaraMcpDisable.test.ts` 10/10 (2 new activeTurnId flow
tests), `piSynaraMcpExtension.test.ts` 9/9, `PiAdapter.test.ts` 37/37 (1 new
Decision 14 retirement-ordering test; the AC2 test now runs through the
mapped custom-tool seam with the exact structured failure, non-MCP turn
continuity, and no session.abort), `ProviderService.test.ts` 87/87 (1 new
AC1 behavioral test through the public disable into the real orchestration
at the Pi adapter boundary), `synaraMcpCommand.test.ts` 14/14 (6 new
Decision 14 no-wait/idle-disable regression tests: pending-until-outcome
operation with the issuing session as its wait-set member, dormant ->
succeeded operation/activity with `finalState: disabled`, unavailable and
timeout -> failed operation/activity with `finalState: disabled` and bounded
sanitized detail, exactly-once journaling through the decider, and
idempotent terminal replay for settled operations), `wsRpc.auth.test.ts` 8/8
and `wsRpc.connectionLifecycle.test.ts` 26/26 (unchanged test files;
`wsRpc.ts` disable outcome handling now routes through the shared
`planSynaraMcpDisableResolution` helper). Focused seam pass: 234/234. `git
diff --check` passes. The workspace `bun run test` stalls in the server suite
(same as impl-06's acceptance record, Decision 23).

Full server suite evidence is inherited from the implementing agent's single
completed run: `27 failed | 3851 passed | 16 skipped`, with all failures in
five files outside the impl-07 change surface. Both captured rerun logs
(`/tmp/server-full-impl07.log` and the baseline log `/tmp/server-full-baseline.log`) stalled before completing; the captured baseline log shows the
same off-surface failure files failing before the stall
(`codexAppServerManager.test.ts` 2, `OpenCodeAdapter.test.ts` 9,
`ClaudeAdapter.test.ts` 5, `AntigravityAdapter.test.ts` 1) and no impl-07
surface file appears among any captured failure. Baseline equivalence of the
remaining reported failures was not re-proven by the captured reruns.

**Typecheck follow-up (impl-07 final verification):** the workspace
`bun typecheck` now fails only on the seven documented pre-existing baseline
errors (cb21f8e9: `agentGateway/httpRoute.test.ts` 37, `McpSessionAuthority.ts`
23, `orchestration/decider.ts` 1119, `projectActivation.test.ts` 201,
`synaraMcpCommand.ts` 417, `wsRpc.ts` 1360 and 2346); all impl-07-introduced
errors are fixed. The critical `wsRpc.ts` disable path shadowed the
`command` parameter with a later block-scoped `const command` (TDZ
use-before-declaration on every Synara MCP command dispatch); the parsed
command is renamed to `synaraMcpCommand`. Focused seam re-verified after the
fix: 234/234 (same per-file counts), plus the four affected test doubles
(`CheckpointReactor`, `ProviderCommandReactor`, `ProviderRuntimeIngestion`,
`ProviderSessionReaper`) pass with the required `disableSynaraMcp` fake
member. `git diff --check` passes.

## Testing Seams

**Approval status:** Approved by owner on 2026-08-12, following designer review.

- **AC1:** Public session/provider disable boundary — new calls are fenced, active calls are cancelled and drained, authority is revoked only after drain, resources are cleaned up, and the runtime is reconciled at a safe boundary; late callbacks cannot mutate state or emit duplicate results and uncertain cleanup leaves the session disabled/unavailable.
- **AC2:** Narrow Pi tool-execution exception seam — a disabled MCP call returns structured `synara_mcp_disabled`, the non-MCP Pi turn continues without whole-session abort, and the cancelled call is not replayed.

The execution seam is limited to turn continuity and no-replay; it is not a general Pi execution test suite.
