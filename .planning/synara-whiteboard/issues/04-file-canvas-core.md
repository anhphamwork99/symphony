# 04 — Open and Auto-save a Project File canvas

**What to build:** Let a user open a Project `.excalidraw` file as a visual File canvas, edit it manually, and have host-owned settled Auto-save write the backing file safely and truthfully.

**Blocked by:** 01 — Prove the Excalidraw integration boundary.

**Status:** ready-for-agent

- [ ] **AC1:** Opening a Project `.excalidraw` file routes to a File canvas instead of a raw JSON preview.
- [ ] **AC2:** A File canvas remains file-backed, Project-scoped, separate from native Whiteboards, and absent from the native launcher unless imported.
- [ ] **AC3:** Manual edits mark the canvas temporarily `Unsaved`, then host Auto-save writes the backing file and updates its expected fingerprint.
- [ ] **AC4:** Successful Auto-save produces the expected Git working-tree change without a separate Save action.
- [ ] **AC5:** The server confines writes to the authoritative Project root and rejects traversal, escaping symlinks, stale fingerprints, unauthorized Project identity, and destination replacement races.
- [ ] **AC6:** Atomic-write failure or fingerprint conflict retains unresolved state and a diagnostic without reporting `Saved`.
- [ ] **AC7:** The agent-facing Whiteboard API exposes no direct filesystem-write operation.

## Testing Seams

Feature governance: [Decision 0047](../decisions/0047-testing-strategy-governance-reassessment.md).

**Approval status:** Approved — owner approved the proposed seams on 2026-08-26.

- **AC1–AC4, AC6:** Actual File-canvas browser over a temporary real Project filesystem — prove visual routing, save truth, backing-file contents, and Git-visible change.
- **AC5, AC7:** Server-owned Project-path, fingerprint, authorization, and atomic-write public boundary — prove safe admission and failure diagnostics.
