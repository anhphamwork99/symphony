# WP-03 — Ticket 04 closure and project routing

**State:** blocked on WP-02 PASS

**Dependencies:** WP-01 PASS; WP-02 report complete; frozen candidate unchanged; no source/test/Alfie delta; no unresolved criterion challenge.

## Objective and observable outcome

Close Ticket 04 from evidence only and route Ticket 05 as the sole ready-for-planning frontier, without activating ticket-level review/Supervisor gates or claiming integrated project acceptance.

## Bounded read set

- PLAN and WP-01/WP-02 artifacts.
- Ticket 04 issue and Project Home.
- Frozen candidate, git status/staging state, and controlled provenance record.
- Ticket 05 dependency/status lines.

## Exact allowed write set

- `.planning/synara-pi-subagent-lifecycle-reliability/issues/04-cancellation-watchdog-and-teardown-settlement.md`
- `.planning/synara-pi-subagent-lifecycle-reliability/PROJECT.md`
- `.planning/synara-pi-subagent-lifecycle-reliability/plans/04-cancellation-watchdog-and-teardown-settlement/PLAN.md` — plan state/completion record only.
- `.planning/synara-pi-subagent-lifecycle-reliability/plans/04-cancellation-watchdog-and-teardown-settlement/WP-01-focused-deterministic-evidence.md` — final state/result only.
- `.planning/synara-pi-subagent-lifecycle-reliability/plans/04-cancellation-watchdog-and-teardown-settlement/WP-02-controlled-provider-and-implementation-report.md` — final state/result only.
- `.planning/synara-pi-subagent-lifecycle-reliability/plans/04-cancellation-watchdog-and-teardown-settlement/WP-03-ticket-closure-and-routing.md` — final state/result only.

## Prohibited changes

No source/tests/contracts/manifests/lockfile/migrations/config/Alfie/decisions/reviews/Supervisor records; no Ticket 05 implementation; no push/release/deploy; no unrelated owner or Whiteboard files.

## Closure gate

Proceed only if all are true:

1. candidate equals the candidate in both WP evidence sets;
2. WP-01 command passed and every T04-AC1–AC5 row has normal plus material failure/diagnostic evidence;
3. issue report is complete and contains no unsupported manual/current-run claim;
4. controlled Alfie is exact and unchanged;
5. diff from the frozen candidate contains no Ticket 04 source/test/contract/manifest/lockfile/Alfie change;
6. no unresolved `BLOCKER`, `INFORMATION_GAP`, or §9 challenge exists;
7. unrelated owner files are neither modified by Ticket 04 nor staged;
8. integrated project review and Supervisor acceptance remain unused.

Heavyweight workspace commands are not a default closure requirement for this evidence/docs-only candidate. Only if the current-session owner explicitly authorizes them, run once from repository root:

```bash
bun fmt
bun lint
bun typecheck
```

Record producer exits/counts. If not authorized, record `not run — no current-session owner authorization`; do not run them implicitly.

## Exact issue closure edits

- `Status: ready-for-agent` → `Status: accepted`.
- Mark dependencies discharged.
- State: `Implementation result: evidence-only closure; no Ticket 04 source/test/contract/Alfie change`.
- Preserve the completed Implementation Report.
- Add a closure record with frozen candidate, WP evidence/report commits, controlled provider, AC1–AC5 verdicts, manual-run disposition, heavyweight-check disposition, and next frontier Ticket 05.
- Do not add a ticket-level reviewer or Supervisor section beyond the governance disposition already in the report.

## Exact Project Home routing edits

- Routing metadata triage: `Tickets 01–04 accepted; Ticket 05 is the sole frontier`.
- Current-frontier narrative: Ticket 04 accepted from evidence-only execution at the frozen candidate; no source/Alfie change; deterministic evidence authoritative; no new destructive run; integrated review/Supervisor still reserved.
- Status table:
  - Ticket 04 → `accepted`, dependency note `T04-AC1–AC5 deterministically evidenced and reported; no source change`;
  - Ticket 05 → `ready-for-planning — sole frontier`, dependency note `Tickets 02–04 accepted seams`;
  - Ticket 06 remains blocked.
- Keep the serial dependency graph unchanged.
- Do not claim the project, Ticket 05, or Ticket 06 implemented or accepted.

## Verification and staging safety

```bash
git diff --check
git status --short
git diff --cached --name-only
git diff --cached -- apps/web/package.json apps/web/src/main.tsx bun.lock
```

Then verify:

- issue and Project Home agree that Ticket 04 is accepted;
- exactly one frontier exists and it is Ticket 05 `ready-for-planning`;
- Tickets 01–04 are accepted and Ticket 06 remains blocked;
- every evidence/report link resolves;
- closure diff contains planning files only;
- no review or Supervisor artifact was created;
- no source/manual-destructive claim was added.

Use explicit staging of the six allowed paths; never `git add .` or `git add -A`.

## Commit boundary

```text
docs(planning): accept Ticket 04 cancellation settlement
```

## Completion record fields

- router baseline and frozen execution candidate;
- WP-01 evidence commit/path and test totals;
- WP-02 report commit/path and controlled provenance;
- T04-AC1–AC5 PASS matrix;
- no-source-change statement;
- destructive manual disposition;
- heavyweight-check authorization/result;
- preserved owner changes excluded;
- Ticket 05 sole ready-for-planning frontier;
- integrated review and exactly one Supervisor final acceptance still reserved.

## Escalation

Do not close if any AC is inferred rather than evidenced, the candidate changed, Alfie is dirty/mismatched, a destructive run is ambiguously represented, an unrelated path is staged, or a challenge remains. Return `challenge` if closure would reinterpret accepted bands/owner authority or consume project-level review/Supervisor governance. Return `blocked` for repository/staging access failures.
