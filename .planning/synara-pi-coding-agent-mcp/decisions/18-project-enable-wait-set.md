# Decision 18: Durable project enable wait-set

Status: Accepted technical decision
Date: 2026-08-12

## Decision

`/Enable Synara MCP` is a durable project operation. Its project metadata record
contains an immutable wait-set snapshot of all current provider sessions at
acceptance, per-session outcomes bound to captured runtime generations, a stable
request ID, a monotonic operation generation, aggregate status, and an absolute
120-second deadline.

Only sessions in the acceptance snapshot participate in the current request.
Future sessions hydrate from the final project projection and do not join the
wait. An empty wait-set succeeds immediately.

Each session activates independently with its own authenticated subject,
credentials, transport, catalog, and lifecycle generation. The project command
reports terminal success only when every wait-set member reaches successful
safe-boundary exposure. The first failure, timeout, unsafe disappearance, or
uncertain result rolls the project back to persisted `disabled` per Decisions 10
and 16, propagates revoke-first cleanup to all project sessions, and emits one
failed terminal activity. A successful sibling cannot remain active after
rollback.

The operation is serialized and receipt-backed. Completion, timeout, restart
recovery, and callbacks require matching project ID, request ID, operation
generation, wait-set membership, and session generation. Stale work is ignored.
The persisted absolute deadline prevents restart from extending the wait
indefinitely. Recovery resumes pending work or rolls back after expiry; it never
replays MCP activation calls.

Pending and terminal acknowledgements use Decision 12's existing activity path
and deterministic IDs. Exactly one terminal activity is accepted for each
request.

## Rejected alternatives

Immediate metadata-only success, in-memory wait state, dynamic wait sets,
quorum/majority success, enabled-but-degraded failure, session-only rollback,
unbounded active-turn waits, random/shared IDs, and automatic recovery replay
are rejected.

## Evidence

Supervisor decision based on scout evidence from orchestration command receipts,
CheckpointReactor completion/retry patterns, startup reconciliation, project
thread enumeration, safe-boundary deferral, provider lifecycle generations, and
project metadata journal/projection seams.
