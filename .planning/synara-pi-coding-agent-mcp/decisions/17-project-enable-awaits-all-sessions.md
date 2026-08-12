# Decision 17: Project enable awaits all current sessions

Status: Accepted by owner
Date: 2026-08-12

## Decision

`/Enable Synara MCP` does not report terminal success when only the project
metadata event has been committed. The command waits for all current provider
sessions in the project to reconcile the enable request.

The terminal result is successful only when every current session required by the
project contract has completed activation successfully. If any session fails,
times out, disappears in an unsafe state, or cannot prove clean activation, the
project follows Decision 10 and Decision 16: it rolls back to persisted
`disabled`, propagates disable cleanup to all project sessions, and emits a
failed terminal result. No session may remain active after rollback.

A pending acknowledgement is emitted immediately when the command must wait for
an active turn or multiple session reconciliations. The final system activity is
emitted only after the all-session outcome is authoritative. Future sessions
hydrate from the final project projection and do not participate in the current
command's wait set.

The wait must be bounded and restart-safe. It must use a stable request ID,
correlate per-session outcomes, and never duplicate terminal results or replay
MCP calls.
