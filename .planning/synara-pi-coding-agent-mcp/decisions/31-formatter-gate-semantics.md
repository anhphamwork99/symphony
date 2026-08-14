# Decision 31: Formatter completion-gate semantics

**Status:** Accepted by owner
**Date:** 2026-08-14

## Question

What does it mean for the repository completion requirement `bun fmt` to pass,
particularly when the mutating formatter exits successfully but detects
pre-existing formatting drift outside the current ticket?

## Decision

The `bun fmt` completion gate passes when the required command runs to
completion and exits with status `0`.

A zero-diff worktree after the command is not an additional completion
requirement. Formatter-produced changes outside the authorized ticket surface
must not be committed merely to make a repository-wide formatter rerun produce
no diff.

For a ticket-scoped implementation:

- run `bun fmt` and require exit status `0`;
- preserve the ticket's authorized source and ownership boundaries;
- do not absorb unrelated formatter drift into the ticket;
- revert formatter-only changes outside the authorized surface before
  completion; and
- report any pre-existing repository-wide formatter drift separately when it
  affects verification interpretation.

This decision clarifies the pass semantics of the existing completion gate. It
does not waive `bun fmt`, permit a formatter failure, or authorize unrelated
repository-wide normalization.

## Owner approval

The owner explicitly selected this interpretation on 2026-08-14 after reviewing
the two available paths:

1. authorize a 38-file repository-wide formatting normalization; or
2. define `bun fmt` success by exit status `0` while excluding unrelated
   formatter output from the ticket.

The owner selected option 2.

## Effect on impl-09

The exact impl-09 source candidate `8a8907ac` has valid formatter evidence:

- `bun fmt` ran against that exact candidate;
- it exited with status `0`; and
- unrelated formatter output was not applied to the ticket branch.

Decision 30 may therefore be reassessed. Its rejection was based on a stricter
zero-diff interpretation that this owner decision supersedes.

## Reassessment triggers

Reassess this decision if:

- the owner changes the repository formatter policy;
- `bun fmt` exits non-zero;
- formatter output inside a ticket's authorized source surface is discarded in
  a way that conceals a functional or syntactic defect; or
- CI adopts a separate check-mode formatter command whose documented contract
  explicitly requires a clean diff.
