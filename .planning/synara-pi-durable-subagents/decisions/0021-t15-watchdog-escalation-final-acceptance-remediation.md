# Decision 0021 — Ticket 15 watchdog escalation final acceptance remediation

## Status

needs-remediation (binding final-acceptance verdict; Decisions 0001–0020
remain authoritative and unchanged)

## Date

2026-08-19

## Candidate

- Symphony `262785a8`
- Alfie unchanged at `489acd626` / `0.14.0-alfie.1`

## Question

Does Ticket 15 at Symphony `262785a8` satisfy T15-AC1 through T15-AC7
under the approved Testing Seams and Decisions 0001–0020, and can the
parallel Ticket-14 sequence-band collision be safely adjudicated?

## Governing references

- Project Home
- Specification Implementation Decisions 25, 26, and 27; story 41
- Issue 15, including T15-AC1–AC7 and its approved Testing Seams
- Decisions 0001–0020, particularly:
  - Decision 0001: lifecycle/control success requires matching material
    failure and diagnostic evidence; `session.abort()` resolution is not
    child termination evidence.
  - Decisions 0006/0008: standalone wallclock acceptance method.
  - Decision 0011: journal-first, retryable cancellation and evidence before
    `cancelled`.
  - Decision 0012: first applicable terminal evidence owns lifecycle truth.
  - Decisions 0013/0018: durable outbox/coordinator truth must not be
    weakened by watchdog control bookkeeping.
- Ticket 15 two-axis independent review evidence package
  (`reviews/15-watchdog-escalation-review.md`).
- Ticket 16, which owns proven process teardown and post-proof generation
  fencing.

## Evidence

The persisted review package reports that the first-candidate Standards and
Spec findings were remediated in the rebuilt, ticket-only commit. Clean
post-remediation verification reports:

- workspace typecheck: 7/7;
- ticket-focused server suites: 338 tests across 10 files;
- contracts: 230 tests across 20 files;
- standalone real-Pi watchdog acceptance: 2/2;
- formatting clean and lint with zero errors.

Source inspection confirms the major accepted invariants:

- watchdog stage records are journal-only and do not directly settle
  lifecycle state;
- stage 1 reuses the Ticket-06 durable cancellation protocol;
- timeout or session-stop completion is not treated as child termination
  proof;
- wall-time selection is attempt/generation scoped;
- idle age is re-derived against the server clock;
- uncertain cleanup records a Ticket-16 teardown handoff;
- the production adapter routes session stop through its owned stop path.

Three material discrepancies remain.

### F1 — Blocking: provider-turn interruption does not wait for its terminal-evidence window

After `interruptProviderTurn` resolves, the coordinator performs one immediate
terminal/active-child observation and advances directly to provider-session
stop if terminal truth has not already committed. The configured stage timeout
only bounds the `session.abort()` call; it is not used as a post-dispatch
evidence window.

A quickly resolving `session.abort()` followed by slightly delayed durable
terminal evidence therefore causes premature provider-session stop. This
contradicts the ticket's requirement that every stage wait for
stage-appropriate evidence and leaves T15-AC3/T15-AC4 incompletely proved.
Decision 0001 also forbids treating `session.abort()` resolution as child
termination evidence.

Required remediation:

1. Bound provider-turn command dispatch without equating command resolution
   with terminal evidence.
2. After accepted dispatch, wait or poll for applicable durable terminal or
   cancellation evidence for the remaining configured stage window.
3. Advance to provider-session stop only after that evidence window expires
   without proof.
4. Add deterministic coverage where:
   - interrupt resolves immediately;
   - terminal evidence commits later but before the stage deadline;
   - provider-session stop is not dispatched.
5. Retain the complementary case proving that absent evidence through the
   deadline advances exactly once to provider-session stop.

### F2 — Blocking: successful terminal observation is journaled with a timeout diagnostic

The provider-turn stage chooses
`pi_subagent_watchdog_stage_timeout` whether `interruptObserved` is
`terminal_evidence` or not. The conditional branches are identical. Thus a
successful evidence-bearing transition can be durably classified as a timeout.

This contradicts the review disposition claiming per-stage diagnostic-code
fidelity and weakens T15-AC7's operator-observation guarantee.

Required remediation:

- Record a truthful stable diagnostic for the terminal-evidence path; do not
  emit a timeout code when evidence arrived.
- Add an assertion covering the journal row and operator diagnostic for both
  terminal-evidence and timeout outcomes.

### F3 — Blocking evidence/report discrepancy: teardown handoff does not itself fence same-generation late terminal success

The Ticket 15 report says existing attempt/generation guards make late events
history-only after teardown handoff. That is not true for a terminal event from
the still-current attempt and generation. The handoff row is journal-only and
does not rotate or fence generation; `recordTerminalEvent` will apply the first
same-attempt/same-generation terminal while the aggregate remains nonterminal.

Premature fencing would also be incorrect: Ticket 16 owns fencing only after
owned process-tree death is proved. The correct boundary is therefore:

- Ticket 15 records uncertain cleanup and hands ownership to Ticket 16 without
  claiming termination or fencing.
- A same-generation terminal received before proven teardown remains ordinary
  lifecycle evidence under Decision 0012.
- Ticket 16 must fence the attempt/generation before settlement after proven
  teardown, after which late events are ignored and counted.

Required remediation:

- Correct the T15-AC6 matrix, implementation comments, and review disposition
  so they do not claim that the handoff row alone fences current-generation
  terminal evidence.
- Add a boundary test documenting the actual pre-proof behavior and preserving
  Ticket 16's T16-AC5 obligation.
- If the owner instead requires all same-generation terminal evidence to be
  rejected immediately at Ticket 15 handoff, that would conflict with the
  currently routed Ticket-16 proof-before-fence design and requires explicit
  owner adjudication. This decision does not authorize premature fencing.

## Ticket-14 sequence-band adjudication

Watchdog sequences 70–74 are reserved to Ticket 15. The parallel Ticket-14
implementation currently uses sequence 70 for `recordResumeEvent`, which can
collide when watchdog records are later written for the resumed attempt and
generation under the journal uniqueness constraint.

Binding direction:

- Ticket 14 must move resume to a sequence disjoint from 70–74 and all other
  accepted attempt-local bands before Ticket 14 final acceptance.
- The re-band must update repository literals, lifecycle notifications,
  constants, tests, comments, and any telemetry/query assumptions together.
- Ticket 14 must include an integration regression proving that a resumed
  attempt can subsequently receive the full watchdog band without uniqueness
  conflict or loss of either event.
- Ticket 15's 70–74 allocation stands unless a later recorded reassessment
  changes it. The current parallel Ticket-14 band must not merge or be
  accepted as-is.

## Settled verdict

NEEDS REMEDIATION.

T15-AC1, T15-AC2, and T15-AC5 have sufficient evidence. T15-AC3 and T15-AC4
remain incomplete because provider-turn dispatch resolution is followed by an
immediate observation rather than a bounded terminal-evidence wait. T15-AC7 is
not fully satisfied because successful terminal observation can be labeled
with the timeout diagnostic. T15-AC6's uncertain-handoff behavior is broadly
correct, but its evidence package materially overclaims current-generation
late-event fencing and must be aligned with Ticket 16's proof-before-fence
ownership.

## Rejected alternatives

- Accepting based only on green tests is rejected because the existing tests
  do not exercise delayed terminal evidence after a quickly resolved
  provider-turn interrupt.
- Treating `session.abort()` resolution as the stage's evidence is rejected by
  Decision 0001 and Decision 0011.
- Accepting the false timeout code as cosmetic is rejected because safe,
  truthful operator diagnostics are part of T15-AC7 and were an explicit
  review-remediation item.
- Adding an immediate Ticket-15 generation fence is rejected because process
  death is not yet proved and Ticket 16 explicitly owns proof-before-fence.
- Allowing Ticket 14 and Ticket 15 to share sequence 70 is rejected because the
  journal uniqueness key makes the collision operational, not stylistic.
- Re-banding Ticket 15 instead of Ticket 14 is rejected for now: Ticket 15 was
  committed first and its tests, telemetry, and diagnostics already use the
  contiguous 70–74 stage band. Ticket 14 is not yet accepted and has the
  smaller change surface.

## Assumptions and residual uncertainty

- The persisted clean-worktree command results accurately correspond to
  Symphony `262785a8`.
- The read-only Supervisor environment could inspect the submitted source and
  planning artifacts but could not independently execute `git show` or rerun
  commands.
- Alfie remains unchanged at the stated pin.
- No undisclosed accepted decision assigns sequence 70 to Ticket 14.
- The exact replacement sequence for Ticket 14 should be selected after a
  repository-wide band audit; this decision settles disjointness and ownership,
  not an ungrounded numeric allocation.

## Downstream effect

- Ticket 15 remains needs-remediation and must not transition to complete.
- Ticket 16 remains blocked by Ticket 15.
- Ticket 17 remains blocked by Tickets 15 and 16.
- Ticket 14 may continue independently only after re-banding its resume event;
  it cannot pass final acceptance with sequence 70.
- Project Home should route this decision and keep Ticket 15 as the active
  acceptance frontier.

## Failure and rollback implications

No rollback is required merely to record this rejection. The candidate remains
unaccepted. It must not be used as the accepted blocker-clearing baseline for
Ticket 16.

If the watchdog code is rolled back, the production lease-expiry/watchdog
driver is removed and Ticket 15 remains unimplemented. If only the handoff
semantics are changed, lifecycle truth must continue to obey Decisions 0011
and 0012: timeout, interrupt resolution, session-stop return, or handoff alone
must never assert a terminal state.

## Reopening conditions

Reassess this verdict only when:

1. provider-turn interrupt has a bounded post-dispatch terminal-evidence wait;
2. delayed-before-deadline terminal evidence prevents session stop in focused
   tests;
3. absent evidence through the deadline advances to session stop;
4. terminal-evidence and timeout paths emit truthful diagnostics;
5. the AC6 report and tests accurately preserve Ticket 16's proof-before-fence
   ownership;
6. focused unit/integration verification and the standalone real-Pi acceptance
   path pass at the remediated candidate; and
7. Ticket 14's stream acknowledges and implements the disjoint-band constraint
   before its own acceptance.
