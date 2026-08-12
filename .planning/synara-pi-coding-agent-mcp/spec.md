# Synara MCP opt-in integration around Pi

**Project:** synara-pi-coding-agent-mcp
**Project home:** [PROJECT.md](PROJECT.md)
**Status:** ready-for-agent
**Tracker:** Local Markdown under this Project Home

## Problem Statement

Synara currently injects a large internal tool catalog into Pi sessions through
custom tools. This makes Synara heavier than Pi standalone at startup, increases
model context and token overhead, and couples Synara's UI/lifecycle layer to the
coding agent's tool surface. Pi's runtime event stream also needs a strict
canonicalization boundary so malformed provider payloads do not disappear from
the journal and become repeated warnings.

The current Pi SDK does not provide the native `mcpServers` session option needed
to attach Synara MCP directly. Synara therefore needs a small Pi MCP adapter/
extension while preserving the existing MCP protocol and authorization rules.

## Solution

Keep Synara as the UI, session/lifecycle broker, event journal, streaming,
reconnect, and replay layer. Pi remains the coding agent and uses the native
coding-agent tools, project MCP servers, and extensions configured by the user.
Synara does not inject its internal catalog into default Pi context.

Provide an explicit project-level integration controlled by
`/Enable Synara MCP` and `/Disable Synara MCP`:

- A dormant Pi MCP extension may load side-effect-free, but before activation it
  opens no MCP connection, performs no discovery, registers no Synara tools,
  mints no credential, and adds no Synara catalog to model context.
- Enable and disable are Synara-owned commands, never Pi prompts or assistant
  messages. They apply at a safe turn boundary and use durable system
  activities for pending and terminal acknowledgement.
- Project activation is shared by current and future sessions and users, but
  every session independently binds the authenticated user's
  `AuthenticatedSession.subject`, credentials, runtime generation, catalog, and
  authorization checks.
- Enable snapshots all current sessions into an immutable durable wait-set and
  reports success only when all sessions activate successfully. The wait has a
  bounded 120-second deadline. Any failure, timeout, or unsafe disappearance
  rolls the project back to disabled and cleans every session, including
  sessions that had succeeded.
- A session created during an enable operation waits until that operation is
  terminal. It activates only if the final project state is enabled; otherwise
  it remains dormant.
- Disable fences MCP immediately, cancels and drains MCP calls, revokes
  credentials, clears resources, and reloads or recreates Pi at the safe
  boundary. It never aborts the entire Pi turn and never replays a cancelled MCP
  call.
- Runtime events are canonicalized at the Pi adapter boundary before strict
  journal persistence. Tool detail is normalized without weakening the
  canonical schema or journal-first behavior.

## User Stories

1. As a coding-agent user, I want my default Pi session to contain only the
   tools I configured, so startup is lightweight and predictable.
2. As a coding-agent user, I want Synara MCP absent from default model context,
   so Synara's internal catalog does not increase startup tokens.
3. As a coding-agent user, I want to enable Synara MCP explicitly, so the agent
   can use Synara integration only when I request it.
4. As a coding-agent user, I want the dormant integration to consume negligible
   resources before activation, so unused capability does not create a
   connection, discovery traffic, or retry loop.
5. As a coding-agent user, I want enabled Synara MCP tools discovered on demand,
   so the catalog is not eagerly injected into context.
6. As a coding-agent user, I want `/Disable Synara MCP`, so I can revoke the
   integration explicitly.
7. As a coding-agent user, I want enable and disable to wait for a safe turn
   boundary, so an active Pi turn never gets a mid-turn tool-surface mutation.
8. As a coding-agent user, I want a pending acknowledgement while a command is
   waiting, so I know why the final result has not appeared yet.
9. As a coding-agent user, I want a terminal acknowledgement after
   reconciliation, so I know the project reached enabled or disabled state.
10. As a coding-agent user, I want failed enable to roll back to disabled, so
    the UI never claims the integration is available when one session failed.
11. As a coding-agent user, I want to retry enable explicitly after failure, so
    an intermittent MCP problem does not silently retry external operations.
12. As a user sharing a project, I want activation to be project-wide, so I do
    not need to repeat the integration command for every session.
13. As a user sharing a project, I want each session to use its own identity,
    credential, and authorization, so another user's access is never inherited.
14. As a user opening a new session during enable, I want it to wait for the
    current operation, so it cannot alter that operation's outcome.
15. As a user opening a new session after successful enable, I want it to
    activate from current project state, so new sessions converge automatically.
16. As a user opening a new session after rollback, I want it to remain dormant,
    so disabled project state is respected.
17. As a user, I want a running MCP call cancelled when I disable Synara MCP, so
    revoked integration cannot continue executing.
18. As a user, I want the rest of my Pi turn to continue after an MCP call is
    cancelled, so disabling Synara MCP does not discard unrelated coding work.
19. As a user, I want cancelled MCP calls never replayed, so external writes are
    not duplicated.
20. As a user, I want reconnect and resume to use fresh MCP authority, so old
    credentials and callbacks cannot cross runtime generations.
21. As a user, I want MCP calls rejected when my identity is missing, stale,
    expired, or mismatched, so the integration fails closed.
22. As a project operator, I want existing authorization, ownership, approval,
    active-turn, Stop, cancellation, and audit checks preserved, so enabling
    MCP does not grant extra privileges.
23. As a user, I want durable pending and terminal activities replayed after
    reconnect, so command state is not lost with the WebSocket.
24. As a user, I want MCP control activities distinct from assistant messages,
    so Pi is not falsely shown as authoring Synara lifecycle state.
25. As a user, I want failure details safe and bounded, so credentials, tokens,
    raw responses, and sensitive filesystem data are not exposed.
26. As a developer, I want malformed Pi tool details normalized before journal
    persistence, so canonical events are not quarantined unnecessarily.
27. As a developer, I want paired token measurements against Pi standalone, so
    Synara overhead is measured rather than hidden by accounting changes.
28. As an operator, I want startup recovery to resolve pending activation
    operations with stable IDs and deadlines, so crashes cannot duplicate
    activation calls or terminal activities.

## Implementation Decisions

- Keep the existing provider abstraction and Pi in-process integration. Add a
  Pi-side MCP extension/adapter because the current Pi SDK lacks native
  `mcpServers` session configuration.
- Keep the default tool boundary: native coding-agent tools, configured project
  MCP servers, and configured extensions only. Remove unconditional Synara
  gateway catalog injection from default Pi runtime construction.
- Add project-level `synaraMcpDesiredState` and a durable activation operation
  to the existing project metadata aggregate, command/event, projection, and
  migration path. Store desired project intent only; credentials, catalogs,
  runtime state, and generations remain session-local.
- Intercept `/Enable Synara MCP` and `/Disable Synara MCP` at the Synara command
  boundary. Capture the authenticated `AuthenticatedSession.subject` from
  trusted server context; never accept identity from browser payload or infer it
  from Pi/session/thread identifiers.
- Use one project lifecycle coordinator plus per-session lifecycle coordinators.
  Serialize enable, disable, reload, resume, reconciliation, and rollback.
- Load the Pi extension dormant. Activation stages identity validation, fresh
  subject-bound credentials, MCP initialize/discovery, complete schema
  validation, and runtime exposure; only a complete successful stage is
  committed at a safe boundary.
- Persist an immutable wait-set of current sessions at enable acceptance. New
  sessions wait for the operation's terminal state and never join its wait-set.
  Aggregate success requires every member to succeed; the deadline is 120
  seconds.
- Any activation failure, timeout, unsafe disappearance, or uncertain cleanup
  rolls the project back to disabled. Cleanup fences MCP, revokes authority,
  clears resources, and leaves normal coding-agent tools usable.
- Disable uses fence → cancel/drain → revoke → close/clear → safe-boundary
  reload/recreate. It must not call Pi `session.abort()` for the whole turn.
  Cancelled MCP calls surface structured `isError` results and are never
  replayed.
- Use three durable system activity kinds: pending, succeeded, and failed. Use
  distinct deterministic pending/terminal IDs, a shared stable `requestId`,
  `turnId: null`, sanitized bounded failure detail, and the existing
  journal-first activity path. Keep these activities visible in the work log but
  out of assistant, sidebar-summary, and pending-interaction state.
- On reconnect, resume, or restart, start the MCP extension dormant and obtain
  fresh subject-bound credentials and discovery. Use operation generation and
  session generation checks to discard stale callbacks and completions.
- Normalize Pi runtime event payloads at the adapter boundary before strict
  canonical persistence. Preserve the strict canonical schema and journal-first
  ordering.
- Measure startup/context/token overhead by component against Pi standalone;
  do not reduce reported overhead by changing accounting or hiding catalog
  content.

## Testing Decisions

See the accepted project-scoped [Testing Strategy Governance Decision Record](decisions/20-testing-strategy-governance.md).

## Out of Scope

- Native MCP support in the upstream Pi SDK; the adapter remains the current
  compatibility seam.
- Automatic Synara capability inference from user prompts.
- Synara internal tools in default Pi context.
- A new owner/admin or Pi-specific permission model.
- Sharing one user's identity, credentials, catalog, or runtime authority with
  another user's session.
- Automatic retry or replay of MCP calls after cancellation, timeout, reconnect,
  or ambiguous transport failure.
- Aborting the entire Pi turn merely because Synara MCP is disabled.
- Replacing Synara's canonical event journal or weakening strict schemas.
- Artifact-backed tool output or compaction unless later measurement proves it
  necessary.
- Performance/accounting changes intended only to make Synara's token overhead
  appear smaller.

## Further Notes

The implementation is a multi-ticket vertical-slice effort. Work should proceed
from contracts and project persistence through command lifecycle, Pi adapter,
identity-bound MCP transport, multi-session reconciliation, UI activities,
recovery, and measurement. Each ticket must preserve the testing governance
record and cite the relevant project Decision Records.

The normative decision trail is under the Project Home. Technical decisions
were validated against current repository conventions by `scout` and settled by
`supervisor`; the owner remains the authority for product/spec changes.
