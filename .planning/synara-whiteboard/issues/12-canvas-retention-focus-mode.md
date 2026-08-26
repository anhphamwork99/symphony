# 12 — Bound canvas mounting and add Focus mode

**What to build:** Keep many Whiteboard/File-canvas tabs usable without linear editor-memory growth, restore evicted view state, and provide Focus mode while following existing Right-sidebar layout conventions.

**Blocked by:** 03 — Create, edit, Auto-save, and restore a native Whiteboard; 05 — Resolve File-canvas conflicts, close, and third-canvas flush.

**Status:** ready-for-agent

- [ ] **AC1:** At most the active and most recently used eligible canvas instances remain mounted.
- [ ] **AC2:** Opening another canvas flushes required persistence, unmounts the correct candidate, and never loses unresolved content.
- [ ] **AC3:** Reopening an evicted tab hydrates the same document, viewport, zoom, and restoration state.
- [ ] **AC4:** Hidden retained canvases suspend avoidable visible-only work.
- [ ] **AC5:** Focus mode expands the same document, hides the transcript, retains the Main composer and current conversation, and preserves selection-context behavior.
- [ ] **AC6:** Exiting Focus mode restores tab identity, viewport, zoom, and predictable focus; Escape works when the editor does not own it.
- [ ] **AC7:** Existing Right-sidebar preferred width, clamping, Main minimum width, tab order, Project switching, and restoration diagnostics remain authoritative.
- [ ] **AC8:** Standard Excalidraw editing shortcuts remain available, while keyboard, reduced-motion, and accessibility status behavior is browser-verifiable.

## Testing Seams

Feature governance: [Decision 0047](../decisions/0047-testing-strategy-governance-reassessment.md).

**Approval status:** Approved — owner approved the proposed seams on 2026-08-26.

- **AC1–AC6:** Actual browser with mount-count, flush, hydration, viewport, and focus instrumentation.
- **AC2, AC3:** Native/File persistence and restoration boundaries.
- **AC7:** Existing public Right-sidebar sizing and Project-workspace routing boundary.
- **AC8:** Browser keyboard, focus, and reduced-motion boundary.
