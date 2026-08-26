# 07 — Scale large Whiteboard selections safely

**What to build:** Keep large selections complete and agent-readable without rendering thousands of chips, serializing the scene, truncating IDs, or blocking the Main composer.

**Blocked by:** 06 — Attach Whiteboard elements to the Main composer.

**Status:** ready-for-agent

- [ ] **AC1:** Below a centralized measured threshold, selection continues to render one chip per element.
- [ ] **AC2:** Above the threshold, the composer renders one Whiteboard selection-set chip with the complete selected count.
- [ ] **AC3:** Synara preserves the full selected-ID set behind a lightweight reference and never silently truncates context.
- [ ] **AC4:** The agent reads the selection through bounded, deterministic batches.
- [ ] **AC5:** Closing the selection-set chip deselects the complete set.
- [ ] **AC6:** Dropping below the threshold restores per-element chips without losing or duplicating selection.
- [ ] **AC7:** Oversized materialization or batch-read failure is explicit and never sends partial context as complete.
- [ ] **AC8:** Performance evidence proves composer render/store cost is bounded by references and presentation rather than serialized scene size.

## Testing Seams

Feature governance: [Decision 0047](../decisions/0047-testing-strategy-governance-reassessment.md).

**Approval status:** Approved — owner approved the proposed seams on 2026-08-26.

- **AC1–AC3, AC5, AC6:** Actual canvas/composer browser boundary with threshold-crossing large-selection fixtures.
- **AC3, AC4, AC7:** Selection-set reference and agent-tool batch-read public boundary.
- **AC8:** Browser/composer store instrumentation over large-selection fixtures.
