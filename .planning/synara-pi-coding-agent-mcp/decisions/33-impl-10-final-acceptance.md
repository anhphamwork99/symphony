# Decision 33: Final acceptance of impl-10 MCP activity UI

**Status:** Rejected — implementation criteria satisfied, repository completion gate unresolved
**Trigger:** Final acceptance
**Date:** 2026-08-14

## Question

May source candidate commit `6b132f83` be finally accepted for impl-10 despite
the focused and web verification passes, the independent reviewer's
`PASS WITH EXTERNAL BLOCKER`, the red root test suite, the unauthorized and
unrun `bun fmt`/`bun lint`/`bun typecheck` heavy checks, and the missing UI
screenshots?

## Governing references

Authoritative:

- `../PROJECT.md`
- `../issues/impl-10-mcp-activity-ui.md`
- `../spec.md`
- `12-mcp-command-activity-contract.md`
- `20-testing-strategy-governance.md`
- Repository completion requirements in `../../../AGENTS.md`

Supporting:

- `../issues/impl-05-mcp-command-and-acknowledgement.md`
- Fixed-point-to-candidate diff `f021e84b..6b132f83`.
- One independent reviewer package.
- `../../../CONTRIBUTING.md`

## Evidence scope

The candidate is exact source candidate commit `6b132f83`, one commit ahead of
fixed point `f021e84b`, with a clean working tree. Its diff contains exactly
four web files: `apps/web/src/storeEventReducer.test.ts`,
`apps/web/src/storeTestFixtures.ts`, `apps/web/src/workLog.test.ts`, and
`apps/web/src/workLog.ts`. No server or packages files are touched.

The supplied verification is:

- focused worker plus independent reviewer runs: 150/150 passed;
- web suite: 298 files, 3796/3796 passed;
- root suite: 7/8 packages, with `apps/server` 27 failed, 3936 passed, and 16
  skipped;
- the identical failure names reproduce at the fixed point `f021e84b`, with a
  missing `McpSessionAuthority`/runtime receipt and no server or packages diff
  between the fixed point and the candidate; and
- no `bun fmt`, `bun lint`, or `bun typecheck` result was produced: those
  checks were not run because the owner did not authorize them in this
  conversation.

The candidate behavior evidence shows that the work log retains all three MCP
acknowledgement kinds with `turnId: null`; live and replayed snapshots render
equivalently; pending and terminal activities remain distinct rows; MCP failure
detail is sanitized and bounded to 1 KiB UTF-8; unrelated work-log detail is
unchanged; MCP acknowledgements are excluded from sidebar summaries and
pending-interaction state; and malformed or unknown activity data fails safely
without corrupting unrelated work-log state.

## Criterion-by-criterion assessment

| Criterion                                                                          | Verdict                                                              |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Retain all MCP acknowledgement kinds even with `turnId: null`                      | Satisfied                                                            |
| Live events and replayed snapshots render equivalently                             | Satisfied                                                            |
| Safe failure detail renders as a system/work row, never assistant content          | Satisfied                                                            |
| MCP acknowledgements excluded from sidebar summaries and pending-interaction state | Satisfied                                                            |
| Decision 12 activity-contract and Decision 20 testing-strategy seams               | Satisfied                                                            |
| Independent review                                                                 | Satisfied (PASS with external blocker)                               |
| Root test suite                                                                    | Not satisfied — `apps/server` 27 failed at candidate and fixed point |
| `bun fmt`, `bun lint`, `bun typecheck`                                             | Not satisfied — no owner authorization and no passing evidence       |
| UI screenshots                                                                     | Affect PR readiness only; required before PR handoff                 |

## Decision

Reject final acceptance of impl-10 at exact source candidate commit `6b132f83`.

This is explicitly an acceptance-gate rejection, not a finding that the
impl-10 source or behavior is defective. The implementation criteria,
Decision 12/20 seams, and independent review are satisfied.

The `apps/server` failures are external and pre-existing: the identical
failure names reproduce at the fixed point `f021e84b` with no server or
packages diff, and the missing `McpSessionAuthority`/runtime receipt sits
outside the candidate's four web files. They do not, however, waive the
green-root requirement for final acceptance. They must be tracked and fixed
separately and must not be folded into impl-10.

The heavy checks (`bun fmt`, `bun lint`, `bun typecheck`) were correctly not
run without owner authorization, but their passing evidence is still required
for the repository completion gate. UI screenshots are not a source defect;
they are required before PR handoff.

## Rejected alternatives

- Implicitly waiving the repository completion gate.
- Accepting the candidate with unresolved completion evidence.
- Blaming impl-10 for the pre-existing server defect.
- Running the heavyweight checks without owner authorization.
- Treating the missing screenshots as a source defect.
- Expanding impl-10 to repair the server.

## Assumptions

- The supplied branch, fixed point `f021e84b`, candidate `6b132f83`, clean-tree
  identity, and four-file diff are accurate.
- All reported verification results refer to exact candidate commit `6b132f83`.
- The identical root-suite failure names reproduced at the fixed point belong
  to the same external, pre-existing server state.
- The independent reviewer package examined the complete integrated impl-10
  candidate and is independent of its implementation.

## Residual uncertainty

The heavy checks remain unexecuted, so formatter, lint, and typecheck
conformance at `6b132f83` is unknown. The root-suite server failures are
reproduced and external to the candidate surface, but their root cause and
remediation are not part of this record.

## Downstream effect

- Persist and track this record as
  `.planning/synara-pi-coding-agent-mcp/decisions/33-impl-10-final-acceptance.md`.
- Update the impl-10 ticket: status
  `implementation-verified-final-acceptance-blocked`, all four technical
  criteria checked, and an `## Implementation evidence` section linking this
  decision, candidate commit `6b132f83`, the focused 150/150 pass, and the web
  3796/3796 pass, stating that final acceptance is blocked by root/server
  failures and missing authorized heavyweight-check evidence.
- Do not represent impl-10 as done or accepted.
- Do not change any source, test, or configuration files.
- Track and fix the external `apps/server` suite failures separately, outside
  impl-10 scope.
- Obtain UI screenshots before PR handoff.

## Failure or rollback implications

This rejection authorizes no source change, rollback, or history rewrite. It
only prevents the reviewed candidate from receiving final acceptance under the
current evidence package. If the candidate is changed, it becomes a new
candidate requiring proportionate re-verification.

## Reopening conditions

Reassess this rejection — and any later acceptance must be a Reassessment of
this Decision 33 — if:

- a fresh green root suite passes;
- the owner explicitly authorizes and all of `bun fmt`, `bun lint`, and
  `bun typecheck` pass together;
- candidate changes receive verification proportionate to their changed
  surface;
- UI screenshots are produced before PR handoff; or
- any governing evidence used by this decision is shown to be contradictory or
  inaccurate.

## Superseded records

None.

Decision 12 (activity contract), Decision 20 (testing strategy), and the
impl-05 supporting evidence remain authoritative and are not reopened or
superseded by this rejection.
