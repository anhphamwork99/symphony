# 14 — Verify the integrated Whiteboard release candidate

**What to build:** Prove the complete Whiteboard feature through Decision 0047’s integrated native, large-selection, and File-canvas paths, with measured performance, accessibility, and required failure diagnostics.

**Blocked by:** 07 — Scale large Whiteboard selections safely; 10 — Auto-save agent edits on File canvases; 13 — Complete launcher and Project lifecycle.

**Status:** ready-for-agent

- [ ] **AC1:** The integrated native path covers Main-chat creation, per-element chips, streamed agent edits, Take Over, one Undo, Auto-save, Main-conversation switch clearing, Project continuity, restart restoration, and non-restored history.
- [ ] **AC2:** The integrated large-selection path covers both threshold directions, one selection-set chip, complete selected IDs, bounded batch reads, aggregate clear, and no silent truncation.
- [ ] **AC3:** The integrated File-canvas path covers visual routing, human and agent edits, host Auto-save, atomic Git-visible write, third-canvas flush, clean external reload, dirty conflict choices, and no auto-merge.
- [ ] **AC4:** Empty, normal, image-bearing, and large-selection performance budgets pass for selection, composer updates, hydration, serialization, streaming, thumbnails, exports, and two mounted editors.
- [ ] **AC5:** No full element or scene payload appears inside composer editor state, persisted drafts, selection-set references, or unselected prompt context.
- [ ] **AC6:** Launcher, tabs, Focus mode, save/conflict states, Retry, Undo/Redo, Take Over, dialogs, and failures are keyboard-operable and meaningfully announced.
- [ ] **AC7:** Reduced motion, focus restoration, contrast, and non-color-only diagnostic requirements pass in the browser.
- [ ] **AC8:** Decision 0047’s required failure pairs pass, including authorization, traversal, stale revisions/fingerprints, malformed import, missing assets, containment timeout, late updates, close/quit failure, third-canvas flush failure, and hydration diagnostics.

## Testing Seams

Feature governance: [Decision 0047](../decisions/0047-testing-strategy-governance-reassessment.md).

**Approval status:** Approved — owner approved the proposed seams on 2026-08-26.

- **AC1–AC3:** Production-integrated native, large-selection, and File-canvas browser paths required by Decision 0047.
- **AC4, AC5:** Measured browser, store, persistence, filesystem, and network instrumentation.
- **AC6, AC7:** Browser accessibility, keyboard, focus, contrast, and reduced-motion boundary.
- **AC8:** Feature-governance failure matrix at the highest applicable public boundaries.
