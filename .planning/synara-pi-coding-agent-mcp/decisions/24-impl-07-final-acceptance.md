# Decision 24: impl-07 final acceptance

Status: Accepted
Date: 2026-08-13

## Question

Does the complete impl-07 candidate based on fixed point `cb21f8e9`,
comprising commits `6163e0a4`, `7afa964a`, `03de9097`, and `fe0c6ba7`,
satisfy the ticket, AC1/AC2 testing seams, Decisions 13, 14, and 20, and the
accepted impl-06 prerequisite without absorbing impl-08 or impl-09 scope?

## Governing references

- [Project Home](../PROJECT.md)
- [impl-07 ticket](../issues/impl-07-disable-cancellation-cleanup.md)
- [Decision 13: Disable cancels active Synara MCP calls](13-disable-cancels-mcp-calls.md)
- [Decision 14: Disable cancellation and revocation sequence](14-disable-cancellation-sequence.md)
- [Decision 20: Testing strategy governance](20-testing-strategy-governance.md)
- [Decision 23: impl-06 final acceptance](23-impl-06-final-acceptance.md)

## Decision

Accept impl-07 at commit `fe0c6ba7`.

The accepted candidate is the diff from fixed point `cb21f8e9` through HEAD
`fe0c6ba7`, consisting of commits `6163e0a4`, `7afa964a`, `03de9097`, and
`fe0c6ba7`.

The implementation provides a per-session disable operation that:

1. Synchronously fences new Synara MCP admission before asynchronous cleanup.
2. Retires the exact active turn's write authority and obtains its drain
   barrier before revoking credentials.
3. Settles every affected Pi-facing execution exactly once with
   `isError: true`, code `synara_mcp_disabled`, and the required stable
   message.
4. Cancels and drains in-flight work within the required two-second bound.
5. Suppresses late gateway callbacks and never replays a cancelled call.
6. Revokes credentials and clears transport, catalog, registrations, caches,
   callbacks, and generation-bound resources in the required order.
7. Reconciles the runtime only at a safe boundary when a turn is active, or
   immediately when the session is idle.
8. Does not call `session.abort()`, allowing the Pi turn to continue with its
   configured non-MCP coding-agent tools.
9. Reaches `dormant` only when settlement, drainage, cleanup, and reconciliation
   are proven; uncertainty leaves the session disabled and `unavailable`.
10. Exposes the operation through the public `ProviderService` boundary.
11. Preserves journal-first desired-state acceptance and exactly-once terminal
    command consistency, including idle and previously empty-wait-set cases.
12. Reports timeout or uncertain cleanup as failed-disabled with a sanitized
    diagnostic rather than as clean success.

impl-08 project-wide fan-out/wait-set behavior and impl-09 restart recovery
remain outside this acceptance.

## Criterion-level rationale

### Ticket checklist

- **Fence new calls before cleanup:** Pass. The per-session generation and
  Pi-local execution fence reject registrations racing disable before their
  handlers start.
- **Cancel and drain before revocation:** Pass. Exact-turn retirement supplies
  the drainage barrier, cancellation is bounded, and credential revocation
  follows drainage or timeout handling.
- **Structured errors and late-callback suppression:** Pass. Affected executions
  receive exactly one `synara_mcp_disabled` result, while late completions lose
  to once-only settlement and cannot mutate current state.
- **Turn continuity, no replay, and fail-closed cleanup:** Pass. Disable does not
  abort the Pi session, cancelled calls are not replayed, and uncertain cleanup
  leaves the session disabled and unavailable.

### AC1 — public session/provider disable boundary

Pass. The approved public boundary demonstrates admission fencing, cancellation,
exact-turn drainage, post-drain revocation, cleanup, safe-boundary runtime
reconciliation, generation isolation, late-callback suppression, and
fail-closed unavailable handling.

### AC2 — narrow Pi tool-execution exception seam

Pass. The mapped custom-tool seam demonstrates the exact structured
`synara_mcp_disabled` result, continued non-MCP Pi execution, no
`session.abort()`, and no replay of the cancelled MCP call.

### Decision 13

Pass. Active Synara MCP calls are cancelled and drained without cancelling the
whole Pi turn. Authority is fenced immediately, late callbacks are ignored,
resources are cleaned up, and cancelled calls cannot be retried or attributed
to a later turn or generation.

### Decision 14

Pass. The implementation preserves the required order: desired-disabled
journal and synchronous fence; exact-turn retirement and cancellation;
exactly-once structured Pi settlement; bounded drain; revocation and cleanup;
continued Pi turn; and safe-boundary reconciliation. Timeout and uncertain
cleanup are represented as failed-disabled and unavailable, never as clean
success.

### Decision 20

Pass. The definitive reviewer found the approved public provider seam and
narrow Pi exception seam sufficient and confirmed all testing-governance
requirements. Focused verification passed 488/488 tests across 13 files,
including 234/234 tests at the approved impl-07 seams. Success, timeout,
unavailable, duplicate, late-callback, and idle/no-wait outcomes are covered.
No actionable testing-governance finding remains.

### Scope and standards

Pass. The implementation remains session-scoped, preserves configured
coding-agent tools, does not absorb impl-08 or impl-09, centralizes disable
terminal planning, and retains deterministic, journal-first, exactly-once
terminal behavior. The candidate diff is scoped and `git diff --check` is
clean.

## Evidence

- Definitive independent feature-level review: `PASS WITH GAPS`.
- Every impl-07 ticket checkbox, AC1, AC2, governing standard, scope check,
  testing-governance requirement, and historical finding was reported
  `PASS` or `CLOSED`.
- No actionable reviewer finding remains.
- Fresh focused run: 488/488 tests passed across 13 files.
- Approved impl-07 seam: 234/234 tests passed.
- Workspace lint completed with zero errors and 425 warnings.
- `git diff --check` passed.
- Workspace typechecking reports only seven documented pre-existing baseline
  errors; no impl-07-introduced type error remains.
- One complete server-suite run reported 27 failed, 3851 passed, and 16 skipped.
  All reported failures were in files outside the impl-07 change surface.
- A captured baseline rerun stalled, so exact one-for-one baseline equivalence
  of all full-suite failures was not re-proven.
- `bun fmt` produced sweeping outside-scope changes; those changes were
  reverted, preserving the scoped candidate diff.

## Treatment of baseline verification gaps

The seven workspace typecheck errors are documented pre-existing baseline
errors. They do not occur because of impl-07, and all impl-07-introduced
typecheck errors were resolved.

The full server suite completed once but contained 27 failures outside the
impl-07 surface. The attempted captured baseline rerun stalled, so exact
baseline equivalence for every failure remains unproven. This lowers confidence
in the workspace baseline but does not contradict the focused impl-07 evidence:
488 focused tests pass, all approved seams pass, no impl-07 file appears among
the captured failures, and the definitive reviewer found no actionable issue.

Consistent with Decision 23, unrelated baseline defects or a stalled baseline
rerun do not by themselves reject a candidate whose scoped behavior and failure
surfaces are affirmatively verified. These gaps are therefore accepted as
residual workspace risk, not as unresolved impl-07 findings.

## Rejected alternatives

- Rejecting solely because workspace typecheck remains non-zero.
- Rejecting solely because exact full-suite baseline equivalence was not
  completed.
- Treating `PASS WITH GAPS` as conditional acceptance.
- Requiring unrelated workspace failures to be repaired in impl-07.
- Accepting timeout or uncertain cleanup as dormant success.
- Aborting the complete Pi turn during disable.
- Reopening Decisions 13, 14, 20, or prerequisite final acceptances without
  decision-changing evidence.
- Absorbing impl-08 fan-out/wait-set or impl-09 restart-recovery behavior.

## Assumptions

- The focused 488/488 run was executed against `fe0c6ba7` after the final fixes
  and after reverting unrelated formatting changes.
- No unreported source mutation exists between the reviewed HEAD and the
  candidate accepted here.
- The seven typecheck errors are the same documented pre-existing baseline
  errors described in the ticket and Decision 23.

## Residual uncertainty

Workspace-wide health is not fully green: seven pre-existing typecheck errors
remain, 27 failures occurred in the completed server-suite run, and exact
baseline equivalence of all those failures was not established because the
captured baseline rerun stalled.

This uncertainty is accepted only as existing workspace-baseline risk. It does
not authorize ignoring a future failure that implicates the impl-07 surface or
one of its accepted invariants.

## Downstream effect

impl-07 is complete and may be treated as an accepted prerequisite by dependent
tickets. Downstream work may rely on its per-session disable fence, exact-turn
retirement, bounded cancellation and drainage, post-drain revocation,
safe-boundary reconciliation, exactly-once structured settlement, fail-closed
unavailable state, public provider boundary, and journal-first terminal
consistency.

## Failure and rollback implications

If later evidence invalidates an accepted invariant, dependent work must stop
relying on impl-07 acceptance until a recorded Reassessment is completed.
Rollback, if required, must preserve desired-disabled state and fail closed; it
must not restore stale authority, replay cancelled calls, report uncertain
cleanup as success, or abort unrelated Pi turn work.

## Reopening conditions

Reopen this decision if material new evidence shows any of the following:

- A call can be admitted after the disable fence begins.
- Disable retires or drains the wrong turn, or credentials can be revoked before
  the exact-turn drainage barrier settles outside the accepted timeout path.
- An affected execution receives zero or multiple settlements, or receives a
  result other than the required structured `synara_mcp_disabled` error.
- A late callback can mutate state, emit another result, or bind to a later
  turn or runtime generation.
- A cancelled MCP call can be replayed or retried automatically.
- Disable calls `session.abort()` or otherwise prevents the Pi turn from
  continuing with non-MCP coding-agent tools.
- Timeout, cleanup failure, or reload failure can be reported as clean dormant
  success.
- Revoked credentials, transport, catalog, registrations, callbacks, caches,
  or generation-bound state survive disable.
- Runtime reconciliation can hot-swap the tool surface at an unsafe point.
- Idle/no-wait disable can settle the durable operation before the provider
  outcome, produce inconsistent operation/activity terminals, or violate
  exactly-once journaling.
- Later verification attributes a workspace failure to the impl-07 change
  surface or contradicts the focused 488/488 evidence.
- The reviewed candidate is shown not to match `fe0c6ba7`.

## Superseded records

None.
