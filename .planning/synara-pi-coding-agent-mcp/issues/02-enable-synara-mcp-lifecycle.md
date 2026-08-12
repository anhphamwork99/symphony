# Enable Synara MCP command lifecycle

Labels: `wayfinder:grilling`

## Question

What is the user-visible and server-side contract for `Enable Synara MCP`,
including command validation, acknowledgement, activation state, behavior when
the Pi turn is active, failure reporting, Stop/cancellation, and whether the
change applies immediately or at the next safe runtime boundary?

## Resolved so far

- The command is `/Enable Synara MCP`.
- Activation is persisted at project level.
- It applies to current and future sessions in that project.
- It does not activate Synara MCP in other projects.
- Before activation, a call returns exactly:
  `Synara MCP is disabled; ask the user to run /Enable Synara MCP`.
- A running turn keeps its existing tool surface; activation takes effect from
  the next turn and for new sessions in the project.
- If the runtime cannot attach MCP safely between turns, Synara recreates and
  resumes the Pi runtime at that boundary rather than hot-swapping during a
  turn.
- Provide `/Disable Synara MCP` with the same safe-boundary behavior; it does
  not interrupt a running call or turn.
- Activation/deactivation is a project integration setting, not a permission
  grant. A user who can operate the project may change it; individual MCP
  operations continue to enforce existing authorization.
- Before activation, a dormant Pi MCP extension may be loaded for low startup
  cost, but it opens no connection, performs no discovery, and registers no
  Synara tools into the model context.
- Activation is committed only after identity validation, fresh credentials,
  MCP initialization, complete catalog discovery/validation, and runtime
  exposure all succeed. Any activation failure rolls the persisted project
  setting back to `disabled`, cleans all candidate resources, and requires the
  user to run `/Enable Synara MCP` again.

## Resolution status

This issue's user decisions are complete enough for implementation planning:
project-level persisted activation, safe turn-boundary application, explicit
enable/disable commands, no new owner/admin permission model, and all-or-nothing
activation with rollback to disabled on failure. The final implementation
contract and verification evidence belong in the implementation ticket, not in
this question body.
