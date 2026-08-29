# WP-04 — exactly-one fresh owner-authorized quality gate and report

**State:** **PASS under the owner-approved replacement contract.** The original
quality attempt fail-stopped after `bun fmt` changed ten historical
planning/review files outside Ticket 06 scope. The owner then explicitly
authorized discarding exactly those formatter-only mutations and running one
replacement gate containing `bun lint` and `bun typecheck`, with no formatter
rerun. The candidate returned to exact clean SHA
`9b55649050b76feffdc4279ceaec92ac74a78686`; lint and typecheck both exited `0`
without mutation.

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

The original formatter challenge remains preserved in the first raw log and
report. Under the subsequent explicit owner disposition, exactly the ten listed
formatter-only mutations were discarded. The replacement producer recorded:

- `bun lint`: exit `0`; one non-blocking `no-unused-vars` warning for
  `firstAdmission` in the real-Pi acceptance test; zero errors.
- post-lint worktree: clean.
- `bun typecheck`: exit `0`; `7/7` packages successful.
- replacement producer: exit `0`.

Additional evidence:

- `evidence/WP-04-decision0009-replacement-quality-gate.log`

## Downstream route

WP-04 is PASS. The one lint warning is reported as residual evidence and is not
an error or mutation. WP-05 may now perform exactly one integrated review.
WP-06 Decision 0010 and WP-07 closure remain dependent on their preceding
gates.

## Commit boundary

The replacement transaction changes only the replacement raw log, this WP
file, the WP-04 report, and Ticket 06's permitted issue status/report fields.
It changes no source, review, Supervisor decision, closure artifact, or
protected owner WIP. Commit message:
`docs(planning): record Ticket 06 replacement quality gate`.
