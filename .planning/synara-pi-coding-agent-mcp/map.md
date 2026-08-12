# Synara Pi Coding Agent MCP — Wayfinding Map

## Destination

Build and ship Synara as a thin UI/session/lifecycle/event layer around the
tools configured by the coding agent, with Synara MCP available only after the
user runs `Enable Synara MCP`, and with Pi runtime tool events durably persisted
without whitespace-induced quarantine or warning spam.

## Notes

Domain: provider integration, MCP, runtime event durability, and context/token
performance.

Default behavior is intentionally simple: Pi uses the coding agent's configured
tools; Synara does not inject its internal tool catalog. Synara MCP is an
explicit user action and is discovered through the MCP adapter on demand.

Consult `on-the-same-page` for user-facing decisions, `matt-domain-modeling`
for shared terms and consequential decisions, and `matt-implement` when a
resolved ticket is ready for implementation. This map plans and executes the
effort because the destination is a build, rather than stopping at a handoff
spec.

## Decisions so far

- Enable Synara MCP command lifecycle — project-level persisted activation,
  explicit enable/disable, safe turn-boundary application, and no new
  owner/admin permission model. (Decision details:
  [Enable Synara MCP command lifecycle](issues/02-enable-synara-mcp-lifecycle.md))
- Default Pi behavior — Pi uses the coding agent's configured tools; Synara is
  the UI/session/lifecycle/event layer.
- Synara MCP activation — user invokes `Enable Synara MCP`; Synara does not
  infer activation from prompt text.
- Synara MCP discovery — Pi learns the available Synara operations through the
  MCP adapter on demand.
- Synara MCP default state — the integration may be installed for the MCP
  adapter, but the Pi model context has no Synara tools, no MCP connection is
  opened, and no catalog discovery runs before `/Enable Synara MCP`.
- MCP activation refusal — any adapter-level pre-activation call fails closed
  with the stable message `Synara MCP is disabled; ask the user to run
  /Enable Synara MCP`.
- Discovery payload — after activation and at a safe turn boundary, explicit
  MCP discovery returns standard complete tool schemas; the catalog is loaded
  on demand rather than injected at session startup.
- Pi MCP extension lifecycle — a small dormant extension may be loaded with
  the Pi session, but it opens no connection, performs no discovery, registers
  no Synara tools, and adds no Synara catalog to model context until project
  activation.
- Enable failure — activation is all-or-nothing. Any failure rolls the
  persisted project state back to disabled, cleans candidate MCP resources,
  and requires another explicit `/Enable Synara MCP`.
- Current implementation constraint — `PiAdapter` currently calls
  `listAgentGatewayMcpTools()` and projects every descriptor into Pi
  `customTools`; the shared `mcpInjection` module currently builds native MCP
  configurations for other providers, not Pi. The implementation must add a
  real Pi MCP-adapter path or an explicitly MCP-compatible Pi bridge.
- Pi SDK capability evidence — the pinned `@earendil-works/pi-coding-agent`
  SDK exposes `tools`, `excludeTools`, `noTools`, and `customTools` for session
  creation; its documented `createAgentSessionFromServices` path has no native
  `mcpServers` configuration.
- Latest SDK check — npm latest `@earendil-works/pi-coding-agent@0.84.1` was
  inspected and still exposes `customTools` but no `mcpServers` session
  option. Upgrading alone does not provide native Pi MCP support.
- Pi extension capability evidence — the latest SDK documents
  `ExtensionAPI.registerTool()` and extension loading through `ResourceLoader`.
  A Pi-side extension is therefore the current integration seam for an
  MCP-protocol client/adapter, pending native upstream support.
- Disabled MCP refusal — pre-activation calls return the exact stable message
  `Synara MCP is disabled; ask the user to run /Enable Synara MCP` and perform
  no operation.
- MCP activation scope — `/Enable Synara MCP` persists at project level and
  applies to current and future sessions in that project only.
- MCP activation timing — a running turn keeps its existing tool surface;
  project activation takes effect from the next turn and for new sessions.
- MCP runtime attachment — activation must take effect at a safe turn boundary;
  runtime recreation/resume is the fallback until the Pi SDK proves safe
  between-turn MCP attachment.
- MCP deactivation — provide `/Disable Synara MCP`; it does not interrupt a
  running call or turn and takes effect from the next turn.
- MCP activation authority — enabling/disabling MCP is a project integration
  setting, not an authority grant; a user who can operate the project may
  change it, while each MCP operation enforces the user's existing rights.
- Synara MCP authority — enabled MCP may use all operations available to the
  user, while preserving existing authorization and lifecycle boundaries.
- Synara MCP visibility — default Pi context contains no Synara catalog; the
  dormant adapter becomes active only after project activation and a safe turn
  boundary.

## Not yet specified

- Exact MCP adapter configuration and command acknowledgement/projection
  protocol.
- Whether enabling MCP changes the active runtime in place or takes effect at
  the next safe turn/session boundary.
- Exact Synara MCP operation catalog, naming, schemas, and error contract.
- How “all user-authorized operations” maps to project/thread/turn scope.
- Token measurement instrumentation and the acceptable default overhead budget.
- Whether large tool outputs require artifact-backed storage after measurement.
- Whether event normalization is Pi-local first or becomes a shared provider
  utility after additional provider evidence.
- Migration behavior for resumed sessions created with the old injected catalog.

## Out of scope

- Making Synara a second autonomous agent with its own default tool catalog.
- Replacing Pi's configured coding-agent tool selection.
- Bypassing authorization, approval, active-turn, stop, or cancellation checks.
- Changing token accounting merely to reduce displayed numbers.
- Rewriting historical runtime events solely to hide existing warnings.
