# Ticket 17 — Integrated real-Pi acceptance review

## Review state

completed

## Scope

- Symphony candidate: `9b6d06cb`
- Base: `46b32d71`
- Candidate range: `46b32d71..9b6d06cb`
- Alfie provenance: `aa6fa4a8540644d2509b10d6df854486ddc67d1d`
  (`0.15.0-alfie.4`)
- Changed production/test surface:
  - `apps/server/src/provider/Layers/PiAdapter.ts`
  - `apps/server/src/provider/piSubagentChildOwnerTeardownWiring.test.ts`
  - `apps/server/src/provider/piSubagentRealPiAcceptance.test.ts`
  - `apps/server/src/provider/piSubagentRealPiAcceptanceHelpers.ts`

This is an independent feature-level review and evidence package. It is not
the Supervisor's final acceptance.

## Verdict

**PASS WITH NOTES.** No material acceptance criterion is contradicted by the
candidate, and no actionable production regression was found. The candidate
is ready for the single Supervisor final-acceptance consultation, with the
AC6 evidence boundary and the non-destructive/manual distinction presented
explicitly below.

## Independent review method

The candidate diff and surrounding production paths were reviewed with
`codex review --base 46b32d71`. The review found no discrete actionable bug
likely to break existing behavior or tests. The review did not run the
destructive manual teardown leg, in accordance with Decisions 0031–0033.

## Verification evidence

Observed on the clean isolated candidate worktree
`/private/tmp/symphony-t17-integration`:

```text
apps/server child-owner + bridge focused tests:
  2 files, 62 passed, 0 failed

integrated real-Pi acceptance:
  1 file, 9 passed, 1 skipped, 0 failed
  the one skipped test is the opt-in destructive manual T17-AC6 leg

bun fmt:
  exited 0

bun lint:
  exited 0, 0 errors, 564 warnings

bun typecheck:
  7/7 workspace tasks successful, 0 errors
```

The first typecheck invocation used the absolute Bun binary without adding
its directory to `PATH`, so Turbo could not locate the declared
`bun@1.3.12` package-manager binary. Rerunning with
`PATH=/Users/anhpham99/.bun/bin:$PATH` passed all seven workspace tasks. The
formatter temporarily changed unrelated workspace files; those generated
changes were reverted immediately because the candidate was clean before
verification. The candidate ended clean with no generated or unrelated file
in its diff.

The required real-Pi command used the pinned local Alfie checkout:

```text
env -u SYNARA_T17_MANUAL_TEARDOWN \
  ALFIE_REPO_DIR=/Users/anhpham99/alfie \
  /Users/anhpham99/.bun/bin/bun run --cwd apps/server test \
  src/provider/piSubagentRealPiAcceptance.test.ts
```

## Criterion evidence

### T17-AC1 — compatible real Pi capability and durable identity: PASS

The integrated real-Pi harness negotiates the pinned Alfie extension, admits a
managed child through the public production WebSocket path, and asserts the
durable execution identity and admission result. The real-Pi acceptance file
passed this stage.

### T17-AC2 — bounded detach and reconnectable execution card: PASS

The observed real-Pi run reported the bounded foreground attachment and
reconnected running execution card. The harness uses isolated state and the
production card projection/reconnect path rather than a provider fake.

### T17-AC3 — real cancellation with honest card state: PASS

The integrated real-Pi cancellation stage passed. Its assertions preserve the
`cancelling` state until terminal evidence and verify stable failure
diagnostics for an inaccessible provider-session path.

### T17-AC4 — batched completion and identity-addressable results: PASS

The real-Pi stage passed with two managed child completions, one bounded
parent follow-up, durable completion acknowledgement, and individual result
retrieval by execution identity.

### T17-AC5 — restart reconciliation without replay: PASS

The real-Pi restart stage passed. The harness reuses the isolated root/database
only for the restart leg, observes the non-terminal execution before restart,
and verifies generation advancement/reconciliation without a new admission or
automatic delegation replay.

### T17-AC6 — watchdog, owned teardown, and fencing: PASS WITH EVIDENCE BOUNDARY

Decision 0031 requires all three legs; no single leg is sufficient:

1. **Mandatory non-destructive real-Pi leg — observed PASS.** The integrated
   real-Pi test passed watchdog progression through bands 70–74, provider
   session stop, teardown handoff, and honest `cancelling` /
   `cleanup_uncertain` state. The candidate accepts both valid provider-stop
   operator branches while retaining the required band-74 cleanup-uncertain
   handoff semantics.
2. **Accepted deterministic contract leg — PASS.** The candidate's
   child-owner/bridge suite passed 62/62 and covers exact identity routing,
   proven and survivor results, malformed/mismatched/stale/unavailable
   replies, endpoint timeout, retry after durable proven-outcome failure,
   restart-empty owner resolution, sibling isolation, and no parent-supervisor
   fallback. The previously accepted Ticket-16 deterministic fixtures remain
   the authority for bands 75–78 and proof-before-fence.
3. **Isolated manual real-Pi leg — recorded operator evidence.** The ticket's
   Implementation Report records the isolated 2026-08-20 operator run with
   the exact child-owner root/descendant PIDs, TERM→KILL evidence, no band 76
   while either exact PID was live, durable bands 75→76, and generation 1→2.
   This review does not rerun that destructive test and does not convert it
   into shared-CI evidence. The manual record remains the sole source for the
   terminal zero-owned-child claim.

### T17-AC7 — legacy/no-bridge fallback: PASS

The real-Pi acceptance passed the capability-absent and stripped-bridge legs.
Those paths retain legacy behavior and are not labeled managed or recoverable.

### T17-AC8 — isolation: PASS

The observed real-Pi run verified an isolated temporary root, home, state
database, agent directories, loopback model endpoint, and ephemeral
non-default port. The harness restores environment state and does not use the
user's active Pi configuration as its agent directory.

### T17-AC9 — loud stable diagnostics and no mock-only success: PASS

The acceptance path is composed from the production WebSocket/server graph and
the real Pi adapter with only the approved deterministic loopback model
endpoint. Failure-stage assertions and stable diagnostics passed. Provider
fakes are not the source of the integrated acceptance result.

## Decision 0033 invariant audit

All reviewed candidate paths preserve the binding managed-child ownership
rules:

- `PiAdapter.ts` registers an owner only when the session is managed, the
  ownership capability is advertised, and the live extracted bridge actually
  exposes `teardownOwnedProcesses`.
- Missing bridge or missing endpoint therefore leaves no retained owner; the
  teardown sweep resolves no owner and produces the non-terminal
  owner-unproven/band-78 path.
- Dispatch uses only the retained opaque owner record and sends the exact
  `executionId`, `attemptId`, and `generation`.
- Invalid, mismatched, stale, thrown, timed-out, or unavailable endpoint
  results are rejected by bridge validation and cannot produce band 76,
  cancellation settlement, or a generation fence.
- A valid `proven` reply is not itself treated as durable proof: the opaque
  owner is retained until the band-76 transaction commits, preserving retry
  after a durable outcome-write failure.
- No parent `PiBashProcessSupervisor` fallback is used for managed-child
  teardown, and Symphony does not discover, cache, reconstruct, register, or
  signal child PIDs/process groups.
- The parent supervisor remains available only for processes it directly owns,
  as permitted by Decision 0033.

The candidate test suite explicitly covers the newly important mixed-version
case where the capability is advertised but the live bridge has no owner
endpoint; it asserts band 78 and zero parent-supervisor calls.

## Findings

No CRITICAL, HIGH, MEDIUM, or LOW actionable findings were identified by the
independent review.

### Notes supplied to final acceptance

- AC6's manual run record is accepted as an operator evidence artifact only;
  it must not be described as an automated destructive pass or as
  deterministic-fixture evidence.
- The candidate's workspace formatter is not a suitable scope-preserving
  commit operation: `bun fmt` rewrote unrelated pre-existing workspace files.
  Those changes were reverted and none are part of the candidate.
- The isolated manual test remains intentionally skipped unless an operator
  explicitly requests a new isolated run and records it.

## Scope audit

- No changes were made to the main branch.
- The main checkout's pre-existing
  `apps/server/.pi/notifications.jsonl` and
  `apps/server/src/diagnostics/Layers/ThreadDiagnosticsQuery.test.ts` remain
  untouched.
- No Alfie source or dependency pin was changed by the Symphony candidate.
- No destructive real-Pi test was rerun or added to shared CI.
- No Ticket-17 checkbox or status was changed before this review.

## Readiness

The candidate and this independent review package are ready for exactly one
Supervisor final-acceptance/reassessment consultation covering Ticket 17 and
the narrow managed-child ownership reassessment in Decision 0033.
