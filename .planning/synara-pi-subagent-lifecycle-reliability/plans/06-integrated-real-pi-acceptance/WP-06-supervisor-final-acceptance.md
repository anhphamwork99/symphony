# WP-06 — exactly-one Supervisor final acceptance and persisted decision

**State:** pending

**Owner role:** Project Supervisor (convened by the main agent with the
owner's current-session go-ahead, after WP-05 PASS)

**Dependencies:** WP-05 verdict PASS; Supervisor final-acceptance gate still
unused (this consumes the project's **single** Supervisor consultation — G-Q).

## Objective and observable outcome

Exactly one Supervisor final-acceptance consultation for the complete
project, persisted as a binding decision record under this project's
`decisions/` directory, accepting or rejecting Ticket 06 and the integrated
project candidate. Reviews are evidence; only this accepted decision advances
the project.

## Decision record requirements

Path:

```text
.planning/synara-pi-subagent-lifecycle-reliability/decisions/0007-integrated-real-pi-acceptance-final-acceptance.md
```

Minimum fields (house style of decisions 0001–0006):

1. Status: ACCEPTED or REJECTED (binding), date, consultation class
   (final acceptance).
2. Question: does the evidence package at the recorded lineage satisfy
   T06-AC1–AC8 and justify project acceptance?
3. Governing references: Project Home, issue 06, PLAN, WP evidence, WP-05
   review, decisions 0001/0002/0006, inherited 0031–0034.
4. Candidate and provenance: baseline `4bf368a4…`, candidate `12fd6686…`,
   zero-delta proof, Alfie pin, protected WIP audit.
5. Criterion-level disposition per AC with evidence class and artifact path.
6. Explicit AC6 disposition: three-leg split honored (D + R + M; H
   supporting-only); exactly-one manual run; no automated destructive claim.
7. Explicit no-retry/authorization audit for WP-03/WP-04 gates.
8. Reopening conditions and residual risk.
9. What this decision does NOT authorize (no push/release/deploy; no new
   kill authority; no reopening of settled invariants).

## Bounded read set

Everything WP-05 reviewed, plus the WP-05 review artifact itself. The
Supervisor runs no producer; read-only verification commands as in WP-05.

## Exact allowed write set

```text
.planning/synara-pi-subagent-lifecycle-reliability/decisions/0007-integrated-real-pi-acceptance-final-acceptance.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-06-supervisor-final-acceptance.md
```

Plus: the WP-04 report's Supervisor-link field may be filled with this
decision's path and verdict.

```text
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-04-quality-gate-and-implementation-report.md
```

## Prohibited changes

No production path; no issue/PROJECT status change (WP-07's); no second
decision record; no evidence mutation; no review edits.

## Commit boundary

```text
docs(planning): record Ticket 06 supervisor final acceptance
```

Stage only the allowed WP-06 paths.

## Escalation

- `challenge` (as a REJECTED decision or returned consultation): any material
  gap — names the exact condition and the required repair path; the project
  does not advance; a second consultation requires a material reopening.
