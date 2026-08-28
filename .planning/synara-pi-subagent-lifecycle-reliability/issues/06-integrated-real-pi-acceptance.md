# Ticket 06 — integrated real-Pi acceptance

**Status:** ready-for-agent — sole project frontier; Decision 0008 reassessment
persisted; historical candidate/evidence reset pending implementation
**Dependencies:** Tickets 01–05 accepted. [Decision 0008](../decisions/0008-reassessment-live-control-post-await-retirement-classification.md)
is aspect-scoped **Authoritative** for the post-await live-control retirement
classification only; [Decision 0007](../decisions/0007-ticket-06-batching-fixture-causal-control-and-candidate-rebaseline.md)
remains authoritative only for its fixture/rebaseline/erratum aspects.
**Plan:** [`../plans/06-integrated-real-pi-acceptance/PLAN.md`](../plans/06-integrated-real-pi-acceptance/PLAN.md)
**Historical state:** `ffd45bd867e94c9003415f5f2e937cc9c616e399`, its WP-01 PASS,
and the renewed WP-02 integrated-pass/canonical-identity-failure attempt are
supporting only. The attempt stopped atomically after the canonical failure;
its raw logs/hashes and no-retry disposition are immutable.
**Current route:** exact two-file containment candidate child of `ffd45bd` →
freeze → same closed WP-01 (296 baseline plus exact implementation-added
focused cases, expected count recorded after implementation) → exactly one
new full five-file WP-02 → fresh owner WP-03 → fresh owner WP-04 → WP-05 →
WP-06 final Supervisor Decision 0009 → closure.
**Implementation authorization:** the future source write set is exactly
`apps/server/src/provider/piSubagentLiveLifecycleContainment.ts` and
`apps/server/src/provider/piSubagentLiveLifecycleContainment.test.ts`. No
canonical expectation, Alfie source/pin, third file, configuration, or
unrelated change is allowed. This planning transaction runs no implementation,
tests, or producers.

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
- **T06-AC7:** Every stage failure reports stage and stable diagnostic; mock-only
  success is impossible.
- **T06-AC8:** Exactly one integrated feature-level review and exactly one
  Supervisor final acceptance are recorded for the full project.

## Testing seams

Mandatory integrated real-Pi harness; deterministic lower-level fixtures;
accepted isolated manual destructive run; exact Alfie provenance manifest;
non-default ports and isolated process ownership; no user live-instance
mutation. Inherited Decisions 0031–0034 govern the destructive boundary.

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
destructive run (M evidence) and WP-06's persisted Supervisor acceptance; the
historical 2026-08-20 operator run is supporting-only (H) and cannot close
AC6 by itself.
