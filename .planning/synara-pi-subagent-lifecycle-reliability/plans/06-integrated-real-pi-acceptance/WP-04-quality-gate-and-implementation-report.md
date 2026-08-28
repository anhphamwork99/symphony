# WP-04 — owner-authorized quality gate and complete Implementation Report

**State:** pending — **conditionally authorized (2026-08-28, current
session, owner verbatim `Cho phép tất cả các cổng`, PLAN §7c item 3):
exactly one gate run, ONLY if WP-03 has PASSED.** Until that condition
holds, this WP does not execute — no fmt, lint, or typecheck command is run.

**Owner role:** implementation worker

**Dependencies:** WP-01–WP-03 committed; **WP-03 PASS**; explicit
current-session owner authorization for `bun fmt`, `bun lint`,
`bun typecheck` (granted 2026-08-28, conditional as recorded above; PLAN
§8). The quality gate runs exactly once.

## Objective and observable outcome

Run the one quality gate (Q evidence) and complete the Ticket 06
Implementation Report in the issue — every placeholder replaced, T06-AC1–AC8
mapped to executed evidence by class, no empty field.

## Bounded read set

- All WP-01–WP-03 evidence artifacts.
- Issue 06 (Implementation Report placeholder and Unlock gate).
- PLAN §3 (AC matrix), §7 (runner policy), §9 (Git safety).

## Exact allowed write set

```text
.planning/synara-pi-subagent-lifecycle-reliability/issues/06-integrated-real-pi-acceptance.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-04-quality-gate.log
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-04-quality-gate-and-implementation-report.md
```

The issue write is limited to the Implementation Report; status stays
`ready-for-agent` (WP-07 owns status).

## Prohibited changes

No production path anywhere; no review/Supervisor artifact; no closure or
routing (WP-07's); no evidence-file edits beyond appending gate output to the
new WP-04 log; protected WIP paths never staged.

## Exact commands (cwd explicit, inside the isolated Symphony worktree)

The gate runs inside `/tmp/symphony-t06` (not the main checkout) so any
formatter interaction with owner WIP is impossible by construction:

```bash
cd /tmp/symphony-t06
set -o pipefail
{ bun fmt && bun lint && bun typecheck ; } \
  2>&1 | tee /Users/anhpham99/symphony/.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-04-quality-gate.log
status=${PIPESTATUS[0]}; exit "$status"
```

**fmt-hazard rule (PLAN §8):** if `bun fmt` modifies prohibited or unrelated
files in the worktree, STOP with `challenge`. Do not silently restore and
continue; the challenge package lists every touched file. Restoration happens
only as part of the challenge with the owner informed. Do not commit
formatter drift.

Record exact exits, lint warning/error counts, typecheck task counts, and
any non-failing console advisories.

## Implementation Report required content (issue fields)

1. Candidate lineage: planning baseline `4bf368a4…`, frozen candidate
   `12fd6686…`, all WP commits.
2. Exact provenance: Symphony worktree, Alfie worktree
   `3fe340b4…` / `0.15.0-alfie.6`, Pi SDK, fixture hashes.
3. Isolation and composition evidence (P/R fields).
4. AC1–AC8 matrix by evidence class with named tests/legs and artifact paths.
5. Failure/diagnostic stage report (AC7) — every required failure leg.
6. Manual destructive run record (M) with authorization and no-retry
   statement; H supporting-only statement.
7. Quality-gate authorization/result (Q).
8. Owner-WIP preservation and staged-paths audit.
9. Review package link and verdict (after WP-05) and Supervisor link/verdict
   (after WP-06) — these two fields may be filled by WP-05/WP-06
   respectively; WP-04 leaves them as explicit pending-not-claimed.
10. Reopening conditions and residual risk.

No field may remain an unexplained placeholder at closure (WP-07 verifies).

## Verification contract

- Gate exit 0 with recorded counts.
- Report consistent with all evidence artifacts; no evidence-class mixing.
- Zero-delta gate and WIP hash unchanged; nothing staged outside the three
  allowed paths.

## Commit boundary

```text
docs(planning): record Ticket 06 quality gate and implementation report
```

Stage only the three allowed WP-04 paths.

## Escalation

- `blocked`: WP-03 has not passed yet (gate not run; the conditional
  authorization stays reserved), authorization absent (gate not run; do not
  fabricate), or environment failure.
- `challenge`: gate failure, fmt-hazard rule triggered (formatter touches
  out-of-scope paths — stop, list every touched file, no silent
  restore-and-continue, no formatter-drift commit), evidence/report
  inconsistency, or an AC that cannot cite executed evidence.
