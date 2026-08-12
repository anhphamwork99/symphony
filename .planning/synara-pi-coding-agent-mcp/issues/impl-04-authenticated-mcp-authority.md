# impl-04 — Bind Synara MCP authority to the authenticated subject

**What to build:** Carry `AuthenticatedSession.subject` into Synara MCP credentials and requests while preserving existing authorization boundaries.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Bind each MCP session to its controlling authenticated subject.
- [ ] Keep credentials, authority, and runtime generations isolated per user/session.
- [ ] Reject missing, expired, stale, or mismatched subject bindings.
- [ ] Preserve capability, ownership, approval, active-turn, Stop, cancellation, rotation, and audit checks.

## Testing Seams

**Approval status:** Approved by owner on 2026-08-12, following designer review.

- **AC1:** Trusted authenticated session-establishment boundary → MCP session — `AuthenticatedSession.subject` is bound to the controlling session and runtime generation; a valid subject operates only within its own session and existing capability, ownership, approval, active-turn, Stop, cancellation, rotation, and audit checks remain enforced.
- **AC2:** MCP admission boundary — missing, expired, stale, or mismatched subject/credential/generation fails closed before an operation is created; request-supplied identity cannot override trusted server identity and denied requests produce no side effect.

This ticket reuses the existing authorization boundary and does not introduce a new permission model.
