# Decision 11: Synara MCP command acknowledgement

Status: Accepted by owner
Date: 2026-08-12

## Decision

`/Enable Synara MCP` and `/Disable Synara MCP` are Synara-owned commands and are
never sent to Pi or added to the model conversation.

When a command is issued while a Pi turn is active, Synara emits two system
activities:

1. An immediate pending acknowledgement explaining that the requested change
   will apply after the current turn completes.
2. A terminal activity after safe-boundary reconciliation reports success or
   failure.

When the runtime is already idle, Synara omits the pending acknowledgement and
emits only the terminal result.

For enable success, the terminal result states that Synara MCP is enabled for
the project. For enable failure, it states that activation failed and the
project remains disabled, with a safe diagnosable reason. Disable follows the
same pending/terminal pattern and reports the final disabled state.

These acknowledgements are Synara system activities, not assistant messages.
They must not consume model context or appear as if Pi authored them.
