# WP-05 — exactly-one integrated feature-level review

**State:** pending

**Owner role:** independent reviewer (convened by the main agent with the
owner's current-session go-ahead)

**Dependencies:** WP-01–WP-04 committed; complete Implementation Report;
review/Supervisor gates still unused (this consumes the project's **single**
integrated review — G-M).

## Objective and observable outcome

One independent criterion-level review of the complete Ticket 06 evidence
package against T06-AC1–AC8 and the evidence-class discipline, producing a
verdict artifact. Exactly one review exists for the whole project; no second
review loop without a material reopening.

## Review scope (what the reviewer verifies)

1. Every AC row cites executed evidence with the correct class
   (D/R/M/Q/A; H only as supporting context).
2. Evidence-class separation: no fixture result relabeled real-Pi; no
   automated destructive claim; M leg present exactly once with valid
   current-session authorization and the no-retry statement.
3. Provenance chain: baseline → candidate → worktree SHAs → producers →
   artifacts, all consistent.
4. Zero-delta gate: Pi acceptance surface empty `12fd6686..HEAD`;
   `12fd6686..HEAD -- apps packages` contains only planning/evidence paths.
5. Protected WIP unstaged, hash `ab8f8f54…` unchanged across all records.
6. Failure/diagnostic legs exist for every criterion (AC7); mock-only success
   impossible.
7. Quality gate recorded with exact counts (AC8 precondition).
8. Issue status correctly still `ready-for-agent`; no premature closure.

## Bounded read set

All plan/evidence artifacts, the issue, Project Home, governing decisions,
and git state. The reviewer runs no producer except read-only git/inspection
commands; any re-run need is a review finding, not a silent action.

## Exact allowed write set

```text
.planning/synara-pi-subagent-lifecycle-reliability/reviews/06-integrated-real-pi-acceptance-review.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-05-integrated-review.md
```

Plus: the WP-04 report's review-link field may be filled with this artifact's
path and verdict.

```text
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-04-quality-gate-and-implementation-report.md
```

## Prohibited changes

No production path; no decision record (WP-06's); no closure/routing (WP-07's);
no evidence mutation; no issue status change; no second review artifact.

## Reviewer verification commands (read-only)

```bash
cd /Users/anhpham99/symphony
git rev-parse HEAD
git log --oneline 12fd6686..HEAD -- apps packages
git diff --name-only 12fd6686edc26a3fa0382e8bdeb83a1be8045539..HEAD -- apps/server/src/provider apps/server/src/persistence apps/server/src/orchestration apps/server/scripts/wallclock-tests.ts apps/server/vitest.config.ts packages/contracts/src/piSubagents.ts
git diff -- apps/web/package.json apps/web/src/main.tsx bun.lock | shasum -a 256
git diff --cached --name-only
```

## Required review artifact fields

Per-AC verdict table with evidence citations; evidence-class integrity
findings; provenance audit; gate/authorization audit; findings list
(blocking/non-blocking); explicit verdict (`PASS` / `FAIL` with reasons);
confirmation that exactly-one review and exactly-one Supervisor gates are
being consumed in the right order.

## Commit boundary

```text
docs(planning): record Ticket 06 integrated review
```

Stage only the allowed WP-05 paths.

## Escalation

- `challenge`: any blocking finding — review returns FAIL with the exact gap;
  the package returns to the main agent; no closure motion.
