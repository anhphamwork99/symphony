# Decision 22: impl-04 final acceptance

Status: Accepted
Date: 2026-08-13

## Question

Does the complete `impl-04` candidate at commit `01d1b0ff` satisfy AC1,
AC2, Decisions 20 and 21, and the project's authenticated Synara MCP authority
boundary?

## Decision

Yes. Final acceptance is granted for `impl-04` at commit
`01d1b0ff1e120baa0d4db89f1391ae3a20403452`.

The authenticated MCP authority binding is propagated through the required
Codex start and fork seams. Missing or malformed authority fails closed without
preventing the provider session from operating without a Synara MCP lease.
No request-supplied identity replaces trusted server authority, and the
existing authorization and admission boundaries remain intact.

The two focused server teardown failures and seven workspace typecheck errors
observed during final verification are baseline failures outside the ticket's
approved repair scope. They do not invalidate the focused AC1 and AC2 evidence
and do not block this ticket.

## Governing references

- [Project Home](../PROJECT.md)
- [impl-04 ticket](../issues/impl-04-authenticated-mcp-authority.md)
- [Decision 20: Testing strategy governance](20-testing-strategy-governance.md)
- [Decision 21: Authenticated MCP session authority](21-authenticated-mcp-session-authority.md)

## Evidence

- Contracts provider tests: 12 of 12 passed.
- Focused server tests: 289 passed, 2 skipped, with 2 baseline teardown
  failures unrelated to MCP authority propagation.
- Workspace typecheck no longer reports the two Codex propagation errors
  addressed by `impl-04`; seven pre-existing errors remain outside scope.
- Independent review found AC1, AC2, and Decision 21 conformant with no
  concrete security or correctness blocker.
- Final Project Supervisor consultation accepted the integrated candidate.

## Rejected alternatives

- Rejecting solely because unrelated baseline teardown failures remain.
- Rejecting solely because unrelated pre-existing workspace type errors remain.
- Expanding acceptance into `impl-06`, `impl-07`, or `impl-09`.
- Reopening Decisions 20 or 21 without decision-changing evidence.

## Reopening conditions

Reopen `impl-04` only if later evidence demonstrates:

- subject authority can be omitted or mismatched while still acquiring a
  gateway lease or creating an MCP operation;
- an AC1 or AC2 regression;
- a bypass of Decision 21's trusted subject, session, or generation authority;
  or
- a newly demonstrated test or typecheck regression caused by this ticket.

No prior decision record is superseded.
