# Decision 13: Disable cancels active Synara MCP calls

Status: Accepted by owner
Date: 2026-08-12

## Decision

When the user invokes `/Disable Synara MCP`, Synara immediately fences new
Synara MCP authority and cancels/drains any in-flight Synara MCP calls. It does
not automatically cancel the entire Pi turn.

The affected Pi tool call receives a structured cancellation/unavailable result.
Pi may continue the turn with its remaining coding-agent tools, but the cancelled
MCP call must not be automatically retried or replayed.

After cancellation drainage, Synara revokes MCP credentials, closes the
transport, clears discovery and registered tool state, reloads or recreates the
Pi runtime when required, persists the disabled state, and emits the terminal
system activity defined by Decisions 11 and 12.

Disable is fail-closed. Late callbacks and responses from the cancelled MCP call
are ignored, cannot mutate state, and cannot be attributed to a later turn or
runtime generation.
