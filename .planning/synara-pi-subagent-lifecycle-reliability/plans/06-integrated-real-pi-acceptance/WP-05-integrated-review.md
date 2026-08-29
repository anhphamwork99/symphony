# WP-05 — exactly-one integrated feature-level review

**State:** **CHALLENGE.** The exactly-one G-M reviewer invocation ran after WP-01–WP-04 PASS, remained read-only, and returned substantial supporting evidence, but its response terminated without the required `State / Result / Needs` contract or an explicit criterion-level verdict. Runtime classified the outcome as unknown (`no State section found`). No PASS may be inferred and no second review loop was opened.

## Objective and review boundary

The reviewer was assigned the complete current candidate, whose correction delta is exactly four files from candidate2 and six distinct paths from `12fd6686`, AC1–AC8, D/R/M/Q evidence classes, exact candidate/Alfie provenance, zero-delta and protected-WIP proofs, failure diagnostics, and authorization history. The assignment also required verification of Decision 0009's internal-only mapping and confirmation that exactly one final Supervisor gate remained unused.

## Evidence preserved

The incomplete response nevertheless confirmed focused log hashes, bounded/redacted managed routing output, WP-01 counts/hashes, candidate surface constraints, no producer execution during review, and the non-blocking nature of the pre-existing lint warning. It identified residual ambiguity in the generic WP-03 authorization wording and stale `PROJECT.md` routing relative to WP-03/WP-04 PASS.

Full preservation and runtime disposition:

- `../../reviews/06-integrated-real-pi-acceptance-review.md`

## Downstream state

The missing criterion table and final verdict make the package insufficient for WP-06. Exactly one final Supervisor gate remains unused and must not be invoked with incomplete reviewer evidence. WP-07 closure remains blocked.

Resolution requires an explicit governance repair authorizing recovery/replacement of the invalid reviewer response; no automatic second review or inferred PASS is permitted.

## Write set and commit

This transaction writes only the review artifact, this WP file, and the permitted WP-04 review-link field. It runs no producer and changes no source, evidence log, Project Home, issue closure, Supervisor decision, or protected WIP. Commit: `docs(planning): record Ticket 06 integrated review challenge`.
