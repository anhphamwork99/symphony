# Decision 23: impl-06 final acceptance

Status: Accepted
Date: 2026-08-13

## Question

Does the complete `impl-06` candidate in `a02fe1c6..3dfc98d1` satisfy
the ticket's AC1/AC2 testing seams and Decisions 09, 10, 20, and 21 without
taking ownership of `impl-07` or `impl-08`?

## Decision

Accept `impl-06-single-session-mcp-lifecycle` at commit `3dfc98d1`.

The accepted candidate provides one lifecycle coordinator per Pi session,
side-effect-free dormant startup, serialized dormant/activating/active/
deactivating/unavailable transitions, trusted authority validation, fresh
generation-bound credentials, explicit MCP initialization, complete catalog
discovery and validation, safe-boundary atomic publication, stale-completion
fencing, and fail-closed rollback. If publication or cleanup cannot be proved,
the session remains non-active and unavailable.

The accepted implementation exposes the per-session coordinator for the
project propagation work owned by `impl-08`. Cancellation, drainage, and
revoke ordering during disable remain owned by `impl-07`; neither follow-on
contract is absorbed into this ticket.

## Evidence

- Accepted commit range: `a02fe1c6..3dfc98d1`.
- Focused Vitest verification passed 61 tests across
  `piSynaraMcpLifecycle.test.ts`, `piSynaraMcpExtension.test.ts`, and
  `PiAdapter.test.ts`.
- `git diff --check` passed.
- Server TypeScript checking reported no errors in the impl-06 change
  surface.
- Independent review passed lifecycle states, dormant startup, safe-boundary
  behavior, stale-completion fencing, and session disposal. Its initialization,
  generation-binding, and rollback-cleanup findings were resolved in
  `3dfc98d1`.

## Residual risks

The workspace-wide `bun run test` did not finish: server Vitest remained
running without completion for approximately nine minutes and was cancelled.
Server typechecking still exits non-zero because of seven pre-existing errors
outside the impl-06 change surface in agent-gateway, orchestration, and
WebSocket code. These reduce workspace-wide confidence but do not contradict
the focused acceptance evidence.

## Rejected alternatives

- Requiring project propagation/wait-set behavior from impl-06; this remains
  impl-08 scope.
- Requiring disable cancellation/drain/revoke orchestration from impl-06; this
  remains impl-07 scope.
- Rejecting the focused candidate solely for unrelated baseline type errors or
  the cancelled full-suite run.

## Reopening conditions

Reopen if later verification shows that initialization can be skipped, a stale
generation can expose or invoke tools, a partial catalog survives rollback,
failed activation is reported enabled, normal configured tools are lost, or
follow-on wiring cannot preserve the accepted safe-boundary and authority
invariants.
