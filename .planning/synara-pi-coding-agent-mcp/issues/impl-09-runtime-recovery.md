# impl-09 — Recover MCP operations across restart and reconnect

**What to build:** Resume or safely roll back pending project operations and Pi runtimes after restart, reconnect, resume, or runtime replacement.

**Blocked by:** impl-08 — Propagate project activation across the all-session wait-set.

**Status:** done

- [x] Recover pending operations from durable state and persisted deadline.
- [x] Reconcile future sessions only after the current operation is terminal.
- [x] Use fresh subject-bound credentials and generations after recreation.
- [x] Suppress stale callbacks, duplicate terminal activities, and activation replay.

**Implementation:** All work landed on branch `impl-09-runtime-recovery` in
commit `ef7cd206` (this ticket's docs commit follows). Tests-first through the
approved AC1/AC2 seams; no provider/MCP replay at recovery, no web changes, and
no Pi lifecycle internal changes (existing provider tests already prove the
runtime/session generation boundary). Four vertical slices:

1. **Durable recovery record on every newly created operation.** The contract
   `ProjectMcpActivationOperation` gains an optional `recoveryIdentity` +
   `issuingThreadId` record (new `makeProjectMcpActivationRecoveryIdentity` —
   deterministic, bound to the immutable project/request/generation identity,
   dependency-free FNV-1a so contracts stay browser-bundle-safe). Optional at
   the schema level so pre-impl-09 (legacy) terminal JSON decodes unchanged
   from the durable journal; the planner mints the record on every newly
   created operation (enable and disable, retries included), and the
   server-side CAS validator rejects a new operation without it and enforces
   its immutability across same-request updates. The shared session-generation
   token mint moved to `synaraMcpCommand.ts` (planner, reconciliation, and
   convergence all use the canonical `orchestration:<threadId>:<session.updatedAt>`).

2. **AC1: startup/replay recovery orchestration.** New
   `synaraMcpStartupRecovery.ts` settles every durable pending operation after
   projection bootstrap and before `markCommandReady` (wired in
   `effectServer.ts`, readiness-gated: a blocked recovery fails server start).
   Recovery uses the persisted absolute deadline (never extends it) and
   performs ZERO provider/MCP replay: pending enable journals the durable
   failed-disabled rollback first (old runtimes are gone and cannot be
   re-proven), pending disable converges to succeeded-disabled (every member
   is dormant by construction), and each recovery emits exactly one
   deterministic terminal activity on the issuing thread through the existing
   completion/failure planners (`planSynaraMcpRecovery` re-derives the plan
   from the durable operation). A legacy pending operation without a recovery
   identity blocks startup with a bounded diagnostic naming the operation
   identity. Stale work stops without journaling; deterministic command/activity
   IDs plus journal receipt deduplication make recovery replay-safe.

3. **AC2: runtime/session convergence from the final durable project state.**
   New `synaraMcpSessionConvergence.ts` decides per session at every session
   ensure: any pending operation — enable or disable — makes the session wait
   for the exact operation terminal (a future session never joins the immutable
   wait-set and cannot alter its outcome); a terminal succeeded-enabled state
   activates through the public provider enable boundary with the exact fresh
   session generation (never a stale wait-set token; fresh subject-bound
   authority rides the existing session-start contract); terminal
   failed/disabled, no-operation, missing-project, and unbound states stay
   dormant. The convergence never writes project state, so stale or duplicate
   convergence can never restore enabled state or replay completed work.
   `ProviderCommandReactor.ts` wraps the session-ensure boundary
   (`ensureSessionForThread` → core + best-effort convergence, bounded 30s,
   failure degrades to dormant and retries at the next ensure, never breaks a
   turn start). Recreated runtimes start dormant and converge under their own
   new generation; old credentials/callbacks/catalogs cannot reattach (already
   proven at the provider boundary by impl-06/07/08 tests, unchanged).

4. **Normative ticket update and evidence.** This ticket.

**Focused verification:** `projectActivation.test.ts` 6/6 (new: new-operation
recovery record required, recovery record immutability, new request after
terminal requires the record), `synaraMcpCommand.test.ts` 26/26 (4 new:
deterministic recovery-record minting incl. generation advance on retry,
`planSynaraMcpRecovery` re-derivation feeding the terminal planners,
terminal/legacy refusal, shared session-generation token),
`synaraMcpStartupRecovery.test.ts` 9/9 (AC1: pending enable journal-first
failed-disabled rollback with deterministic terminal and unextended deadline,
elapsed-deadline detail, pending disable succeeded-disabled convergence,
legacy pending/incomplete record blocks startup with bounded diagnostic, stale
settlement stops without journaling, second pass no-op, multi-project
recovery, legacy terminal JSON schema decode, recovery-identity round-trip),
`synaraMcpSessionConvergence.test.ts` 9/9 (AC2: representative decision
states, wait-before-terminal for pending enable and disable, dormant states,
activation with the exact fresh session generation, unavailable/throw/timeout
degradation, no project-state write, legacy terminal-enabled activation),
`synaraMcpProjectReconciliation.test.ts` 12/12, `OrchestrationEngine.test.ts`
23/23 (fixture updated for the recovery record), `ProviderCommandReactor.test.ts`
133/133 incl. 4 new AC2 tests (terminal-enabled project activates on ensure
with the exact session generation before the turn, pending operation waits,
no-operation stays dormant, unproven activation degrades without breaking the
turn). Combined focused set 218/218 across 7 files; full orchestration
directory 600/600 across 45 files; provider Synara MCP suites 173/173;
contracts 204/204; web projection decode 120/120.
`git diff --check` is clean. No `bun fmt`/`bun lint`/`bun typecheck`/`bun test`
were run: the owner did not request the three checks in this conversation, and
the full suite belongs to orchestrator final verification.

**Residual risks:** (1) Startup recovery only settles operations that were
still pending; an operation that reached terminal in the crashed process but
whose terminal activity was not yet journaled (a small crash window between the
operation command and the activity command) is not re-emitted — the work log
then shows the durable pending activity without a terminal. Not in AC1, and
re-emitting would require deriving the terminal for legacy terminal operations,
which the contract does not carry enough identity for. (2) Session convergence
is lazy at session ensure: a session that waited through a pending operation
activates at its next safe session/turn boundary after the operation is
terminal, not via an event fan-out at the terminal transition. Consistent with
Decision 09's safe-boundary semantics. (3) Non-Pi providers without a Synara
MCP runtime succeed by construction through the existing provider boundary.

## Testing Seams

**Approval status:** Approved by owner on 2026-08-12, following designer review.

- **AC1:** Startup/replay reconciliation orchestration boundary — pending operations converge or roll back within the persisted absolute deadline, future sessions wait for terminal state, fresh subject-bound credentials are used, and terminal activities are not duplicated.
- **AC2:** Runtime/session generation boundary — recreated runtimes reject old credentials and callbacks, old catalogs cannot reattach, and stale activation cannot restore enabled state or replay completed work.

Use representative recovery states rather than duplicating the full wait-set matrix from `impl-08`.
