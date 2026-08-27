# WP-04 — independent Ticket 03 implementation review

**State:** pending

**Owner role:** independent reviewer, distinct from implementation worker

**Dependencies:** WP-03 report complete; focused and required final verification recorded; candidate frozen.

## Objective

Independently audit the complete Ticket 03 candidate against Decision 0006, T03-AC1–AC5, inherited lifecycle/fencing authority, and unchanged Alfie `.6` before any acceptance/routing change.

## Exact allowed write set

- `.planning/synara-pi-subagent-lifecycle-reliability/reviews/03-terminal-before-cleanup-and-live-lifecycle-containment-review.md` — new

## Prohibited changes

No source, tests, contracts, issue, Project Home, plan status, decision, Alfie, provenance, migration, release, push, deployment, or acceptance edit.

## Review contract

Review committed candidate SHAs and include: scope audit; authority/invariant matrix; AC matrix; journal-first ordering; tuple/session activation, entry and response revalidation, retirement, disposal; Decision 0003 steer classification; bands 40/70–78; persistence failure/retry; unavailable vs outcome-unknown diagnostics; identity/boundedness/security; controlled `.6` provenance; evidence-class separation; forbidden fallback/duplicate counters; residual risks and reopening conditions.

Classify findings as BLOCKING, MATERIAL REOPENING, NONBLOCKING, or NOTE. PASS requires zero blocking and zero unresolved reopening findings.

## Reviewer reproductions

```bash
cd apps/server
bun run test src/provider/piSubagentLiveLifecycleContainment.test.ts \
  src/provider/piSubagentLifecycleContainmentWiring.test.ts \
  src/provider/piSubagentLifecycleContainmentRace.test.ts \
  src/provider/piSubagentCanonicalRouting.test.ts \
  src/provider/piSubagentTerminalLifecycle.test.ts

ALFIE_REPO_DIR=/Users/anhpham99/alfie \
  node ../../node_modules/vitest/vitest.mjs run --project wallclock \
  --maxWorkers=1 --no-file-parallelism \
  src/provider/piSubagentLifecycleContainmentRealPiAcceptance.test.ts

cd ../../packages/contracts
bun run test src/piSubagents.test.ts
```

The reviewer may rely on recorded fmt/lint/typecheck only when source has not changed since that evidence.

## Commit boundary

```text
docs(review): assess Ticket 03 lifecycle containment
```

## Handoff

Review SHA, reviewed candidate SHAs, PASS/FAIL/REOPEN disposition, criterion matrix, findings, remediation requirements, and whether closure may proceed.

## Escalation

Blocking implementation findings return to the owning WP for remediation and re-verification. Material contradiction with Decision 0006 returns `challenge`; do not invent Alfie/authority workarounds. WP-05 is blocked without PASS.
