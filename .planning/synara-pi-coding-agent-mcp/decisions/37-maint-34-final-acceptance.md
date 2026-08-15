# Decision 37: maint-34 final acceptance

**Status:** Accepted
**Trigger:** Final acceptance
**Date:** 2026-08-15
**Identifier:** synara-pi-mcp-decision-37
**Accepted candidate:** `23df500bd75b1aa557f3aef162a6b3bd3d03cd6f`

## Question

May maint-34 be marked done after its fixture-only repair restores the 27
pre-existing server failures identified by Decision 33, while preserving
Decision 21 authority invariants and remaining outside impl-10 ownership?

## Governing references

Authoritative:

- `../PROJECT.md`
- `../issues/maint-34-mcp-authority-test-fixtures.md`
- `21-authenticated-mcp-session-authority.md`
- `31-formatter-gate-semantics.md`
- `33-impl-10-final-acceptance.md`
- `36-impl-10-final-acceptance-reassessment.md`
- Repository completion requirements in `../../../AGENTS.md`

Supporting:

- Candidate commit `23df500bd75b1aa557f3aef162a6b3bd3d03cd6f`
- Exactly one independent maint-34 reviewer package returning `ACCEPT`
- Clean-worktree integrated gate commit
  `96f590a898350c73aebf0b1a21dc4b1634b6d308`
- `/tmp/impl10-final-gates-96f-test.log`
- `/tmp/impl10-final-gates-96f-fmt.log`
- `/tmp/impl10-final-gates-96f-lint.log`
- `/tmp/impl10-final-gates-96f-typecheck.log`

## Evidence

The candidate introduces a deterministic real-registry MCP authority test
helper and wires it into five existing server test seams. It changes no
production runtime or contract, adds no test, changes no expectation, and
weakens no timeout, retry, or skip.

The unchanged focused package moved from:

- 27 failed;
- 356 passed; and
- 3 skipped

to:

- 383 passed; and
- the same 3 skipped.

Every real Agent Gateway fixture lease receives a server-minted binding owned
by its exact fixture thread/provider/project context. Unbound sessions remain
uncredentialed, so fail-closed authority behavior is preserved.

Exactly one independent maintenance reviewer returned `ACCEPT` and
independently reproduced 383 passed with the same 3 skips.

At clean integrated descendant
`96f590a898350c73aebf0b1a21dc4b1634b6d308`:

- root `bun run test` passed 8/8 tasks;
- the server suite passed 342 files and 4015 tests;
- `bun fmt` completed successfully under Decision 31;
- lint completed with 0 errors; and
- typecheck passed 7/7 tasks.

## Verdict

Accept maint-34 at
`23df500bd75b1aa557f3aef162a6b3bd3d03cd6f`.

The ticket repaired test fixtures only and preserved the Decision 21
authority, ownership, expiry, and fail-closed boundaries. The original 27
failures are resolved without weakening existing tests or transferring this
maintenance work into impl-10.

## Rejected alternatives

- Leaving maint-34 open after all focused, independent-review, and repository
  completion gates passed.
- Treating the fixture repair as impl-10 production ownership.
- Weakening production authority validation instead of supplying valid test
  authority.
- Adding replacement tests or changing expectations, skips, retries, or
  timeouts to conceal fixture failures.
- Requiring a zero-diff formatter condition contrary to Decision 31.

## Assumptions and residual uncertainty

- The supplied candidate identity and fixture-only diff attribution are
  accurate.
- The independent reviewer package covers the complete candidate and is
  independent of implementation.
- The final gate logs correspond to the stated clean-worktree descendant.
- The integrated descendant contains later work, but focused candidate
  verification and independent review isolate maint-34 behavior, while the
  descendant gates establish repository integration health.

No residual uncertainty is material to maint-34 acceptance under the accepted
Project Contract.

## Ownership and downstream effect

Commit `23df500b` belongs exclusively to maint-34. It remains outside impl-10
production ownership, as established by Decision 36. Integrated repository
verification does not transfer ownership of later or unrelated work.

After this record is persisted and tracked, bookkeeping may:

- change maint-34 status to accepted/completed;
- check the repository completion-gate item;
- link Decision 37 and the exact candidate, focused, reviewer, and integrated
  verification evidence; and
- record that Decision 33's external 27-failure blocker was repaired by
  maint-34.

This authorizes ticket status, checklist, and evidence bookkeeping only. It
authorizes no source, test, contract, configuration, history, or unrelated
project-record change.

## Failure and rollback implications

Acceptance requires no source rollback or history rewrite. If the candidate
identity, fixture-only scope, authority behavior, independent review, or
verification attribution is invalidated, reopen maint-34 before relying on its
completion status. Any later production change requires separate ownership and
review.

## Reopening conditions

Reassess this decision if:

- commit `23df500b` is shown to include production runtime or contract behavior;
- any fixture bypasses active, unexpired, server-minted authority;
- missing, stale, foreign, or unbound authority can obtain a gateway
  credential;
- focused test or unchanged-skip evidence is invalidated;
- the independent reviewer package is shown not to cover the complete
  candidate;
- the pinned integrated gates are invalidated or attributed to another tree;
- maint-34 ownership is incorrectly absorbed into impl-10 or unrelated work;
  or
- Decision 21, Decision 31, or the repository completion policy changes
  materially.

## Superseded records

None. Decisions 21, 31, 33, and 36 remain authoritative within their stated
scopes.
