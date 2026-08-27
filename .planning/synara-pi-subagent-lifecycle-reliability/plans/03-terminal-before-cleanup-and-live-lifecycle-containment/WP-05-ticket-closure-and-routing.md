# WP-05 — Ticket 03 closure and project routing

**State:** pending

**Owner role:** planning/report worker

**Dependencies:** WP-04 PASS; no source change after review; all evidence complete.

## Objective

Reconcile review, accept Ticket 03 only when every gate passes, and route Ticket 04 as the next sole frontier without consuming the project's reserved final project-acceptance consultation.

## Exact allowed write set

- `.planning/synara-pi-subagent-lifecycle-reliability/issues/03-terminal-before-cleanup-and-live-lifecycle-containment.md`
- `.planning/synara-pi-subagent-lifecycle-reliability/PROJECT.md`
- this Ticket 03 `PLAN.md` and WP files

No new decision record unless governing authority explicitly requires one.

## Prohibited changes

No source/tests/contracts/decisions/Alfie/provenance/migration/release/push/deployment, Ticket 04 implementation, or project final-acceptance claim.

## Closure contract

Proceed only when:

1. review is PASS with no blocking/reopening findings;
2. reviewed SHAs equal current candidate;
3. all ACs have normal and failure evidence;
4. controlled `.6` remains unchanged;
5. isolated real-Pi evidence passes;
6. `bun fmt`, `bun lint`, and `bun typecheck` have passed under explicit owner authorization;
7. working tree is clean except closure files and preserved unrelated owner changes.

Then record review disposition, exact source/evidence/report/review SHAs, non-goals, and verification; set Ticket 03 accepted; route Ticket 04 as sole frontier; keep Tickets 05–06 blocked; mark plan/WPs complete; reserve the single integrated project review/final acceptance.

## Verification

```bash
git diff --check
git status --short
```

Verify Project Home and issue status agree, exactly one frontier exists, Ticket 04 is only routed, all SHAs/links resolve, and closure diff contains no source.

## Commit boundary

```text
docs(planning): accept Ticket 03 lifecycle containment
```

## Handoff

Closure SHA, accepted candidate/evidence/review SHAs, final AC matrix, next frontier, Ticket 04 inherited risks, and status.

## Escalation

Do not accept when review is not PASS, candidate changed, required real-Pi/failure/final checks are absent, Alfie changed, or any AC rests only on inference. Return `challenge` if closure would change Decision 0006, inherited owner/band authority, or project acceptance governance.