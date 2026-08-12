# Decision 08: Authenticated principal for Synara MCP

Status: Accepted by owner
Date: 2026-08-12

## Decision

`AuthenticatedSession.subject` is the canonical user principal for Synara MCP
calls made by Pi. Pi does not receive or create an independent user identity.

The MCP credential/session binding must carry the authenticated subject from the
Synara session into the MCP request path. Every call must continue to validate
that principal against the existing project/thread ownership, capability,
approval, active-turn, Stop, cancellation, credential-rotation, and audit
boundaries.

Missing, expired, stale, or mismatched identity binding fails closed. The
implementation must never infer user identity from `sessionKey`, `threadId`,
`projectId`, provider process state, or extension-local state.

## Consequences

- The existing Agent Gateway session identity (`sessionKey`, `threadId`,
  `provider`, and turn authority) remains necessary for runtime and turn safety;
  it is not a replacement for the authenticated user principal.
- Identity propagation is a new seam between the authenticated Synara session
  and the gateway MCP credential/request path.
- Cross-session and reconnect behavior must preserve or deliberately rebind the
  authenticated subject; it must not silently inherit a different user's
  identity.
- Focused tests must cover missing, stale, and mismatched subject bindings, as
  well as normal calls and reconnect/resume.

## Evidence

Scout evidence: `apps/server/src/auth/Services/ServerAuth.ts:53-60` defines
`AuthenticatedSession.subject`; `apps/server/src/wsRpc.ts:2036-2051,
2093-2107,2136-2147` and `apps/server/src/wsConnectionSessions.ts:86-105`
bind the authenticated WebSocket session. `apps/server/src/agentGateway/mcpTransport.ts:64-130`
currently authenticates provider-session bearer credentials and enforces thread,
provider, capability, and active-turn boundaries, but does not currently carry
`AuthenticatedSession.subject`.
