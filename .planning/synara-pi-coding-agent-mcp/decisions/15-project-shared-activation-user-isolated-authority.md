# Decision 15: Project-shared activation with user-isolated authority

Status: Accepted by owner
Date: 2026-08-12

## Decision

Synara MCP activation is one shared persisted state for the project. When an
authorized user enables or disables Synara MCP for a project, the resulting
project state applies to current and future sessions opened against that
project, including sessions controlled by other authenticated users.

Activation is not an authorization grant and does not transfer identity or
permissions between users. Every session independently binds its current
`AuthenticatedSession.subject`, obtains its own credentials and runtime
generation, and enforces that user's current project/thread ownership,
capabilities, approvals, active-turn, Stop, cancellation, and audit boundaries.

A session controlled by User B must never inherit User A's MCP credential,
connection, discovery authority, in-flight requests, callbacks, or identity
binding merely because the project is enabled. It performs fresh activation for
its own runtime at a safe boundary using User B's authenticated principal.

Disabling the project state applies to all sessions for that project. Each
session must fence and reconcile its own MCP runtime according to Decisions 13
and 14; a failure in one session cannot leave that session's authority active or
prevent the durable project state from becoming disabled.
