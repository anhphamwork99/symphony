# Decision 14: Disable cancellation and revocation sequence

Status: Accepted technical decision
Date: 2026-08-12

## Decision

`/Disable Synara MCP` is serialized by the per-session lifecycle coordinator and
uses this order:

1. Persist desired disabled, advance runtime generation, and synchronously fence
   new MCP admission.
2. Retire exact-turn write authority and cancel/tombstone relevant in-flight MCP
   requests.
3. Return each affected Pi-facing request exactly one MCP error result with
   `isError: true`, code `synara_mcp_disabled`, and message
   `Synara MCP is disabled; ask the user to run /Enable Synara MCP`.
4. Await the registry drainage barrier with the existing two-second bounded
   timeout.
5. Revoke credentials, close transport, and clear catalog, tool registrations,
   caches, callbacks, and generation-bound state.
6. Without calling `session.abort()`, allow Pi to consume the failed tool result
   and continue its turn with coding-agent tools.
7. At the safe boundary, reload or recreate the runtime dormant; then persist
   and project the terminal acknowledgement.

A registration racing disable is rejected before its handler starts. A late
response loses to the once-only cancellation settlement and cannot mutate state
or bind to a new turn/generation. Calls are never automatically retried or
replayed.

A drain timeout is not clean success. Authority remains revoked and the project
remains disabled, but the session stays unavailable until cleanup/recreation is
proven. The terminal activity has `status: failed`, `finalState: disabled`, and a
sanitized diagnostic. Explicit `/Enable Synara MCP` is required for recovery.

## Evidence

The sequence follows existing `inFlightRequestRegistry`, `sessionLease`, MCP
transport, credential revocation and generation-isolation conventions. Direct
inspection of `@earendil-works/pi-agent-core@0.81.1` confirmed that a rejected
custom-tool `execute` is converted into an error `toolResult` and the agent loop
continues; disable therefore must not abort the Pi session.

## Rejected alternatives

Whole-turn abort, fetch-AbortSignal-only cancellation, delaying the admission
fence, revoke-after-reload, bare HTTP 202 as the Pi-facing result, accepting late
responses, stale-generation reuse, automatic replay, mid-turn hot swap, and
reporting timeout as clean success are rejected.
