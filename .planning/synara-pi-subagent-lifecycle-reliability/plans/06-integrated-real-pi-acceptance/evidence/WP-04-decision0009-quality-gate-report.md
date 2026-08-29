# WP-04 Decision 0009 — quality gate report

**Disposition:** CHALLENGE / FAIL-STOP

## Authorization and prerequisites

The owner authorized all remaining WPs in the current session after WP-03 PASS. WP-04 began exactly once at frozen candidate `9b55649050b76feffdc4279ceaec92ac74a78686`, with WP-01, WP-02, and WP-03 already PASS. The candidate checkout was clean before execution; the protected main-checkout WIP hash was `ab8f8f54fe818819721f737aa337156ed6348c7410c55083ce3a67785bb7eaa8` and staging was clean.

## Exact gate and result

The authorized sequence was:

1. `bun fmt`
2. verify formatter produced no out-of-scope mutation
3. `bun lint`
4. `bun typecheck`

`bun fmt` executed exactly once and returned `0`, but modified ten historical planning/review files outside Ticket 06's permitted WP-04 write set. The explicit formatter-mutation stop gate then returned `86` (`FORMATTER_MUTATION_STOP=1`). `bun lint` and `bun typecheck` were not executed.

Out-of-scope formatter mutations retained in `/tmp/symphony-t06` for owner disposition:

1. `.planning/synara-pi-subagent-lifecycle-reliability/issues/05-restart-reconnect-resume-and-crash-diagnostics.md`
2. `.planning/synara-pi-subagent-lifecycle-reliability/plans/04-cancellation-watchdog-and-teardown-settlement/PLAN.md`
3. `.planning/synara-pi-subagent-lifecycle-reliability/plans/04-cancellation-watchdog-and-teardown-settlement/evidence/WP-01-ac-diagnostic-matrix.md`
4. `.planning/synara-pi-subagent-lifecycle-reliability/plans/04-cancellation-watchdog-and-teardown-settlement/evidence/WP-02-nondestructive-real-pi-disposition.md`
5. `.planning/synara-pi-subagent-lifecycle-reliability/plans/05-restart-reconnect-resume-and-crash-diagnostics/PLAN.md`
6. `.planning/synara-pi-subagent-lifecycle-reliability/plans/05-restart-reconnect-resume-and-crash-diagnostics/WP-01-focused-deterministic-evidence.md`
7. `.planning/synara-pi-subagent-lifecycle-reliability/plans/05-restart-reconnect-resume-and-crash-diagnostics/WP-03-ticket-closure-and-routing.md`
8. `.planning/synara-pi-subagent-lifecycle-reliability/plans/05-restart-reconnect-resume-and-crash-diagnostics/evidence/WP-01-ac-seam-diagnostic-matrix.md`
9. `.planning/synara-pi-subagent-lifecycle-reliability/plans/05-restart-reconnect-resume-and-crash-diagnostics/evidence/WP-02-nondestructive-real-pi-disposition.md`
10. `.planning/synara-pi-subagent-lifecycle-reliability/reviews/03-terminal-before-cleanup-and-live-lifecycle-containment-review.md`

Diff summary: `10 files changed, 273 insertions(+), 271 deletions(-)`.

Raw log: `WP-04-decision0009-quality-gate.log`, SHA-256 `d5b6bb4a257e8ea2a05a86fc6d53a43fc73519260f434512753807090cf4c477`.

## Boundary and downstream state

No formatter mutation was silently restored. No second quality attempt occurred. No Q PASS is claimed. WP-05 integrated review, WP-06 Supervisor final acceptance, and WP-07 closure were not run because their WP-04 PASS dependency is unsatisfied.

Resolution requires an owner decision on the retained formatter mutations and any explicitly authorized replacement quality-gate contract. The current authorization does not permit a retry.
