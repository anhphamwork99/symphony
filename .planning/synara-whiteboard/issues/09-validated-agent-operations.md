# 09 — Complete validated agent operations and recovery

**What to build:** Expand the proven native agent tracer into the complete bounded operation, validation, retry, placement, framing, and deletion model without weakening containment or one-batch recovery.

**Blocked by:** 08 — Stream the first agent-created diagram into a native Whiteboard.

**Status:** ready-for-agent

- [ ] **AC1:** The versioned API supports bounded reads plus create, update, move, resize, style, connect, group, frame, and delete by stable identity.
- [ ] **AC2:** Each mutation validates Project/document authority, expected revision, batch and operation IDs, generation, sequence, references, bounds, and supported values before application.
- [ ] **AC3:** Generated-ID reservation or bounded compound operations make create/connect/group/frame flows deterministic without invalid intermediate state.
- [ ] **AC4:** Malformed, oversized, cross-Project, stale, duplicate, out-of-order, and invalid-reference operations fail closed.
- [ ] **AC5:** The first invalid operation remains unapplied, dependent later operations stop, and prior valid work finalizes as one partial batch.
- [ ] **AC6:** Retry starts a fresh batch and generation against current state and cannot revive the failed generation.
- [ ] **AC7:** Generated content uses available space near selected context or viewport, avoids unrelated diagrams, and places multi-element results in named frames.
- [ ] **AC8:** Delete during active ownership requires confirmed containment and stale updates cannot recreate removed state.

## Testing Seams

Feature governance: [Decision 0047](../decisions/0047-testing-strategy-governance-reassessment.md).

**Approval status:** Approved — owner approved the proposed seams on 2026-08-26.

- **AC1–AC6, AC8:** Public agent-tool contract and production orchestration admission boundary.
- **AC3, AC7:** Actual Excalidraw translation/browser boundary with arrows, bindings, groups, frames, placement, and deletion cascades.
- **AC2, AC4:** Strict decoder and cross-Project authorization boundary.
