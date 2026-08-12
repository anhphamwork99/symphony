# Decision 19: Future sessions wait for the current enable operation

Status: Accepted by owner
Date: 2026-08-12

## Decision

A session created, attached, resumed, or hydrated after a project `/Enable
Synara MCP` operation has been accepted is not added to that operation's
immutable wait-set and cannot affect its terminal result.

The future session waits for the current project activation operation to reach a
terminal state. Afterward:

- if the project is durably `enabled`, the session activates Synara MCP through
  its own safe-boundary lifecycle using its own authenticated subject,
  credentials, transport, catalog, and runtime generation;
- if the operation failed or rolled the project back to `disabled`, the session
  remains dormant with no MCP connection, discovery, credentials, or Synara
  tools.

The future session must not create a parallel activation attempt, extend the
current operation deadline, or change the current operation's all-session
outcome.
