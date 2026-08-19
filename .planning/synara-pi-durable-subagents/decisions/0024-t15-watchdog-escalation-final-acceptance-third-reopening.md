# Decision 0024 — Ticket 15 watchdog escalation final-acceptance third reopening

## Status

needs-remediation (binding reassessment of Decision 0023 at Symphony
`067aa9a6`; Ticket 15 remains the active acceptance frontier)

## Date

2026-08-19

## Candidate

- Symphony `067aa9a61cf961364a259e24b15a21197ddb51c3`
- Alfie unchanged at `489acd626` / `0.14.0-alfie.1`

## Question

Does Ticket 15 at Symphony `067aa9a6` satisfy all four reopening
conditions established by Decision 0023, allowing Ticket 15 to transition
from `needs-remediation` to `complete` and the frontier to advance to
Ticket 16?

In particular, do the focused tests pair the exact band-72 durable row with
an exact, outcome-specific, stage-scoped operator event for BOTH the
terminal-evidence and no-evidence outcomes?

## Governing references

- Project Home.
- Decision 0001: material lifecycle and control outcomes require matching,
  truthful diagnostic coverage.
- Decision 0021: original Ticket-15 F1/F2/F3 rejection and watchdog-band
  ownership.
- Decision 0022: truthful band-72 outcome vocabulary and paired
  durable/operator proof requirement.
- Decision 0023: current binding gate and its four reopening conditions.
- Issue 15, including T15-AC1 through T15-AC7 and all remediation sections.
- Ticket 16's proof-before-fence ownership.

## Evidence

The repository `main` ref resolves to
`067aa9a61cf961364a259e24b15a21197ddb51c3`.

The coordinator's operator diagnostic contract now includes a fixed `stage`
field. The band-72 no-evidence path emits its own
`pi_subagent_watchdog_stage_timeout` event with stage
`provider_turn_interrupt` after the terminal-evidence early-return branch
and before provider-session stop.

The focused no-evidence test proves the required durable/operator pairing:

- the band-72 durable row has
  `pi_subagent_watchdog_stage_timeout`;
- an operator event has that code at stage `provider_turn_interrupt`;
- the distinct band-71 event has the same code at stage
  `child_abort_timeout`;
- no `pi_subagent_watchdog_terminal_evidence` event is present.

The focused terminal-evidence test captures operator diagnostics and proves
the exact band-72 durable row has
`pi_subagent_watchdog_terminal_evidence` with
`observed: terminal_evidence`. It does not, however, assert an operator
event with that code at stage `provider_turn_interrupt`, and it does not
assert absence of `pi_subagent_watchdog_stage_timeout` at that stage. The
test ends after its durable-row and no-handoff assertions.

Therefore the exact stage-scoped operator pairing exists in source for the
timeout/no-evidence outcome but is not proved for the terminal-evidence
outcome.

F1 remains protected by the bounded `waitForTerminalEvidence` path and its
complementary delayed-evidence/no-evidence tests. F3 remains protected by
the boundary test proving that band 74 does not fence a same-attempt,
same-generation terminal before Ticket 16 proves teardown.

Reported clean-worktree verification at this candidate is green:

- workspace typecheck: 7/7;
- focused server suites: 341 tests across 10 files;
- contracts: 230 tests across 20 files;
- standalone real-Pi acceptance: 2/2 against Alfie
  `489acd626` / `0.14.0-alfie.1`;
- formatting clean.

The Supervisor did not independently rerun these commands.

## Reopening-condition adjudication

1. Pass: the band-72 no-evidence outcome emits its own unambiguous stage-2
   timeout operator diagnostic before stage 3.
2. Fail: the no-evidence focused test has the required stage-scoped pairing,
   but the terminal-evidence focused test only captures its operator stream;
   it does not assert the required terminal-evidence event or absence of the
   stage-2 timeout event. The requirement applies to BOTH outcomes.
3. Pass: Decision-0021 F1 and F3 protections remain intact.
4. Pass as reported execution evidence: focused verification and standalone
   real-Pi acceptance are green at the candidate.

## Settled verdict

NEEDS REMEDIATION.

Decision 0023 is reassessed at Symphony `067aa9a6`. The missing stage-2
operator emission identified by Decision 0023 is implemented, and the
timeout/no-evidence test unambiguously proves it. Reopening condition 2
nevertheless remains unsatisfied because the terminal-evidence focused test
does not assert its captured operator outcome.

Ticket 15 remains `needs-remediation`. It does not transition to complete,
and the frontier does not advance to Ticket 16.

## Required remediation

1. In the focused terminal-evidence test, assert an operator event with:
   - diagnostic code `pi_subagent_watchdog_terminal_evidence`; and
   - stage `provider_turn_interrupt`.
2. In that same test, assert that no operator event has:
   - diagnostic code `pi_subagent_watchdog_stage_timeout`; and
   - stage `provider_turn_interrupt`.
3. Retain the existing exact band-72 durable-row assertion in that test.
4. Retain the no-evidence test's stage-scoped band-71/band-72 distinction.
5. Preserve the existing F1 bounded evidence window and F3
   proof-before-fence boundary.
6. Rerun focused verification and standalone real-Pi acceptance at the new
   candidate.

## Rejected alternatives

- Treating capture of the operator stream as proof is rejected because no
  expectation constrains the terminal-evidence operator outcome.
- Treating the durable band-72 row alone as sufficient is rejected because
  Decision 0023 explicitly requires paired durable and operator evidence.
- Treating the timeout test's stage-scoped assertions as covering both
  outcomes is rejected because it proves only the no-evidence branch.
- Accepting based solely on green verification is rejected because the green
  terminal-evidence test omits the required operator assertions.
- Reopening F1 or F3 is rejected because their implementation and focused
  boundary evidence remain intact.
- Blocking Ticket 15 on Ticket 14's re-band is rejected because that remains
  Ticket 14's separate acceptance gate.

## Assumptions and residual uncertainty

- The reported verification results accurately correspond to clean candidate
  `067aa9a6`.
- Alfie remains at the stated pin.
- No undisclosed accepted decision weakens Decision 0023's requirement that
  both outcomes receive exact durable/operator pairing.
- The missing assertions are expected to be a small focused-test remediation;
  the stage-2 terminal-evidence operator emission already exists in source.

## Downstream effect

- Ticket 15 remains `needs-remediation`.
- Ticket 15 remains the active acceptance frontier.
- Ticket 16 remains blocked by Ticket 15.
- Ticket 17 remains blocked by Tickets 15 and 16.
- Ticket 14 remains independently subject to its disjoint-band acceptance
  gate.

## Failure and rollback implications

No rollback is required. The new fixed-stage operator contract, stage-2
timeout emission, truthful terminal-evidence vocabulary, F1 bounded evidence
window, and F3 proof-before-fence behavior should all be retained.

Candidate `067aa9a6` must not be used as Ticket 16's blocker-clearing
baseline.

## Reopening conditions

Reopen when:

1. the terminal-evidence focused test pairs its exact band-72 durable row
   with `pi_subagent_watchdog_terminal_evidence` at stage
   `provider_turn_interrupt` and proves the stage-2 timeout event is absent;
2. the no-evidence focused test retains its exact band-72 durable/operator
   pairing and its band-71 versus band-72 stage distinction;
3. F1 and F3 protections remain intact; and
4. focused verification and standalone real-Pi acceptance pass at the new
   candidate.

## Superseded record

This decision reassesses Decision 0023 for candidate `067aa9a6` and becomes
the current Ticket-15 acceptance gate. It retains Decision 0021's
proof-before-fence direction and Ticket-14 disjoint-band constraint.
