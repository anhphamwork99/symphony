# Decision 0022 — Ticket 15 watchdog escalation final-acceptance reopening

## Status

needs-remediation (binding reassessment of Decision 0021 at the remediated
candidate; Decision 0021's lifecycle and sequence-band directions remain
authoritative)

## Date

2026-08-19

## Candidate

- Symphony `0a292e5c`
- Alfie unchanged at `489acd626` / `0.14.0-alfie.1`

## Question

Does Ticket 15 at Symphony `0a292e5c` satisfy Decision 0021's seven
reopening conditions and T15-AC1 through T15-AC7, allowing Ticket 15 to
transition to complete and the frontier to advance to Ticket 16?

In particular, is reopening condition 7 a prerequisite to Ticket 15's
acceptance, or a constraint on the parallel Ticket-14 stream before Ticket
14's own acceptance?

## Governing references

- Project Home.
- Specification Implementation Decisions 25, 26, and 27; story 41.
- Issue 15, including T15-AC1 through T15-AC7 and its approved Testing Seams.
- Decision 0001: lifecycle and control success requires matching material
  failure and truthful diagnostic coverage.
- Decisions 0006 and 0008: standalone wall-clock acceptance method.
- Decision 0011: cancellation remains journal-first and evidence-driven.
- Decision 0012: first applicable terminal evidence owns lifecycle truth.
- Decision 0021: binding rejection findings F1/F2/F3 and reopening
  conditions 1–7.
- Ticket 16's proof-before-fence ownership.
- Ticket 15's independent feature-level review package at the preceding
  candidate, together with the scoped Decision-0021 remediation delta and
  current focused verification evidence.

## Evidence

The current repository HEAD resolves to full commit
`0a292e5ccd22db3ccb7e359a53c4bf439e4729f8`.

The submitted clean-worktree verification reports:

- workspace `bun typecheck`: 7/7;
- ticket-focused server suites: 341 tests across 10 files;
- contracts: 230 tests across 20 files;
- standalone real-Pi watchdog acceptance: 2/2 against Alfie
  `489acd626` / `0.14.0-alfie.1`.

The Supervisor environment is read-only and did not independently rerun these
commands. Exact-source inspection was used to assess the Decision-0021
remediation delta.

### Reopening conditions 1–3 — satisfied

The provider-turn stage establishes a deadline covering command dispatch and
the remaining post-dispatch evidence window. `waitForTerminalEvidence` is
poll-count bounded using `stageTimeoutMs` and `evidencePollMs`, with an
injectable `wait` seam.

Focused tests establish both required branches:

- terminal evidence committed on the second poll inside the window settles
  through normal lifecycle evidence and dispatches no provider-session stop;
- absent evidence through the window advances to exactly one
  provider-session stop.

Command completion is not treated as terminal evidence.

### Reopening condition 4 — not satisfied

Decision 0021 required truthful durable and operator diagnostics for both the
terminal-evidence and timeout outcomes.

At band 72, the terminal-evidence branch records and reports
`pi_subagent_watchdog_session_stopped`. The same diagnostic constant is used
at band 73 when a dispatched provider-session stop actually returns
`"stopped"`.

The focused terminal-evidence test simultaneously proves that:

1. no provider-session stop was dispatched; and
2. band 72 contains `pi_subagent_watchdog_session_stopped`.

Those facts conflict. Durable terminal evidence proves that normal lifecycle
truth ended escalation; it does not prove that the watchdog stopped the
provider session. Replacing the former false timeout label with a false
session-stop label does not meet Decision 0021 F2 or T15-AC7's truthful
operator-observation requirement.

The new focused tests assert the journal-row codes. They do not pair exact
operator-surface assertions with both band-72 outcomes. An earlier
child-abort timeout emits the same generic timeout diagnostic before stage 2,
so merely observing that code somewhere does not prove faithful stage-2
operator reporting.

Required remediation:

1. Add or select a stable diagnostic whose meaning is terminal evidence
   observed / escalation settled by evidence, without claiming a provider
   session stop.
2. Use it consistently for the band-72 terminal-evidence journal row and its
   operator diagnostic.
3. Retain `pi_subagent_watchdog_stage_timeout` for the band-72 no-evidence
   outcome.
4. Add focused assertions for both the exact durable row and exact operator
   event on both outcomes.
5. Rerun focused unit/integration verification and the standalone real-Pi
   acceptance at the resulting candidate.

### Reopening condition 5 — satisfied

The module contract and boundary test now state and prove that the band-74
teardown-handoff row does not fence the current attempt or generation. A
same-generation terminal arriving before proven teardown remains applicable
under Decision 0012. Ticket 16 retains ownership of process-death proof and
post-proof fencing.

### Reopening condition 6 — satisfied subject to reported execution evidence

The reported focused unit/integration, contract, typecheck, and standalone
real-Pi results are green at `0a292e5c`. No contradictory execution evidence
was supplied or found. Condition 4 nevertheless remains a semantic and
diagnostic failure that green tests currently encode rather than detect.

## Reopening condition 7 adjudication

Condition 7 is not a prerequisite to Ticket 15's own acceptance.

Decision 0021 consistently states that:

- watchdog sequences 70–74 belong to Ticket 15 and remain allocated there;
- Ticket 14 must move its resume event to a disjoint band;
- Ticket 14 must implement and verify that change before Ticket 14's own final
  acceptance.

The phrase “before its own acceptance” refers to Ticket 14. Reading condition
7 as requiring the parallel Ticket-14 implementation to land before Ticket 15
could be accepted would contradict Decision 0021's explicit downstream
direction that Ticket 14 may continue independently and that Ticket 15's
allocation stands.

Accordingly, Ticket 14's re-band remains binding but is Ticket 14's gate.
It is not the reason Ticket 15 is rejected at `0a292e5c`.

## Settled verdict

NEEDS REMEDIATION.

Decision 0021 is reassessed on the new candidate. Findings F1 and F3 are
closed, and the sequence-band constraint is correctly scoped to Ticket 14's
own acceptance. F2 remains open because the terminal-evidence path still
carries a diagnostic that claims a session stop that did not occur.

T15-AC3, T15-AC4, and the proof-before-fence portion of T15-AC6 now have the
required remediation evidence. T15-AC7 and reopening condition 4 do not pass
until the terminal-evidence diagnostic is truthful on both durable and
operator surfaces.

Ticket 15 therefore remains `needs-remediation`; it does not transition to
complete, and the frontier does not move to Ticket 16.

## Rejected alternatives

- Accepting `pi_subagent_watchdog_session_stopped` as a generic success code is
  rejected because its established use and literal meaning describe an actual
  provider-session stop, while the terminal-evidence test proves no such
  command was dispatched.
- Treating the row's `observed: terminal_evidence` metadata as sufficient is
  rejected because the stable diagnostic code is itself an operator-facing
  contract and must remain truthful independently of auxiliary metadata.
- Accepting based only on green tests is rejected because the focused test
  currently asserts the semantic mismatch.
- Reopening F1 is rejected: the source and complementary tests demonstrate the
  bounded post-dispatch evidence window.
- Adding an immediate Ticket-15 generation fence is rejected: Ticket 16 still
  owns proof-before-fence.
- Blocking Ticket 15 on the unmerged Ticket-14 re-band is rejected: Decision
  0021 explicitly makes that change a prerequisite to Ticket 14's own
  acceptance.

## Assumptions and residual uncertainty

- The reported verification results accurately correspond to clean candidate
  `0a292e5c`.
- Alfie remains at the stated pin.
- No undisclosed decision reassigns watchdog band 70–74.
- A dedicated terminal-evidence diagnostic is expected to be the clearest
  remediation; an existing code may be reused only if its established
  semantics truthfully describe this outcome.
- The exact Ticket-14 replacement band remains outside Ticket 15 and must be
  settled through Ticket 14's repository-wide band audit.

## Downstream effect

- Ticket 15 remains `needs-remediation`.
- Ticket 15 remains the active acceptance frontier.
- Ticket 16 remains blocked by Ticket 15.
- Ticket 17 remains blocked by Tickets 15 and 16.
- Ticket 14 remains independently obligated to re-band its resume event and
  prove coexistence with watchdog band 70–74 before Ticket 14 acceptance.

## Failure and rollback implications

No rollback is required to record this rejection. The candidate remains
unaccepted and must not be used as Ticket 16's blocker-clearing baseline.

The F1 and F3 changes should be retained. Remediation is confined to truthful
diagnostic vocabulary, emission, and paired assertions; it must not remove the
bounded evidence window, equate command resolution with termination proof, or
introduce pre-proof generation fencing.

## Reopening conditions

Reassess this verdict when:

1. the band-72 terminal-evidence path uses a stable diagnostic that does not
   claim provider-session stop or timeout;
2. the band-72 timeout path retains its truthful timeout diagnostic;
3. focused tests assert the exact journal row and exact operator event for
   both outcomes;
4. the Decision-0021 F1 and F3 protections remain intact;
5. focused unit/integration verification and standalone real-Pi acceptance
   pass at the new candidate.

Ticket 14's disjoint-band implementation remains a separate prerequisite to
Ticket 14's own acceptance, not to this reopening.

## Superseded record

This decision reassesses Decision 0021 for candidate `0a292e5c` and becomes
the current Ticket-15 acceptance gate. It does not supersede Decision 0021's
proof-before-fence direction or its binding Ticket-14 disjoint-band
constraint.
