# WP-03 — exactly-one owner-authorized manual destructive run

**State:** pending — mandatory for T06-AC6 closure; cannot be skipped or
substituted

**Owner role:** operator (the owner personally executes the destructive run
inside the isolated environment; the worker records it)

**Dependencies:** WP-01 and WP-02 committed and PASS; **explicit
current-session owner authorization naming this WP and the destructive
scope**. Historical manual evidence (H, 2026-08-20 operator run, durable-
subagents Decision 0034) is **supporting-only** and cannot close AC6 for this
project.

## Objective and observable outcome

Produce the M evidence leg for T06-AC6: exactly one operator-executed,
isolated, real-Pi destructive run recording the zero-owned-child claim — the
exact child-owned root and descendant processes are gone after proven
teardown — through TERM→bounded-KILL observation, band `75 → 76`, card
settled `cancelled`, and generation advance, inside the run's own isolated
environment.

## Exactly-one and no-retry rule

- The run is attempted **exactly once** under this authorization.
- If it aborts, fails, or yields ambiguous evidence: record the outcome
  truthfully and return `challenge`. A rerun requires a **fresh owner
  decision** after material-cause review. No automatic, silent, or
  convenience retry is permitted.
- No automated or CI destructive run may be substituted (Decisions 0031–0032
  prohibit it).

## Bounded read set

- WP-01/WP-02 evidence.
- Inherited Decisions 0028, 0030–0034 (operator recipe, bands, owner-only
  kill boundary) and the recorded 2026-08-20 run record (H, reference only).
- The operator recipe accepted by those decisions, unmodified.

## Exact allowed write set

```text
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-03-manual-run-record.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-03-manual-run-raw.log
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-03-manual-destructive-run.md
```

## Prohibited changes

No source/test/config change anywhere; no modification of the accepted
operator recipe; no PID discovery outside the run's own isolated child tree;
no process-name kills, no parent fallback, no Symphony kill authority; no
worktree teardown before this WP settles (or a recorded owner deferral); no
quality gate, review, or Supervisor artifact.

## Required record fields (`WP-03-manual-run-record.md`)

1. Authorization provenance: who authorized, in which session, quoting the
   current-session authorization.
2. Environment: isolated root/home/state/workspace/ports; worktree SHAs.
3. Exact recipe steps as executed (verbatim commands; no deviation from the
   accepted recipe — any needed deviation is a `challenge` before execution).
4. Observed: exact child root PID and descendant PID(s); liveness before
   teardown; TERM before bounded KILL escalation; no band 76 while any exact
   PID remained live; bands `75 → 76`; card `cancelled`; generation advance;
   absence of both PIDs after teardown (the zero-owned-child claim).
5. Duration, operator, date (current session date), and evidence class M.
6. Explicit statement: H evidence (2026-08-20) not relabeled; this record is
   the sole M leg for T06-AC6 of this project; exactly-one rule honored.

## Verification contract

- Every AC6-required observation recorded with raw log backing.
- The record contains no claim beyond the run's observed scope.
- Zero-delta gate on the Pi acceptance surface still passes; protected WIP
  hash unchanged.

## Commit boundary

```text
docs(planning): record Ticket 06 manual destructive run
```

Stage only the three allowed WP-03 paths.

## Escalation

- `blocked`: no current-session authorization (WP-03 and the ticket stay
  pending — do not close Ticket 06 without AC6's M leg).
- `challenge`: ambiguous/failed run (no-retry rule), recipe deviation need,
  or any destructive automation proposal.
