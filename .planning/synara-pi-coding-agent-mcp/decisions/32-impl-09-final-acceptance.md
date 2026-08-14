# Decision 32: impl-09 final acceptance

**Status:** Binding Reassessment — Acceptance
**Trigger:** Material technical decision verification/escalation — governing-authority and material-evidence reassessment
**Date:** 2026-08-14
**Supersedes:** Decision 30’s binding rejection

## Question

Does owner-approved Decision 31 remove Decision 30’s sole formatter blocker and
permit final acceptance of impl-09 at exact source candidate `8a8907ac`,
without a second final-acceptance consultation?

## Authority basis

Authoritative:

- `../PROJECT.md`
- `../issues/impl-09-runtime-recovery.md`
- `28-impl-09-final-acceptance.md`
- `29-impl-09-final-acceptance-reassessment.md`
- `30-impl-09-formatter-evidence-correction.md`
- `31-formatter-gate-semantics.md`

Decision 31 establishes that `bun fmt` passes when it completes with exit
status `0`; a zero-diff worktree is not required, and unrelated formatter output
must not be absorbed into ticket scope. This is the owner decision expressly
requested by Decision 30 and satisfies Decision 30’s reopening condition.

## Evidence considered

- Exact source candidate `8a8907ac` ran `bun fmt` successfully with exit status
  `0`.
- AC1 and AC2 passed.
- The independent reviewer returned `PASS WITH GAPS` and recommended `ACCEPT`.
- Focused server tests passed 195/195.
- Contracts tests passed 204/204.
- Workspace typecheck passed 7/7 packages.
- Lint completed with zero errors.
- The only full-suite failures were two unrelated, off-surface 240-second React
  Compiler timeouts involving `Sidebar.tsx` and `TraitsPicker.tsx`.
- No evidence links those web timeouts to impl-09.
- Commits after `8a8907ac` contain governance records only; they do not alter
  the accepted source or test state.

## Decision

Accept impl-09 unconditionally at exact source candidate commit `8a8907ac`.

Decision 30’s rejection depended solely on a zero-diff formatter
interpretation. Decision 31 supersedes that interpretation and confirms that
the successful exit-0 formatter run satisfies the repository completion gate.
The formatter’s unrelated repository-wide output must remain outside impl-09
scope and is not required for acceptance.

The prior criterion-level findings remain valid: impl-09 satisfies AC1 and AC2,
preserves the accepted lifecycle and authority invariants, and has passing
focused tests, contracts tests, typecheck, lint, and formatter evidence. The two
off-surface full-suite timeouts remain unrelated workspace failures and do not
block this candidate.

This is a reassessment of Decision 30 on new governing authority, not a second
final-acceptance consultation.

## Preserved non-blocking findings and residual uncertainty

- Startup recovery is tested through an orchestration seam rather than a real
  engine/server-start integration fixture.
- A low-severity layering import remains.
- A competing convergence timeout may leave one bounded transient timer alive
  after activation wins.
- Per-turn read-model cost has not been measured.
- Reviewer findings F5 and F6 remain informational.
- A crash between durable terminal-state dispatch and terminal-activity
  dispatch may leave the work log without the corresponding terminal activity.
- The two unrelated React Compiler timeout failures remain workspace debt.

No supplied evidence shows that these gaps violate impl-09 acceptance criteria
or an accepted production invariant.

## Rejected alternatives

- Upholding Decision 30 after the owner supplied the exact formatter-policy
  decision it required.
- Continuing to require a zero-diff formatter run contrary to Decision 31.
- Absorbing the formatter’s unrelated repository-wide output into impl-09.
- Treating governance-only commits after `8a8907ac` as a new source candidate.
- Treating unrelated web compiler timeouts as impl-09 regressions without
  dependency or reproduction evidence.
- Reopening accepted lifecycle, wait-set, rollback, testing, or authority
  decisions without contrary evidence.
- Converting preserved reviewer gaps into blocking requirements without
  evidence of a failed acceptance criterion.

## Assumptions

- The supplied formatter result belongs to exact commit `8a8907ac`.
- The historical reviewer and verification results remain accurate and
  candidate-scoped.
- Commits after `8a8907ac` modify governance records only.
- No omitted formatter evidence demonstrates a concealed functional or
  syntactic defect within impl-09’s authorized surface.
- No new evidence connects the two web React Compiler timeouts to impl-09.

## Downstream effect

- Represent impl-09 source candidate `8a8907ac` as finally accepted.
- Mark Decision 30’s rejection as superseded.
- Preserve Decisions 28–31 as historical and governing evidence; do not
  rewrite or delete them.
- Decision 29 remains historical rather than becoming the controlling record
  again.
- Treat later commits as governance-only; acceptance remains attached
  exclusively to source/test state `8a8907ac`.
- Do not apply unrelated formatter output under impl-09 authority.
- No source correction, repository-wide normalization, additional feature
  review, or second final-acceptance consultation is required.

## Reopening conditions

Reassess this acceptance if:

- `bun fmt` is shown to have exited non-zero or to have run against a different
  candidate;
- formatter output within impl-09’s authorized surface is shown to conceal a
  functional or syntactic defect;
- the owner changes formatter-gate policy or CI introduces an authoritative
  clean-diff formatter gate;
- accepted reviewer, focused-test, contracts, typecheck, or lint evidence is
  shown to be stale, inaccurate, or associated with another candidate;
- either web timeout is causally linked to impl-09;
- a preserved reviewer gap produces a concrete acceptance-criterion or
  production-invariant failure;
- later commits contain source or test changes rather than governance records
  only; or
- any governing evidence incorporated by this reassessment is materially
  contradicted.

## Superseded record

Decision 30’s binding rejection is superseded in full. Its factual formatter
reproduction remains historical evidence, but its zero-diff pass interpretation
is displaced by owner-approved Decision 31.
