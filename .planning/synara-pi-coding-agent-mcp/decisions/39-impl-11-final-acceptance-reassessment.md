# Decision 39: impl-11 final-acceptance reassessment

**Status:** Binding — Accepted
**Date:** 2026-08-15
**Identifier:** `synara-pi-mcp-decision-39`
**Trigger:** Final-acceptance Reassessment
**Supersedes:** `synara-pi-mcp-decision-38` final-acceptance rejection

## Question

Does the newly owner-authorized bundled completion-gate evidence satisfy Decision
38's reopening conditions and permit final acceptance of impl-11?

## Governing references

- Authoritative: `.planning/synara-pi-coding-agent-mcp/PROJECT.md` — project
  routing and standing boundaries.
- Authoritative: `.planning/synara-pi-coding-agent-mcp/spec.md` — normative
  paired-measurement and no-hidden-overhead requirements.
- Authoritative:
  `.planning/synara-pi-coding-agent-mcp/issues/impl-11-token-overhead-measurement.md`
  — impl-11 scope, AC1/AC2, and approved seams.
- Authoritative:
  `.planning/synara-pi-coding-agent-mcp/decisions/20-testing-strategy-governance.md`
  — test and completion-check execution governance.
- Authoritative:
  `.planning/synara-pi-coding-agent-mcp/decisions/31-formatter-gate-semantics.md`
  — formatter pass and unrelated-drift treatment.
- Authoritative:
  `.planning/synara-pi-coding-agent-mcp/decisions/34-impl-11-measurement-contract.md`
  — measurement and acceptance contract.
- Authoritative:
  `.planning/synara-pi-coding-agent-mcp/decisions/35-impl-11-effective-catalog-observer-reassessment.md`
  — accepted observer scope and constraints.
- Authoritative:
  `.planning/synara-pi-coding-agent-mcp/decisions/38-impl-11-final-acceptance.md`
  — prior binding rejection and reopening conditions.
- Supporting: exact current-session bundled completion-gate evidence and clean
  candidate evidence supplied for this reassessment.
- Supporting: the feature-level reviewer and functional evidence already
  evaluated and accepted by Decision 38.

## Evaluated candidate

- Final candidate HEAD: `11c9c86ca1fc1ea2f675d6fb9264eadf8c116428`
  (`11c9c86c`).
- Worktree state after formatter-drift reversal: clean.
- The worktree Git metadata directly identifies HEAD as
  `11c9c86ca1fc1ea2f675d6fb9264eadf8c116428`.
- The supplied exact current-session `git status --short --branch` evidence
  reports the candidate clean at `11c9c86c`.
- Decision identifier 39 is the next available identifier; the decisions
  directory ends at Decision 38 before persistence of this record.
- All governing records referenced above exist and were reread for this
  reassessment.

## Evidence

Decision 38 rejected impl-11 solely because no successful `bun fmt` and
`bun lint` evidence had been supplied. It found no blocking implementation
defect and already accepted the following evidence:

- AC1 and AC2 passed.
- The Decision 34 measurement contract passed.
- The Decision 35 observer contract passed.
- The independent feature-level reviewer found no blocking implementation
  defect.
- All three modes completed three valid repetitions, with two measured turns
  per repetition.
- All 18 measured turns reconciled and cross-checked successfully.
- Effective manifests were complete and stable.
- Configuration equivalence and publication sanitization were evidenced.
- The optimization recommendation remained non-binding.
- Root tests, focused verification, report scans, publication safety, scope,
  and review-finding closure passed.

The owner subsequently explicitly authorized the required bundled
completion-gate execution in the current conversation. Against clean candidate
HEAD `11c9c86c`, the main session ran:

`PATH="$HOME/.bun/bin:$PATH" bun fmt && bun lint && bun typecheck`

Results:

- `bun fmt`: exit 0.
- `bun lint`: exit 0, with 459 warnings and 0 errors.
- `bun typecheck`: exit 0; 7/7 packages successful.
- Because the commands were joined with `&&`, all three commands completed
  successfully in order.
- `bun fmt` produced unrelated formatter-only drift.
- Consistent with Decisions 31 and 38, all unrelated formatter-only drift was
  reversed rather than absorbed into impl-11.
- The resulting worktree was clean at candidate HEAD `11c9c86c`.
- No unreviewed material source change was introduced by the completion-gate
  run.

The 459 lint warnings are non-blocking under the actual lint command contract
because the command completed with exit status 0 and reported zero errors. No
governing record establishes warning-free lint as an additional acceptance
condition.

## Criterion verdict

- AC1 — controlled paired measurement: pass.
- AC2 — token-accounting snapshot and reconciliation: pass.
- Decision 34 measurement contract: pass.
- Decision 35 effective-catalog observer contract: pass.
- Testing Strategy Governance Decision 20: pass.
- Formatter gate under Decision 31: pass.
- Lint completion gate: pass.
- Typecheck completion gate: pass, 7/7 packages.
- Publication safety: pass.
- Observer non-interference: pass.
- Review-finding closure: pass.
- Ticket scope and approved seams: pass.
- Candidate attribution: pass at `11c9c86c`.
- Worktree cleanliness after formatter-drift reversal: pass.
- Repository completion verification: pass.
- Decision 38 reopening conditions: satisfied.

## Reassessment and settled verdict

Decision 38's rejection is superseded.

impl-11 is finally accepted at candidate
`11c9c86ca1fc1ea2f675d6fb9264eadf8c116428`.

The only deficiency identified by Decision 38—missing successful formatter and
lint evidence—has been cured through an explicitly owner-authorized bundled
completion-gate run. The commands passed, and their execution introduced no
retained or unreviewed source change.

Decisions 20, 31, 34, and 35 remain authoritative in their respective scopes.
This reassessment changes only Decision 38's final-acceptance verdict from
rejected to accepted. It does not reopen or alter impl-11's scope, measurement
seams, accounting contract, observer authorization, or owner-approved
non-goals.

## Formatter-drift treatment

The formatter's unrelated output is not part of the accepted impl-11
candidate.

Under Decision 31:

- `bun fmt` passed because it completed with exit status 0.
- A zero-diff state immediately after the mutating command was not an
  additional pass condition.
- Unrelated formatter-only drift was correctly reversed.
- No repository-wide normalization is authorized or accepted through impl-11.
- The final clean state at unchanged candidate HEAD `11c9c86c` confirms that
  the formatter run did not create a new source candidate requiring reviewer
  or functional-evidence refresh.

## Rejected alternatives

- Keeping Decision 38's rejection after its sole missing gate evidence has been
  supplied successfully.
- Treating 459 warnings and zero errors from a successful lint command as an
  invented warning-free completion requirement.
- Rejecting formatter evidence because the mutating formatter initially
  produced unrelated drift, contrary to Decision 31.
- Absorbing unrelated formatter drift into the accepted candidate.
- Requiring a second initial final-acceptance consultation after Decision 38
  expressly authorized reassessment.
- Reopening AC1, AC2, approved seams, measurement policy, observer scope, or
  non-material residuals without new contradictory evidence.
- Inventing a numeric overhead budget or authorizing compaction,
  artifact-backed output, or accounting changes.

## Assumptions

- The supplied current-session command results are exact and attributable to
  candidate `11c9c86c`.
- The reported clean `git status --short --branch` was obtained after all
  formatter-only drift was reversed.
- Reversal affected only formatter-produced unrelated drift and did not conceal
  a functional or syntactic defect inside impl-11's authorized surface.
- The earlier feature-level reviewer and functional evidence accepted by
  Decision 38 remain attributable and have not been invalidated by any retained
  source change.
- The lint command's zero exit status and zero-error result represent success
  under the repository's configured lint contract.

## Residual uncertainty

The non-blocking residuals recorded by Decision 38 remain disclosed:

- Activated `activationDetail` serializes as `[object Object]`; independent
  activation and exposure evidence remains valid.
- Activated turn-one accounting includes the disclosed dormant bootstrap.
- A pre-existing ignored root `.pi` predates the accepted measurement run.
- Observer environment configuration exists only during isolated-child capture
  and is scrubbed afterward.
- Decision 35 retains its assumption that `AgentSession.getAllTools()` is the
  exact model-visible effective catalog.
- The lint run reports 459 warnings. They do not block the configured gate, but
  a separate maintenance effort may address them if independently authorized.

None of these residuals defeats an impl-11 acceptance criterion or the newly
satisfied completion gates.

## Failure and rollback implications

No source rollback is required because the accepted worktree is clean at
unchanged candidate HEAD `11c9c86c`.

If later evidence shows that:

- the bundled checks were not run against this candidate;
- a check actually exited non-zero;
- formatter drift inside impl-11's authorized surface was improperly
  discarded;
- material source changes were retained without review;
- the worktree was not clean after restoration; or
- earlier reviewer or functional evidence was not attributable to the accepted
  candidate,

this acceptance must be reopened and the affected evidence refreshed
proportionately.

## Downstream effect

- impl-11 may be changed from `implemented-awaiting-final-acceptance` to an
  accepted/completed ticket state.
- Candidate `11c9c86c` is the accepted impl-11 source HEAD.
- impl-11's dependency edge into
  `.planning/synara-pi-coding-agent-mcp/issues/impl-12-integrated-verification.md`
  is discharged.
- impl-12 remains `ready-for-agent`; this decision removes only its impl-11
  blocker and makes no finding about whether its impl-01 through impl-10
  dependencies are otherwise satisfied.
- Dependent work may proceed only after the main agent persists this Decision
  Record under `.planning/synara-pi-coding-agent-mcp/decisions/`, confirms it
  exists and is tracked, and cites it as an aspect-scoped Authoritative
  reference.
- No optimization, compaction, artifact-backed output, accounting change, new
  budget, public catalog API, or expansion of observer scope is authorized.

## Reopening conditions

Reassess this acceptance if material new evidence shows that:

- candidate identity or worktree cleanliness was misstated;
- any bundled completion command was unauthorized, did not execute against
  `11c9c86c`, or exited non-zero;
- formatter-only reversal concealed a defect or discarded an authorized impl-11
  source change;
- retained material source changes lack feature-level review or functional
  verification;
- report-source equivalence, reviewer coverage, test attribution, publication
  safety, observer non-interference, catalog completeness, or accounting
  reconciliation is invalidated;
- `AgentSession.getAllTools()` is shown not to represent the complete
  model-visible catalog;
- a governing completion, measurement, accounting, or publication policy
  materially changes; or
- the owner changes impl-11's accepted scope or risk boundaries.
