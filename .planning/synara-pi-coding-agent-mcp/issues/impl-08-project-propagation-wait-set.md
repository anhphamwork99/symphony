# impl-08 — Propagate project activation across the all-session wait-set

**What to build:** Make one project-level enable/disable operation reconcile every current Pi session, wait for all current sessions, and roll back globally on any failure.

**Blocked by:** impl-02 — Persist project MCP activation operations; impl-05 — Implement Synara MCP commands and durable acknowledgements; impl-06 — Implement single-session MCP lifecycle; impl-07 — Cancel MCP calls and revoke authority on disable.

**Status:** done

- [x] Snapshot the current session wait-set and exclude future sessions.
- [x] Reconcile sessions independently with a 120-second absolute deadline.
- [x] Commit enabled only after every session succeeds.
- [x] On any failure, timeout, or unsafe disappearance, commit disabled and clean every session, including successful siblings.
- [x] Serialize races and ignore stale operation/session generations.

**Implementation:** One project-level enable/disable operation now reconciles
every current Pi session through the public provider boundary, waits for all
of them, and rolls back globally on any failure. All work landed on branch
`impl-06-single-session-mcp-lifecycle` (see the commit record for this
ticket). Three vertical slices, each test-first through approved public
seams:

1. **Provider per-session enable boundary.** New
   `ProviderAdapterShape.enableSynaraMcp({ threadId, expectedSessionGeneration })`
   → bounded `ProviderEnableSynaraMcpResult` (`active`/`unavailable`,
   `alreadyActive`, stable sanitized `detail`), routed by
   `ProviderService.enableSynaraMcp` (Services + Layers) to the Pi adapter.
   `piSynaraMcpEnable.ts` drives the existing per-session
   `coordinator.activate` machinery (impl-06) — the packet's "Pi enable
   machinery" — and applies the safe boundary immediately for idle sessions
   by pumping `adapter.notifySafeBoundary()` (an idle Pi runtime never emits
   `agent_end`), stopping the pump once a turn starts so the surface is never
   applied mid-turn. Stale-generation protection: the durable wait-set token
   must bind to the exact thread (`orchestration:<threadId>:` prefix) — a
   stale or misrouted generation is refused before any staging; a missing
   live session, mid-deactivation, or disposed coordinator is a bounded
   fail-closed `unavailable`; the result is idempotent for already-active
   sessions and re-enables sessions left `unavailable` by a failed
   activation. The command boundary normalizes throws/timeouts through the
   shared `runProviderSynaraMcpEnable` wrapper (bounded sanitized detail,
   never a real 120-second wait).

2. **All-current-session wait-set + per-member durable outcomes.** The
   planner (`synaraMcpCommand.ts`) now captures every current session
   (`thread.session !== null`) into the immutable deterministic wait-set for
   both enable and disable; future sessions never join an accepted operation
   (the decider already enforces wait-set/deadline/createdAt immutability and
   the failed-enable rollback transition). New
   `planSynaraMcpMemberOutcome` journals each member's succeeded outcome
   independently and recomputes the aggregate, refusing resolutions that do
   not match the current operation's request id, operation generation,
   wait-set membership, and captured session generation; completion/failure
   guards gained explicit operation-generation correlation. New
   `synaraMcpMemberStatus` reports an unsafe disappearance per member.

3. **Command-boundary fan-out reconciliation.** New
   `synaraMcpProjectReconciliation.ts` reconciles the pending operation
   sequentially in deterministic wait-set order: per-member liveness check,
   bounded provider enable/disable call with the remaining deadline, durable
   member outcome journaled with a fresh CAS read, then exactly one
   deterministic terminal. Any failure, timeout, or unsafe disappearance
   journals the durable failed-disabled operation first (journal-first),
   fans out disable cleanup to every captured member (successful siblings
   included, best-effort and bounded), and emits exactly one failed terminal.
   A disable member whose session disappeared is dormant by construction.
   Stale work (settled/superseded operation) stops and journals nothing;
   replay produces no duplicate side effects or terminal. `wsRpc.ts` drives
   the module through seams (read model, dispatch, bounded
   `runProviderSynaraMcpEnable`/`runProviderSynaraMcpDisable`, clock) for
   both pending enable and pending disable, replacing the old
   wait-status polling and the inline single-session disable resolution.

`ProviderServiceShape.enableSynaraMcp` is declared optional with a doc note
(the live service always provides it) so the four impl-07 test doubles
(CheckpointReactor, ProviderCommandReactor, ProviderRuntimeIngestion,
ProviderSessionReaper — outside this ticket's write set) compile unchanged;
`wsRpc.ts` fails closed if the member is ever absent. Coordinator internals
(`piSynaraMcpLifecycle.ts`) were not modified.

**Focused verification:** `piSynaraMcpEnable.test.ts` 9/9 (idle immediate
boundary, active-turn natural boundary, turn-start pump stop, idempotent
duplicate, stale/misrouted generation refusal, deactivating refusal, disposed
refusal, activation-failure mapping with revoke + no partial tools,
re-enable after unavailable), `ProviderService.test.ts` 99/99 (6 new impl-08
tests: delegation with the wait-set generation, unavailable passthrough,
no-binding fail-closed unavailable, no-runtime adapter idempotent success,
adapter failure propagation, and an AC1 behavioral test running the real
coordinator + enable helper through the public operation incl. idempotent
duplicate and stale-generation refusal), `synaraMcpCommand.test.ts` 22/22 (6
new impl-08 tests: all-current-session deterministic wait-set for enable and
disable, future-session exclusion for an accepted operation, per-member
outcome journaling with all-success commit, stale session generation /
non-member / stale operation generation refusals, member status liveness;
the impl-05 idle-enable immediate-settlement test now asserts the impl-08
all-session capture with the session-less immediate case), and
`synaraMcpProjectReconciliation.test.ts` 10/10 (AC1 multi-session enable
success with per-member tokens and one terminal; AC2 member failure →
failed-disabled rollback + sibling cleanup + one failed terminal, unsafe
disappearance rollback, member timeout rollback, expired-deadline rollback
with a fake clock — never a real 120-second wait, settled/superseded stale
work stop, replay no-op, multi-session disable fail-closed, disappeared
disable member dormant-by-construction, all-dormant disable one succeeded
terminal). Focused seam pass: 206/206 across the seven impl-08 files, plus
the four impl-07 test doubles 254/254 and adjacent lifecycle suites 115/115.
`git diff --check` passes. `bun fmt`, `bun lint` (0 errors), and
`bun typecheck` pass with only the seven documented pre-existing baseline
errors (impl-07 record, line-shifted by formatting: `httpRoute.test.ts` 37,
`McpSessionAuthority.ts` 23, `decider.ts` 1119, `projectActivation.test.ts`
201, `synaraMcpCommand.ts` 401, `wsRpc.ts` 1408 and 2394).

**Full suite evidence:** the full server suite completes with
`27 failed | 3903 passed | 16 skipped` across the same five off-surface
files documented in impl-07's acceptance record (`codexAppServerManager`
2, `OpenCodeAdapter` 9, `ClaudeAdapter` 5, `AntigravityAdapter` 1, and the
environment-dependent `integration/orchestrationEngine.integration` 10 with
`WaitForTimeoutError` runtime-receipt timeouts — none of the five files
imports or references any impl-08 surface symbol). No impl-08 surface file
appears among any failure. Baseline equivalence: the impl-07 record's
captured baseline shows the same four files failing with the same counts
(2/9/5/1) before its suite stalled; this ticket's run completed.

## Testing Seams

**Approval status:** Approved by owner on 2026-08-12, following designer review.

- **AC1:** Project lifecycle command → provider reconciliation orchestration — the current session wait-set is captured immutably, each member is reconciled independently, future sessions are excluded from that operation, all-session success commits enabled, and one terminal outcome is journaled.
- **AC2:** Orchestration failure/restart boundary — a failed, timed-out, or unsafe-disappearing session causes global rollback and sibling cleanup; absolute deadline, operation/session generations, race serialization, and no replay are preserved. Use a controllable clock rather than a real 120-second wait.

This ticket owns project-wide atomic behavior; per-session lifecycle and durable persistence details remain owned by `impl-02`, `impl-06`, and `impl-07`.
