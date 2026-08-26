# 05 — Resolve File-canvas conflicts, close, and third-canvas flush

**What to build:** Make external file changes, unresolved Auto-save, closing, quitting, and opening a third canvas predictable without silent overwrite or data loss.

**Blocked by:** 04 — Open and Auto-save a Project File canvas.

**Status:** ready-for-agent

- [ ] **AC1:** An externally changed clean File canvas reloads the new backing file.
- [ ] **AC2:** An external change while Auto-save is pending, failed, or conflicted preserves local state and never auto-reloads or auto-merges divergent Excalidraw JSON.
- [ ] **AC3:** Conflict resolution exposes the applicable Retry, Reload, Save As, Keep Editing, Discard, and Cancel actions with truthful fingerprint state.
- [ ] **AC4:** Opening a third canvas flushes pending File-canvas Auto-save before unmounting the selected older canvas.
- [ ] **AC5:** Flush failure or conflict preserves unresolved content, prevents false `Saved` state, and does not behave as though eviction succeeded.
- [ ] **AC6:** Closing unresolved native or File-canvas content requires Retry save, Discard changes, or Cancel.
- [ ] **AC7:** Quitting Synara consolidates all unresolved documents and quits only after explicit resolution; crash or force-kill restores only confirmed native revisions and confirmed file writes.
- [ ] **AC8:** Save As and watcher races cannot bypass path, fingerprint, or atomic-write protections.

## Testing Seams

Feature governance: [Decision 0047](../decisions/0047-testing-strategy-governance-reassessment.md).

**Approval status:** Approved — owner approved the proposed seams on 2026-08-26.

- **AC1–AC3, AC8:** Real filesystem watcher/fingerprint/Auto-save state-machine boundary using a temporary Project.
- **AC4, AC5:** Browser mount-count and File-canvas flush boundary — prove successful and failed third-canvas transitions.
- **AC6, AC7:** Browser close/quit dialog, focus, and keyboard boundary with real unresolved save states.
