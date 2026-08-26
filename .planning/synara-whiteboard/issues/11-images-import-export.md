# 11 — Add images, import, and export

**What to build:** Support images and interoperable `.excalidraw`, PNG, and SVG workflows for native Whiteboards and File canvases without embedding large binaries in document context or leaving partial assets after failure.

**Blocked by:** 03 — Create, edit, Auto-save, and restore a native Whiteboard; 04 — Open and Auto-save a Project File canvas.

**Status:** ready-for-agent

- [ ] **AC1:** Clipboard paste, drag-and-drop, and Project-file selection use one image-ingestion boundary.
- [ ] **AC2:** Image binaries are stored separately from element metadata and Whiteboard context chips.
- [ ] **AC3:** Images are decoded and measured before commit; oversized images are optimized when safe or rejected without partial assets/elements.
- [ ] **AC4:** Missing or corrupt assets remain diagnostic while recoverable document content remains available.
- [ ] **AC5:** Strict `.excalidraw` import creates a new independent native Whiteboard and never silently replaces the Active Whiteboard.
- [ ] **AC6:** Export produces valid editable `.excalidraw`, PNG, and SVG using official utilities.
- [ ] **AC7:** PNG/SVG omit the dot grid by default and include it only through the explicit option.
- [ ] **AC8:** Import/export failure, duplicate, delete, Undo, and Redo preserve coherent asset ownership and never claim partial success.

## Testing Seams

Feature governance: [Decision 0047](../decisions/0047-testing-strategy-governance-reassessment.md).

**Approval status:** Approved — owner approved the proposed seams on 2026-08-26.

- **AC1, AC3–AC7:** Actual Excalidraw browser and official import/export utility boundary.
- **AC2, AC4, AC8:** Real asset persistence, ownership, duplication, deletion, and reconciliation boundary.
- **AC3:** Deterministic image-processing failure seam complemented by at least one real image path.
