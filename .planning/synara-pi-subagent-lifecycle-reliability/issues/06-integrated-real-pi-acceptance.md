# Ticket 06 — integrated real-Pi acceptance

**Status:** ready-for-agent — sole project frontier; Decision 0009 candidate
`9b55649050b76feffdc4279ceaec92ac74a78686` frozen; WP-01 ready with `308` as
an estimate only pending the actual producer count; WP-02 blocked; no current
D/R/Q PASS
**Dependencies:** Tickets 01–05 accepted. [Decision 0008](../decisions/0008-reassessment-live-control-post-await-retirement-classification.md)
remains aspect-scoped **Authoritative** for post-await same-registration
classification. [Decision 0007](../decisions/0007-ticket-06-batching-fixture-causal-control-and-candidate-rebaseline.md)
remains authoritative only for its historical fixture/rebaseline aspects.
[Decision 0009](../decisions/0009-reassessment-structured-provider-unavailable-preservation.md)
is aspect-scoped **Authoritative** for the bounded correction and rebaseline
route; it is not final acceptance.
**Plan:** [`../plans/06-integrated-real-pi-acceptance/PLAN.md`](../plans/06-integrated-real-pi-acceptance/PLAN.md)
**Frozen candidate:** `9b55649050b76feffdc4279ceaec92ac74a78686`, the exact
sole-parent child of candidate2; it is the producer identity for the next
route. Candidate2 `2afef48b008527685658801d8f0d84c79e24827d`, the sole-parent
child of `ffd45bd`, remains historical supporting evidence.
**Final numbering:** the eventual Ticket 06 final Supervisor acceptance is
Decision **0010**, not Decision 0009.
**Historical only:** `12fd6686edc26a3fa0382e8bdeb83a1be8045539`, `ffd45bd`,
the old WP-01/WP-02 records, and merge `44249d81c49172e192dcf0f09ddfadc702a4b34c`.
The current integration merge `cecc9d8ae62bd97b9c81be07d0cfb473a9862cc7` has
parents `0e828e0fe5daf273a6a0c04960494756ccdf204e` (planning) and the frozen
candidate; it is integration provenance only.
**Current evidence state:** no current D/R PASS. This planning transaction
runs no producer, test, gate, review, or Supervisor consultation.

## Candidate freeze and exact lineage

- `ffd45bd867e94c9003415f5f2e937cc9c616e399` is the sole-parent child of
  `12fd6686edc26a3fa0382e8bdeb83a1be8045539`.
- Candidate2 `2afef48b008527685658801d8f0d84c79e24827d` is the sole-parent child
  of `ffd45bd` and is the frozen producer identity.
- Candidate2 delta from `ffd45bd`: exactly
  `apps/server/src/provider/piSubagentLiveLifecycleContainment.ts` and
  `apps/server/src/provider/piSubagentLiveLifecycleContainment.test.ts`.
- Candidate2's total delta from `12fd6686` is the two Decision 0007 fixture
  paths plus the two containment paths.
- The new candidate is one exact recorded sole-parent child of candidate2. Its
  correction delta is exactly:

  ```text
  apps/server/src/provider/piSubagentLiveLifecycleContainment.ts
  apps/server/src/provider/piSubagentLiveLifecycleContainment.test.ts
  apps/server/src/provider/piSubagentManagedRuntimeBinding.ts
  apps/server/src/provider/piSubagentCanonicalRouting.test.ts
  ```
- The new candidate's total distinct delta from `12fd6686` is exactly six
  paths: the two fixture paths plus those four correction paths.
- Main integration merge `44249d81c49172e192dcf0f09ddfadc702a4b34c` has parents
  `50853a3b9774e7aa5462916056195ffa536dc491` and candidate2. It is integration
  provenance only; no producer may use the merge as identity.
- Alfie is unchanged and remains pinned at
  `3fe340b401ca86bcbe8b55abd4de107e1d93482e` /
  `@alfie/pi-subagents@0.15.0-alfie.6`.

## Objective

Provide one isolated integrated acceptance candidate proving the project-level
identity, lifecycle, failure, recovery, and control contract against the pinned
real-Pi composition, while preserving the inherited deterministic/manual
boundary for destructive process-tree claims.

## Acceptance criteria

- **T06-AC1:** Pinned controlled Alfie and Symphony composition starts with
  exact provenance and isolated home/state/workspace/ports.
- **T06-AC2:** Public `executionId` remains usable through detached output,
  durable result read, terminal settlement, reconnect, and explicit control.
- **T06-AC3:** Real lifecycle covers progress, terminal-before-cleanup,
  cancellation, watchdog handoff, and truthful diagnostics.
- **T06-AC4:** Restart/reconnect restores terminal/live-owner/orphan truth with
  no automatic replay; explicit Resume is proven or truthfully denied.
- **T06-AC5:** Stale attempt/generation and duplicate delivery/control paths are
  fenced and bounded.
- **T06-AC6:** Destructive cleanup evidence uses the inherited three-leg split:
  real-Pi through handoff, accepted deterministic owner/teardown fixtures, and
  isolated manual real-Pi proof for the zero-owned-child claim only.
- **T06-AC7:** Every stage failure reports stage and stable diagnostic;
  mock-only success is impossible.
- **T06-AC8:** Exactly one integrated feature-level review and exactly one
  Supervisor final acceptance are recorded for the full project.

## Current route

1. **Freeze:** candidate `9b55649050b76feffdc4279ceaec92ac74a78686` is the
   exact four-file correction child of candidate2, with six total paths from
   `12fd6686`; its SHA and sole-parent proof are recorded.
2. **WP-01:** run the unchanged closed 19-file deterministic set exactly once
   and record the actual producer file/test count. Candidate2's actual `303`
   tests plus five focused tests make `308` an estimate only; do not broaden the
   set.
3. **WP-02:** remains blocked until fresh WP-01 PASS; then run exactly one
   complete fresh five-file non-destructive real-Pi attempt, serially, with no
   retry.
4. Fresh owner authorization for WP-03 manual destructive evidence, then fresh
   owner authorization for WP-04 quality/report evidence after WP-03 PASS.
5. WP-05 exactly one integrated review, then WP-06 exactly one final Supervisor
   consultation persisted as Decision 0010, followed by WP-07 closure/routing.

Focused Decision 0009 implementation evidence is copied byte-identically in
four logs, all supporting only (not current D/R/Q acceptance):

- initial red: 2 files, 49 tests, 45 passed / 4 failed, exit 1, SHA-256
  `4285cbdd33f6e4f76cc126133a6589396b8e133aca0522c6fdb1ef087115fbb9`;
- initial green: 2 files, 49/49, exit 0, SHA-256
  `2e22b5879ea1bc16d199e277e8aaa52b334cf81e9fb540841842cc1d4cef5a47`;
- review-conflation red: 2 files, 49 tests, 1 failed, exit 1, SHA-256
  `363e2f7c3297f27a69425a13021cea0ea889cd8ac8161fc42e59a41268f4ffff`;
- final green: 2 files, 50/50, exit 0, SHA-256
  `d9d1f4f351b0e4598b5699c1e5ca5e73919c49a82e39083c8ff964e8f8c106be`.

The pre-freeze review fixed route-inactive conflation and amended the candidate.
Decision 0009's mapping is exact-marker-only: only the exact structured
`pi_subagent_managed_execution_unavailable_live` marker carries internal
`unavailableReason: provider_inactive`; an unaccepted control maps to
`pi_subagent_read_live_record_unavailable`, while observation and generic
route-inactive (`provider_route_inactive`) remain
`pi_subagent_live_lifecycle_unavailable`. Provider text is never parsed and no
accepted effect or public reason is claimed.

A delegated worker also ran heavyweight typecheck/lint and targeted format
validation without user authorization. This is a factual, non-authoritative
incident only: it is not WP-04/Q evidence or a gate, no current quality pass is
claimed, and it was not rerun.

## Testing seams and implementation boundary

Mandatory integrated real-Pi harness; deterministic lower-level fixtures;
accepted isolated manual destructive boundary; exact Alfie provenance manifest;
non-default ports and isolated process ownership; no user live-instance
mutation. Decision 0009 authorizes only the exact four-file correction listed
above: internal `unavailableReason` on unavailable, control
`provider_inactive` mapped to `pi_subagent_read_live_record_unavailable`, while
observation and generic unavailable remain generic. No public reason, applied/
acceptance lie, canonical expectation, configuration, coordinator, contract or
schema, third source/test path, lockfile, or Alfie change is authorized.

## Implementation Report placeholder

- Candidate lineage and exact Symphony/Alfie pins:
- Isolation and composition evidence:
- AC evidence matrix by evidence class:
- Failure/diagnostic stage report:
- Manual destructive run record (if executed):
- Review package link and verdict:
- Supervisor final-acceptance link and verdict:
- Reopening conditions and residual risk:

## Unlock gate

No integrated acceptance may be claimed from deterministic fixtures alone, and
no automated destructive real-Pi claim may replace the approved manual leg.
Ticket 06 cannot close without WP-03's exactly-one authorized manual
destructive run (M evidence), WP-04's fresh Q/report gate, and WP-06's
persisted Decision 0010 acceptance. Old WP-03/WP-04 authorizations remain
non-transferable. The required protected WIP aggregate hash is
`ab8f8f54fe818819721f737aa337156ed6348c7410c55083ce3a67785bb7eaa8`; this
transaction leaves protected owner WIP untouched and unstaged.
