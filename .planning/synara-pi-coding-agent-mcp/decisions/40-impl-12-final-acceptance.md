# Decision 40: impl-12 final acceptance

**Status:** Binding — Accepted
**Date:** 2026-08-15
**Identifier:** `synara-pi-mcp-decision-40`
**Trigger:** Final acceptance
**Supersedes:** None; this is the first impl-12 final-acceptance decision.

## Question

Does complete impl-12 satisfy its approved integrated-flow checklist, AC1/AC2
seams, Decision 20 testing governance, and Decision 31 completion-gate
semantics at candidate `6912d542`, despite the independent reviewer's FAIL?

## Governing references

- Authoritative: `.planning/synara-pi-coding-agent-mcp/PROJECT.md`.
- Authoritative: `.planning/synara-pi-coding-agent-mcp/spec.md`.
- Authoritative:
  `.planning/synara-pi-coding-agent-mcp/issues/impl-12-integrated-verification.md`.
- Authoritative:
  `.planning/synara-pi-coding-agent-mcp/decisions/20-testing-strategy-governance.md`.
- Authoritative:
  `.planning/synara-pi-coding-agent-mcp/decisions/31-formatter-gate-semantics.md`.
- Authoritative:
  `.planning/synara-pi-coding-agent-mcp/decisions/39-impl-11-final-acceptance-reassessment.md`.
- Supporting: the exactly-one independent feature-level reviewer package.
- Supporting: candidate-attributed raw full-suite and bundled-gate logs from
  the dependency-complete main environment.

## Evaluated candidate and evidence

- Candidate HEAD:
  `6912d542483232f54b6a7baded193f92232d742a`.
- Decision 39 accepted source baseline: `11c9c86c`.
- Executable verification source: `5bf3cfad`.
- The only subsequent candidate commit, `6912d542`, changes the normative
  ticket evidence text and does not change executable behavior.
- The candidate worktree was clean and
  `git diff --check 11c9c86c...HEAD` passed.
- The candidate diff contains planning, tests, and harnesses only; no
  production source changed.
- Focused AC1 verification passed 3 files / 9 tests.
- Focused AC2 and reducer/work-log regressions passed 3 files / 151 tests.
- `bun run test` passed 8/8 workspace tasks. The server suite reported 4,115
  passing and 17 environment-gated skips; the web suite reported 3,797
  passing.
- The owner-authorized bundled `bun fmt && bun lint && bun typecheck` gate
  passed. Lint reported 460 warnings and 0 errors; typecheck passed 7/7
  packages.
- Formatter-only unrelated drift was reversed under Decision 31, leaving the
  candidate clean.
- Matt Standards and Spec/testing-governance reviews passed after repair.

## Criterion verdict

| Criterion                                                                        | Verdict | Basis                                                                                                                                                                               |
| -------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dormant default startup has no Synara catalog or MCP activity                    | pass    | The integrated AC1 journey begins dormant, fails MCP admission closed, and observes no activation/catalog activity.                                                                 |
| Enable pending/terminal behavior, all-session success, and subject-bound MCP use | pass    | Multi-session wait-set, durable pending/terminal activities, captured authority, generation binding, successful use, and mismatched/stale failure are covered.                      |
| Disable cancellation preserves Pi-turn continuity and prevents replay            | pass    | Disable occurs during the same deferred turn; fence/settle/revoke/reload ordering, structured disabled settlement, no interrupt, normal turn completion, and no replay are covered. |
| Reconnect/restart recovery and future-session waiting                            | pass    | Future sessions remain outside the immutable wait-set, enabled recreation gets fresh authority, restart recovery is durable, and provider replay is absent.                         |
| Failed sibling activation globally rolls back to disabled                        | pass    | Sibling cleanup, disabled final state, bounded failure detail, and exactly-once terminal evidence are covered.                                                                      |
| Focused smoke and permitted full command                                         | pass    | Focused AC1/AC2 evidence and dependency-complete `bun run test` raw execution passed.                                                                                               |
| AC1 integrated server/WebSocket/Pi boundary                                      | pass    | The approved public orchestration boundary covers lifecycle, authority, cancellation, recovery, and rollback.                                                                       |
| AC2 browser/work-log boundary                                                    | pass    | The approved reducer/work-log boundary proves durable visibility, replay equivalence, dedupe, and no assistant/sidebar/pending-interaction contamination.                           |
| Decision 20 testing governance                                                   | pass    | Tests remain at the owner-approved seams and include representative authority/activation failure, rollback/recovery, and exactly-once terminal evidence.                            |
| Decision 31 formatter semantics                                                  | pass    | `bun fmt` exited 0; unrelated formatter drift was reversed and not committed.                                                                                                       |
| Scope, cleanliness, and attribution                                              | pass    | No production source changed; the clean candidate is executable-equivalent to the verified source.                                                                                  |

## Reviewer-Fail reconciliation

The exactly-one independent feature-level reviewer returned FAIL because its
isolated worktree lacked dependencies (`turbo: command not found`) and it
correctly refused to treat ticket/context summaries as executable proof. The
FAIL is retained as an evidence-availability finding and is not relabelled as a
reviewer pass.

The reviewer directly passed candidate scope and cleanliness, Decision 20 seam
design, and source coverage for every checklist criterion, AC1, and AC2. It
found no behavioral defect.

The dependency-complete raw logs cure the specific evidence-availability gap:
they contain the successful full-suite and bundled-gate executions with the
reported counts. Those runs are attributable to executable source `5bf3cfad`;
candidate `6912d542` adds only normative ticket evidence text. No claim is made
that the reviewer independently reran the commands.

## Decision

impl-12 is unconditionally accepted at candidate
`6912d542483232f54b6a7baded193f92232d742a`.

The accepted implementation proves the complete dormant → enable →
subject-bound use → same-turn disable/cancellation → reconnect/restart →
rollback journey at the approved seams without changing production source.

## Rejected alternatives

- Rejecting solely because the reviewer's isolated environment lacked
  dependencies after candidate-attributed raw execution evidence supplied the
  missing proof.
- Accepting on source inspection alone without dependency-complete runtime and
  completion-gate evidence.
- Requiring a second feature-level reviewer.
- Reopening owner-approved testing seams without material contrary evidence.
- Treating 460 lint warnings or 17 environment-gated skips as command failures.
- Issuing conditional acceptance.

## Assumptions and non-blocking residuals

- The supplied source/candidate SHA relation and clean status are accurate.
- Environment-gated skips do not cover an impl-12 acceptance criterion.
- The reviewer's dependency failure was environmental rather than a failed
  behavior assertion.
- Independent runtime reproduction remains unavailable from the reviewer
  package; the candidate-attributed main-environment logs cure that gap.
- Lint retains 460 warnings and the server suite retains 17
  environment-gated skips.
- Some test-fixture controls are unused and harness cleanup branches repeat;
  these are maintenance smells, not AC1/AC2 defects.

## Downstream effect

- `impl-12` may advance from `implemented-awaiting-final-acceptance` to `done`.
- Accepted candidate/source HEAD:
  `6912d542483232f54b6a7baded193f92232d742a`.
- No source rollback or additional acceptance evidence is required.
- No product scope, production behavior, or testing seam is expanded by this
  decision.

## Reopening conditions

Reassess this acceptance if material evidence shows that:

- candidate identity, cleanliness, or the executable-equivalence relation was
  misstated;
- the candidate diff contains production-source changes;
- raw logs are stale, contradictory, unauthorized, inaccessible, or
  misattributed;
- any focused, full-suite, formatter, lint, or typecheck command actually
  failed;
- checklist, AC1/AC2, Decision 20, or Matt conformance evidence is invalidated;
- the reviewer's environment failure concealed a concrete behavior defect;
- formatter reversal discarded an authorized functional change;
- Decisions 20 or 31 materially change; or
- the owner changes impl-12 scope, seams, acceptance standards, or accepted
  risk.
