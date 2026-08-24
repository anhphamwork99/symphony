# Decision — Accept integrated Antigravity background lifecycle

Date: 2026-08-24  
Project: `synara-antigravity-background-lifecycle`  
Candidate: `feat/antigravity-background-lifecycle@e9a2426e7a1dbe269f3b77dabc8821915b1d6f41`  
Decision type: Final acceptance  
Verdict: ACCEPTED

## Question

Does the integrated candidate satisfy AC-01 through AC-14 and the approved
scope after reconciling the single independent review's three findings?

## Governing references

- Authoritative:
  `.planning/synara-antigravity-background-lifecycle/PROJECT.md`
- Authoritative: `docs/findings/ANTIGRAVITY-fullyIdle-probe.md`
- Authoritative: integrated source and tests at candidate `e9a2426e7`
- Supporting: `/tmp/antigravity-background-feature-review.md`, reviewing prior
  tip `d07f68b47`
- Supporting: remediation commits `7c3ed9098` and `e9a2426e7`
- Supporting: exact-tip verification supplied to final acceptance

Owner-approved decisions remain: one `agy -p` process per turn; official Stop
`fullyIdle` as aggregate authority; aggregate states limited to
`active | idle | finalizing`; terminal-last and exactly-once settlement;
bounded continuation, deadline, close-wait, and drain; default OFF; no per-job
identity, internal gRPC, stream-json migration, or restart reattachment.

## Evidence

Fresh exact-tip verification passed:

- Antigravity adapter tests: 108/108.
- Lint: zero errors; existing warnings only.
- Typecheck: 7/7 packages.
- Full workspace test: 8/8 Turbo tasks.
- Server unit tests: 400 files passed, 3 skipped; 4,951 tests passed, 17 skipped.
- Standalone wallclock tests: all 15 runs green.
- Web build: green.
- Both remediated files: targeted formatter clean.

Earlier integrated verification passed:

- Contracts: 12/12.
- Server projection and adapter: 121/121.
- Web: 169/169.
- Browser no-scroll scenario: one pass, 95 skipped.
- Workspace format pass before remediation.

Only the two Antigravity adapter files changed after the workspace format pass;
targeted formatting of both completes exact-tip formatting coverage.

## Independent-review finding reconciliation

### Timeout settlement registration

Closed. The stop-idle timer callback stores `settleStopIdleTimeout(...)` in
`context.terminalSettlement` and clears it in `finally` only on identity match.
Deterministic tests cover both background-deadline and close-wait settlement,
require `stopSession` to join while teardown is blocked, exercise re-entrant
close, and assert one terminal, teardown, and cleanup owner.

### Process error while idle is unconfirmed

Closed. The error handler snapshots unconfirmed stop-idle ownership before
clearing it. That state disables legacy output-based success recovery, emits
`background_idle_unconfirmed`, preserves captured output, and settles failed.
The deterministic test also proves re-entrant close cannot duplicate settlement
or cleanup.

### O(file) continuation scan

Closed. The hook uses sanitized official zero-based `executionNum` directly.
Continuation requires an integer, nonnegative value below the cap, making the
decision O(1). Tests prove no `readFileSync`, event-history independence, cap
boundaries, and neutral `{}` for missing or malformed counters.

The review's request for another independent review is rejected because Project
Home authorizes exactly one feature review followed by exactly one Supervisor
final acceptance consultation. Contrary evidence was reconciled here.

## Acceptance-criteria verdict

| Criterion                         | Verdict |
| --------------------------------- | ------- |
| AC-01 Hook contract               | PASS    |
| AC-02 Legacy safety               | PASS    |
| AC-03 Active ownership            | PASS    |
| AC-04 Recovery exclusion          | PASS    |
| AC-05 Idle transition             | PASS    |
| AC-06 Terminal ordering           | PASS    |
| AC-07 Failure honesty             | PASS    |
| AC-08 Cleanup safety              | PASS    |
| AC-09 Cancellation                | PASS    |
| AC-10 Typed aggregate surface     | PASS    |
| AC-11 Web truth                   | PASS    |
| AC-12 Transcript isolation        | PASS    |
| AC-13 Real-provider qualification | PASS    |
| AC-14 Rollback                    | PASS    |

## Binding decision

ACCEPTED.

The candidate at `e9a2426e7a1dbe269f3b77dabc8821915b1d6f41` satisfies
AC-01 through AC-14 and the accepted Project Contract. The three review
findings are closed by committed source and deterministic tests; exact-tip
verification is sufficient and fresh.

The feature may be marked complete. Default-OFF enablement remains unchanged.
Qualified opt-in is limited to the documented `agy` 1.1.19 gate.

## Residual risks

- Qualification covers `agy` 1.1.19 only; the generic health check does not
  enforce that exact floor.
- False Stops can cause repeated model re-entry; cap and deadline bound cost.
- Server restart does not reattach to an inherited `agy` process.
- The feature remains opt-in while production experience accumulates.

These are accepted bounded risks and do not contradict an acceptance criterion.

## Failure and rollback implications

If new evidence shows duplicate/non-final terminal events, unbounded
continuation, incorrect `fullyIdle` authority, duplicate cleanup ownership, or
lifecycle-driven transcript auto-scroll, disable with
`SYNARA_ANTIGRAVITY_STOP_IDLE_LIFECYCLE=0` and reassess. Rollback requires no
data migration.

## Downstream effect

- Marks the integrated feature complete.
- Leaves the feature default OFF.
- Allows qualified opt-in with `agy` 1.1.19.
- Does not authorize per-job lifecycle, internal gRPC, stream-json migration,
  restart reattachment, or default enablement.

## Reopening conditions

Reassess on material evidence that `fullyIdle` semantics differ; terminal
ordering/uniqueness fails; cancellation escapes settlement or duplicates
cleanup; process error before idle can complete; continuation depends on event
file size or exceeds cap/deadline; aggregate activity retriggers auto-follow;
or a governing owner boundary changes.

No prior Decision Record is superseded.
