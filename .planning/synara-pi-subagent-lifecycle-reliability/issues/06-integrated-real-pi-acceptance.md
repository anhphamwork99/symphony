# Ticket 06 — integrated real-Pi acceptance

**Status:** ready-for-agent — sole project frontier; Decision 0009 correction
route persisted; no new candidate or fresh D/R PASS exists
**Dependencies:** Tickets 01–05 accepted. [Decision 0008](../decisions/0008-reassessment-live-control-post-await-retirement-classification.md)
remains aspect-scoped **Authoritative** for post-await same-registration
classification. [Decision 0007](../decisions/0007-ticket-06-batching-fixture-causal-control-and-candidate-rebaseline.md)
remains authoritative only for its historical fixture/rebaseline aspects.
[Decision 0009](../decisions/0009-reassessment-structured-provider-unavailable-preservation.md)
is aspect-scoped **Authoritative** for the bounded correction and rebaseline
route; it is not final acceptance.
**Plan:** [`../plans/06-integrated-real-pi-acceptance/PLAN.md`](../plans/06-integrated-real-pi-acceptance/PLAN.md)
**Historical candidate2:** `2afef48b008527685658801d8f0d84c79e24827d`, the
sole-parent child of `ffd45bd`; it is not new-candidate proof.
**Final numbering:** the eventual Ticket 06 final Supervisor acceptance is
Decision **0010**, not Decision 0009.
**Historical only:** `12fd6686edc26a3fa0382e8bdeb83a1be8045539`, `ffd45bd`,
the old WP-01/WP-02 records, and merge
`44249d81c49172e192dcf0f09ddfadc702a4b34c` as integration provenance.
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

1. **Correction and freeze:** create one exact four-file correction child of
   candidate2 and record its SHA and sole-parent proof. The total distinct
   candidate delta from `12fd6686` must be exactly six paths.
2. **WP-01:** after freeze, rerun the unchanged closed 19-file deterministic
   set exactly once and record the actual producer file/test count. Candidate2's
   historical `303/303` is supporting only; do not broaden the set.
3. **WP-02:** only after the fresh WP-01 PASS, run exactly one complete fresh
   five-file non-destructive real-Pi attempt, serially, with no retry.
4. Fresh owner authorization for WP-03 manual destructive evidence, then fresh
   owner authorization for WP-04 quality/report evidence after WP-03 PASS.
5. WP-05 exactly one integrated review, then WP-06 exactly one final Supervisor
   consultation persisted as Decision 0010, followed by WP-07 closure/routing.

The focused containment red/green logs are preserved implementation evidence,
not current WP-01 D evidence or WP-02 R evidence:

- red: 24 tests, 6 failed / 18 passed, exit 1, SHA-256
  `665e0bbaf0a9a25d1908c9767d2bd7ff2947d4e1844a6df80d84622300b16e3b`;
- green: 24/24, exit 0, SHA-256
  `84feb4814b891ce69472c74dd5596f04c9bf753fa65de18c7d31b352dd95f43b`.

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
