# Decision 0001 — Final acceptance

Date: 2026-08-17

State: accepted

## Project

Synara Antigravity terminal-answer recovery.

## Question

Does the scoped Antigravity/main change set based on parent commit `f05bb5a0`
satisfy the accepted contract and remediate the independent review
sufficiently for final acceptance?

## Trigger

Final acceptance: the project's single Project Supervisor consultation.

## Candidate

Parent commit `f05bb5a03aeaf0fd263da863939981514e80e861`
plus the changes committed with this decision to:

- `apps/server/src/main.ts`
- `apps/server/src/main.test.ts`
- `apps/server/src/provider/Layers/AntigravityAdapter.ts`
- `apps/server/src/provider/Layers/AntigravityAdapter.test.ts`

## Governing references

- `../PROJECT.md` is the project router.
- `../HANDOFF.md` controls precedence rules, implementation boundaries,
  non-goals, and handoff constraints; it wins over `../SPEC.md` on conflict.
- `../SPEC.md` AC-01 through AC-18 are otherwise normative.

## Evidence

- Current scoped source and tests.
- The one independent feature-level review, which returned
  `CHANGES_REQUIRED` against the pre-remediation candidate; its six findings
  are durably summarized below and in `../POST_REVIEW_EVIDENCE.md`.
- `../POST_REVIEW_EVIDENCE.md`, which maps all six review findings to current
  source and deterministic regressions.
- Final combined verification: five files, 147/147 tests passed.
- Final server typecheck: nonzero only in concurrent Pi-subagent files, with
  no diagnostic in the four scoped files.
- Scoped `git diff --check`: passed.

## Reviewer reconciliation

All six contrary findings are remediated:

1. Watchdog, Stop-hook, process-error, and interrupt install an owned cleanup
   fence before terminal settlement can reopen admission.
2. Session Stop that loses to a watchdog claimant joins settlement without a
   second teardown; close performs the single managed reap.
3. Stop-hook settlement performs an ownership- and revision-checked final
   transcript drain before the terminal event.
4. Preparation cleanup records Stop intent, makes one final bounded attempt,
   and never re-arms after Stop.
5. Replacement teardown-unproven enters quarantine/reap handling and blocks
   replacement admission.
6. Stop-hook teardown-unproven emits cleanup-specific diagnostics and never a
   watchdog-only missing-terminal warning.

## Decision

**ACCEPTED.** AC-01 through AC-18 pass at criterion level. No material
unresolved duplicate-settlement, ownership, admission, cleanup, quarantine,
diagnostic-content, configuration, or regression defect remains.

The earlier independent `CHANGES_REQUIRED` report remains historical
supporting evidence against the superseded pre-remediation candidate; it is
not the current verdict.

## Rejected alternatives

- Retaining `CHANGES_REQUIRED` based on the superseded candidate.
- Requiring a second independent reviewer.
- Treating concurrent Pi-subagent typecheck failures as Antigravity failures.
- Requiring unrelated full-workspace repair.
- Accepting with an unresolved material condition.

## Assumptions

The 147/147 result and four-file candidate scope accurately describe the
verified working tree, and no writer altered those files after final
verification.

## Residual uncertainty

- No live intermittent `agy 1.1.13` wedge replay or current full-server-suite
  result.
- Numeric grace parsing accepts some alternate JavaScript number forms.
- CLI-version diagnostic metadata is compatibility-labelled rather than
  dynamically discovered.

These do not defeat the HANDOFF acceptance standard. Controlled rollout can
use `shadow`; rollback can set
`SYNARA_ANTIGRAVITY_TERMINAL_RECOVERY_MODE=off`. Quarantine intentionally
blocks admission while process or resource cleanup is unconfirmed.

## Reopening conditions

Reopen on a failing scoped test or scoped typecheck diagnostic; duplicate
assistant or terminal emission; false completion during valid activity;
cross-generation signalling or cleanup; admission while owned cleanup remains
unresolved; leaked process, lease, run directory, timer, or listener;
content-bearing recovery diagnostics; or evidence that the candidate differs
from the verified four-file diff.
