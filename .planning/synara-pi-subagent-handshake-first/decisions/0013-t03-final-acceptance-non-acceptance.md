# Decision 0013 — Ticket 03 final-acceptance non-acceptance

- **Date:** 2026-08-23
- **Status:** Rejected — needs verification remediation
- **Consultation class:** Supervisor final acceptance, class 2; the one and
  only final-acceptance consultation for Ticket 03.
- **Scope:** Ticket 03, “Present durable execution-card truth”, at integrated
  candidate `236d4119b` on accepted Ticket-02 baseline `f31a93ab2`, with
  implementation report persisted at `40a41ad11` and exactly one independent
  feature-level review persisted at evidence tip `b181150ad`.
- **Write set of the consultation:** None.
- **Non-scope:** This decision does not accept or advance Ticket 04, reopen
  Tickets 01/01b/01c or Ticket 02, alter the controlled-artifact boundary, or
  authorize an external side effect.

## Question

Does Ticket 03 candidate `236d4119b`, with its persisted implementation report,
focused verification, and exactly one independent feature-level PASS review,
have sufficient evidence for binding final acceptance under the Project
Contract and repository completion requirements?

## Governing references

- Project Home: [PROJECT.md](../PROJECT.md)
- [Ticket 03 — Present durable execution-card truth](../issues/03-present-durable-execution-card-truth.md)
- [Normative feature specification](../spec.md)
- [Project terms](../terms.md)
- [Decision 0012 — Ticket 02 final acceptance](0012-t02-final-acceptance.md)
- [Testing Strategy Governance](../../synara-pi-durable-subagents/decisions/0001-testing-strategy-governance.md)
- Repository `AGENTS.md`
- [Ticket 03 independent review](../reviews/03-durable-execution-card-truth-review.md)
- Candidate range `f31a93ab2..236d4119b`
- Implementation report commit `40a41ad11`
- Persisted evidence/review tip `b181150ad`
- The Supervisor consultation dated 2026-08-23 represented by this record

## Evidence

The candidate adds backward-compatible, optional/defaulted execution-card
attachment and teardown-evidence fields. Missing fields in older persisted
events decode to `null`, while fresh projections emit explicit values.

All four current durable card reads use bounded execution-, attempt-, and
generation-fenced attachment and teardown projections. No database migration,
DDL, historical rewrite, or backfill is part of the candidate.

Teardown bands 77 and 78 publish card updates only after durable recording.
Band 76 remains fenced history after proven cancellation advances generation.
Bands 77 and 78 remain non-terminal and cannot produce a false stopped or
terminal claim.

The web uses one whole-card presentation for card ordering, expansion, label,
spinner, controls, and details. Its relevant precedence is committed terminal,
orphaned, teardown uncertainty, cancellation intent, detached running, and
ordinary lifecycle state.

Focused verification reported:

- contracts: 34/34 passed;
- server durable card surface: 17/17 passed;
- focused web presentation, strip, store, and reconnect: 40/40 passed;
- result/details browser boundary: 6/6 passed;
- targeted ChatView orphan/Resume journey: 1/1 passed.

The full isolated-port ChatView run reported 82 passed, 12 skipped, and one
failure in the pre-existing Issue-550 machine-sensitive performance-ratio
benchmark. The Ticket-03 browser journey passed in both the full and targeted
runs. The independent reviewer reproduced the benchmark once failing and once
passing and found no Ticket-03 causal change.

The exactly one independent feature-level review returned PASS on AC1–AC5 and
was persisted at `b181150ad`.

`bun fmt`, `bun lint`, and `bun typecheck` were not authorized and were not
run. No passing result for those mandatory completion checks exists.

## Binding findings

### AC1 — PASS

The card projection includes bounded current-attempt/current-generation
attachment and teardown evidence derived from existing durable state. The
shared contract preserves old-event decoding with `null` defaults, fresh
projections emit explicit fields, and no schema migration or durable rewrite
was introduced.

### AC2 — PASS

`Running in background` requires current observed running state plus
authenticated current-generation detached/background evidence. Attached and
legacy-null cards remain conservatively `Running`. This uses existing durable
owner authority and does not introduce a competing client-side lease protocol.

### AC3 — PASS

Cancellation intent overrides ordinary running presentation. Current survivors
or owner-unproven evidence presents `Cancellation unverified`, without a
spinner, repeated Cancel, Resume, false stopped claim, or terminal inference.
Relevant band-77/78 publication occurs only after durable commit.

### AC4 — PASS

An ownerless, non-terminal execution presents `Outcome unknown (orphaned)`,
has no spinner or Cancel action, and offers explicit Resume only. The browser
journey proves that Resume is not automatic and that one explicit user action
dispatches it.

### AC5 — PASS

Terminal and resumed generations do not inherit stale attachment or teardown
evidence. List, identity read, snapshot, replay, reconnect, card strip, and
details preserve the same whole-card presentation. Stale prior-generation
terminal or teardown records cannot settle or mutate the current generation.

### Contrary browser evidence — NON-BLOCKING

The Issue-550 timing-ratio failure is outside the Ticket-03 change surface,
while the changed Ticket-03 assertion passed. Independent one-fail/one-pass
reproduction supports the conclusion that it is machine/load-sensitive rather
than a Ticket-03 regression. It does not remediate or substitute for the
missing mandatory workspace checks.

### Mandatory completion gate — FAIL DUE TO MISSING EVIDENCE

Repository authority requires `bun fmt`, `bun lint`, and `bun typecheck` all to
pass before a task is considered complete. None was run because explicit owner
authorization was absent. The prohibition on unauthorized execution explains
the missing evidence but does not waive the passing requirement.

Ticket 03 therefore cannot receive final acceptance in this consultation.

## Decision

Final acceptance is **REJECTED / NEEDS REMEDIATION**.

The rejection is limited to the missing mandatory completion evidence. It does
not overturn the independent review’s PASS findings for AC1–AC5 and does not
identify a behavioral execution-card defect.

The only presently identified unblocker is explicit owner authorization to run
the three heavyweight checks in one bundled final verification pass:

- `bun fmt`
- `bun lint`
- `bun typecheck`

All three must pass against the reviewed candidate without material source
drift. Passing is not inferred in advance. Any failure must be inspected and
remediated; a materially changed candidate requires proportionate renewed
verification.

## Rejected alternatives

1. **Accept despite missing checks.** Rejected because it would contradict the
   explicit repository rule that all three checks pass before completion.
2. **Treat lack of authorization as a waiver.** Rejected because the authority
   prohibits unauthorized execution but does not waive the completion
   requirement.
3. **Infer passing results from focused tests or review inspection.** Rejected
   because tests do not establish formatting, lint, or workspace typecheck
   success.
4. **Treat the Issue-550 timing flake as Ticket-03 remediation.** Rejected
   because the evidence places it outside the changed behavior and
   independently demonstrates machine sensitivity.
5. **Add the low web-upsert ordering guard to this candidate.** Rejected as
   acceptance remediation because ordered replay and authoritative snapshots
   make the conservative-null regression risk non-blocking, it predates Ticket
   03, and changing the reviewed candidate would unnecessarily expand scope.
6. **Re-derive owner lease freshness in the browser.** Rejected because current
   durable owner authority plus authenticated seq-3/background evidence is the
   approved seam; a client-side lease protocol would create competing liveness
   truth.

## Assumptions and residual uncertainty

- The persisted review accurately identifies candidate `236d4119b`, baseline
  `f31a93ab2`, implementation report `40a41ad11`, and evidence tip
  `b181150ad`.
- No passing heavyweight-check evidence exists outside the supplied and
  persisted evidence package.
- Whether the candidate passes formatting, lint, and typecheck remains
  unknown. The informational long conditional may or may not be changed by
  formatting; no result is inferred.
- The browser upsert ordering risk remains low and pre-existing under ordered
  replay and snapshot authority.

## Downstream effects

- Ticket 03 is **not complete**.
- The one Ticket-03 final-acceptance consultation budget is exhausted by this
  binding non-acceptance.
- Ticket 04 remains blocked by Ticket 03. It is neither accepted nor advanced
  by this decision.
- Decisions accepting Tickets 01, 01b, 01c, and 02 remain unchanged.
- Candidate behavior satisfying AC1–AC5 remains usable evidence; it need not be
  discarded solely because the completion checks were unauthorized.
- Fresh passing heavyweight-check evidence does not automatically accept Ticket 03. It is material new evidence to be routed under the project’s governing
  reassessment/owner process, not a second Ticket-03 final-acceptance
  consultation.

## Follow-ups

### Acceptance remediation

Obtain explicit owner authorization and run `bun fmt`, `bun lint`, and
`bun typecheck` as one bundled final verification pass. Preserve exact outputs
and candidate identity. Remediate any failure and rerun proportionately.

### Non-blocking follow-ups

- Consider a separate web-store ordering guard so a genuinely out-of-order
  old-shape event cannot conservatively regress fresh attachment/teardown
  fields to `null`.
- Correct the stale strip-test comment when that file is next touched.
- Apply ordinary formatting if the authorized formatter requires it.

These follow-ups are not AC1–AC5 failures and, except for any changes required
by the mandatory checks themselves, are not acceptance remediation.

## Failure, rollback, and safety implications

No rollback is required solely because final acceptance is withheld. Any
remediation must preserve backward event decoding, current
execution/attempt/generation fencing, journal-first terminal authority,
post-commit band-77/78 publication, non-terminal teardown uncertainty, orphan
honesty, whole-card precedence, and Ticket-02’s accepted boundaries.

A rollback or remediation must not infer terminality from process absence,
cancellation dispatch, session stop, transcript existence, owner-unproven
evidence, or client-side timing.

## Reopening conditions

Reassess this rejection only on material new evidence consisting of:

1. explicit owner-authorized results showing `bun fmt`, `bun lint`, and
   `bun typecheck` all pass against the reviewed candidate or a clearly
   identified remediated successor;
2. failures from those checks and evidence that all resulting remediation is
   complete;
3. material evidence that the candidate, review provenance, durable fencing,
   publication ordering, whole-card presentation, or focused test results were
   stale or incorrect; or
4. a governing owner decision that changes the repository completion
   requirement.

Any later reassessment must preserve the fact that this was the one and only
Ticket-03 final-acceptance consultation; it must not be represented as a
second final-acceptance consultation.
