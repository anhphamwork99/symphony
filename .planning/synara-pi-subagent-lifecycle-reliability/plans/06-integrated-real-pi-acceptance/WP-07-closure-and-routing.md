# WP-07 — Ticket 06 closure and project routing

**State:** blocked until the new reset D/R evidence, fresh-authorized M/Q,
WP-05 PASS, and accepted persisted Decision 0009 exist. Decision 0008 cannot
close the ticket.

## Objective

Only after accepted Decision 0009, mark Ticket 06 accepted and update Project
Home routing. Confirm G-M and G-Q were each consumed exactly once, all AC1–AC8
have class-correct evidence, no unresolved challenge remains, and no frontier
remains. Historical ffd/WP-01/current renewed WP-02 artifacts stay supporting.

## Closure invariants

The exact new candidate must be the two-file child of ffd and four-file child
from `12fd6686`; no canonical expectation, Alfie, third-file, or unrelated
source change may appear. The current five-file WP-02 must have exited 0 once;
WP-03 must contain the sole fresh M run; WP-04 must contain the sole fresh Q
gate and complete report; review and final acceptance must be exactly one each.
Protected WIP, raw-log hashes, staging, and apps/packages zero-delta proofs
must hold.

## Prohibited work and commit

No new review/decision, evidence mutation, source change, push, release, or
deploy. Commit: `docs(planning): accept Ticket 06 and close project`.
