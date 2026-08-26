# 02 — Prove exact AI edit-batch Undo and Redo

**What to build:** Prove with the pinned real Excalidraw embed that one completed, interrupted, or failed partial AI edit batch can be recovered as exactly one user-visible Undo/Redo event without exposing individual streamed updates.

**Blocked by:** 01 — Prove the Excalidraw integration boundary.

**Status:** ready-for-agent

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
