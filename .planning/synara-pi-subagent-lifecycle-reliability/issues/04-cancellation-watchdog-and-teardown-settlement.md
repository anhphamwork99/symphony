# Ticket 04 — cancellation, watchdog, and owned teardown retry settlement

**Status:** blocked
**Blocked by:** Ticket 03 accepted; inherited Decisions 0021–0034; DG-4
**Implementation:** forbidden while blocked

## Objective

Complete the failure-path lifecycle so cancellation, watchdog escalation, owned
teardown retries, survivors, and owner-unproven outcomes settle durably and
truthfully without killing outside the approved owner boundary.

## Acceptance criteria

- **T04-AC1:** Cancellation intent is journal-first, authorized, idempotent,
  and remains `cancelling` until accepted termination evidence.
- **T04-AC2:** Watchdog stages 70–74 remain bounded, observable, and non-terminal
  until terminal evidence or approved cleanup proof settles them.
- **T04-AC3:** Teardown request/outcomes 75–78 preserve owned-only dispatch,
  proof-before-fence, bounded survivor evidence, retry escalation, and no
  parent/PID fallback.
- **T04-AC4:** Persistence outage, provider stop failure, timeout, owner loss,
  survivor, and late terminal paths each produce stable diagnostics and no
  fabricated cancellation.
- **T04-AC5:** Graceful terminal/cancel paths never invoke destructive teardown;
  replay and duplicate sweeps do not duplicate effects.

## Testing seams

Deterministic cancellation/watchdog/teardown coordinator and repository
fixtures; adapter owner endpoint fixtures; injected timeout and write failure;
accepted isolated manual real-Pi destructive boundary only where required by
inherited Decisions 0028–0034.

## Implementation Report placeholder

- Candidate/pin and inherited decision references:
- Band and identity matrix:
- Owned-only proof and retry evidence:
- Failure/diagnostic evidence:
- Manual-run record, if applicable (environment and operator required):
- Review findings/disposition:
- Residual uncertainty:

## Unlock gate

No new cleanup authority may be introduced without an explicit decision. This
ticket cannot reinterpret `cleanup_uncertain`, `survivors`, or
`owner_unproven` as terminal.
