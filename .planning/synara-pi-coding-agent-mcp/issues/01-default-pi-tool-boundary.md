# Default Pi tool boundary

Labels: `wayfinder:grilling`, `wayfinder:task`

## Question

What exact runtime construction and configuration changes ensure a default Pi
session receives only the complete tool set configured by the selected coding
agent, with no Synara internal catalog injection, while preserving native tools,
configured MCP tools, extensions, approvals, and provider lifecycle behavior?

## Scout evidence

`apps/server/src/provider/Layers/PiAdapter.ts` currently calls
`listAgentGatewayMcpTools()` and projects every returned descriptor into Pi's
`customTools` before `createAgentSessionFromServices`. The shared
`apps/server/src/agentGateway/mcpInjection.ts` currently builds native MCP
configuration for Codex, Claude, OpenCode, and ACP paths; it is not currently
used to configure a native MCP server for Pi.
