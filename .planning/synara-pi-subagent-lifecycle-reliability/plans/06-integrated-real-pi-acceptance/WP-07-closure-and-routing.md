# WP-07 — Ticket 06 closure and project routing

**State:** blocked until the new candidate's fresh D/R evidence, fresh-authorized
M/Q, WP-05 PASS, and accepted persisted Decision 0010 exist. Decision 0009
cannot close the ticket.

## Objective

Only after accepted Decision 0010, mark Ticket 06 accepted and update Project
Home routing. Confirm G-M and G-Q were each consumed exactly once, all AC1–AC8
have class-correct evidence, no unresolved challenge remains, and the frontier
advances. Historical candidate2 WP-01/WP-02 artifacts stay supporting.

## Closure invariants

The new candidate must be the sole-parent child of candidate2 with exactly the
four-file correction delta and exactly six distinct paths from `12fd6686` (two
fixture paths plus the four correction paths). No fifth file, canonical
expectation, Alfie, coordinator/configuration, contract/schema, lockfile, or
unrelated source change may appear. The new five-file WP-02 must have exited 0
exactly once; WP-03 must contain the sole fresh M run; WP-04 the sole fresh Q
gate and complete report; review and final acceptance must be exactly one each.
Protected WIP, raw-log hashes, staging, source/index, and apps/packages
zero-delta proofs must hold.

## Prohibited work and commit

No new review/decision, evidence mutation, source change, push, release, or
deploy. Commit: `docs(planning): accept Ticket 06 and close project`.
