# WP-04 — exactly-one fresh owner-authorized quality gate and report

**State:** blocked. Requires the new candidate's fresh WP-01 PASS, exactly one
new full five-file WP-02 PASS, the exactly-one fresh owner-authorized WP-03
PASS, and fresh explicit owner authorization. Historical authorization is
non-transferable; Decision 0009 does not authorize a quality run.

## Objective

Run exactly one `bun fmt`, `bun lint`, and `bun typecheck` gate in the isolated
Symphony worktree and complete Ticket 06's Implementation Report with
criterion-level AC1–AC8 evidence classes, all failure/diagnostic legs, exact
six-path-from-`12fd6686` candidate lineage, provenance, authorization/no-retry,
protected-WIP, and staging audits. Preserve Decision 0009's internal-only
`unavailableReason` mapping and leave review and Decision 0010 fields explicitly
pending for WP-05/WP-06.

## Stop gates

Stop on any command failure, formatter touching an out-of-scope path, report
inconsistency, evidence-class mixing, provenance/source-surface drift, or
protected-WIP/staging drift. Do not silently restore formatter changes. No
source, evidence, review, Supervisor, or closure artifact is changed here
except the future WP-04 report/log and its permitted issue report fields.

Commit message: `docs(planning): record Ticket 06 quality gate and implementation report`.
