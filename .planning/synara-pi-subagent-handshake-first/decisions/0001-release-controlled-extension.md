# Decision 0001 — Release-controlled extension for the managed Pi harness

- **Date:** 2026-08-21
- **Status:** Accepted by owner
- **Owner evidence:** “okay chấp nhận phương án này”
- **Scope:** Synara desktop managed Pi subagent harness only

## Context

The incident showed that an unspecified Pi agent directory falls back to the
mutable global Pi extension installation. A global `pi-subagents` v0.10
extension can satisfy the old base handshake while lacking
`journal-terminal-lifecycle`; detached children then cannot provide committed
terminal evidence and execution cards can remain falsely live.

## Decision

Synara-managed Pi subagent sessions must use a `pi-subagents` artifact selected
and verified by the Synara release. They must not silently select a global Pi
extension for managed execution.

The selected artifact must complete the mandatory managed-harness handshake
before managed Agent work is available. If Synara cannot supply the selected
artifact or it does not satisfy the handshake, initialization fails early with
an actionable managed-subagent-unavailable diagnostic. No managed child,
admission, or durable execution card is created first.

Synara must not mutate, delete, or require updates to the user's global Pi
extensions. Those extensions remain available to other Pi consumers.

## Consequences

- Updates to a user's global `pi-subagents` version do not alter Synara's
  managed-subagent behavior.
- A Synara release update is required to advance the managed-harness extension
  artifact, after compatibility verification.
- Version labels alone are insufficient; the selected artifact's negotiated
  handshake capabilities are the operational contract.
- The implementation may choose the internal delivery mechanism
  (`agentDir`, extension factory, or another release-owned mechanism) only if
  it preserves this decision and the source handoff's boundaries.

## Rejected alternatives

- Continue selecting the global Pi extension and trust its version number.
- Mutate or delete a user's global Pi extension to repair incompatibility.
- Accept a missing handshake at session bootstrap and reject the first Agent
  call later.
