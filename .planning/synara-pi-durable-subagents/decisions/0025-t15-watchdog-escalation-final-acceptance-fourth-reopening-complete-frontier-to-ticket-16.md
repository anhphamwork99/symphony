# Decision 0025 — Ticket 15 watchdog escalation final-acceptance fourth reopening: complete; frontier to Ticket 16

## Status

accepted (binding reassessment of Decision 0024 at Symphony `91e34c1e`;
Ticket 15 transitions to complete and the active frontier advances to
Ticket 16)

## Date

2026-08-19

## Candidate

- Symphony `91e34c1e7164c3b0aa83e788116b1447d588364f`
- Alfie unchanged at `489acd626` / `0.14.0-alfie.1`

## Question

Does Ticket 15 at Symphony `91e34c1e` satisfy all four reopening
conditions established by Decision 0024, including exact source proof that
the terminal-evidence focused test asserts its captured operator outcome,
allowing Ticket 15 to transition from `needs-remediation` to `complete` and
the active frontier to advance to Ticket 16?

## Governing references

- Project Home.
- Decision 0001: material lifecycle and control outcomes require matching,
  truthful diagnostic coverage.
- Decision 0021: original Ticket-15 F1/F2/F3 rejection and watchdog-band
  ownership.
- Decision 0022: truthful band-72 outcome vocabulary and paired
  durable/operator proof.
- Decision 0023: stage-2 timeout operator emission and outcome-specific,
  stage-scoped pairing.
- Decision 0024: current binding gate and its four reopening conditions.
- Issue 15, including T15-AC1 through T15-AC7 and all five remediation
  sections.
- Ticket 16's proof-before-fence ownership.

## Evidence

The repository main ref resolves to
`91e34c1e7164c3b0aa83e788116b1447d588364f`.

In the focused terminal-evidence test, directly after the exact band-72
durable-row assertions, the test now asserts:

1. an operator event with diagnostic code
   `pi_subagent_watchdog_terminal_evidence` and stage
   `provider_turn_interrupt` is present; and
2. no operator event with diagnostic code
   `pi_subagent_watchdog_stage_timeout` and stage
   `provider_turn_interrupt` is present.

The pre-existing exact band-72 assertions remain:
`pi_subagent_watchdog_terminal_evidence` with
`observed: terminal_evidence`. The assertions are inside the correct
terminal-evidence test and precede its no-teardown-handoff assertion.

The focused no-evidence test retains:

- the exact band-72 durable row with
  `pi_subagent_watchdog_stage_timeout`;
- `stage_timeout` at `provider_turn_interrupt` present;
- the distinct band-71 `stage_timeout` at `child_abort_timeout` present; and
- `pi_subagent_watchdog_terminal_evidence` absent.

F1 remains protected by the bounded `waitForTerminalEvidence` implementation
and its complementary focused branches: delayed terminal evidence inside the
stage-2 window prevents provider-session stop, while absent evidence through
the bounded window advances exactly once.

F3 remains protected by the boundary test proving that the band-74 teardown
handoff is not a same-attempt, same-generation fence. Applicable terminal
evidence before proven teardown remains ordinary lifecycle truth; Ticket 16
continues to own proof-before-fence.

Reported clean-worktree verification at this exact candidate is green:

- workspace typecheck: 7/7;
- ticket-focused server suites: 341 tests across 10 files;
- coordinator suite: 16/16;
- contracts: 230 tests across 20 files;
- standalone real-Pi watchdog acceptance: 2/2 against Alfie
  `489acd626` / `0.14.0-alfie.1`;
- formatting clean.

The Supervisor did not independently rerun these commands.

## Reopening-condition adjudication

1. Pass: the terminal-evidence focused test pairs its exact band-72 durable
   row with `pi_subagent_watchdog_terminal_evidence` at stage
   `provider_turn_interrupt` and proves the stage-2 timeout event absent.
2. Pass: the no-evidence focused test retains its exact band-72
   durable/operator pairing and band-71 versus band-72 stage distinction.
3. Pass: Decision-0021 F1 and F3 protections remain intact.
4. Pass as reported execution evidence: focused verification and standalone
   real-Pi acceptance are green at candidate `91e34c1e`.

## Settled verdict

ACCEPT.

Decision 0024 is reassessed at Symphony `91e34c1e`. Its sole failing
condition is closed at the exact required source location. All four reopening
conditions pass, and no material Ticket-15 acceptance issue remains.

Ticket 15 transitions from `needs-remediation` to `complete`. Symphony
`91e34c1e` with Alfie `489acd626` / `0.14.0-alfie.1` is the accepted
Ticket-15 blocker-clearing baseline.

The active implementation frontier advances to Ticket 16.

## Rejected alternatives

- Keeping Ticket 15 in remediation because the fourth-pass assertions landed
  in the wrong test is rejected: at `91e34c1e`, both required assertions are
  inside the terminal-evidence test immediately after its exact band-72 row
  assertions.
- Requiring a code-only operator assertion is rejected: the accepted tests
  use stage identity and distinguish band 71 from band 72.
- Reopening F1 is rejected because the bounded evidence window and both
  focused branches remain intact.
- Reopening F3 or introducing a Ticket-15 generation fence is rejected because
  the boundary test remains intact and Ticket 16 still owns proof-before-fence.
- Blocking Ticket 15 on Ticket 14's re-band is rejected because Decisions
  0021–0024 settle that as Ticket 14's own acceptance gate.
- Requiring Ticket 16 teardown proof before accepting Ticket 15 is rejected:
  Ticket 15 truthfully hands uncertain cleanup to Ticket 16 without claiming
  termination or fencing.

## Assumptions and residual uncertainty

- The reported clean-worktree verification results correspond exactly to
  Symphony `91e34c1e`.
- Alfie remains pinned at `489acd626` / `0.14.0-alfie.1`.
- No undisclosed accepted decision changes Ticket 15's sequence-band
  ownership or Ticket 16's proof-before-fence responsibility.
- Verification was not independently rerun by the read-only Supervisor. No
  contradictory source or execution evidence was supplied or found.
- No material acceptance uncertainty remains under the approved testing
  strategy.

## Downstream effect

- Ticket 15 transitions to `complete`.
- Ticket 15 is no longer the active acceptance frontier.
- Ticket 16 is unblocked and becomes the active implementation frontier.
- Ticket 17 remains blocked by Ticket 16.
- Symphony `91e34c1e` with Alfie `489acd626` / `0.14.0-alfie.1` becomes the
  accepted Ticket-15 baseline for dependent work.
- Project Home must route Decision 0025 and update the frontier accordingly.
- Issue 15 must record status `complete` and cite Decision 0025.
- Ticket 14 remains independently obligated to use a sequence band disjoint
  from watchdog band 70–74 and prove coexistence before its own acceptance.
- Ticket 16 must preserve its proof-before-fence ownership; this acceptance
  does not authorize settlement or fencing based on band 74 alone.

## Failure and rollback implications

No rollback is required.

Any later change that removes the bounded terminal-evidence window, weakens
the exact durable/operator outcome pairing, treats band 74 as a termination
proof or generation fence, or allows Ticket 14 to collide with watchdog band
70–74 would invalidate a governing invariant and require reassessment.

Rolling back `91e34c1e` would remove the exact terminal-evidence operator
assertions that close Decision 0024 and would reopen Ticket 15 acceptance.

## Reopening conditions

Reopen this acceptance only upon material new evidence that:

1. the reported verification did not run against exact candidate `91e34c1e`;
2. the accepted focused assertions do not execute against the captured
   terminal-evidence operator stream;
3. either band-72 outcome can emit a durable/operator mismatch;
4. the bounded F1 evidence window or F3 proof-before-fence boundary regresses;
5. standalone real-Pi acceptance fails under the accepted Alfie pin; or
6. a governing decision changes Ticket 15's ownership or lifecycle
   invariants.

## Superseded record

This decision supersedes Decision 0024 as the current Ticket-15 acceptance
gate and accepts its remediated candidate. It preserves:

- Decision 0021's prohibition on treating command completion, timeout,
  session-stop return, or handoff alone as terminal proof;
- Ticket 16's proof-before-fence ownership; and
- Ticket 14's independent obligation to re-band away from watchdog
  sequences 70–74.
