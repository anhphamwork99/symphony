# Synara MCP adapter discovery and on-demand loading

Labels: `wayfinder:research`, `wayfinder:grilling`

## Question

How should Synara implement its MCP server and follow the existing MCP adapter
convention so Pi can discover Synara operations only after activation and load
tool definitions on demand, without exposing the full catalog in the default
context or creating a second tool execution path?

## Resolved so far

- The Pi model does not receive Synara tools or the Synara catalog in its
  default context.
- A small Pi MCP extension may be loaded dormant, but it opens no connection,
  performs no discovery, and registers no Synara tools before activation.
- `/Enable Synara MCP` activates the project-level integration; activation is
  applied at a safe turn boundary.
- After activation, the extension opens the MCP connection and performs
  explicit discovery on demand.
- Discovery returns standard complete tool schemas; the catalog is not injected
  into default session startup context.
- Any unexpected adapter-level pre-activation call fails closed with:
  `Synara MCP is disabled; ask the user to run /Enable Synara MCP`.

## Scout evidence

The current Pi path is not MCP-native: `buildPiAgentGatewayCustomTools()` in
`apps/server/src/provider/Layers/PiAdapter.ts` calls the gateway `tools/list`
endpoint and wraps each result as a Pi `customTools` entry whose executor calls
the gateway `tools/call` endpoint. `mcpInjection.ts` has provider-specific MCP
config builders, but no Pi builder is currently wired into session creation.

The pinned Pi SDK's documented `createAgentSessionFromServices` options expose
`tools`, `excludeTools`, `noTools`, and `customTools`, but no native
`mcpServers` option. Therefore the desired MCP behavior requires a Pi MCP
adapter/bridge (unless the dependency is upgraded to a version with native MCP
support); it cannot be achieved by adding a config field to the current SDK.

An independent check of npm latest
`@earendil-works/pi-coding-agent@0.84.1` found the same API shape: no
`mcpServers` session option. Upgrading the dependency alone is therefore not a
solution.

The same SDK documents `ExtensionAPI.registerTool()` and extension loading via
`ResourceLoader`. The current implementation direction is a Pi-side extension
that speaks MCP to Synara and owns the adapter lifecycle, rather than more
provider-specific catalog projection in `PiAdapter`.

## Decision direction

Use MCP as the Synara-facing protocol and build a Pi-side adapter/bridge until
the upstream Pi SDK provides a stable native MCP client. The bridge may expose
a bounded Pi integration surface, but its Synara calls must go through the
MCP server and preserve the same discovery, disabled refusal, authorization,
active-turn, approval, Stop, cancellation, and audit rules. Revisit native
support later as a dependency upgrade decision; do not block the current
implementation on it.
