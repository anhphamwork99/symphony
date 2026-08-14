# Decision 27: impl-08 final acceptance

**Status:** Binding Acceptance
**Trigger:** Final acceptance
**Date:** 2026-08-14

## Question

Does the integrated impl-08 candidate at reviewed HEAD
`4c1518e393ebb60d068d2b93fd1a1f88d34ef6fe` satisfy its authoritative
acceptance criteria, governing decisions, testing strategy, and repository
completion requirements, such that it may be accepted and marked done after
bounded acceptance bookkeeping?

## Governing references

Authoritative:

- `../PROJECT.md`
- `../spec.md`
- `../issues/impl-08-project-propagation-wait-set.md`
- `14-disable-cancellation-sequence.md`
- `16-project-enable-rollback-propagation.md`
- `17-project-enable-awaits-all-sessions.md`
- `18-project-enable-wait-set.md`
- `19-future-session-waits-for-enable-operation.md`
- `20-testing-strategy-governance.md`
- `26-impl-08-typecheck-correction.md`
- Repository `AGENTS.md`

Supporting:

- Candidate range `2bfeb1d0...4c1518e3`.
- Integrated commits `ebc3060c`, `43049d46`, `31fb547d`, `92ffe439`,
  `9cd736cf`, `2f8baa34`, and `4c1518e3`.
- Final focused, heavyweight, full-suite, and clean-tree verification evidence.
- Exactly one independent final reviewer package: `PASS WITH GAPS`,
  recommendation `accept`, high confidence.

## Evidence scope

The reviewed candidate is branch `impl-06-single-session-mcp-lifecycle` at
HEAD `4c1518e393ebb60d068d2b93fd1a1f88d34ef6fe`, with fixed point
`2bfeb1d0` and a clean working tree.

Focused impl-08 and corrective suites pass. The reconciliation suite contains
12 passing tests and the Pi enable-helper suite contains 10 passing tests,
including the post-correction generation and elapsed-deadline cleanup cases.

`bun fmt` completed; formatter changes outside the allowed corrective surface
were reverted and the changed surface is format-clean. `bun lint` exited 0
with 430 warnings and 0 errors. `bun typecheck` passed all 7 workspace packages
with 0 errors. `git diff --check` is clean.

The final `bun run test` completed with 3907 passed, 16 skipped, and 27 failed.
The 27 failures are independently verified as pre-existing and confined to
five off-surface files: integration timeout 10, Codex 2, OpenCode 9, Claude 5,
and Antigravity 1. No impl-08 surface failed.

The single final reviewer found AC1, AC2, and checklist C1-C12 passing.
Findings F1, F2, and F3 are resolved. D1 is stale ticket bookkeeping. N1 and N2
are informational and non-blocking.

## Decision

Accept impl-08 at reviewed HEAD
`4c1518e393ebb60d068d2b93fd1a1f88d34ef6fe`.

The candidate satisfies AC1 and AC2:

- the current-session wait-set is immutable and deterministic;
- future sessions do not join the accepted operation;
- each member is reconciled independently against the full captured session
  generation;
- enabled is committed only after every member succeeds;
- failure, timeout, unsafe disappearance, or uncertain result rolls the project
  back to persisted disabled;
- cleanup includes successful siblings;
- stale operation/session work cannot settle a newer operation;
- replay produces no duplicate side effects or terminal; and
- exactly one terminal outcome is emitted.

The candidate also satisfies checklist C1-C12, the approved Testing Seams,
Decisions 14/16/17/18/19/20, and the corrective requirements of Decision 26.

The stale impl-08 ticket prose is not treated as implementation evidence and
does not block acceptance because final candidate and independent reviewer
evidence are complete. The ticket remains `corrective-pending` solely until
this Acceptance Decision is persisted and the exact bookkeeping below is
applied. It may then be marked `done` without another implementation or review
cycle.

## Required post-acceptance ticket bookkeeping

Update only `../issues/impl-08-project-propagation-wait-set.md` as follows:

1. Change `**Status:** corrective-pending` to `**Status:** done`.
2. Identify accepted candidate HEAD
   `4c1518e393ebb60d068d2b93fd1a1f88d34ef6fe` and the accepted range
   `2bfeb1d0...4c1518e3`.
3. State that reconciliation requires equality with the complete captured
   session-generation token, together with request ID, operation generation,
   and wait-set membership. A thread-prefix check alone is insufficient.
4. Record that the 120-second absolute deadline remains the activation-success
   deadline. After it has elapsed, rollback cleanup may use a separate bounded
   30-second cleanup grace. That grace does not extend the activation deadline
   and cannot convert a timeout into success.
5. Record `piSynaraMcpEnable.test.ts` at 10 passing tests,
   `synaraMcpProjectReconciliation.test.ts` at 12 passing tests, and the final
   post-correction focused verification results.
6. Record typecheck as 7/7 workspace packages passed with 0 TypeScript errors.
7. Record the full suite as 3907 passed, 16 skipped, and 27 failed, with the
   failures confined to the five independently verified pre-existing
   off-surface files: integration timeout 10, Codex 2, OpenCode 9, Claude 5,
   and Antigravity 1; no impl-08 surface failure.
8. Record that `bun fmt` completed with non-allowlisted pre-existing drift
   reverted, the changed surface is format-clean, `bun lint` exited 0 with 430
   warnings and 0 errors, and `git diff --check` is clean.
9. Cite this final Acceptance Decision and state that Decision 26's corrective
   gate is resolved.
10. Do not change the ticket scope, acceptance criteria, approved Testing
    Seams, or owner-approved behavioral decisions.

## Accepted residual risks

1. The repository retains 27 pre-existing full-suite failures in five
   independently verified off-surface files. They remain workspace debt but do
   not invalidate impl-08.
2. Repository-wide formatter drift exists outside the accepted candidate. It
   was excluded from the candidate and does not affect changed-surface
   cleanliness.
3. Reviewer note N2 concerning timeout-pump continuation remains informational.
   Current focused evidence does not show a leak, unbounded wait, mid-turn
   exposure, duplicate terminal, or other accepted-invariant violation.

## Rejected alternatives

- Rejecting impl-08 solely because the ticket prose has not yet been refreshed,
  despite complete final candidate and independent review evidence.
- Declaring the 27 off-surface baseline failures to be impl-08 regressions
  without contrary dependency or failure evidence.
- Reopening owner-approved wait-set, rollback, future-session, cancellation, or
  testing decisions.
- Requiring another feature-level review after docs-only acceptance
  bookkeeping.
- Marking the ticket done before persisting this record and completing D1.

## Assumptions

- The supplied candidate hashes, clean-tree state, verification outputs, and
  single reviewer package are accurate and all refer to reviewed HEAD
  `4c1518e393ebb60d068d2b93fd1a1f88d34ef6fe`.
- Independent baseline attribution for the 27 failures was performed against
  the final run and not inferred only from historical counts.
- The D1 update changes documentation only and will not alter source, tests,
  candidate commits, scope, or governing behavior.

## Residual uncertainty

The pre-existing full-suite failures and repository-wide formatter drift remain
outside impl-08. No evidence supplied in this consultation shows an impl-08
dependency on those failures.

N2 may be reopened only if operational or test evidence demonstrates an
unbounded continuation, leaked task/resource, deadline extension, mid-turn tool
exposure, duplicate terminal, or shutdown/restart interference.

## Downstream effect

- Persist and track this Acceptance Decision under the project `decisions/`
  directory.
- Apply the exact docs-only ticket bookkeeping above.
- After both actions are confirmed, mark impl-08 `done`.
- No additional source change, corrective implementation cycle, or independent
  feature review is required for impl-08.
- Downstream tickets may cite impl-08 as accepted only after the Acceptance
  Decision exists and the ticket update is tracked.

## Failure or rollback implications

If the accepted source commit is reverted, changed after review, or cannot be
reproduced at the stated HEAD, this acceptance no longer applies to the altered
candidate.

Reverting the docs-only bookkeeping does not change the reviewed source
behavior, but it restores a governance and traceability blocker; the ticket
must not be represented as done until repaired.

## Reopening conditions

Reopen this acceptance only if:

- the candidate differs from reviewed HEAD
  `4c1518e393ebb60d068d2b93fd1a1f88d34ef6fe`;
- focused impl-08 or corrective verification is shown to fail at that HEAD;
- one or more of the 27 full-suite failures is shown to depend on or regress
  because of impl-08;
- the full-generation equality, absolute-deadline, rollback, sibling-cleanup,
  stale-work, or exactly-once-terminal invariants are disproved;
- cleanup exceeds its bounded grace or the grace extends activation success
  beyond the 120-second deadline;
- N2 produces concrete invariant, resource-lifetime, restart, or operability
  failure evidence;
- the ticket bookkeeping changes source behavior, scope, or an owner-approved
  decision; or
- material evidence supplied for this acceptance is shown to be stale,
  contradictory, or inaccurate.

## Superseded records

None. Decision 26 remains authoritative for the corrective work and is now
satisfied; it is not superseded.
