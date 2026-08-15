# Decision 41: Upstream feature integration final acceptance

**Status:** Binding — Accepted
**Date:** 2026-08-16
**Identifier:** `synara-pi-mcp-decision-41`
**Trigger:** Final acceptance (the only final acceptance invocation for this ticket)
**Supersedes:** None.

## Question

Does the integration of owner-approved upstream feature groups #641, #632,
#631, #648, #652, #659, #667, #670+0e477deb, #608, #680, #682, #683 (range
`c0034fda..50e45cc5`) at candidate `50e45cc572b268a9c3be22c43c197c549a1867de`
satisfy the accepted Project Contract — Pi/MCP boundaries intact, no migration
changes, non-goals #642/#666/#676/#655 excluded — despite (a) four graph-heavy
browser suites failing to dynamically import before tests, and (b)
`migrations:check` failing on fork-vs-upstream lineage at id 90?

## Governing references

- Authoritative: `.planning/synara-pi-coding-agent-mcp/PROJECT.md`.
- Authoritative: commit range `c0034fda..50e45cc5`.
- Authoritative: owner-approved feature list in the current request.
- Authoritative: `AGENTS.md` completion gates; Decisions 20 and 31.
- Supporting: the exactly-one independent feature-level reviewer package
  (PASS WITH GAPS, confidence medium-high, no blocker/high-risk semantic
  defect, web typecheck reproduced exit 0).

## Evaluated candidate and evidence

- Candidate HEAD verified in worktree: `50e45cc572b268a9c3be22c43c197c549a1867de`.
- Migrations registry in candidate ends at local `090_ProjectMcpActivation`;
  no upstream 090–096 entries — consistent with "no migration changes".
- Pi/MCP boundary modules intact: stable fail-closed refusal message,
  dormant extension, enable/disable/recovery paths, PiAdapter layers/services.
- Upstream/integrated union 133/133 files verified before one corrective
  test commit; provider-usage corrective test 3/3.
- Focused server 531, web 437, contracts/shared 33 pass.
- Full `bun run test` 8/8 (server 4,155 pass / 17 environment-gated skips).
- Lint exit 0 / 0 errors; final typecheck 7/7.
- `bun fmt` exits 0 but would rewrite pre-existing local Pi files; output
  not committed (Decision 31 precedent), candidate left clean.
- Unrelated unstaged Antigravity changes in the shared checkout are excluded
  from the candidate.

## Criterion verdicts

| Criterion | Verdict | Basis |
|---|---|---|
| Owner-approved 12-group scope integrated; non-goals excluded | pass | Union verification; local confirmation that migration-bearing non-goals' artifacts are absent. |
| No migration changes | pass | Candidate registry ends at local 090; no upstream 090–096. |
| Pi/MCP boundaries preserved (tool boundary, opt-in MCP, refusal close, lifecycle, authority) | pass | Boundary modules verified present; full server suite green with +40 tests vs impl-12 baseline. |
| Completion gates (test/lint/typecheck; formatter per Decision 31) | pass | 8/8 tasks, 0 lint errors, 7/7 typecheck; formatter excluded under Decision 31. |
| Reviewer evidence precondition | pass | Exactly one independent feature-level reviewer, ticket-level evidence, no blockers. |
| Browser-runner suites (4 graph-heavy) | non-blocking gap | Pre-test dynamic-import failure, zero assertion failures, harness provably works (ChatMarkdown passes), node-level web coverage and typecheck compensate; no governing criterion breached. |
| `migrations:check` | non-blocking gap | Pre-existing fork-level lineage divergence at id 90 exposed by fetched upstream v0.7.2 tag; zero migration entries in candidate; no DB-impacting change introduced. |

## Decision

The upstream feature integration is accepted at candidate
`50e45cc572b268a9c3be22c43c197c549a1867de`.

No product scope, Pi/MCP boundary, production behavior, or testing seam is
changed by this acceptance. The two gaps are classified non-blocking for this
ticket with recorded obligations.

## Rejected alternatives

- Rejecting for the browser gap: stricter than any governing criterion; no
  defect is evidenced and the failure mode is pre-test module load.
- Rejecting for `migrations:check`: the failure is fork-lineage, pre-existing,
  and outside owner-approved scope; acceptance adds no lineage change.
- Silently accepting without recording the gaps: would lose the reassessment
  anchor for both residual risks.
- Conditional acceptance, or a second reviewer: violates the exactly-one
  reviewer invocation and the no-conditional-acceptance precedent.

## Assumptions and residual uncertainty

- The 133/133 union mapping (file ↔ PR attribution) and numeric verification
  counts are as reported by the main/verification environment; the final
  acceptance independently confirmed candidate identity, migration registry,
  and Pi/MCP boundary-module presence.
- Exact root cause of the four browser suites is not yet established;
  classification rests on the observed pre-test dynamic-import failure.
- The four suites' surfaces are covered by node-level suites; should that
  coverage claim fail, the browser gap becomes material.

## Downstream effect

- The upstream-integration ticket advances to accepted at the candidate SHA.
- Follow-up obligations:
  1. Make the four browser suites load and root-cause the import failure.
  2. Before integrating any migration-bearing upstream PR (#642/#655/#666/#676
     or successors), obtain an owner-approved migration-lineage mapping; do
     not paper over the failing diagnostic.
- No source rollback or additional acceptance evidence is required for this
  ticket.

## Reopening conditions

Reassess this acceptance if material evidence shows that:

- candidate identity, scope attribution, or gate results were misstated;
- any focused/full-suite/lint/typecheck command actually failed;
- a browser-only behavioral defect is found in any of the four unverified
  suites' surfaces attributable to the integrated changes;
- node-level coverage of those surfaces proves insufficient;
- the candidate is later found to include migration changes or any non-goal
  artifacts;
- a Pi/MCP boundary test (fail-closed refusal, dormant default, activation,
  disable-cancellation, rollback) fails on this candidate; or
- the owner changes ticket scope, gates, acceptance standards, or accepted
  risk.
