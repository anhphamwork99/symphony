# Decision 29: impl-09 final-acceptance reassessment

**Status:** Binding Acceptance
**Trigger:** Material technical decision verification/escalation — material-evidence reassessment
**Date:** 2026-08-14
**Supersedes:** Decision 28’s binding rejection

## Question

Does newly obtained formatter evidence at exact source candidate commit
`8a8907ac` satisfy Decision 28’s explicit reopening condition and remove its
sole final-acceptance blocker, such that impl-09 may now be accepted without a
second final-acceptance consultation?

## Governing references

Authoritative:

- `../PROJECT.md`
- `../spec.md`
- `../issues/impl-09-runtime-recovery.md`
- `09-dormant-pi-mcp-lifecycle.md`
- `15-project-shared-activation-user-isolated-authority.md`
- `16-project-enable-rollback-propagation.md`
- `17-project-enable-awaits-all-sessions.md`
- `18-project-enable-wait-set.md`
- `19-future-session-waits-for-enable-operation.md`
- `20-testing-strategy-governance.md`
- `21-authenticated-mcp-session-authority.md`
- `27-impl-08-final-acceptance.md`
- `28-impl-09-final-acceptance.md`
- Repository completion requirements in `AGENTS.md`

Supporting:

- Exact formatter command, exit status, output, and clean detached-worktree
  evidence supplied for commit `8a8907ac`.
- The behavioral, reviewer, focused-test, contracts, typecheck, lint, full-suite,
  and candidate-attribution evidence preserved in Decision 28.

## Evidence scope

The implementation and source candidate remains exactly commit `8a8907ac`.
This reassessment does not review or accept a later source candidate.

A detached worktree at exact commit `8a8907ac` ran:

`PATH="$HOME/.bun/bin:$PATH" bun fmt`

The command exited `0` with:

`Finished in 1012ms on 2547 files using 10 threads`

Immediately afterward:

- `git status --short | wc -l` returned `0`; and
- the diff stat was empty.

The formatter therefore passed at the exact candidate and did not modify it.

All evidence accepted by Decision 28 remains in force:

- AC1 and AC2 behavioral criteria passed;
- the independent reviewer reported `PASS WITH GAPS` and recommended `ACCEPT`;
- focused server tests passed 195/195;
- contracts tests passed 204/204;
- workspace typecheck passed 7/7 packages;
- lint completed with 0 errors;
- the only full-suite failures were two unrelated 240-second React Compiler
  timeouts for `Sidebar.tsx` and `TraitsPicker.tsx`; and
- the candidate contains no web-file changes.

The current branch also contains documentation-only commit `3d9971bf`, which
persisted Decision 28. That commit is governance history, not a replacement
source candidate. Acceptance remains attached to `8a8907ac`. The commit that
persists this reassessment will likewise be decision-record-only unless its
tracked diff proves otherwise.

## Reassessment

Decision 28 is superseded.

Its binding rejection rested solely on the absence of successful `bun fmt`
evidence at exact candidate HEAD `8a8907ac`. Its explicit reopening condition
required `bun fmt` to pass at that exact commit without modifying the candidate.

The new detached-worktree evidence satisfies that condition exactly:

- the formatter ran against `8a8907ac`;
- it exited successfully; and
- the worktree and diff remained empty afterward.

The formatter uncertainty identified by Decision 28 is therefore resolved. No
new evidence contradicts Decision 28’s substantive behavioral findings,
reviewer evidence, test results, lifecycle or authority analysis, or
candidate-attribution findings.

## Decision

Accept impl-09 at exact source candidate commit `8a8907ac`.

The candidate satisfies:

- impl-09 AC1 and AC2;
- the dormant, project-shared, rollback, immutable-wait-set, future-session,
  testing, and subject-authority requirements governed by Decisions 09 and
  15–21;
- the accepted impl-08 invariants preserved by Decision 27;
- focused server and contracts verification;
- workspace typecheck;
- lint with zero errors; and
- the mandatory formatter gate, now proven by a successful no-diff formatter
  run at the exact candidate commit.

The two web React Compiler timeouts remain unrelated full-suite failures and do
not block this candidate on the supplied attribution evidence.

This is an unconditional acceptance of `8a8907ac`, reached by reassessing
Decision 28 on material new evidence. It is not a second final-acceptance
consultation and does not reopen previously settled lifecycle, authority,
wait-set, rollback, or testing decisions.

## Preserved non-blocking findings and residual risks

1. Startup recovery is not exercised through a real engine/server-start
   integration fixture. Focused fake-seam coverage verifies recovery behavior,
   but actual layer construction, readiness ordering, and startup failure
   propagation remain less directly proven.

2. The reported low-severity layering import adds coupling but does not
   presently violate an accepted runtime invariant.

3. The convergence timeout leaves a transient timer alive when activation wins
   first. The supplied evidence shows at most bounded retention within the
   30-second timeout, not unbounded growth, duplicate activation, state
   mutation, or correctness failure.

4. Per-turn read-model cost has not been measured. No evidence currently shows
   unacceptable latency or load behavior, but material measured cost remains a
   reassessment trigger under the project’s performance-first priority.

5. Reviewer findings F5 and F6 remain informational. Their detailed substance
   was not supplied, so this reassessment neither reinterprets nor elevates
   them.

6. Startup recovery dispatches durable project terminal state before terminal
   activity. A crash in that interval may leave the work log without the
   corresponding terminal activity. No supplied evidence establishes this as
   an impl-09 acceptance-criterion failure.

7. The repository still has two unrelated web React Compiler timeout failures.
   They remain workspace debt and must be reassessed if dependency or
   reproduction evidence connects them to impl-09.

## Rejected alternatives

- Keeping Decision 28’s rejection after its sole blocker and exact reopening
  condition have been satisfied.
- Requiring formatter-induced changes when the successful formatter run
  produced no worktree change.
- Treating documentation-only commits after `8a8907ac` as a new source
  candidate.
- Performing a second final-acceptance consultation despite Decision 28 having
  already completed the criterion-by-criterion acceptance assessment.
- Treating the two off-surface web compiler timeouts as impl-09 regressions
  without contrary dependency or reproduction evidence.
- Reopening Decisions 09, 15–21, or 27 without material evidence contradicting
  their accepted invariants.
- Converting non-blocking reviewer findings into source-correction requirements
  without evidence of a failed acceptance criterion or production invariant.
- Issuing conditional acceptance. This reassessment either passes or rejects;
  the preserved gaps are explicitly non-blocking.

## Assumptions

- The detached worktree was checked out at exact commit `8a8907ac`.
- The reported formatter command, exit status, output, clean status count, and
  empty diff stat are accurate and belong to that detached worktree.
- The prior focused, contracts, typecheck, lint, full-suite, and reviewer
  evidence summarized in Decision 28 remains accurate and candidate-scoped.
- Commit `3d9971bf` changes decision records only and does not alter source,
  tests, runtime behavior, or the candidate represented by `8a8907ac`.
- The commit used to persist this Decision Record will likewise be
  documentation-only.
- The two web compiler timeout tests do not consume or depend on the changed
  impl-09 server recovery modules.
- Existing provider tests proving fresh credential, callback, catalog, and
  runtime-generation isolation remain applicable at `8a8907ac`.

## Residual uncertainty

The formatter uncertainty recorded by Decision 28 is resolved.

The remaining uncertainty is limited to the preserved non-blocking gaps:
real-server startup integration is less directly tested; the transient timeout
timer and per-turn read-model cost have bounded but unmeasured operational
dimensions; the detailed content of informational reviewer findings F5 and F6
was not supplied; and a documented crash window may omit a terminal work-log
activity.

None of the supplied evidence shows that these uncertainties violate an
accepted criterion or production invariant.

## Downstream effect

- Persist and track this record as
  `.planning/synara-pi-coding-agent-mcp/decisions/29-impl-09-final-acceptance-reassessment.md`.
- After persistence is confirmed, represent impl-09 source candidate
  `8a8907ac` as finally accepted.
- Record that Decision 28’s rejection is superseded by this reassessment.
- Preserve Decision 28 as historical evidence; do not delete or rewrite it.
- Do not identify `3d9971bf` or the Decision 29 persistence commit as a newly
  reviewed source candidate. They are decision-record-only history.
- No behavioral source correction, additional feature-level review, or second
  final-acceptance consultation is required.
- Decisions 09, 15–21, and 27 remain authoritative and are not reopened or
  superseded.
- If any source or test file changes after `8a8907ac`, treat the resulting
  commit as a new candidate and verify it proportionately before transferring
  this acceptance.

## Failure or rollback implications

This acceptance does not authorize source modification or rollback. It accepts
the source and test state at exact commit `8a8907ac`.

If `8a8907ac` cannot reproduce the reported formatter result, if the detached
worktree was not actually at that commit, or if accepted verification evidence
is shown to belong to another candidate, this acceptance must be reassessed.

Reverting or changing accepted source creates a different candidate to which
this acceptance does not automatically apply. Reverting only the later
decision-record commits does not alter source behavior, but it removes the
governance basis for representing impl-09 as accepted until the record is
restored.

## Reopening conditions

Reassess this acceptance if:

- `bun fmt` does not reproduce successfully and without a diff at exact commit
  `8a8907ac`;
- the formatter evidence is shown to come from another commit or a dirty
  worktree;
- focused server, contracts, typecheck, or lint evidence is shown to be stale,
  inaccurate, or associated with another source candidate;
- either web React Compiler timeout is shown to depend on impl-09 changes;
- real server startup fails to run recovery before command readiness;
- a pending operation extends its persisted absolute deadline;
- recovery replays provider or MCP activation;
- a future session joins or changes the immutable operation wait-set;
- a stale credential, callback, catalog, or runtime generation can reattach;
- stale work restores enabled state or produces duplicate terminal activity;
- the transient timeout timer causes material resource retention under load;
- measured read-model cost violates evidenced operational requirements;
- the crash window produces concrete duplicate, missing-terminal, replay, or
  operability failure that violates the accepted contract;
- commit `3d9971bf` or this record’s persistence commit is shown to contain
  source or test changes material to the candidate; or
- any governing evidence used by Decision 28 or this reassessment is shown to
  be contradictory or inaccurate.

## Superseded records

Decision 28’s binding rejection is superseded in full by this binding
acceptance.

Decision 28 remains authoritative as historical evidence for its
criterion-by-criterion behavioral assessment, full-suite attribution, and
preserved non-blocking findings where this reassessment incorporates them.

Decision 27 remains authoritative for impl-08. Decisions 09 and 15–21 remain
authoritative and are not reopened or superseded.
