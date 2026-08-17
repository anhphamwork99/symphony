# Project terms

- **Coding agent tools** — the tools configured by the selected coding-agent
  runtime/profile, including its native tools, MCP tools, and extensions.
- **Default Pi session** — a Pi session before the user enables Synara MCP. It
  receives only the configured coding-agent tools plus the minimum runtime
  behavior required by the provider integration.
- **Synara MCP** — an optional MCP integration that exposes Synara operations to
  Pi after the user invokes `Enable Synara MCP`.
- **Discoverable but dormant** — the Synara MCP integration may be installed
  and available to the MCP adapter, but the Pi model context does not contain
  Synara tools and no MCP connection or catalog discovery is opened before the
  user invokes `/Enable Synara MCP`.
- **MCP activation refusal** — a Synara MCP call made before activation is not
  expected from the default Pi model surface; if an adapter-level call still
  arrives, it fails closed with:
  `Synara MCP is disabled; ask the user to run /Enable Synara MCP`.
- **Disabled MCP refusal** — the stable user-facing refusal returned for a
  Synara MCP call before activation: `Synara MCP is disabled; ask the user to
run /Enable Synara MCP`.
- **Project MCP activation** — the persisted project-level state created by
  `/Enable Synara MCP`; it applies to current and future sessions in that
  project, but does not activate Synara MCP in other projects.
- **MCP activation setting** — a project integration preference, not a grant of
  Synara authority. A user who can operate the project may change it; each MCP
  operation still applies the user's existing authorization.
- **MCP discovery** — the MCP-adapter flow through which Pi learns which Synara
  tools are available; Synara does not infer capability from prompt text.
- **User-authorized Synara operation** — any Synara operation the current user
  may perform, subject to existing project/thread ownership, approvals,
  active-turn, stop, and cancellation rules.
- **Runtime event canonicalization** — converting provider-native values into
  values accepted by the canonical `ProviderRuntimeEvent` contract while
  retaining raw provider data for diagnostics.
