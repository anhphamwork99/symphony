# WP-03 — Ticket 05 closure and project routing

**State:** blocked by WP-01 and WP-02

**Owner role:** implementation worker

## Objective and observable outcome

Close Ticket 05 from passing evidence only and route Ticket 06 as the sole
`ready-for-planning` frontier without consuming the integrated project review
or Supervisor final acceptance.

## Closure dependencies

All must hold:

1. WP-01 committed and PASS.
2. Every T05-AC1–AC6 row has positive plus material failure/diagnostic evidence.
3. WP-02 controlled provenance and required current-execution real-Pi
   disposition pass honestly.
4. Ticket 05 Implementation Report is complete.
5. Candidate has no Ticket 05 source/test/contract/configuration/migration/
   manifest/lockfile/Alfie delta.
6. No unresolved challenge, AC-affecting blocker, or evidence gap.
7. Protected owner WIP remains untouched and unstaged.
8. No Ticket 05 decision/review/Supervisor artifact exists.

## Bounded read set

- PLAN, WP-01/WP-02, and all evidence artifacts.
- Ticket 05 issue and Project Home.
- Candidate/status/staging state.
- Controlled provenance record.
- Ticket 06 status/dependency lines.

## Exact allowed write set

```text
.planning/synara-pi-subagent-lifecycle-reliability/issues/05-restart-reconnect-resume-and-crash-diagnostics.md
.planning/synara-pi-subagent-lifecycle-reliability/PROJECT.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/05-restart-reconnect-resume-and-crash-diagnostics/PLAN.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/05-restart-reconnect-resume-and-crash-diagnostics/WP-01-focused-deterministic-evidence.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/05-restart-reconnect-resume-and-crash-diagnostics/WP-02-controlled-real-pi-and-implementation-report.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/05-restart-reconnect-resume-and-crash-diagnostics/WP-03-ticket-closure-and-routing.md
```

WP/PLAN edits are limited to final state/result, commit links, and completion
record.

## Prohibited changes

No source/tests/contracts/configuration/migrations/manifests/lockfiles/Alfie;
no decisions/reviews/Supervisor artifacts; no Ticket 06 implementation; no
release/deploy/push; no unrelated planning or owner WIP.

## Final workspace gate

`bun fmt`, `bun lint`, and `bun typecheck` are one final pass only. Run them
from repository root only with explicit owner authorization in the current
closure conversation:

```bash
bun fmt
bun lint
bun typecheck
```

Record exact exits, lint warning/error counts, and typecheck task counts. If
authorization is absent, Ticket 05 remains `ready-for-agent`; do not close or
reinterpret the missing gate.

## Exact Ticket 05 closure edits

- `Status: ready-for-agent` → `Status: accepted`.
- Mark Tickets 02–04 dependencies discharged.
- Record: `Implementation result: evidence-only closure; no Ticket 05
  source/test/contract/configuration/migration/Alfie change`.
- Preserve the completed Implementation Report.
- Add a closure record with baseline/candidate/commits, controlled provenance,
  AC1–AC6 verdicts, reconnect/cursor evidence, inactive-provider denial,
  crash/bounds evidence, no-replay proof, real-Pi/manual disposition,
  heavyweight checks, owner-WIP exclusion, governance disposition, and next
  frontier.

Do not add Ticket 05 review or Supervisor sections.

## Exact Project Home routing edits

- Triage: `Tickets 01–05 accepted; Ticket 06 is the sole frontier
  (ready-for-planning)`.
- Status table:
  - Ticket 05 → `accepted`, `T05-AC1–AC6 evidenced and reported; no source
    change`;
  - Ticket 06 → `ready-for-planning — sole frontier`, dependencies
    `Tickets 01–05 accepted; all provenance/evidence gates available`.
- Narrative: Ticket 05 accepted from evidence-only execution; provider-inactive
  Resume fails closed without bootstrap; controlled evidence recorded; no
  destructive manual claim; Ticket-level review/Supervisor unused; integrated
  project gates reserved.
- Keep the serial dependency graph unchanged.
- Do not claim Ticket 06 implemented, reviewed, accepted, or ready for agent.

## Verification and staging safety

```bash
git diff --check
git status --short
git diff --cached --name-only
git diff --cached -- apps/web/package.json apps/web/src/main.tsx bun.lock
```

Verify:

- issue and Project Home agree;
- exactly one frontier exists: Ticket 06 `ready-for-planning`;
- Tickets 01–05 are accepted;
- all evidence/report links resolve;
- closure diff contains only the six allowed paths;
- no decision/review/Supervisor artifact exists;
- no source or unsupported real-Pi/manual claim exists;
- protected owner files are absent from the index and byte-identical to the
  Ticket 05 baseline.

## Commit boundary

```text
docs(planning): accept Ticket 05 lifecycle recovery
```

Stage the six allowed paths explicitly. Never use `git add .` or `git add -A`.

## Escalation

- `blocked`: missing authorization/dependency/evidence/environment, or staging
  safety cannot be proven.
- `challenge`: any AC contradiction, candidate/source delta, unsupported claim,
  material decision, or routing inconsistency. Preserve completed evidence and
  do not advance Ticket 06.
