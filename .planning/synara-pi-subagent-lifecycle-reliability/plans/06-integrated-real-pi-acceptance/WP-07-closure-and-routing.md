# WP-07 — Ticket 06 closure and project routing

**State:** blocked until renewed D/R, fresh-authorized M/Q, WP-05 PASS, and accepted persisted Decision 0008. Package A makes no closure claim.

**Owner role:** implementation worker

**Dependencies:** WP-06 decision ACCEPTED and persisted; no unresolved
challenge; all evidence/authorization gates honored.

## Objective and observable outcome

Close Ticket 06 as `accepted` from the persisted decision only, and record
the project-closure state in Project Home: lifecycle `active` → closed-state
routing per the accepted decision, Tickets 01–06 accepted, G-M (integrated
review) and G-Q (Supervisor final acceptance) consumed exactly once each, no
frontier remaining.

## Closure dependencies (all must hold)

1. WP-01 D evidence complete with failure legs.
2. WP-02 R evidence complete, five files only, provenance exact.
3. WP-03 M record present with valid current-session authorization and the
   no-retry statement; H used as supporting-only.
4. WP-04 Q gate passed and recorded; Implementation Report complete — no
   placeholder, including the WP-05/WP-06 link fields.
5. WP-05 review artifact exists, verdict PASS, exactly one.
6. WP-06 decision record exists, ACCEPTED, exactly one.
7. Zero-delta gate on the Pi acceptance surface (`12fd6686..HEAD`) empty;
   `12fd6686..HEAD -- apps packages` planning/evidence-only.
8. Protected WIP unstaged, hash `ab8f8f54…` unchanged; nothing unrelated
   staged.
9. Both isolated worktrees removed (`git worktree list` clean of
   `symphony-t06` / `alfie-t06`) or their removal recorded with reason.

## Bounded read set

All prior WP artifacts, the decision record, the issue, Project Home, git
state.

## Exact allowed write set

```text
.planning/synara-pi-subagent-lifecycle-reliability/issues/06-integrated-real-pi-acceptance.md
.planning/synara-pi-subagent-lifecycle-reliability/PROJECT.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/PLAN.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-01-freeze-and-deterministic-evidence.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-02-non-destructive-real-pi-evidence.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-03-manual-destructive-run.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-04-quality-gate-and-implementation-report.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-05-integrated-review.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-06-supervisor-final-acceptance.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-07-closure-and-routing.md
```

WP/PLAN edits are limited to final state/result fields, commit links, and a
completion record.

## Prohibited changes

No production path; no new review/decision artifact; no evidence mutation; no
push/release/deploy.

## Exact closure edits

Issue 06:

- `Status: ready-for-agent` → `Status: accepted`;
- record the implementation result (evidence-only; no source/test/contract/
  configuration/migration/manifest/lockfile/Alfie change);
- add a closure record: lineage and commit links, provenance, AC1–AC8
  verdicts with classes, manual-run authorization/no-retry record, quality
  gate counts, review and decision links, governance statement
  (G-M/G-Q consumed exactly once), residual risk and reopening conditions.

PROJECT.md:

- Ticket 06 row and narrative → `accepted`;
- frontier state → none remaining; project closure recorded per the accepted
  decision;
- G-M/G-Q marked consumed (exactly one each, with artifact links);
- handoff note updated; dependency graph annotated complete.

## Verification and staging safety

```bash
git diff --check
git status --short
git diff --cached --name-only
git diff --name-only 12fd6686edc26a3fa0382e8bdeb83a1be8045539..HEAD -- apps packages
```

Verify issue and Project Home agree; exactly one review and exactly one
decision artifact exist; all links resolve; the closure diff contains only
the allowed paths; protected owner files are absent from the index.

## Commit boundary

```text
docs(planning): accept Ticket 06 and close project
```

Stage only the allowed WP-07 paths explicitly. Never `git add .`/`git add -A`.

## Escalation

- `blocked`: any closure dependency unmet (including missing M record or
  absent authorization audit) — Ticket 06 stays `ready-for-agent`.
- `challenge`: routing inconsistency, evidence/claim mismatch, or any attempt
  to close across an unresolved challenge.
