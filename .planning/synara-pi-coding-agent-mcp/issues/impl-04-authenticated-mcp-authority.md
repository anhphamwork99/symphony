# impl-04 — Bind Synara MCP authority to the authenticated subject

**What to build:** Carry `AuthenticatedSession.subject` into Synara MCP credentials and requests while preserving existing authorization boundaries.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] Bind each MCP session to its controlling authenticated subject.
- [x] Keep credentials, authority, and runtime generations isolated per user/session.
- [x] Reject missing, expired, stale, or mismatched subject bindings.
- [x] Preserve capability, ownership, approval, active-turn, Stop, cancellation, rotation, and audit checks.

**Implementation:** WP4 completion commit (delivered as a single coherent
commit on top of `9c54d574`) restored the half-reverted Codex propagation and
closed the remaining seams end to end:

- `ProviderForkThreadInput` accepts an optional `McpAuthorityBinding`;
- `CodexAppServerStartSessionInput` carries the binding and
  `agentGatewayMcp.acquireSessionLease` accepts it;
- `CodexAdapter` forwards `input.mcpAuthority` into the manager start input and
  passes it through the session-lease seam on start;
- the manager forwards the binding on fork, and `ProviderCommandReactor`
  forwards the already-resolved binding into `providerService.forkThread`;
- regression tests at the contracts, adapter, manager, and reactor seams cover
  start and fork propagation, absent authority (fail closed, session stays
  healthy with no gateway lease), and malformed binding rejection;
- restored the `ProviderCommandReactor` test harness routing through the
  harness runtime (lost from `cb380ee5` during WP4 slice repairs), which fixed
  80 pre-existing delivery-path test failures.

Focused verification: contracts `12/12`, `CodexAdapter` `34/34`, manager `124
passed` (2 pre-existing teardown failures also present on baseline),
`ProviderCommandReactor` `129/129`. Full server suite: `27 failed | 3770
passed` — every failure is present on the baseline (`107 failed`); no new
failures. `bun run typecheck`: no new errors; 7 pre-existing errors remain
identical to baseline (`decider.ts`, `projectActivation.test.ts`,
`synaraMcpCommand.ts`, `wsRpc.ts` ×2, `McpSessionAuthority.ts`,
`httpRoute.test.ts`).

## Testing Seams

**Approval status:** Approved by owner on 2026-08-12, following designer review.

- **AC1:** Trusted authenticated session-establishment boundary → MCP session — `AuthenticatedSession.subject` is bound to the controlling session and runtime generation; a valid subject operates only within its own session and existing capability, ownership, approval, active-turn, Stop, cancellation, rotation, and audit checks remain enforced.
- **AC2:** MCP admission boundary — missing, expired, stale, or mismatched subject/credential/generation fails closed before an operation is created; request-supplied identity cannot override trusted server identity and denied requests produce no side effect.

This ticket reuses the existing authorization boundary and does not introduce a new permission model.
