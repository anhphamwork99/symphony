# WP-05 — exactly-one integrated feature-level review

**State:** **READY FOR ONE OWNER-AUTHORIZED REPLACEMENT REVIEWER PACKAGE.** The
first G-M runtime ran after WP-01–WP-04 PASS, remained read-only, and returned
substantial supporting evidence, but terminated without the required
`State / Result / Needs` contract or explicit criterion-level verdict. Runtime
classified it as unknown (`no State section found`). The owner subsequently
directed automatic completion and authorized one replacement reviewer package;
the invalid response remains preserved and is not inferred PASS.

## Objective and review boundary

The reviewer was assigned the complete current candidate, whose correction delta is exactly four files from candidate2 and six distinct paths from `12fd6686`, AC1–AC8, D/R/M/Q evidence classes, exact candidate/Alfie provenance, zero-delta and protected-WIP proofs, failure diagnostics, and authorization history. The assignment also required verification of Decision 0009's internal-only mapping and confirmation that exactly one final Supervisor gate remained unused.

## Evidence preserved

The incomplete response nevertheless confirmed focused log hashes, bounded/redacted managed routing output, WP-01 counts/hashes, candidate surface constraints, no producer execution during review, and the non-blocking nature of the pre-existing lint warning. It identified residual ambiguity in the generic WP-03 authorization wording and stale `PROJECT.md` routing relative to WP-03/WP-04 PASS.

Full preservation and runtime disposition:

- `../../reviews/06-integrated-real-pi-acceptance-review.md`

## Downstream state

The missing criterion table and final verdict make the package insufficient for WP-06. Exactly one final Supervisor gate remains unused and must not be invoked with incomplete reviewer evidence. WP-07 closure remains blocked.

The governance repair is now explicit: run one replacement read-only reviewer
package against the complete unchanged candidate and evidence. If it PASSes,
exactly one final Supervisor gate remains unused for WP-06. No producer,
quality rerun, additional reviewer loop, or inferred PASS is permitted.

## Write set and commit

This transaction writes only the review artifact, this WP file, and the permitted WP-04 review-link field. It runs no producer and changes no source, evidence log, Project Home, issue closure, Supervisor decision, or protected WIP. Commit: `docs(planning): record Ticket 06 integrated review challenge`.
