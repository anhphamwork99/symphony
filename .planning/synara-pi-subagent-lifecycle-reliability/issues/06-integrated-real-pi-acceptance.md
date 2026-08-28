# Ticket 06 — integrated real-Pi acceptance

**Status:** ready-for-agent — sole project frontier
**Dependencies:** discharged — Tickets 01–05 accepted; local Decisions
0001/0002/0006, applicable inherited decisions (especially durable-subagents
0031–0034), and this evidence-only plan remain binding
**Plan:** [`../plans/06-integrated-real-pi-acceptance/PLAN.md`](../plans/06-integrated-real-pi-acceptance/PLAN.md)
**Execution authorization:** serial evidence-only WPs (WP-01–WP-07) in the
accepted plan; no source/test/harness/fixture/config/migration/manifest/
lockfile/Alfie change anywhere; no manual destructive run and no quality gate
until explicit current-session owner authorization; behavioral producers run
in an isolated Symphony worktree at `12fd6686` with controlled Alfie worktree
`3fe340b4` via `ALFIE_REPO_DIR`
**Evidence status:** none yet — no Ticket 06 evidence, review, or acceptance
exists

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
