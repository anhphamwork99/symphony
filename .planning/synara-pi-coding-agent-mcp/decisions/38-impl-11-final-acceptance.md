# Decision 38: impl-11 final acceptance

Status: Binding — Rejected
Date: 2026-08-15
Identifier: synara-pi-mcp-decision-38
Trigger: Final acceptance

## Evaluated candidate

- Source: clean HEAD `7bf32b13` on `impl-09-runtime-recovery`
- Measurement source: `62963a448e36cf480e562df9fff3a84733f266e4`
- Accepted source HEAD: none

## Question

May impl-11 be marked accepted based on the complete integrated
implementation, real report, independent reviewer package, and supplied
verification?

## Governing references

- Authoritative: `PROJECT.md`.
- Authoritative: `spec.md`.
- Authoritative:
  `issues/impl-11-token-overhead-measurement.md`.
- Authoritative: `decisions/20-testing-strategy-governance.md`.
- Authoritative: `decisions/31-formatter-gate-semantics.md`.
- Authoritative: `decisions/34-impl-11-measurement-contract.md`.
- Authoritative:
  `decisions/35-impl-11-effective-catalog-observer-reassessment.md`.
- Authoritative: repository completion requirements.

## Evidence

- The required single independent feature-level reviewer returned
  `PASS WITH GAPS` and found no blocking implementation defect.
- The real report completed three modes, three repetitions per mode, and two
  measured turns per repetition.
- Every mode completed 3/3 valid repetitions.
- All 18 measured turns reconciled and cross-checked successfully.
- Effective manifests were complete and stable, configuration equivalence was
  evidenced, publication was sanitized, and the recommendation remained
  non-binding.
- Root typecheck passed 7/7 packages.
- Root tests passed 8/8 tasks with 4,110 passing and 17 environment-gated
  skips.
- Focused verification passed 185 tests with one real-runtime-gated skip.
- Report deep-path and evidence scans passed.
- No `bun fmt` or `bun lint` result was supplied.

## Criterion verdict

- AC1: pass.
- AC2: pass.
- Decision 34: pass.
- Decision 35: pass.
- Testing governance for the authorized and executed tests: pass.
- Publication safety: pass.
- Review-finding closure: pass.
- Scope: pass.
- Repository completion verification: reject solely because successful
  `bun fmt` and `bun lint` evidence is absent.

## Decision

Final acceptance is rejected solely because the mandatory formatter and lint
completion evidence is missing.

Decision 20's no-run-without-explicit-request rule controls execution
authority; it does not waive the completion requirement. Decision 31 confirms
that formatter success is not waived. Tests, typecheck, reviewer approval, a
clean worktree, and report scans cannot establish formatter or lint success.

Explicit owner authorization is required before the bundled final
`bun fmt`, `bun lint`, and `bun typecheck` pass may run.

## Non-blocking residuals

- Activated `activationDetail` serializes as `[object Object]`; independent
  activation and exposure evidence remains valid.
- Activated turn-one accounting includes the disclosed dormant bootstrap.
- A pre-existing ignored root `.pi` predates the accepted measurement run.
- Observer environment configuration exists only during isolated-child
  capture and is scrubbed afterward.
- Decision 35 retains its disclosed assumption that
  `AgentSession.getAllTools()` is the exact model-visible effective catalog.

## Rejected alternatives

- Inferring formatter or lint success from tests, typecheck, reviewer approval,
  or a clean worktree.
- Treating Decision 20's execution restriction as a completion-gate waiver.
- Running prohibited checks without explicit owner authorization.
- Reopening approved seams, inventing a budget, or authorizing optimization
  work to resolve an unrelated verification gap.
- Rejecting the candidate for the disclosed non-material residuals.

## Downstream effect

- Do not mark impl-11 accepted or completed.
- Request explicit owner authorization for the bundled final
  `bun fmt`, `bun lint`, and `bun typecheck` pass.
- If those checks pass against an attributable final candidate and introduce
  no unreviewed material source change, reassess this record. That reassessment
  is not a second initial final-acceptance consultation.
- Formatter-produced unrelated drift must not be committed merely to satisfy
  the gate.
- A non-zero check requires correction and evidence refresh proportionate to
  any resulting change.

## Reopening conditions

Reassess this rejection when:

- explicit owner authorization is granted and the bundled checks pass;
- a final check changes source or reveals a material defect;
- candidate identity, worktree cleanliness, report-source equivalence,
  reviewer coverage, test attribution, publication safety, observer
  non-interference, or accounting reconciliation is invalidated; or
- a governing completion policy materially changes.

No prior record is superseded. Decisions 20, 31, 34, and 35 remain
authoritative in their respective scopes.
