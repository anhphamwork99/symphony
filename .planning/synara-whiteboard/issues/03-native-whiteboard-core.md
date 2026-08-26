# 03 — Create, edit, Auto-save, and restore a native Whiteboard

**What to build:** Let a Project user create `board`, edit it manually in a Right-sidebar tab, see truthful Auto-save state, and restore confirmed content after navigation and restart.

**Blocked by:** 01 — Prove the Excalidraw integration boundary.

**Status:** ready-for-agent

- [ ] **AC1:** `New Whiteboard` creates a stable Project-owned native Whiteboard named `board` and opens it in the existing Right-sidebar tab system.
- [ ] **AC2:** Manual edits transition through truthful `Saving...` and `Saved` states using settled revision-checked Auto-save rather than pointer-frequency writes.
- [ ] **AC3:** Persistence failure retains visible content, exposes persistent `Not saved — Retry`, and never claims success.
- [ ] **AC4:** Restart restores the latest confirmed document, metadata, viewport, zoom, grid preference, and image references but not Undo/Redo history.
- [ ] **AC5:** Switching Main conversations preserves the Project-owned tab and document state; switching Projects preserves isolation.
- [ ] **AC6:** Corrupt or unrestorable state remains represented by an explicit diagnostic pane rather than disappearing or becoming an empty replacement.
- [ ] **AC7:** Closing unresolved native content requires Retry save, Discard changes, or Cancel.

## Testing Seams

Feature governance: [Decision 0047](../decisions/0047-testing-strategy-governance-reassessment.md).

**Approval status:** Approved — owner approved the proposed seams on 2026-08-26.

- **AC1, AC2, AC5:** Production WebSocket/API, real persistence, and actual embedded browser boundary — prove the complete create/edit/save/navigation path.
- **AC3, AC6, AC7:** Repository failure and browser diagnostic boundary — prove retry, close resolution, and retained restoration failures.
- **AC4:** Real server restart boundary — prove durable content and intentionally non-durable history.
