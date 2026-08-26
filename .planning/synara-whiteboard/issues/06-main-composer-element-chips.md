# 06 — Attach Whiteboard elements to the Main composer

**What to build:** Turn ordinary Whiteboard element selection into lightweight Main-composer context that synchronizes both ways, clears on Main-conversation switch, and snapshots the latest element state exactly once at Send.

**Blocked by:** 03 — Create, edit, Auto-save, and restore a native Whiteboard.

**Status:** ready-for-agent

- [ ] **AC1:** Each selected element in an ordinary selection creates one lightweight Whiteboard selection chip.
- [ ] **AC2:** Deselecting an element removes its chip, and closing a chip deselects its element without feedback loops.
- [ ] **AC3:** Chips contain bounded identity and provenance references only; element JSON, scene JSON, images, and full related context never enter composer editor state or persisted drafts.
- [ ] **AC4:** Pointer movement and selected-element content changes do not publish composer-draft updates while selected identities remain unchanged.
- [ ] **AC5:** Send resolves the latest current element state once and creates immutable snapshots with distinctly marked minimal related context.
- [ ] **AC6:** Deleted unsent context is removed; temporarily unavailable context remains diagnostic and contributes no fabricated payload.
- [ ] **AC7:** Switching Main conversations clears all unsent Whiteboard chips and deselects their elements without copying or restoring them in another draft.
- [ ] **AC8:** Sent snapshots remain context records and do not navigate back to mutable elements.

## Testing Seams

Feature governance: [Decision 0047](../decisions/0047-testing-strategy-governance-reassessment.md).

**Approval status:** Approved — owner approved the proposed seams on 2026-08-26.

- **AC1–AC4, AC7:** Actual canvas and Main-composer browser boundary — prove selection projection, deletion, feedback-loop prevention, switch clearing, and bounded update frequency.
- **AC5, AC6, AC8:** Composer send/materialization boundary — prove latest-state snapshots, related-context labeling, unavailable diagnostics, and non-navigation.
