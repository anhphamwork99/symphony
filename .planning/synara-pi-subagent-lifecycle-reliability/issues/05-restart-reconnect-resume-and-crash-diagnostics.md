# Ticket 05 — restart, reconnect, Resume, projection truth, and crash diagnostics

**Status:** blocked
**Blocked by:** Tickets 02–04 accepted; DG-5 and applicable inherited decisions
**Implementation:** forbidden while blocked

## Objective

Make reconnect and restart projections tell the truth about live ownership,
terminal evidence, orphan uncertainty, Resume eligibility, and crash evidence
without automatic replay.

## Acceptance criteria

- **T05-AC1:** Reconnect hydrates bounded durable execution truth and does not
  create new attempts or dispatch work.
- **T05-AC2:** Restart distinguishes recovered terminal, proven live owner, and
  owner/terminal uncertainty; orphan diagnostics explain possible side effects.
- **T05-AC3:** Late old-attempt/generation evidence is fenced, counted, and
  remains history-only.
- **T05-AC4:** Resume is explicit-only, authorized, same execution/new attempt,
  and unavailable or diagnostically rejected when provider runtime is inactive.
- **T05-AC5:** Crash diagnostics identify the lifecycle stage and evidence gap
  without inventing owner receipts, terminal exceptions, or cleanup proof.
- **T05-AC6:** No startup, hydration, reconnect, watchdog, or reconciliation
  path automatically replays or resumes side-effecting work.

## Testing seams

Restart/reconnect integration using isolated durable roots; projection snapshot
and cursor fixtures; inactive-provider Resume denial; stale-generation and
late-terminal tests; controlled real-Pi restart leg under inherited isolation;
crash diagnostic assertions with bounded safe metadata.

## Implementation Report placeholder

- Candidate/pin and restart composition:
- Projection/reconnect evidence:
- Resume eligibility and denial matrix:
- Crash diagnostic vocabulary and bounded fields:
- No-replay structural evidence:
- Review findings/disposition:
- Residual uncertainty/open gates:

## Unlock gate

Provider-bootstrap Resume, durable post-restart owner receipt, or any orphan
terminal exception requires explicit material decision; none is implied by this
ticket.
