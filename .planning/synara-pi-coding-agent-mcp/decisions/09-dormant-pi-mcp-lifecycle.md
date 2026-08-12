# Decision 09: Dormant Pi MCP lifecycle

Status: Accepted technical decision
Date: 2026-08-12

## Decision

The Pi Synara MCP extension is loaded side-effect-free and starts dormant. Before
project activation it makes no MCP connection, sends no `initialize` or
`tools/list`, registers no Synara tools, mints or retains no gateway credential,
and starts no retry loop.

A per-session lifecycle coordinator and admission gate owns all MCP transitions.
It separates durable project intent (`desired: disabled | enabled`) from runtime
state (`dormant | activating | active | deactivating | degraded`).

Activation stages identity validation, fresh credentials, MCP connection,
`initialize`, complete catalog discovery and schema validation, then atomically
exposes the catalog through the Pi reload seam at a safe turn boundary. Partial
catalogs are never exposed. Activation failure leaves desired enabled but
runtime degraded; normal coding-agent tools remain usable and no Synara tools are
exposed.

Disable persists desired disabled, fences new MCP calls, retires/cancels and
drains in-flight requests, revokes credentials, closes transport, clears
registration/cache, then reloads or recreates the runtime. Revocation happens
before reload/unregister so stale handles cannot regain authority. If clean
revocation or recreation cannot be proved, the session remains unavailable.

Runtime resume/recreation always starts dormant and obtains fresh identity-bound
credentials and discovery. Browser/WebSocket reconnect does not itself trigger
MCP discovery. Old runtime generations, sockets, callbacks, tokens and tool
handles cannot be inherited. Tool calls are never automatically replayed after
ambiguous failure.

Enable/disable, `/reload`, force-reload and resume operations serialize through
the same coordinator; direct concurrent reload is forbidden. Active turns keep
their existing tool surface. `agent_end` or a completed cancellation barrier is
the normal safe boundary. Stop supersedes pending activation and cleans all
candidate resources.

## Invariants

- Default Pi context contains only coding-agent-configured tools.
- Activation grants no authorization; existing capability, project/thread
  ownership, approval, active-turn, Stop, cancellation, credential-rotation and
  audit checks remain mandatory.
- `AuthenticatedSession.subject` remains the canonical user principal per
  Decision 08; missing, stale, expired or mismatched binding fails closed.
- Cleanup and revocation are idempotent and auditable.

## Rejected alternatives

Eager startup connection/discovery, mid-turn hot swap, direct unrestricted
reload, partial catalog exposure, credential/cache reuse across runtime resume,
Pi/thread/server identity fallback, and automatic call replay are rejected.

## Evidence and verification

Supervisor decision based on scout evidence from `PiAdapter.ts` extension binding,
`/reload`, runtime recreation, active-turn and lease lifecycle, plus
`agentGateway/mcpTransport.ts` ownership/capability/turn checks. Focused tests
must cover dormant zero-MCP activity, safe-boundary enable/disable, reload and
recreation failure, reconnect generation isolation, identity failures,
non-replay, cancellation, and serialized lifecycle races.
