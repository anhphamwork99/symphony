# PROJECT — Antigravity terminal-answer recovery

Status: accepted

Project home: `/Users/anhpham99/symphony/.planning/synara-antigravity-terminal-recovery`

## Goal

Implement and verify the Antigravity-only terminal-answer quiescence recovery
defined in `SPEC.md`: a structurally complete final answer must clear a wedged
`working...` state exactly once, with bounded owned-process cleanup, strict
turn/generation/process ownership, quarantine when death is unconfirmed, and
no content-bearing diagnostics.

## Authoritative records

- `HANDOFF.md` is authoritative for precedence rules, implementation
  boundaries, non-goals, and handoff constraints. If it conflicts with
  `SPEC.md`, `HANDOFF.md` wins.
- `SPEC.md` is authoritative for behavior, design, scope, acceptance criteria,
  rollout, verification, and definition of done where it does not conflict
  with `HANDOFF.md`.
- `decisions/0001-final-acceptance.md` is authoritative for final acceptance
  of the scoped change set based on parent commit `f05bb5a0`.

## Delivery boundaries

- Required source writes:
  `apps/server/src/provider/Layers/AntigravityAdapter.ts` and
  `apps/server/src/provider/Layers/AntigravityAdapter.test.ts`.
- Supporting source writes are allowed only where `SPEC.md` section 14 permits
  them and current source evidence proves they are needed.
- Contracts, database schema, projections, UI protocol, other providers, and
  generic reconciliation thresholds are out of scope.
- Preserve unrelated working-tree changes.
- Do not commit unless the owner explicitly requests it.

## Acceptance

The integrated candidate must satisfy AC-01 through AC-18, preserve the
existing Antigravity lifecycle regressions named in `SPEC.md`, pass the
specified targeted tests and server typecheck, and pass proportional broader
server verification. One independent feature-level review and one final
Project Supervisor consultation are required before this project is accepted.

The integrated candidate passed 147/147 focused tests. Server typecheck
remains nonzero only in the concurrent Pi-subagent strand and reports no
diagnostic in the four scoped files. The single final Supervisor consultation
accepted AC-01 through AC-18 after reconciling all six findings from the one
independent `CHANGES_REQUIRED` review. See
`decisions/0001-final-acceptance.md`.
