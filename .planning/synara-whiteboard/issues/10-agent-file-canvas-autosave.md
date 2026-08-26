# 10 — Auto-save agent edits on File canvases

**What to build:** Let an explicitly referenced File canvas receive validated streamed agent edits while host Auto-save writes the backing Project file safely and watcher conflicts remain contained.

**Blocked by:** 05 — Resolve File-canvas conflicts, close, and third-canvas flush; 08 — Stream the first agent-created diagram into a native Whiteboard; 09 — Complete validated agent operations and recovery.

**Status:** ready-for-agent

- [ ] **AC1:** Only an explicitly referenced eligible File canvas can receive agent operations.
- [ ] **AC2:** Agent operations mutate the in-memory File canvas through the validated API and expose no direct filesystem-write command.
- [ ] **AC3:** Accepted edits mark the canvas temporarily `Unsaved`, then host Auto-save writes through authorized path, fingerprint, and atomic replacement.
- [ ] **AC4:** Confirmed Auto-save creates the expected Git-visible backing-file change without a separate Save action.
- [ ] **AC5:** External change during agent ownership or pending Auto-save becomes a conflict and never silently reloads, overwrites, or merges.
- [ ] **AC6:** Take Over, invalid-operation stop, retry, stale-generation rejection, and one-batch Undo retain native Whiteboard semantics.
- [ ] **AC7:** Path, fingerprint, symlink, write, or containment failure retains accepted in-memory work and never reports false `Saved` state.

## Testing Seams

Feature governance: [Decision 0047](../decisions/0047-testing-strategy-governance-reassessment.md).

**Approval status:** Approved — owner approved the proposed seams on 2026-08-26.

- **AC1–AC7:** Production WebSocket, deterministic fake agent producer, actual File canvas, and temporary real Project filesystem integrated boundary.
- **AC2, AC3, AC7:** Server-owned filesystem authorization and host Auto-save boundary.
- **AC5:** Serialized watcher/agent/Auto-save conflict state-machine boundary.
