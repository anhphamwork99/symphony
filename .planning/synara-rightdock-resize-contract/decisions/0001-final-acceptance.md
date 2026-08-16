# Decision 0001 — Final acceptance

Date: 2026-08-16

Status: Binding — accepted with recorded nonblocking risks

## Question

Final acceptance of the integrated Right-Dock resize candidate in:

- `apps/web/src/components/chat/RightDock.tsx`
- `apps/web/src/components/chat/SingleChatSurface.tsx`
- `apps/web/src/components/chat/rightDockSizing.browser.tsx`
- `apps/web/src/components/ui/sidebar.tsx`

against owner-approved contract D1–D3, AC-01–AC-12, and remediation R1–R10.

## Governing references

- `../PROJECT.md`
- `../DESIGNER-CONTRACT.md`
- `../IMPLEMENTATION-BRIEF.md`
- `../issues/01-implementation-review-remediation.md`
- `../FINAL-VERIFICATION.md`

## Evidence

- Shared-tree source inspection on 2026-08-16.
- Independent reviewer: R1–R10 PASS and AC-01–AC-12 PASS.
- TS2484 and TS2375 structurally closed.
- Focused suites passed sequentially: 19/19, 7/7, 19/19, and 2/2.
- `apps/web` typecheck passed.
- Root format passed.
- Root lint completed with 0 errors.
- In-source test enumeration matches the recorded results.

## Settled direction

The candidate is **accepted with recorded nonblocking risks**.

The previous Supervisor Advisory/not-ready result inspected a stale isolated
checkout and did not consume final acceptance. This binding consultation,
performed against the shared working tree, supersedes that Advisory.

## Rejected alternatives

- **Reject:** rejected because the review blocker no longer exists and no
  remaining in-scope defect is evidenced.
- **Unconditional accept:** rejected because the unrelated workspace typecheck
  failure and lack of a post-fix human packaged-desktop feel check should remain
  visible as residual risks.

## Assumptions

- Recorded command evidence is trusted.
- Acceptance scope is the four source files above plus
  `.planning/synara-rightdock-resize-contract/**`.
- Nothing outside that scope is accepted or authorized by this decision.

## Residual risks

1. Repo-root `bun typecheck` is red solely in the unrelated, in-progress
   Pi-subagents effort at `packages/contracts/src/piSubagents.test.ts`. This
   effort must not fix, stage, hide, or commit those changes.
2. Post-fix drag feel has not been human-verified on a packaged desktop build;
   geometry and browser behavior are covered by focused tests.
3. `SidebarRail` retains the reviewer-noted render-phase latest-ref write. This
   is nonblocking under the verified lifecycle behavior.

## Downstream effect

Final acceptance is consumed exactly once. The owner-requested scoped commit is
authorized for the four source files plus
`.planning/synara-rightdock-resize-contract/**`, excluding all unrelated dirty
working-tree changes. A green workspace-wide typecheck is not a precondition
for this scoped commit.

## Failure and rollback implications

Rollback is capability-scoped: disable the session resolver and synchronous
commit path only. Never roll back the 360px policy or left-sidebar/mobile
semantics as part of that response.

## Reopening conditions

Reopen only on material new evidence:

- an in-scope focused-test regression;
- a real post-merge reproduction of the jerk-at-limit symptom; or
- evidence that the bounded path changed left-sidebar, mobile-sheet,
  split-view, or imaging semantics.
