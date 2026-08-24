# Handoff — child Bash ownership gap blocks Ticket 17 AC6

**Recipient:** Pi durable-subagent runtime maintainer (Alfie child-session
runtime + Symphony Pi integration owner)

**Status:** Investigated blocker. Do not close T17-AC6 or Ticket 17.

## Goal

Make managed Alfie subagent child Bash processes execution-scoped, supervised,
and teardown-provable so Synara may write Ticket-16 band 76 only after the
actual child process tree is gone.

## Current state

At Symphony `5468d1c1` with local uncommitted Ticket-17 harness work and Alfie
`489acd626` / `@alfie/pi-subagents@0.14.0-alfie.1`:

- The normal runner passes **9 automated stages** with manual teardown skipped:
  `/Users/anhpham99/.bun/bin/bun run --cwd apps/server test src/provider/piSubagentRealPiAcceptance.test.ts`.
- AC1–AC5, AC7–AC9 and AC6's required real-Pi watchdog-through-band-74 leg are
  evidenced. The manual leg is opt-in:
  `SYNARA_T17_MANUAL_TEARDOWN=1 /Users/anhpham99/.bun/bin/bun run --cwd apps/server test src/provider/piSubagentRealPiAcceptance.test.ts -t 'MANUAL T17-AC6'`.

- The opt-in manual run is **red**. It must remain red until this issue is
  fixed; its band-76/card results are false-proof evidence, not acceptance
  evidence.

## Problem summary

The production Ticket-16 teardown coordinator writes `teardown_proven` (band
76), settles the execution `cancelled`, and fences its generation even though
the real TERM-ignoring Bash process launched by the managed subagent remains
alive.

The manual reproducer observed, ten seconds after band 76:

```text
PID 64349  PPID 63513 (Vitest node)  PGID 64349  Ss
bash -c echo $$ > "$1"; trap "" TERM; sleep 300 bash <isolated-pid-file>
```

This is neither a zombie nor PID reuse: the test continuously observes the
same exact command and process identity. The PID is cleaned only after the
test process itself exits.

## Root cause

The current ownership scopes differ:

1. Symphony creates `PiBashProcessSupervisor` once per **parent** Pi session
   in [PiAdapter.ts](apps/server/src/provider/Layers/PiAdapter.ts). It injects
   that supervisor only into the parent session's custom `bash` ToolDefinition.
   Its private `activeProcesses` set contains only PIDs spawned through those
   custom operations.
2. Alfie creates each managed subagent **child** `AgentSession` in
   `/Users/anhpham99/alfie/agent/extensions/pi-subagents/src/agent-runner.ts`
   with `tools: allowedTools` and no `customTools`/Bash-operations seam.
3. The child therefore selects the SDK builtin Bash implementation, which raw
   spawns a detached shell. It is not in the parent supervisor's process set.
4. Ticket-16 resolves teardown solely from the parent session's
   `processSupervisor.teardownAll()`. The set is empty, so it returns
   successfully; `resolvePiSubagentOwnedTeardown()` maps that to `proven` and
   the repository commits band 76.

The Ticket-17 harness records PIDs produced by the actual parent supervisor
`spawnProcess` seam. The live Bash PID is absent from that observer before any
teardown occurs. This falsifies PID reuse, active-set cleanup races, and
parent-session custom-tool precedence as explanations.

## Evidence

| Evidence                                                           | Location                                                                                                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Real-Pi integrated harness plus opt-in manual repro                | `apps/server/src/provider/piSubagentRealPiAcceptance.test.ts`                                                            |
| Test-only real server/WS harness, parent-supervisor spawn observer | `apps/server/src/provider/piSubagentRealPiAcceptanceHelpers.ts`                                                          |
| Parent session custom Bash injection                               | `apps/server/src/provider/Layers/PiAdapter.ts` (`createSdkRuntime`, `makePiBashProcessSupervisor`)                       |
| Parent-only active process tracking / `teardownAll()`              | `apps/server/src/provider/Layers/PiAdapter.ts` (`makePiBashProcessSupervisor`)                                           |
| Exact root-and-descendant proof contract                           | `apps/server/src/provider/supervisedProcessTeardown.ts`                                                                  |
| Band 75–78 coordinator / proof-before-fence transaction            | `apps/server/src/provider/piSubagentProcessTeardown.ts`                                                                  |
| Alfie child session construction with no `customTools` seam        | `/Users/anhpham99/alfie/agent/extensions/pi-subagents/src/agent-runner.ts`                                               |
| Alfie child spawn call and pass-through boundary                   | `/Users/anhpham99/alfie/agent/extensions/pi-subagents/src/agent-manager.ts`, `index.ts`                                  |
| Existing destructive-test governance                               | `decisions/0028-t16-real-pi-destructive-test-substitution.md`                                                            |
| T17 AC6 three-leg seam and owner approval                          | `decisions/0031-t17-ac6-destructive-boundary-evidence-split.md`, `decisions/0032-t17-ac6-testing-seam-owner-approval.md` |

## Recommended remediation

Create one **child-scoped supervisor per Alfie-created AgentSession** and retain
it on the immutable managed record:

```text
executionId + attemptId + generation
  → child AgentSession / child supervisor / child-owner bridge endpoint
```

Alfie must:

1. Create the child supervisor before constructing the child session.
2. Inject its Bash tool through that child session's `customTools`, while
   retaining the normal `tools: allowedTools` authorization policy.
3. Associate the supervisor with the exact managed execution identity.
4. Seal child Bash admission before a teardown zero-process proof.
5. Expose an identity-fenced bridge operation:

   ```ts
   teardownOwnedProcesses({
     executionId,
     expectedAttemptId,
     expectedGeneration,
   });
   ```

   It returns only `proven`, `survivors`, `stale`, `missing`,
   `owner_unavailable`, or `dispatch_failed`, plus safe correlation and bounded
   survivor evidence.

6. Retain the opaque child-owner endpoint across parent provider-session stop
   when a current-generation band-74 handoff exists.

Symphony must:

1. Negotiate a new required capability, for example
   `child-bash-process-ownership`.
2. Use the exact opaque child-owner endpoint for managed child teardown.
3. Never fall back to `context.processSupervisor` for managed-child band
   75–78 processing.
4. Map unavailable ownership to band 78 and survivors to band 77. Only a
   matching child-owner `proven` result may create band 76.
5. Re-pin Alfie provenance after its release.

## Explicitly rejected alternatives

- **Sharing the parent supervisor with every child:** teardown of one child can
  affect sibling or parent Bash processes; the ownership identity is too broad.
- **Reporting child PIDs to Synara for direct registration or killing:** unsafe
  under PID reuse, stale generation, descendant escape, and forbidden by the
  teardown authority model.
- **Treating an empty parent supervisor, `session.abort()`, child promise
  settlement, or an empty active registry as teardown proof:** all are false
  proof sources.
- **Requiring real destructive CI:** still prohibited by Decision 0028 unless
  its isolated/deterministic envelope conditions are separately demonstrated.

## Required regression strategy

### Alfie deterministic tests

- Supervised custom Bash injection (not builtin raw spawn), stale/missing
  identity no-effect, sibling isolation, sealing race, TERM-ignoring
  root/descendant outcomes, and endpoint retention across parent stop.

### Symphony deterministic tests

- Empty parent supervisor + live/unavailable child owner → band 78, never 76;
  child-owner survivors → bounded band 77; only matching child-owner proven →
  existing proof-before-fence band 76. Retain current 75–78, retry, fencing,
  stale-generation, and startup no-owner coverage.

### Real-Pi evidence

- Keep T17 automated stage 6 non-destructive: real watchdog through band 74,
  honest `cancelling`, and no bands 75–78.
- Add a non-destructive real-Pi ownership check showing the real child Bash PID
  belongs to the child supervisor and not the parent supervisor.
- Rerun the manual TERM-ignoring child only after both repos are updated and
  repinned. The operator record must show exact commits, isolated environment,
  execution/attempt/generation, child-owner identity, PID ownership, TERM→KILL,
  bands 75 then 76, root/descendant absence, cancelled card, and fenced
  generation.

## Governance and authority required

This changes Ticket 16's accepted ownership boundary, so do **not** implement
under Issue 17 alone.

1. Project Supervisor must decide whether the child-owner endpoint supersedes
   the parent-supervisor portion of Decision 0030 while preserving bands
   75–78 and proof-before-fence.
2. Human owner must approve revised manual AC6 wording. Decision 0032 reopening
   condition 3 applies because the Ticket-16 teardown baseline/manual recipe
   changes materially.
3. Alfie owner must approve the child supervisor lifecycle and bridge contract.

## Current constraints / don'ts

- Do not close T17-AC6, mark Issue 17 complete, or cite the red manual run as
  success.
- Do not remove the manual spawn-observer assertion; it is the regression seam.
- Do not add broad PID/process-name kill logic or export process handles to
  Synara.
- Do not use parent `PiBashProcessSupervisor` as fallback for managed child
  teardown.
- Do not change existing Ticket-16 band meanings without the governing decision.
- Do not claim an automated destructive real-Pi pass.

## Handoff instruction

Implement the child-owner supervision protocol across Alfie and Symphony only
after the required governance decision, then rerun deterministic regressions,
the non-destructive real-Pi stages, and the isolated manual T17-AC6 proof.
