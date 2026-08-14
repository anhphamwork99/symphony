# Decision 30: impl-09 formatter-evidence correction

**Status:** Binding Reassessment — Rejection
**Trigger:** Material technical decision verification/escalation
**Date:** 2026-08-14
**Supersedes:** Decision 29’s binding acceptance

## Question

Does corrected formatter evidence at exact source candidate commit `8a8907ac`
invalidate Decision 29’s acceptance, what is impl-09’s current acceptance
status, and may the formatter’s 38-file repository-wide output be applied as
part of impl-09 without further owner authorization?

## Governing references

Authoritative:

- `../PROJECT.md`
- `28-impl-09-final-acceptance.md`
- `29-impl-09-final-acceptance-reassessment.md`
- Repository completion requirements in `AGENTS.md`

Supporting:

- Corrected formatter reproduction supplied for detached worktree
  `/tmp/impl09-fmt-check` at exact commit `8a8907ac`.
- Corrected detached-worktree status and diff summary.
- The substantive behavioral, reviewer, test, lifecycle, authority, and
  candidate-attribution evidence incorporated by Decision 28.

## Evidence scope

Decision 29 accepted source candidate `8a8907ac` because reported formatter
evidence stated that `bun fmt` exited successfully and left the exact candidate
unchanged.

That evidence was inaccurate because the command was evaluated from the wrong
working directory.

The corrected reproduction used a detached worktree at exact commit `8a8907ac`
and ran:

`cd /tmp/impl09-fmt-check && PATH="/Users/anhpham99/symphony/node_modules/.bin:$HOME/.bun/bin:$PATH" bun fmt`

The command exited `0` and reported:

`Finished in 922ms on 2546 files using 10 threads`

After the command:

- 38 tracked files were modified;
- the diff contained 488 insertions and 401 deletions; and
- the modified surface included both candidate files and unrelated existing
  files.

The main worktree remains clean at governance HEAD `faced476`. No formatter
output has been applied there, and the impl-09 source candidate remains exact
commit `8a8907ac`.

No corrected evidence was supplied that contradicts Decision 28’s substantive
AC1/AC2 findings, accepted lifecycle and authority invariants, independent
review evidence, focused tests, contracts tests, lint, typecheck, or
full-suite attribution.

## Reassessment

Decision 29 is superseded.

Decision 29’s acceptance depended on the factual premise that `bun fmt` ran at
exact commit `8a8907ac` and left the worktree unchanged. The corrected
reproduction directly disproves that premise. It also satisfies Decision 29’s
explicit reopening condition: `bun fmt` does not reproduce without a diff at
the accepted source candidate.

A formatter exit status of `0` establishes successful command execution. It
does not establish formatter conformance when the command rewrites tracked
files. For a mutating repository formatter, a committed candidate passes the
formatter gate only when the required command exits successfully and leaves
that exact committed candidate unchanged.

Accordingly, `8a8907ac` does not satisfy the mandatory repository formatter
gate.

## Decision

Reject final acceptance of impl-09 at exact source candidate commit `8a8907ac`.

Decision 29’s binding acceptance is superseded. Decision 28’s substantive
assessment remains valid, including its finding that the implementation
evidence satisfies the impl-09 behavioral criteria and that formatter
conformance is the sole demonstrated acceptance blocker.

The current rejection is limited to repository completion conformance. It does
not find that impl-09’s runtime-recovery behavior, lifecycle design, authority
boundaries, or focused implementation must be rewritten.

The formatter’s 38-file output is not automatically authorized as impl-09
work. Applying changes to unrelated existing files would materially expand the
ticket’s source, review, regression, and ownership surface.

Under the current global `bun fmt` requirement and formatter configuration,
committing all deterministic formatter output would be technically necessary
to produce a candidate on which a subsequent global formatter run is no-diff.
Technical necessity does not grant authority for that repository-wide scope
expansion.

The human owner must decide whether to:

1. authorize a separate repository-wide formatting normalization, after which
   the resulting new candidate receives review and verification proportionate
   to all 38 changed files; or
2. amend or explicitly narrow the repository completion requirement, including
   the intended formatter scope and pass semantics.

Until one of those paths is authorized and completed, impl-09 must not be
represented as finally accepted.

## Rejected alternatives

- Preserving Decision 29’s acceptance after its decisive no-diff evidence was
  disproven.
- Treating formatter exit status `0` as candidate conformance despite 38
  tracked-file modifications.
- Applying all formatter output under impl-09 merely because the formatter
  generated it.
- Applying only the impl-09-local subset while continuing to claim that the
  current global `bun fmt` gate passes.
- Silently waiving, narrowing, or reinterpreting the repository completion
  requirement.
- Reopening impl-09’s accepted runtime-recovery design or Decisions 09, 15–21,
  and 27 without new behavioral evidence.
- Issuing conditional final acceptance while the mandatory formatter gate
  remains unsatisfied.

## Assumptions

- `/tmp/impl09-fmt-check` was detached at exact commit `8a8907ac`.
- The corrected command, exit status, formatter output, file count, and diff
  statistics belong to that detached worktree.
- The 38-file diff includes files outside impl-09’s accepted source surface.
- The main worktree is clean at governance HEAD `faced476`, and no formatter
  output has been applied there.
- The formatter and its configuration are deterministic for the corrected
  environment.
- Decision 28’s remaining candidate-scoped evidence remains accurate because no
  contrary evidence was supplied.

## Residual uncertainty

The exact 38-file manifest and per-file semantic risk were not supplied in this
consultation. That detail does not affect the rejection because any non-empty
formatter diff disproves Decision 29’s no-diff premise.

It remains possible that formatter version, configuration, generated files, or
environmental differences contribute to the size of the output. Those causes
should be investigated before requesting authorization for a repository-wide
normalization, but they do not convert the current formatter result into a
passing gate.

The verification required for a new formatted candidate depends on the actual
changed-file manifest and cannot be reduced safely to impl-09’s previous
server-only evidence while unrelated files are included.

## Downstream effect

- Persist and track this record as
  `.planning/synara-pi-coding-agent-mcp/decisions/30-impl-09-formatter-evidence-correction.md`.
- Mark Decision 29’s binding acceptance as superseded.
- Preserve Decisions 28 and 29 as historical evidence; do not rewrite or
  delete them.
- Represent impl-09 source candidate `8a8907ac` as not finally accepted.
- Leave the clean governance worktree and source candidate unchanged pending
  owner direction.
- Do not apply the detached worktree’s 38-file formatter diff under existing
  impl-09 authority.
- Before requesting repository-wide formatting authorization, obtain and
  review the exact changed-file manifest and reproduce the formatter output in
  another clean exact-commit worktree to establish determinism.
- If the owner authorizes repository-wide normalization, create a new source
  candidate, review the full changed surface, run verification proportionate
  to that surface, and prove that a subsequent `bun fmt` run exits successfully
  with no tracked diff.
- If the owner changes or narrows the completion gate, persist that governing
  decision before reassessing acceptance.
- No second final-acceptance consultation is warranted until one authorized
  corrective path has produced complete new evidence.

## Failure or rollback implications

This reassessment authorizes no source change, formatter application, rollback,
or history rewrite. The main worktree should remain at its clean governance
state.

The detached formatter output is diagnostic evidence only. It may be discarded
with the detached worktree without affecting the source candidate.

If formatter changes are committed, the resulting commit is a new candidate;
Decision 28’s behavioral findings may support its review but do not
automatically accept it. Verification must cover the actual expanded surface.

## Reopening conditions

Reassess this rejection if:

- an authorized new candidate runs the required global `bun fmt` successfully
  and remains unchanged afterward;
- the human owner changes or narrows the repository formatter requirement and
  supplies candidate-scoped evidence satisfying the revised rule;
- corrected evidence proves that the 38-file diff did not belong to exact
  commit `8a8907ac` or did not result from the required repository formatter;
- formatter configuration or version is corrected through an authorized change
  and exact `8a8907ac` then produces a reproducible no-diff result; or
- other candidate-scoped verification relied upon by Decision 28 is shown to be
  stale, inaccurate, or associated with another source candidate.

## Superseded records

Decision 29’s binding acceptance is superseded in full.

Decision 28 remains authoritative as historical and incorporated evidence for
its criterion-by-criterion behavioral assessment, full-suite attribution,
non-blocking findings, and formatter-based rejection.

Decisions 09, 15–21, and 27 remain authoritative and are not reopened or
superseded by this formatter-evidence correction.
