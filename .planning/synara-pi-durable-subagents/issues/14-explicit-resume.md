# 14 — Explicit resume with a new attempt

**What to build:** An authorized user can explicitly resume an orphaned managed
execution. Synara keeps the logical `executionId`, mints a new `attemptId`,
advances generation, runs the same authorization and admission gates as a new
spawn, and starts one new attempt. Nothing resumes automatically, and late
events from the superseded attempt cannot alter the new attempt.

**Blocked by:** 10 — Restart reconciliation to terminal or orphaned; 13 —
Admission quotas and safe telemetry.

**Status:** ready-for-agent

- [ ] **T14-AC1:** Resume creates exactly one new `attemptId` under the existing
  `executionId` and records the new generation before child start.
- [ ] **T14-AC2:** Late events, terminals, cancels, or completions from the prior
  attempt are ignored and counted after resume.
- [ ] **T14-AC3:** Startup, reconciliation, heartbeat, transcript discovery, and
  model behavior contain no automatic resume trigger.
- [ ] **T14-AC4:** Resume re-runs project/thread authorization, active-turn
  policy, quotas, and admission; denial creates no child.
- [ ] **T14-AC5:** The orphaned execution shows the new attempt as queued or
  running while retaining prior-attempt evidence and updated diagnostics.
- [ ] **T14-AC6:** Work capable of write or external side effects requires the
  explicit user action represented by the resume command and is never replayed
  as recovery.

## Testing Seams

**Approval status:** Approved — owner approval in the ticket-breakdown review
on 2026-08-16.

- **T14-AC1, T14-AC2, T14-AC4, T14-AC5:** Server orchestration resume boundary
  with authorization, quota, stale-event, and durable-restart fixtures.
- **T14-AC2, T14-AC3:** Execution/attempt state-machine contract and public
  command-surface audit proving explicit-only resume.
- **T14-AC1, T14-AC4, T14-AC6:** Isolated real-Pi resume boundary — one explicit
  resume creates the new child attempt and no implicit path does.

