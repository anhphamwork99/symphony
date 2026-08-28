# Ticket 06 — integrated real-Pi acceptance

**Status:** ready-for-agent — sole project frontier; Package C candidate frozen; renewed WP-01 ready
**Dependencies:** discharged — Tickets 01–05 accepted; local Decisions
0001/0002/0006, applicable inherited decisions (especially durable-subagents
0031–0034), and this reassessed plan remain binding
**Plan:** [`../plans/06-integrated-real-pi-acceptance/PLAN.md`](../plans/06-integrated-real-pi-acceptance/PLAN.md)
**Authoritative reassessment:** [Decision 0007](../decisions/0007-ticket-06-batching-fixture-causal-control-and-candidate-rebaseline.md) is authoritative only for the two-file fixture correction, candidate rebaseline, attempt-3 erratum, and downstream gate state.
**Execution authorization:** Package C planning/provenance freeze only. Historical base `12fd6686` and WP-01 `9208e1728`/attempts 1–3 are supporting only. Candidate `ffd45bd867e94c9003415f5f2e937cc9c616e399` is the sole-parent child of `12fd6686`, with exactly the two Decision 0007 files; it was integrated by merge `064b49f1d954b64343006da9240cdadf58bc0ff2` (parents `8c9b8bcbb` and `ffd45bd867e`). No third file, production/config/manifest/lockfile, or Alfie change is allowed.
**Required route:** exact two-file candidate → freeze → renewed WP-01 (same 19 files, 296/296) → one renewed full five-file WP-02 → fresh owner authorization WP-03 → fresh owner authorization WP-04 conditional on new WP-03 PASS → WP-05 one review → WP-06 Decision 0008 → WP-07.
**Gate status:** renewed WP-01 is ready at candidate `ffd45bd867e`; renewed WP-02 remains blocked until WP-01 passes 296/296; old WP-03/WP-04 authorizations are unspent but non-transferable and not executable; WP-05/WP-06 reservations are unused.
**Evidence status:** candidate-freeze provenance and focused correction logs are recorded; no current D/R PASS, review, or acceptance exists. No WP-01/WP-02 producer ran in Package C.

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
