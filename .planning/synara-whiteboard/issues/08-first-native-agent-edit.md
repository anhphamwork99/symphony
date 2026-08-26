# 08 — Stream the first agent-created diagram into a native Whiteboard

**What to build:** Let one eligible Main-chat request create or target a native Whiteboard, stream a minimal valid diagram, expose lock and Take Over, reject stale updates, and recover the whole batch with one Undo.

**Blocked by:** 02 — Prove exact AI edit-batch Undo and Redo; 03 — Create, edit, Auto-save, and restore a native Whiteboard; 06 — Attach Whiteboard elements to the Main composer.

**Status:** ready-for-agent

- [ ] **AC1:** A clear diagram request creates `board` when the Project has no Whiteboard; explicit name, Active Whiteboard, and sole eligible Whiteboard follow deterministic targeting precedence.
- [ ] **AC2:** The agent uses a minimal validated Synara-owned operation surface rather than raw Excalidraw JSON.
- [ ] **AC3:** Progressive updates are admitted and rendered in strict batch/generation/sequence order without remounting.
- [ ] **AC4:** Direct element editing is locked while pan and zoom remain available under a fixed `Agent is working on it...` status.
- [ ] **AC5:** Take Over advances the generation, dispatches stop, waits for acknowledgement, prevents retry, ends the turn, and rejects every late update at canonical admission.
- [ ] **AC6:** Stop dispatch failure or acknowledgement timeout keeps the board protected and exposes an actionable diagnostic.
- [ ] **AC7:** Valid partial work remains visible after Take Over and exactly one Undo removes the complete partial batch.
- [ ] **AC8:** Project/document authority is derived from server-owned context rather than trusted payload identifiers.

## Testing Seams

Feature governance: [Decision 0047](../decisions/0047-testing-strategy-governance-reassessment.md).

**Approval status:** Approved — owner approved the proposed seams on 2026-08-26.

- **AC1–AC8:** Production WebSocket route, deterministic fake agent-operation producer, real persistence, and actual Excalidraw browser boundary.
- **AC3, AC5, AC6, AC8:** Canonical operation-generation and sequence-admission boundary with explicit containment diagnostics.
- **AC7:** Real embedded history/recovery boundary proven by Ticket 02.
