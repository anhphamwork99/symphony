# Final-acceptance reassessment — RightDock same-Project lifecycle ownership fix

- Status: Binding Reassessment — accepted
- Trigger: Single final acceptance consultation
- Candidate: `a1cee80b522efe2d97d9526edeab5fb82f5b0644`
- Write set: none
- External effects: none
- Date: 2026-08-25

## Question

May exact candidate `a1cee80b522efe2d97d9526edeab5fb82f5b0644` be accepted as the integrated fix for the defect in which RightDock tool-tab lifecycle identity still followed the active conversation rather than the owning Project?

## Governing references

- `../PROJECT.md`
- `0002-explicit-project-ownership-and-legacy-migration.md`
- `0006-final-acceptance-candidate-c03a4a511.md`

The owner-approved product contract is not reopened: one Project owns one Right-sidebar workspace; same-Project Main-conversation switches preserve panes, order, active tab, visibility, and runtime context; Projects are isolated; real nested conversation content remains identified by `ThreadId`.

## Evidence

The inspected worktree HEAD is exactly `a1cee80b522efe2d97d9526edeab5fb82f5b0644`.

Production source establishes:

1. `SingleChatSurface` derives RightDock ownership from its real route `ProjectId`.
2. Route-panel bootstrap is scoped by that owning `ProjectId`.
3. Deferred runtime hydration is keyed by `ProjectId`, pane ID, and pane kind.
4. RightDock motion identity is the owning `ProjectId`.
5. Null ownership neither consumes route bootstrap nor mutates a dock slice.
6. Side-chat and other conversation-backed content retain real `ThreadId` identities.

Focused source-backed regressions prove:

- Closing Browser and activating File remains preserved when switching A1→A2 in one Project.
- The exact File `activePaneId` remains selected and the switch produces zero RightDock writes.
- Another Project gets a distinct bootstrap key, dock slice, and terminal scope.
- A null owner produces no bootstrap patch and no runtime identity.
- A hydrated heavy pane remains live across a same-Project rerender and resets for another Project.
- Real Side-chat and conversation host Thread IDs remain nested content identities.

Supplied execution evidence is 44/44 focused unit tests and 4/4 browser tests on main. The independent feature-level reviewer freshly obtained 44/44 unit, 4/4 browser, and 10/10 Project-workspace acceptance passes, supplied pre-fix discrimination evidence, and reported PASS for C1–C6 with no material findings.

## Reassessment

Material post-acceptance evidence showed that three web lifecycle identities—route bootstrap, deferred pane activation, and motion identity—could still follow the active conversation and violate the accepted same-Project continuity contract.

Candidate `a1cee80b5` closes that defect by using the real owning `ProjectId` consistently. It does not alter the Project Contract, introduce a pseudo Thread, or erase legitimate nested Thread identity.

## Binding verdict

Accept exact candidate `a1cee80b522efe2d97d9526edeab5fb82f5b0644` for the integrated RightDock same-Project tool-tab ownership bug fix.

This reassessment supersedes Decision 0006 only as the exact accepted code baseline for this subsequently discovered defect. Decision 0006 remains historically valid for candidate `c03a4a511`, and Decisions 0002 and 0004 remain authoritative without amendment.

## Rejected alternatives

- Retaining `ThreadId` as route-bootstrap scope.
- Retaining `ThreadId` in deferred hydration or motion identity.
- Copying or recreating a dock workspace during conversation navigation.
- Treating the active or first Thread as a Project workspace host.
- Encoding or casting a `ProjectId` as a synthetic `ThreadId`.
- Consuming deep-link bootstrap while the owning Project is unresolved.
- Converting legitimate Side-chat or conversation-scoped identities from `ThreadId` to `ProjectId`.
- Accepting only from reported test totals without inspecting production and discriminating test paths.

## Assumptions

- The supplied focused and independent verification outputs correspond to exact candidate `a1cee80b5`.
- The cited independent reviewer package is the single feature-level review authorized for this final consultation.
- Existing unrelated dirty files are user-owned, do not overlap the nine-file candidate scope, and are outside this verdict.
- Project IDs and pane IDs retain their existing uniqueness guarantees.

## Residual uncertainty and non-blocking risks

- The supplied reviewer summary contains no enumerated LOW-severity defect; therefore no unidentified reviewer note is treated as acceptance evidence or as a blocker.
- Motion continuity is directly grounded in Project-scoped source wiring; the principal browser regressions focus on runtime hydration rather than naming a separate chrome-motion-only scenario.
- Focused verification does not replace repository-wide release qualification if such qualification is required by a later deployment or release process.

These points do not contradict the six acceptance criteria and do not block this scoped bug-fix acceptance.

## Failure and rollback implications

Reverting the Project-scoped bootstrap key can reopen a tool pane that the user closed when switching conversations in one Project. Reverting Project-scoped hydration can demote an already hydrated Browser, Terminal, Device, or Side-chat pane back to preview. Reverting the Project-scoped motion key can spuriously suppress dock chrome motion during a same-Project conversation switch.

Rollback must keep all three lifecycle identities aligned. A partial rollback that restores Thread ownership to any one of them is unsafe. Legitimate nested `ThreadId` fields must remain intact during either forward change or rollback.

## Downstream effect

The exact candidate may become the accepted Project-owned Right-sidebar workspace baseline for this defect fix. No source modification, cleanup, push, deployment, or other external side effect is authorized by this verdict.

## Reopening conditions

Reopen if:

- a same-Project conversation switch reopens a closed tool pane;
- pane order, `activePaneId`, visibility, or runtime state changes during that switch;
- another Project can inherit or mutate the source Project’s dock or hydration state;
- an unresolved owner consumes bootstrap state or creates a dock slice;
- a hydrated pane falls back to preview solely because the Main conversation changed;
- a Project switch fails to reset Project-specific lifecycle identity;
- a real nested conversation identity is replaced by `ProjectId` or a pseudo Thread;
- verification is shown to be stale or from a different candidate;
- candidate scope overlaps the excluded user-owned dirty files; or
- the human owner changes the Project Contract.
