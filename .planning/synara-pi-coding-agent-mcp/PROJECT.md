# Synara Pi Coding Agent MCP

## Purpose

Project Home for charting and delivering the change that makes Synara a thin
communication and lifecycle layer around a configured coding agent, while
making Synara MCP an explicit, on-demand integration and fixing Pi runtime
event persistence failures.

## Authoritative routing

- [map.md](map.md) — the wayfinding map and destination for this effort.
- [terms.md](terms.md) — project-scoped domain vocabulary.
- [spec.md](spec.md) — the normative buildable feature specification.
- [issues/](issues/) — child decision tickets; each ticket owns its resolution.
- [issues/impl-\*.md](issues/) — approved implementation tickets derived from
  the spec. The `impl-` prefix preserves the earlier decision-ticket files.
- [decisions/](decisions/) — consequential decisions recorded while working
  through the map.

## Standing decisions

- The destination is a working implementation, not only a design document.
- Default Pi sessions use the complete tool set configured by the coding agent.
- Synara does not inject its internal tool catalog into default Pi sessions.
- Synara remains responsible for UI, session/lifecycle brokering, event journal,
  streaming, reconnect, and replay.
- Synara MCP is opt-in through the user command `Enable Synara MCP`.
- When enabled, Pi discovers Synara MCP tools through the MCP adapter on demand.
- Synara MCP may expose all operations available to the user, but must preserve
  existing authorization, approval, project/thread ownership, active-turn, and
  stop/cancellation boundaries.

## Skills

- `on-the-same-page` for user-facing decisions and explanations.
- `matt-wayfinder` for this map and its decision tickets.
- `matt-domain-modeling` when terms or durable architectural decisions change.
- `matt-implement` when a resolved implementation ticket is handed off.

## Tracker migration

The earlier GitHub publication is retained for history at
https://github.com/anhpham99/symphony/issues/1. The local `spec.md` and
`issues/` files are the normative tracker artifacts from this point onward.
