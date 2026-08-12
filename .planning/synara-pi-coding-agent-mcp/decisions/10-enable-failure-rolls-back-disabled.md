# Decision 10: Enable failure rolls back to disabled

Status: Accepted by owner
Date: 2026-08-12

## Decision

If `/Enable Synara MCP` cannot complete activation successfully, the project
setting rolls back to `desired=disabled` and the runtime returns to `dormant`.
It must not remain `desired=enabled` with runtime state `degraded`.

An activation is successful only after identity validation, fresh credential
issuance, MCP connection and initialization, complete catalog discovery and
validation, and atomic exposure through the Pi runtime boundary all succeed.
Any failure before that point triggers rollback.

Rollback must revoke candidate credentials, cancel and drain candidate requests,
close transport, discard discovery/catalog state, expose no Synara tools, persist
and audit `disabled`, and leave normal coding-agent tools usable. There is no
automatic activation retry while disabled; the user must explicitly run
`/Enable Synara MCP` again.

The user receives a clear activation-failed acknowledgment with a diagnosable
reason. The command must never report enabled before the full activation commit
has succeeded.

## Relationship to Decision 09

This decision supersedes only Decision 09's activation-failure outcome
(`desired=enabled`, runtime=`degraded`). All other lifecycle requirements in
Decision 09 remain authoritative, including dormant side-effect-free startup,
one lifecycle coordinator, safe-boundary application, staged atomic activation,
revoke-first disable, fresh authority on resume, no automatic tool-call replay,
and fail-closed identity handling.

## Product consequence

A project does not remember an unsuccessful enable intent. After a failed
attempt, its externally visible and persisted state is disabled until the user
tries again.
