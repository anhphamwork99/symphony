# Decision 0023 — Ticket 15 watchdog escalation final-acceptance second reopening

## Status

needs-remediation (binding reassessment of Decision 0022 at Symphony
`c0d3bedf`; Ticket 15 remains the active acceptance frontier)

## Date

2026-08-19

## Candidate

- Symphony `c0d3bedfa90aac71a93caa008f8459bf306ff0fc`
- Alfie unchanged at `489acd626` / `0.14.0-alfie.1`

## Question

Does Ticket 15 at Symphony `c0d3bedf` satisfy all five reopening
conditions established by Decision 0022, allowing Ticket 15 to transition
from `needs-remediation` to `complete` and the implementation frontier to
advance to Ticket 16?

## Governing references

- Project Home.
- Decision 0021: original binding Ticket-15 rejection, including F1/F2/F3
  and watchdog sequence-band ownership.
- Decision 0022: current binding reopening gate and its five reopening
  conditions.
- Issue 15, including T15-AC1 through T15-AC7 and the Decision-0021 and
  Decision-0022 remediation sections.
- Decision 0001: material lifecycle/control outcomes require truthful,
  matching diagnostic evidence.
- Decisions 0006 and 0008: standalone real-Pi wall-clock acceptance method.
- Decision 0012: first applicable terminal evidence owns lifecycle truth.
- Ticket 16's proof-before-fence ownership.

## Evidence

The repository main ref resolves to candidate
`c0d3bedfa90aac71a93caa008f8459bf306ff0fc`.

The new diagnostic literal
`pi_subagent_watchdog_terminal_evidence` is present in the shared contract
literal list and contract test. The coordinator uses the exported
`PI_SUBAGENT_WATCHDOG_TERMINAL_EVIDENCE_DIAGNOSTIC` constant for both the
band-72 terminal-evidence journal row and the terminal-evidence operator
diagnostic.

The no-evidence branch continues to write
`pi_subagent_watchdog_stage_timeout` on its band-72 journal row.

The focused terminal-evidence test asserts the exact band-72 durable code
and `observed: terminal_evidence`, but it does not capture or assert the
operator diagnostic. The focused no-evidence test asserts the exact
band-72 durable timeout code, but it also does not capture or assert the
operator diagnostic.

The implementation emits `pi_subagent_watchdog_stage_timeout` before
band 72 for the band-71 child-abort acknowledgement timeout. After the
band-72 no-evidence row is written, it proceeds directly to provider-session
stop without emitting a stage-2 timeout operator diagnostic. Consequently,
an assertion that the timeout code appears somewhere in emitted diagnostics
would observe the earlier band-71 event and would not prove faithful
operator reporting of the band-72 outcome.

F1 remains protected by the deadline-bounded
`waitForTerminalEvidence` path and its complementary focused branches.
F3 remains protected by the boundary test proving that a band-74 handoff
does not fence a same-attempt, same-generation terminal before Ticket 16
proves teardown.

Reported clean-worktree verification at this candidate is green:

- workspace typecheck: 7/7;
- focused server suites: 341 tests across 10 files;
- contracts: 230 tests across 20 files;
- standalone real-Pi acceptance: 2/2 against Alfie
  `489acd626` / `0.14.0-alfie.1`;
- formatting clean and lint with zero errors.

The Supervisor did not independently rerun these commands.

## Reopening-condition adjudication

1. Pass: the band-72 terminal-evidence path uses a truthful diagnostic on
   its durable and operator surfaces.
2. Pass for durable classification: the band-72 no-evidence row retains
   `pi_subagent_watchdog_stage_timeout`.
3. Fail: focused tests do not assert the exact operator event for either
   outcome, and the no-evidence branch currently has no band-72 timeout
   operator emission to assert.
4. Pass: Decision-0021 F1 and F3 protections remain intact.
5. Pass as reported execution evidence: focused and standalone real-Pi
   verification are green at the candidate.

## Settled verdict

NEEDS REMEDIATION.

Decision 0022 is reassessed at Symphony `c0d3bedf`. The truthful
terminal-evidence vocabulary closes the original semantic portion of F2,
but reopening condition 3 remains unsatisfied.

Ticket 15 remains `needs-remediation`. It does not transition to complete,
and the frontier does not advance to Ticket 16.

## Required remediation

1. Emit a stage-2 operator diagnostic when the band-72 no-evidence window
   expires, using `pi_subagent_watchdog_stage_timeout`.
2. Add focused terminal-evidence coverage that captures the operator
   diagnostic and asserts the exact
   `pi_subagent_watchdog_terminal_evidence` event alongside the exact
   band-72 durable row.
3. Add focused no-evidence coverage that captures and unambiguously asserts
   the band-72 `pi_subagent_watchdog_stage_timeout` operator event alongside
   the exact band-72 durable row. Because band 71 emits the same code, the
   proof must isolate the stage-2 emission, for example through stage/outcome
   metadata or an exact ordered diagnostic assertion.
4. Preserve the existing F1 bounded evidence window and F3
   proof-before-fence boundary.
5. Rerun focused verification and standalone real-Pi acceptance at the new
   candidate.

## Rejected alternatives

- Treating the earlier band-71 timeout diagnostic as proof of a band-72
  operator event is rejected because it describes a different escalation
  stage and outcome.
- Treating a code-only `some(...)` assertion as sufficient is rejected while
  multiple stages emit the same code and the event has no asserted stage
  identity.
- Accepting the durable band-72 row without a matching operator emission is
  rejected because Decision 0022 explicitly requires both durable and
  operator surfaces.
- Accepting based solely on green verification is rejected because the
  focused suite does not prove the required operator behavior.
- Reopening F1 or F3 is rejected: their source and focused boundary evidence
  remain intact.
- Blocking Ticket 15 on Ticket 14's re-band is rejected. Decision 0022
  already settled that as Ticket 14's own acceptance gate.

## Assumptions and residual uncertainty

- The submitted verification results accurately correspond to clean
  candidate `c0d3bedf`.
- Alfie remains at the stated pin.
- No undisclosed accepted decision weakens Decision 0022 condition 3.
- The operator event may reuse the timeout diagnostic literal, but its test
  must distinguish the band-72 stage from the earlier band-71 event.

## Downstream effect

- Ticket 15 remains `needs-remediation`.
- Ticket 15 remains the active acceptance frontier.
- Ticket 16 remains blocked by Ticket 15.
- Ticket 17 remains blocked by Tickets 15 and 16.
- Ticket 14 remains independently subject to its disjoint-band acceptance
  gate.

## Failure and rollback implications

No rollback is required. The truthful terminal-evidence contract and the F1
and F3 protections should be retained. Remediation is confined to the
missing stage-2 timeout operator emission and exact paired operator-surface
test evidence.

The candidate must not be used as Ticket 16's blocker-clearing baseline.

## Reopening conditions

Reopen when:

1. the band-72 no-evidence outcome emits an unambiguously stage-2
   `pi_subagent_watchdog_stage_timeout` operator diagnostic;
2. focused tests pair the exact band-72 durable row with the exact,
   outcome-specific operator event for both terminal-evidence and timeout
   outcomes;
3. F1 and F3 protections remain intact; and
4. focused verification and standalone real-Pi acceptance pass at the new
   candidate.

## Superseded record

This decision reassesses Decision 0022 for candidate `c0d3bedf` and becomes
the current Ticket-15 acceptance gate. It retains Decision 0021's
proof-before-fence direction and Ticket-14 disjoint-band constraint.
