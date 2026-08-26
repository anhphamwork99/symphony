# 02 — Prove exact AI edit-batch Undo and Redo

**What to build:** Prove with the pinned real Excalidraw embed that one completed, interrupted, or failed partial AI edit batch can be recovered as exactly one user-visible Undo/Redo event without exposing individual streamed updates.

**Blocked by:** Human-owner boundary decision — Decision 0052's single public timing remediation is exhausted.

**Status:** blocked-owner-decision

- [ ] **AC1:** Multiple progressive scene updates finalize as exactly one user-visible Undo event.
- [ ] **AC2:** One Undo restores the complete pre-batch state for completed, Take-Over-interrupted, and invalid-operation partial batches.
- [ ] **AC3:** Redo restores the finalized batch result, including relevant image references.
- [ ] **AC4:** Toolbar Undo/Redo and `Cmd/Ctrl+Z` use one coherent history route.
- [ ] **AC5:** A new edit after Undo invalidates the Redo branch deterministically.
- [ ] **AC6:** Human events and AI edit batches share a bounded 20-event session history that resets after duplication or restart.
- [ ] **AC7:** If exact one-event behavior cannot be achieved with the pinned package and a Synara-owned recovery boundary, the ticket fails with reproducible evidence and blocks broad implementation.

## Testing Seams

Feature governance: [Decision 0047](../decisions/0047-testing-strategy-governance-reassessment.md).

**Approval status:** Approved — owner approved the proposed seams on 2026-08-26.

- **AC1–AC6:** Actual embedded Excalidraw browser history boundary — prove toolbar, keyboard, progressive updates, Take Over, partial failure, images, and Redo behavior.
- **AC2, AC3:** Synara-owned pre-batch recovery boundary — verify complete scene and image-reference restoration rather than relying on undocumented editor history assumptions.
- **AC7:** Reproducible real-package feasibility report — no mocked editor may substitute for the blocking result.

## Current gate result

- Binding direction: [Decision 0051](../decisions/0051-ticket-02-exact-batch-history-direction.md).
- Bounded timing Reassessment: [Decision 0052](../decisions/0052-ticket-02-native-history-timing-probe.md).
- Initial Gate source/evidence: `2d5103b60` / `cd69bc867`.
- Timing-probe source/evidence: `49c679888` / `fe8fa88ed`.
- Review: [Ticket 02 Gate failure verification](../reviews/ticket-02-gate-failure-review.md).

Completed three-progress Synara Undo/Redo is retained as partial evidence. AC4 and AC7 fail because real Chromium observes package-native Undo becoming enabled after a human Delete despite both synchronous public `api.history.clear()` and the one authorized `queueMicrotask` post-commit clear:

```text
mutation:Undo:false:null
```

Broad WP-CORE and later work remains blocked. The owner must choose whether to change the package pin, allow a non-public integration boundary, relax the sole-route/no-transient requirement, change the mixed human/AI history model, or defer/remove Whiteboard under the current boundary.
