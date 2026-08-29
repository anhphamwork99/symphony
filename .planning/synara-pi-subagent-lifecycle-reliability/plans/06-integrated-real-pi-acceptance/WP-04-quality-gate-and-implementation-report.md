# WP-04 — exactly-one fresh owner-authorized quality gate and report

**State:** **CHALLENGE / FAIL-STOP.** The owner authorized all remaining WPs after WP-03 PASS. The exactly-one Decision 0009 WP-04 attempt began at frozen candidate `9b55649050b76feffdc4279ceaec92ac74a78686`. `bun fmt` exited `0` but modified ten historical planning/review files outside the permitted Ticket 06 scope. The explicit mutation stop gate exited `86`; `bun lint` and `bun typecheck` did not run. No retry or Q PASS is claimed.

## Objective

The intended gate was exactly one `bun fmt`, `bun lint`, and `bun typecheck` sequence in the isolated Symphony worktree, followed by Ticket 06's criterion-level Implementation Report. It was required to preserve the exact six-path-from-`12fd6686` candidate lineage, provenance, protected WIP, staging, and Decision 0009's internal-only `unavailableReason` mapping.

## Executed result

Preflight proved exact candidate and Alfie pins, clean candidate status, clean staging, and protected WIP hash `ab8f8f54fe818819721f737aa337156ed6348c7410c55083ce3a67785bb7eaa8`.

The quality producer then:

1. ran `bun fmt` exactly once — exit `0`;
2. observed ten out-of-scope historical planning/review mutations;
3. stopped with `FORMATTER_MUTATION_STOP=1`, producer exit `86`;
4. did not run `bun lint` or `bun typecheck`.

Evidence:

- `evidence/WP-04-decision0009-quality-gate.log`
- `evidence/WP-04-decision0009-quality-gate-report.md`

The dirty isolated candidate worktree is preserved for explicit owner disposition. No formatter mutation was silently restored, committed, or transferred to main.

## Downstream route

WP-04 is not PASS. WP-05 review, WP-06 Decision 0010, and WP-07 closure remain blocked and were not executed. Resolution requires an owner decision on the retained formatter mutations and a new explicit quality-gate/retry contract if another attempt is desired.

## Commit boundary

This failure-preservation transaction changes only the raw WP-04 log, this WP file, the WP-04 report, and Ticket 06's permitted issue status/report fields. It changes no source, candidate mutation, review, Supervisor decision, closure artifact, or protected owner WIP. Commit message: `docs(planning): record Ticket 06 quality gate challenge`.
