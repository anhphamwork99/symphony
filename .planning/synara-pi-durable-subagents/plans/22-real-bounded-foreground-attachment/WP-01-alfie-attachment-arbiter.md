# WP-01 — Alfie bounded foreground attachment arbiter

**State:** pending

**Owner role:** worker

**Repository:** `/Users/anhpham99/alfie`

**Dependencies:** none; parallel-safe with WP-02

## Task

Implement the actual extension-owned foreground attachment arbiter, actual
child-start observation, durable detach observation, managed-only spinner
suppression, exact-child containment on lifecycle-report failure, and complete
Ticket-22 attachment-resource cleanup.

## Context and authority

The extension already owns the concrete child through `AgentManager`.
[Decision 0006](../../decisions/0006-t22-bounded-foreground-attachment-technical-direction.md)
requires Alfie—not Symphony—to arbitrate settlement, deadline, cancellation,
startup failure, and cleanup. [Issue 22](../../issues/22-real-bounded-foreground-attachment.md)
authorizes tests at the actual Pi parent-tool and resource-observation seams.
Decision 0001 requires success/failure pairing and forbids synthetic Agent
replacement as acceptance evidence.

Supporting source:

- `agent/extensions/pi-subagents/src/index.ts`: actual registered Agent,
  foreground spinner, `spawnAndWait`, capability advertisement, bridge.
- `agent/extensions/pi-subagents/src/agent-manager.ts`: record/session/promise,
  `OperationToken`, parent abort, stale settlement, disposal.
- Existing tests: `agent-tool-execute.test.ts`,
  `extension-capabilities.test.ts`, `extension-lifecycle.test.ts`,
  `stale-settlement-guard.test.ts`, and `synara-bridge.test.ts`.

## Allowed write set

- `agent/extensions/pi-subagents/src/index.ts`
- `agent/extensions/pi-subagents/src/agent-manager.ts`
- New focused tests under `agent/extensions/pi-subagents/test/`
- Narrow edits to the five existing tests listed above when required

Do not change package version, dependencies, package scripts, unrelated
extension modules, steer/resume behavior, operation-token semantics, terminal
ownership, or scheduling behavior.

## Implementation contract

### Per-invocation host binding

Read an immutable binding from the actual tool's `effectiveCtx` under the
private symbol agreed with WP-02:

`Symbol.for("synara.pi.subagents.managed_foreground.v1")`.

The structural binding contains server-minted `executionId`, `attemptId`,
`generation`, `cancellationScope: "parent_turn"`, validated
`foregroundWaitMs`, and:

```ts
reportObservation(input: {
  kind: "started" | "detached";
  occurredAt: string;
}): Promise<void>
```

Absence or malformed binding preserves current legacy behavior. Before using a
binding, cross-check its identities with the managed identities injected into
the accepted child invocation. A mismatch is startup failure; do not spawn a
replacement or fabricate identity.

### Actual start and settlement handle

Add only the minimal `AgentManager` seam needed for the Agent tool to retain the
same concrete running record and settlement promise while releasing the parent
tool attachment. The implementation may name the internal primitive after
inspecting current conventions, but it must:

- originate `started` only after the concrete record has entered running
  ownership with its operation token and manager-owned promise installed;
- preserve existing `spawnAndWait` behavior for every legacy caller;
- retain all stale-settlement and supersession guards;
- allow the managed foreground path to observe whether the captured operation
  is still active at deadline without exposing mutable authority globally.

The `started` report must settle successfully before inline result publication
or detach processing continues.

### Single attachment arbiter

Create exactly one deadline timer per managed foreground invocation, starting
when the actual managed foreground branch begins child startup.

- **Child settles first:** clear the timer and live attachment entry; return
  the existing normal inline result; emit no detach event and no completion
  follow-up.
- **Deadline fires first:** re-check the captured concrete operation. If still
  active, await `reportObservation({kind: "detached"})`; only after it commits,
  remove the parent attachment entry, stop managed spinner/update publication,
  and return the server-minted execution handle. Keep the manager record,
  session, operation token, promise, abort listener, and parent scope alive.
- **Settlement and deadline become ready together:** current operation-token
  truth decides. Never detach a settled or superseded operation.
- **Parent abort, startup failure, session disposal, or explicit cleanup:**
  clear the timer and Ticket-22 live entry exactly once and preserve existing
  child/session cleanup behavior.

Do not add a second timeout around `reportObservation`. On a functioning path,
tests must show detached return by `foregroundWaitMs + 500 ms`. A hanging
reporter is a Decision-0006 reassessment trigger.

### Failure containment

If a `started` or `detached` report rejects:

- abort the exact concrete child if it started;
- clear only that invocation's timer and attachment entry;
- return `pi_subagent_lifecycle_persistence_failed`;
- do not return inline success or a successful handle;
- do not claim a terminal lifecycle state;
- do not alter another managed or legacy child.

Symphony owns shared-health degradation; Alfie owns exact-child containment.

### Managed result and resource observation

The detached result must carry the existing server-minted execution,
attempt, and generation identities plus an unambiguous managed disposition of
`detached` and state `running`. Do not expose the local Alfie record ID as
durable authority.

Extend the existing bridge additively with a bounded safe resource snapshot
for AC7, reporting only Ticket-22 attachment/timer counts and managed
execution IDs. It must expose no prompt, result, transcript, or raw error.

The 80 ms spinner remains unchanged for legacy foreground execution and is not
installed/published for managed bounded execution.

## Test-first sequence

1. Fast child: `started` commits before unchanged inline result; no `detached`,
   no follow-up, timer/attachment count zero.
2. Long child: deadline returns one handle; same identities, record, token,
   promise, and parent listener; spawn count one; no abort.
3. Deadline/settlement boundary and superseded-operation boundary.
4. `started` report rejection and `detached` report rejection: exact-child
   containment, stable diagnostic, unrelated child unaffected.
5. Parent abort before and after detach.
6. Startup failure, explicit cleanup, child settlement, and session disposal.
7. Concurrent managed attachments and adjacent legacy execution.
8. Managed spinner absent; legacy spinner unchanged.
9. Missing/malformed binding preserves legacy behavior.
10. Capability advertisement includes `bounded-foreground-attachment`.

Prefer fake timers for deterministic unit cases, but retain at least one
real-timer focused case for scheduling behavior.

## Verification

```bash
cd /Users/anhpham99/alfie/agent/extensions/pi-subagents
bun run test test/bounded-foreground.test.ts
bun run test test/extension-capabilities.test.ts \
  test/synara-bridge.test.ts \
  test/agent-tool-execute.test.ts \
  test/stale-settlement-guard.test.ts \
  test/extension-lifecycle.test.ts
bun run test
```

Record test counts, timer/resource counts, exact identity comparisons, and
failure diagnostics.

## Completion and commit rule

- All focused and full extension tests pass.
- No write occurred outside the allowed set.
- Create exactly one local Alfie commit:
  `feat(pi-subagents): add bounded foreground attachment (issue 22)`.
- Report the full commit hash and clean extension-path status. Do not push.

## Challenge conditions

Stop and return `challenge` if the current manager cannot expose actual start
or retain the same promise without weakening operation-token/stale-settlement
guards; if durable detach cannot meet the single-arbiter contract; or if a
new source file is materially required outside the allowed set.
