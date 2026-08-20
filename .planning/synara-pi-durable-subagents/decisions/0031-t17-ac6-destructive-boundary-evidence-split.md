# Decision 0031 — Ticket 17 T17-AC6 destructive-boundary evidence split

## Status

**Decision (binding)** — Project Supervisor adjudication; accepted. Ticket-17
seam refinement under Decision 0001. This record does **not** approve the
pending Ticket-17 Testing-Seam amendment: the concrete amended seam still
requires explicit human-owner approval before any AC6 test is written.

## Date

2026-08-19

## Binding scope

- Ticket 17 only (T17-AC6 evidence split and its T17-AC8 / T17-AC9 mapping).
- Not a project-wide testing-strategy change: the integrated real-Pi smoke
  path stays mandatory under Decision 0001 §6, and this record neither removes
  nor weakens it.
- Not a precedent for any other ticket's destructive-boundary substitution.

## Question

Is Ticket 17's proposed T17-AC6 destructive-boundary evidence split an
ordinary ticket-level test-seam refinement under Decision 0001, or a material
project-wide testing-strategy change requiring a fresh owner-approved
project-scoped Decision Record — and what exact evidence may T17-AC6 claim
when implemented?

## Governing references

- Project Home (`.planning/synara-pi-durable-subagents/PROJECT.md`).
- Decision 0001 (testing-strategy governance; boundary-substitution rules and
  §Exceptions).
- Decision 0028 (Ticket-16 owner-approved real-Pi destructive-test
  substitution — precedent, scoped to Ticket 16).
- Decision 0030 (accepted Ticket-16 teardown baseline: owned-only kill
  authority, bands 75–78, proof-before-fence, bounded survivor evidence).
- Ticket 17 Testing Seams and its pending 2026-08-19 `/matt-implement`
  amendment.
- The Project Supervisor's binding decision returned in the current session.

## Evidence

- Decision 0028's owner approval, obligations, and reopening conditions are
  scoped to Ticket-16 acceptance evidence; the pending Ticket-17 amendment
  correctly declines to assume that authority extends to Ticket 17.
- Decision 0001 §Exceptions delegates concrete test seams to ordinary tickets
  but reserves project-wide strategy changes — including removing the
  integrated real-Pi smoke path — to a new owner-approved project-scoped
  Decision Record.
- Ticket 16's accepted teardown baseline (Decision 0030, Symphony `9c27a48b`)
  already provides implemented, owner-approved deterministic fixtures for the
  teardown/fence contract and a documented isolated manual real-Pi recipe.
- The destructive teardown outcome itself remains non-deterministic in shared
  CI (`proven`/`survivors` flip under host load inside the SIGKILL poll
  window; real OS signals), per the 2026-08-19 Ticket-16 hermeticity
  investigation cited by Decision 0028.
- Ticket 17's harness obligations (T17-AC8 isolation, T17-AC9 loud stage
  failure diagnostics, provider fakes cannot pass) are already normative in
  the Approved seams and are untouched by this split.

## Settled direction

The T17-AC6 evidence split is an **ordinary Ticket-17 seam refinement under
Decision 0001**, not a material project-wide strategy change: it removes no
required real-Pi coverage (the integrated real-Pi smoke path remains the
mandatory public seam for every other stage) and introduces no provider-fake
substitution. No new project-scoped owner-approved Decision Record is
required by Decision 0001 for the seam-design question.

However, by the precedent of Decision 0014 (`matt-implement` reserved
approval authority), Ticket 17's pending amendment makes the concrete amended
Testing Seam expressly contingent on human-owner approval before tests. This
adjudication confirms which authority applies; it does not and cannot
substitute for the owner's approval. The amendment therefore remains
**Pending**.

## Exact required T17-AC6 seam wording (binding)

T17-AC6 must be satisfied by the following mandatory evidence split; no
subset is sufficient:

1. **Mandatory hermetic real-Pi evidence** (integrated smoke harness; the
   ticket cannot pass on provider fakes): a deliberately wedged execution
   progresses through the watchdog stages, the provider session stops, and
   the teardown handoff is journaled (band 74 for the current
   attempt/generation), with stage-scoped diagnostics and the card honest
   through `cancelling`.
2. **Accepted deterministic Ticket-16 fixtures** (already approved and
   implemented under Decision 0028): owned-only teardown authority, journal
   bands 75–78 identities, uncertain-outcome handling (`survivors` /
   `owner_unproven` non-terminal and retryable; escalation to `proven`),
   bounded survivor evidence (cap 16), and proof-before-fence / fencing
   semantics (`proven` settles `cancelled` and advances the generation).
3. **Mandatory isolated manual real-Pi evidence** (the Ticket-16 manual
   recipe, run in isolation on an operator-owned machine): actual
   no-owned-child-process remaining after proven teardown — observed through
   band-75/76 rows, the supervisor's TERM→KILL escalation in the process
   table, and the card settling `cancelled` with generation advanced —
   recorded as an operator-run record. T17-AC6's terminal claim of zero owned
   children must come from this leg alone.

## Implementation permissions (before owner approval of the concrete seam)

- Implement T17-AC6 evidence legs 1 and 2 (real-Pi harness through teardown
  handoff; deterministic Ticket-16 fixtures as acceptance evidence).
- Keep leg 3 documented and explicitly labeled **manual**, per Decision 0028
  obligations 2 and 3.
- Treat the T17-AC6 status checkbox as open until all three legs are
  satisfied and the owner has approved the concrete seam.

## Implementation prohibitions

- **Deterministic/fixture-only AC6 satisfaction is prohibited.**
- **Automated real-Pi destructive-pass claims are prohibited.** No automated
  destructive teardown test may be introduced into shared CI or reported as
  run for Ticket 17.
- The manual recipe may **not** be reported as executed unless an operator
  records an actual isolated run and its environment.
- Deterministic fixtures may not be reported as real-Pi evidence, nor the
  real-Pi leg as deterministic fixture evidence.
- No mock-only success; provider fakes cannot satisfy this ticket (T17-AC9).
- This record may **not** be cited as owner approval of the pending amendment
  or as approval for any other ticket's destructive-boundary substitution.

## Reopening conditions

Reassess this decision only on material evidence that:

1. the owner approves, rejects, or rewords the pending Ticket-17 amendment
   (then persist the outcome and update the amendment's approval record);
2. the integrated real-Pi harness can deterministically prove the destructive
   no-owned-child outcome in an isolated envelope (then reassess against
   Decision 0028's reopening conditions);
3. the Ticket-16 teardown baseline, bands 75–78, or the manual recipe change
   materially; or
4. a later accepted decision changes Decision 0001, 0028, or 0030.

## Superseded record

None. This record preserves Decisions 0001, 0028, and 0030 without amendment
and resolves only the authority question for the Ticket-17 seam.
