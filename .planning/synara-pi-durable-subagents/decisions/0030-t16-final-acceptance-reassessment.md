# Decision 0030 — Ticket 16 final-acceptance rejection reassessment

## Status

accepted; Decision 0029 rejection superseded

## Date

2026-08-19

## Consultation class

Reassessment authorized by Decision 0029. This is not a second
final-acceptance consultation.

## Question

Does candidate `9c27a48b`, supported by the remediation addendum at
`e1d30df0`, close every Decision 0029 reopening requirement and permit Ticket
16 to become complete and Ticket 17 to become unblocked?

## Governing references

- Project Home.
- Ticket 16.
- Decision 0027 — teardown bands and restart ownership posture.
- Decision 0028 — owner-approved real-Pi destructive-test substitution.
- Decision 0029 — final-acceptance rejection and reopening contract.
- The existing Ticket-16 review package and remediation addendum.

## Evidence

- Production recursively traverses nested `AggregateError.errors` with cycle
  protection.
- Survivor evidence accepts only positive safe-integer PIDs and is
  deterministically sorted, deduplicated, and capped at 16.
- Missing PID evidence remains honest uncertainty and is described as
  unavailable, never as zero survivors.
- Production-boundary and coordinator/repository tests prove identical bounded
  PID evidence in band-77 metadata and operator diagnostics while the
  execution remains non-terminal.
- Allocation documentation consistently identifies request 75, proven 76,
  survivors 77, and owner-unproven 78.
- Exact-candidate verification: seven focused files / 119 tests passing,
  `bun fmt` clean, `bun lint` with zero errors / 549 warnings, and
  `bun typecheck` 7/7.
- The independent remediation addendum reran the focused suite, lint,
  typecheck, and formatter checks and closed F1–F3 without invariant
  regression.
- No destructive real-Pi CI run was performed or required under Decision 0028.

## Reopening evidence reconciliation

1. Satisfied: `9c27a48b` implements bounded deterministic extraction through
   nested `AggregateError`.
2. Satisfied: production-boundary and real coordinator/repository tests prove
   survivor evidence reaches band 77 and operator diagnostics while remaining
   non-terminal.
3. Satisfied: source and Ticket-16 allocation documentation are corrected.
4. Satisfied: affected resolver/wiring coverage and the expanded seven-file
   focused suite pass.
5. Satisfied: exact-candidate format, lint, and typecheck evidence passes.
6. Satisfied: the independent remediation addendum closes F1–F3 without
   invariant regression.
7. Satisfied: Project Home, Decisions 0027–0029, candidate `9c27a48b`, and
   addendum `e1d30df0` were supplied to this Reassessment.

## Decision

**ACCEPT.**

- T16-AC1 — pass.
- T16-AC2 — pass.
- T16-AC3 — pass.
- T16-AC4 — pass.
- T16-AC5 — pass.
- T16-AC6 — pass.
- T16-AC7 — pass.

Decision 0029's defect and its documentation/verification findings are closed.
Ticket 16 may become complete and Ticket 17 may become unblocked after this
record is persisted and routed.

## Accepted baseline

- Symphony `9c27a48b`
- Review/addendum evidence `e1d30df0`
- Alfie unchanged at `489acd626` / `0.14.0-alfie.1`

The review/addendum commit is supporting acceptance evidence, not a change to
the accepted implementation baseline.

## Invariant preservation

- Owned-only kill authority is unchanged.
- Survivors and owner-unproven remain retryable uncertainty.
- Uncertain-to-proven escalation remains possible through distinct bands.
- Proof-before-fence remains intact.
- Startup no-owner behavior and Ticket-10's subsequent orphan fence remain
  intact.
- Journal evidence remains immutable.
- Generation and terminal-truth guards remain intact.
- Survivor evidence is deterministic and bounded to 16.
- Bands 75–78 are neither collapsed nor reinterpreted.

## Testing governance and scope

- Decision 0028 remains satisfied: deterministic fixtures are the CI
  acceptance evidence; the isolated destructive real-Pi recipe remains manual
  and unclaimed.
- No schema migration, web change, destructive real-Pi CI test, Alfie
  modification, or dependency-pin change is accepted here.
- Unrelated dirty-tree formatting and runtime noise are excluded.

## Accepted residuals and notes

- The manual real-Pi recipe remains unexecuted and explicitly manual.
- The cosmetic fallback-vocabulary note remains nonblocking.
- SQL discovery materialization with a 64-execution processing cap remains
  accepted.
- The 549 lint warnings are nonblocking because lint reports zero errors and
  they are an existing warning class.
- Antigravity's similar top-level-only telemetry pattern is outside Ticket 16.
- The fixture-oriented `survivorPids` type comment is informational; production
  behavior is correctly bounded.

## Rejected alternatives

- Continue rejecting despite closed survivor-evidence handling.
- Require destructive real-Pi CI contrary to Decision 0028.
- Treat missing PID evidence as zero survivors.
- Collapse bands 76–78.
- Treat uncertain outcomes as teardown proof.

## Downstream effect

- Ticket 16 transitions to complete.
- Ticket 17 is unblocked with respect to Tickets 15 and 16.
- The project frontier advances to Ticket 17.

## Failure and rollback implications

Reverting aggregate traversal, evidence validation/bounding, no-evidence
wording, or durable/operator parity reopens T16-AC4 and restores Decision
0029's rejection posture. Any rollback must preserve immutable bands 75–78 and
must not reinterpret uncertain rows as proof.

## Reopening conditions

Reassess only on material evidence of:

1. loss or mismatch of survivor evidence;
2. regression in owned-only authority, proof-before-fence, startup ordering,
   retryability, journal immutability, generation fencing, or boundedness;
3. invalidation of exact-candidate verification;
4. a relevant Alfie change; or
5. a later accepted decision changing Decisions 0027 or 0028.

## Superseded record

Decision 0029's rejection verdict, remediation gate, and downstream blocking
effect are superseded. Decision 0029 remains historical evidence. Decisions
0027 and 0028 are preserved without amendment.
