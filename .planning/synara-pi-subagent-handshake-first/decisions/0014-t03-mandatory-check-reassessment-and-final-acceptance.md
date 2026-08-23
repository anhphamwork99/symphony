# Decision 0014 — Ticket 03 mandatory-check reassessment and final acceptance

- **Date:** 2026-08-23
- **Status:** Accepted — binding reassessment
- **Semantic outcome:** Reassessment
- **Prior record:** Decision 0013
- **Consultation history:** Decision 0013 remains the one and only Ticket-03
  final-acceptance consultation. This record reassesses its rejection after
  satisfaction of its reopening conditions; it is not a second
  final-acceptance consultation.
- **Scope:** Ticket 03, “Present durable execution-card truth,” comprising
  source candidate `236d4119b`, Ticket-03 check remediation `03cfdc8c8`,
  six-file Ticket-01c/02 typecheck remediation `ea2fd5e00`, and
  evidence/report/addendum tip `57e71e1de`.
- **Write set of consultation:** None.
- **Non-scope:** Ticket 04 acceptance; reopening Tickets 01/01b/01c or 02;
  changing the controlled-artifact, authentication, runtime, admission,
  lifecycle, terminal-authority, teardown, or security boundaries; authorizing
  external side effects.

## Question

Do the owner-authorized mandatory-check remediation and independent remediation
addendum satisfy Decision 0013’s reopening conditions and discharge its sole
missing-evidence blocker, allowing Ticket 03 to receive binding final
acceptance without conducting a second final-acceptance consultation?

## Governing references

- Project Home, [PROJECT.md](../PROJECT.md).
- [Decision 0013](0013-t03-final-acceptance-non-acceptance.md), Ticket-03
  final-acceptance non-acceptance.
- [Ticket 03](../issues/03-present-durable-execution-card-truth.md).
- [Handshake-first feature specification](../spec.md).
- [Decision 0011](0011-t01c-final-acceptance.md), Ticket-01c final acceptance.
- [Decision 0012](0012-t02-final-acceptance.md), Ticket-02 final acceptance.
- [Durable-subagents Decision 0001](../../synara-pi-durable-subagents/decisions/0001-testing-strategy-governance.md),
  Testing Strategy Governance.
- [Original Ticket-03 independent review and verification-remediation addendum](../reviews/03-durable-execution-card-truth-review.md).
- Source/remediation commits `236d4119b`, `03cfdc8c8`, and `ea2fd5e00`.
- Persisted evidence/report/addendum tip `57e71e1de`.

## Material new evidence

The owner authorized the mandatory bundled workspace checks that were missing
from Decision 0013.

After Ticket-03 remediation `03cfdc8c8` and the separately authorized six-file
remediation `ea2fd5e00`:

- `bun fmt` exited 0;
- `bun lint` exited 0 with 0 errors and 615 warnings;
- workspace `bun typecheck` passed all 7 packages;
- `scripts` and `apps/server` per-package typechecks each passed with 0 errors.

The six-file remediation eliminated 22 diagnostics reproduced on the pristine
pre-remediation baseline. Independent review separated those semantic edits
from mechanical formatter churn and found them behavior- and
security-equivalent. The edits preserve package versions, lockfiles, manifests,
artifact pins, prompt derivation, fail-close diagnostics, exact artifact
verification, handshake ordering, admission semantics, lifecycle behavior, and
Ticket-03 presentation.

Focused remediation suites passed 21/21, 22/22, 20/20, 20/20, 47/47, 30/30,
and 3/3. Original Ticket-03 evidence remains green at 34/34, 17/17, 40/40,
6/6, and 1/1, with the original independent feature-level AC1–AC5 PASS
unchanged.

## Reassessment

Decision 0013’s rejection is superseded. Its historical consultation and
reasoning remain preserved, including that acceptance was correctly withheld
when no mandatory-check evidence existed.

Decision 0013’s binding AC1–AC5 PASS findings are adopted unchanged and now
constitute Ticket-03 final acceptance:

1. **AC1 — PASS:** card projection includes bounded
   current-attempt/current-generation attachment and teardown evidence from
   existing durable state, with backward-compatible decoding and no migration
   or rewrite.
2. **AC2 — PASS:** `Running in background` requires current detached execution
   with verified durable owner evidence; attached and legacy-null cards remain
   conservative.
3. **AC3 — PASS:** cancellation intent overrides ordinary running
   presentation, while survivor or owner-unproven evidence presents
   non-terminal `Cancellation unverified` without false stop, spinner,
   repeated Cancel, or terminal inference.
4. **AC4 — PASS:** ownerless non-terminal execution presents
   `Outcome unknown (orphaned)`, has no spinner or Cancel action, and exposes
   explicit Resume only.
5. **AC5 — PASS:** terminal and resumed generations do not inherit stale
   attachment or teardown evidence; snapshot, replay, reconnect, strip, and
   details retain one whole-card presentation.

The repository completion gate now passes. Ticket 03 is therefore
**ACCEPTED** at the integrated evidence set `236d4119b` + `03cfdc8c8` +
`ea2fd5e00`, with report/addendum tip `57e71e1de`.

## Formatter caveat

`bun fmt` exits successfully but rewrites unrelated pre-existing files. The
repository’s stated completion requirement is command success, not zero
formatter diff. Only authorized Ticket-03 formatting and the six authorized
semantic remediation files were committed; unrelated formatter churn was
excluded, and the original owner dirty set was restored.

This caveat is non-blocking. It does not authorize unrelated formatting changes
and does not convert pre-existing formatter churn into Ticket-03 scope.

## Contrary wall-clock evidence

The desktop real-Pi wall-clock suite produced 4/6 on the remediated candidate
under load, with AC1+AC3 and AC4 admission-wait timeouts. The pristine baseline
in the same environment produced 3/6, with the same failures plus AC5-bridge.

The independently audited remediation changes no admission path, wait count,
timeout, or lifecycle behavior. The baseline comparison is inconsistent with a
remediation-caused regression and supports pre-existing machine/load
sensitivity. This evidence does not block Ticket-03 acceptance and does not
presently reopen Decision 0012.

A later reproducible causal link between the accepted remediation and
admission, detach, terminal, or bridge failures would be material reopening
evidence.

## Rejected alternatives

1. **Uphold Decision 0013 because the checks were absent from the original
   candidate.** Rejected because Decision 0013 expressly permits reassessment
   against a clearly identified remediated successor.
2. **Require `bun fmt` to produce zero diff.** Rejected because the governing
   repository requirement is successful command exit, and no zero-diff gate is
   established.
3. **Commit all unrelated formatter output.** Rejected because that would
   exceed authorized scope and introduce unnecessary source drift.
4. **Reject because lint reports 615 warnings.** Rejected because lint exited
   0 with zero errors; the warnings are existing diagnostics and are not a
   failed lint gate.
5. **Reject because the desktop wall-clock suite was 4/6.** Rejected because
   the same-environment pristine baseline was worse, failures overlap, and the
   audited changes do not affect admission, waits, timeouts, or lifecycle
   behavior.
6. **Treat the remediation addendum as a second feature review or final
   consultation.** Rejected. It is bounded verification of material
   remediation evidence and leaves the original AC1–AC5 review intact.
7. **Accept Ticket 04 through this reassessment.** Rejected because Ticket 04
   owns separate desktop/server final-composition acceptance.

## Assumptions and residual uncertainty

- The recorded command outputs and commit identities accurately correspond to
  the reviewed remediated successor and evidence tip `57e71e1de`.
- Unrelated formatter rewrites were not committed, and the original owner dirty
  set was restored as reported.
- The 615 lint warnings are non-error existing diagnostics under the
  repository’s configured lint command.
- The desktop wall-clock suite remains sensitive to host load. The current
  baseline comparison is sufficient to reject causal attribution to the
  remediation, but it does not prove the suite will be stable under every
  environment.
- The pre-existing low-risk web upsert-ordering concern and stale test comment
  remain non-blocking.
- No evidence presently contradicts Decision 0013’s AC1–AC5 findings or
  Decisions 0011/0012’s accepted artifact and lifecycle boundaries.

## Preserved boundaries

This reassessment preserves Decisions 0011 and 0012 and all prior
artifact/runtime security constraints, including:

- release-owned, manifest-exact artifact closure;
- no user-global or ambient extension fallback;
- no credentials, model configuration, prompts, paths, or provider details in
  unsafe artifacts or diagnostics;
- fail-close verification and handshake-before-admission;
- journal-first, identity/attempt/generation-fenced terminal authority;
- non-terminal teardown uncertainty;
- no terminal inference from process absence, cancellation dispatch, session
  stop, transcript existence, timeout, or owner-unproven evidence;
- explicit-only orphan Resume;
- no database migration, historical rewrite, or automatic recovery.

## Downstream effect

- Ticket 03 is complete and bindingly accepted.
- Decision 0013’s rejection is superseded, while its consultation history and
  historical finding remain preserved.
- Ticket 04 becomes **ready/unblocked** because its Ticket-03 dependency is now
  satisfied.
- Ticket 04 is **not accepted**, advanced, or deemed verified by this decision.
  It still requires its own complete implementation, evidence, independent
  review, and authorized final acceptance.
- Decisions 0011 and 0012 remain unchanged.
- No external side effect is authorized.

## Non-blocking follow-ups

- Consider a separate web-store ordering guard against a genuinely
  out-of-order old-shape card event.
- Correct the stale strip-test comment when that file is next touched.
- Address unrelated formatter churn through separately authorized repository
  maintenance.
- Improve or isolate the desktop wall-clock suite’s load robustness without
  weakening its acceptance envelope or lifecycle assertions.
- Consider explicit refactor-proof `return unsupported(...)` narrowing during
  a future cleanup.

## Failure and rollback implications

If the mandatory-check evidence is shown to be stale, run against a materially
different tree, or inaccurately reported, this acceptance must be reassessed.

Any rollback or future remediation must preserve backward event decoding,
current execution/attempt/generation fencing, journal-first terminal authority,
post-commit band-77/78 publication, non-terminal teardown uncertainty, orphan
honesty, whole-card precedence, and Decisions 0011/0012’s artifact/runtime
boundaries.

Rollback must never restore ambient extension fallback, weaken exact artifact
verification, expose credentials or provider data, admit work before handshake,
infer terminality from non-terminal evidence, or automatically resume orphaned
work.

## Reopening conditions

Reassess this acceptance only upon material evidence that:

1. any mandatory check did not actually exit successfully against the
   identified remediated successor;
2. the semantic remediation exceeded its authorized files or altered artifact,
   security, handshake, admission, lifecycle, terminal, or Ticket-03 behavior;
3. the original or addendum review provenance, focused test results, or commit
   identities are stale or incorrect;
4. attachment/teardown projection loses execution-, attempt-, or
   generation-fencing;
5. band-77/78 publication can precede durable commit or produce false terminal
   truth;
6. whole-card presentation, orphan controls, snapshot/replay/reconnect
   consistency, or stale-generation suppression regresses;
7. reproducible evidence causally connects the remediation to the desktop
   admission, bridge, detach, lifecycle, or terminal failures;
8. a future owner-approved decision changes the formatting, lint, typecheck,
   artifact, runtime, or acceptance boundary.
