# WP-05 — exactly-one integrated feature-level review

**State:** blocked until reset WP-01, the new exactly-once five-file WP-02,
fresh-authorized WP-03, fresh-authorized WP-04, and the complete report pass.
Decision 0009 is not review or acceptance and does not consume G-M; the final
Supervisor record remains reserved as Decision 0010.

## Objective and review boundary

One independent criterion-level review covers the complete current candidate,
whose correction delta is exactly four files from candidate2 and six distinct
paths from `12fd6686`, AC1–AC8, D/R/M/Q evidence classes, exact candidate/Alfie
provenance, zero-delta and protected-WIP proofs, all failure diagnostics, and
authorization history. It verifies Decision 0009's internal-only mapping:
control `provider_inactive` to `pi_subagent_read_live_record_unavailable`,
observation/generic unavailable remain generic, and no public reason or
acceptance lie. Historical ffd/WP-01/WP-02 evidence is supporting only and
cannot be used as current proof.

The review runs no producer and creates no second review loop. A blocking
finding returns challenge; closure cannot advance.

## Write set and commit

Future write set is the review artifact, this WP file, and the permitted WP-04
review-link field. Commit: `docs(planning): record Ticket 06 integrated review`.
The review must explicitly confirm that exactly one final Supervisor gate
remains unused for WP-06 Decision 0010.
