# Decision 25: Reassessment of impl-07 final acceptance after corrective commit 531b719a

Status: Accepted reassessment
Date: 2026-08-13

## Question

Does material post-acceptance evidence require Decision 24 to be kept,
amended, or superseded, and does corrective commit
`531b719aeeb99ab9417342f9267870a0f71be2f1` restore every impl-07 invariant
that Decision 24 purported to accept?

## Governing references

- [Project Home](../PROJECT.md)
- [Decision 24: impl-07 final acceptance](24-impl-07-final-acceptance.md)
- [impl-07 ticket](../issues/impl-07-disable-cancellation-cleanup.md)
- [Decision 13: Disable cancels active Synara MCP calls](13-disable-cancels-mcp-calls.md)
- [Decision 14: Disable cancellation and revocation sequence](14-disable-cancellation-sequence.md)
- [Decision 20: Testing strategy governance](20-testing-strategy-governance.md)

Supporting evidence:

- Post-acceptance reviewer artifact `c0640969`.
- Main-agent confirmation of both reported defects in the accepted source.
- Corrective commit `531b719aeeb99ab9417342f9267870a0f71be2f1`.
- Corrective delta `47c8370e...531b719a`.
- Independent corrective-delta review reporting both blockers closed and no
  actionable finding.
- Focused corrective verification: 498/498 tests across 13 impl-07 files.
- Workspace typecheck: exactly seven documented baseline errors, zero new
  corrective-delta errors.
- Clean `git diff --check`.

## Reassessment

Keep Decision 24 as amended.

Decision 24's original acceptance at `fe0c6ba7` was invalidated by material
post-acceptance evidence. The accepted implementation had two real defects:

1. Its Pi-facing execution registry was permanently fenced. Because the same
   registry survived runtime reactivation, disable followed by enable still
   rejected mapped Synara MCP tool calls.
2. A thrown `ProviderService.disableSynaraMcp` failure escaped both command
   branches to the outer RPC error path. That could leave a journaled pending
   disable operation without the required failed-disabled terminal.

Both defects directly met Decision 24 reopening conditions. Accordingly,
impl-07 was not validly accepted during the interval after these defects were
confirmed and before their correction.

Corrective commit `531b719a` closes both blockers. Impl-07 is accepted again at
corrected HEAD `531b719aeeb99ab9417342f9267870a0f71be2f1`.

The complete accepted implementation range is fixed point `cb21f8e9` through
corrected HEAD `531b719a`. The post-acceptance corrective delta is
`47c8370e...531b719a`, where `47c8370e` records Decision 24 above the
previously accepted implementation.

Decision 24 remains the governing original final-acceptance record except where
this reassessment amends its accepted HEAD, evidence, assumptions, residual
risk, downstream effect, and reopening conditions. Reliance on `fe0c6ba7`
alone is no longer authorized.

## Blocker 1: disable → enable → tool admission

Closed.

The corrected execution registry is generation-scoped rather than permanently
session-fenced. `resetForFreshActivation` permanently retires the old
generation with its own pending map and installs a new generation only through
the lifecycle coordinator's proven `onActivationCommitted` seam.

This satisfies the required behavior because:

- successful re-enable creates a fresh admission generation and mapped tool
  calls are admitted again;
- the retired generation remains fenced permanently;
- stale executions and late callbacks retain references only to the retired
  generation and cannot mutate, settle, or enter the fresh generation;
- the new generation is not installed before activation is proven;
- a disable requested while activation is queued or running is recorded
  synchronously, causing the newly committed generation to start fenced;
- duplicate, refusal, and settled queued-disable paths clear their transient
  queued-disable marker without leaking a fence into an unrelated later
  activation.

## Blocker 2: thrown provider-disable failure

Closed.

Both disable command branches now invoke the provider operation through
`runProviderSynaraMcpDisable`. The helper bounds the wait and catches thrown
provider failures locally. A thrown failure becomes an unavailable outcome with
a sanitized and bounded diagnostic.

Both pending and non-pending command shapes then use the shared
`planSynaraMcpDisableResolution` path:

- a pending operation reaches one failed operation outcome and one failed
  terminal activity;
- the terminal uses `finalState: disabled`;
- the diagnostic is sanitized and bounded;
- a settled operation is not transitioned again;
- deterministic replay uses the existing terminal identity and does not create
  a second terminal;
- the provider exception cannot escape to the outer RPC logging path while
  leaving the durable operation pending.

## Criterion-level rationale

### Accepted impl-07 invariants

- **Synchronous admission fence:** Pass. Disable fences the current execution
  generation before asynchronous cleanup; a racing activation commits its fresh
  generation already fenced.
- **Exact-turn retirement and drainage before revocation:** Pass. The correction
  does not alter the accepted ordering or bounded barrier.
- **Exactly-once structured Pi settlement:** Pass. Generation replacement does
  not reuse or transfer pending entries.
- **Late-callback suppression and no replay:** Pass. Retired callbacks close
  over only retired-generation state.
- **Safe-boundary runtime reconciliation:** Pass. Fresh admission is installed
  only at the proven activation commit.
- **Pi turn continuity:** Pass. No `session.abort()` is introduced.
- **Fail-closed lifecycle and terminal state:** Pass. Returned, timed-out, and
  thrown failures all remain disabled/unavailable and terminalize as failed.
- **Journal-first and exactly-once command consistency:** Pass. Desired-disabled
  acceptance precedes provider execution and every provider outcome reaches the
  shared terminal planner.

### AC1 — public session/provider disable boundary

Pass. The public boundary now covers both returned and thrown provider-disable
failures while preserving fencing, exact-turn drainage, post-drain revocation,
cleanup, safe-boundary reconciliation, generation isolation, late-callback
suppression, and fail-closed unavailable handling.

### AC2 — narrow Pi tool-execution exception seam

Pass. The corrected mapped-tool path proves disable settlement, successful
admission after a proven re-enable, retired callback isolation, continued
non-MCP turn execution, no whole-session abort, and no replay.

### Decisions 13, 14, and 20

Pass. Immediate fencing, exact-turn retirement, bounded drainage, structured
settlement, turn continuity, no replay, safe-boundary reconciliation, and
failed-disabled terminal behavior remain intact. Corrective tests exercise the
approved provider and Pi seams and targeted lower-level generation-isolation
behavior. The reported focused suite is 498/498 across 13 impl-07 files.

### Scope and standards

Pass. The correction remains within impl-07 and reuses the existing lifecycle
commit seam, diagnostic sanitizer, and shared terminal planner. It does not
absorb impl-08 project fan-out or impl-09 restart recovery.

## Evidence

- The stale review artifact `c0640969` identified two material defects in the
  previously accepted implementation.
- The main agent independently confirmed both defects in source.
- Corrective implementation HEAD:
  `531b719aeeb99ab9417342f9267870a0f71be2f1`.
- Focused corrective verification: 498/498 tests across 13 impl-07 files,
  including ten new regression tests.
- Workspace typecheck: exactly seven documented baseline errors and no new
  corrective-delta error.
- `git diff --check`: clean.
- Independent corrective-delta review: both blockers closed, no actionable
  finding.

## Rejected alternatives

- Keeping Decision 24 unchanged and accepting `fe0c6ba7` alone.
- Permanently rejecting impl-07 despite verified correction.
- Reusing the fenced generation by merely clearing its fence.
- Replacing the execution generation before activation is proven.
- Ignoring a disable queued during activation.
- Catching thrown provider failures only in the outer RPC handler.
- Treating a thrown disable failure as dormant success.
- Introducing a second terminal planner for exceptions.
- Expanding the correction into impl-08 or impl-09.
- Rejecting solely because the seven documented baseline type errors remain.

## Assumptions

- Commit `531b719a` contains the exact corrective delta reviewed and tested.
- The reported 498/498 focused run was executed against the corrective source.
- The seven workspace typecheck errors are the documented pre-existing
  baseline errors recorded by Decision 24 and the impl-07 ticket.
- No unreported source mutation exists between the reviewed corrective HEAD and
  the accepted HEAD.

## Residual uncertainty

Workspace-wide health remains subject to the baseline uncertainty accepted by
Decision 24: seven pre-existing typecheck errors and the previously documented
off-surface full-suite failures remain unresolved.

The focused evidence establishes the corrected impl-07 behavior but cannot
eliminate every possible scheduler interleaving. Future changes to lifecycle
serialization, activation-commit notification, generation closure ownership,
or terminal planning can invalidate these guarantees.

## Downstream effect

Decision 24 may again be used as an accepted impl-07 prerequisite, but only as
amended by this reassessment and only at corrected HEAD `531b719a`.

Downstream work may rely on synchronous disable fencing, fresh mapped-tool
admission after proven re-enable, permanent retired-generation isolation,
queued-disable fencing, exact-turn drainage, post-drain cleanup, exactly-once
structured settlement, turn continuity, safe-boundary reconciliation,
fail-closed state, and exactly-once failed-disabled terminal resolution for
returned, timed-out, and thrown provider failures.

No downstream record may cite `fe0c6ba7` alone as the accepted impl-07 state.

## Failure and rollback implications

A rollback below `531b719a` invalidates this reassessment unless an equivalent
correction is independently verified and recorded. Any rollback must remain
desired-disabled and fail closed; it must not restore permanent single-registry
behavior, share retired state with fresh generations, bypass durable terminal
resolution, restore stale authority, replay cancelled calls, or abort unrelated
Pi turn work.

## Reopening conditions

Reopen this decision if material evidence shows any of the following:

- Disable followed by successful enable still rejects a valid mapped Synara MCP
  tool call.
- A fresh execution generation is installed before activation is proven.
- A retired execution or callback can interact with a fresh generation.
- A disable queued during activation permits admission after the fence began.
- A queued-disable fence leaks into an unrelated later activation.
- A thrown, timed-out, or unavailable provider disable leaves an operation
  pending or produces inconsistent operation/activity terminals.
- A provider failure reaches terminal output without bounded sanitization.
- A disable command produces zero or multiple deterministic terminals.
- A settled operation is re-transitioned during replay.
- Any original Decision 24 reopening condition occurs.
- The corrective candidate does not match `531b719a`.
- A rollback or later change removes the corrected generation-isolation or
  provider-failure terminal paths.

## Amended and superseded records

This record amends Decision 24. It does not supersede Decision 24 as a whole.

It supersedes these portions of Decision 24:

- acceptance of `fe0c6ba7` as a sufficient standalone impl-07 HEAD;
- the assumption that no accepted invariant was contradicted after review;
- downstream authorization to rely on the original candidate without the
  corrective delta.

Decisions 13, 14, and 20 remain unchanged.
