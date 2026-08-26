# 13 — Complete launcher and Project lifecycle

**What to build:** Give users the complete native Whiteboard launcher and lifecycle, including search, thumbnails, duplication, safe deletion, archive retention, and contained Project deletion.

**Blocked by:** 09 — Complete validated agent operations and recovery; 11 — Add images, import, and export; 12 — Bound canvas mounting and add Focus mode.

**Status:** ready-for-agent

- [ ] **AC1:** The launcher supports New, recent Whiteboards, name search, recent activity, Rename, Duplicate, Export, and confirmed Delete; automatic new-board names use the next available `board`, `board 2`, `board 3`, and later numbered form.
- [ ] **AC2:** Missing thumbnails use a Whiteboard icon; thumbnails generate only after successful settled save and idle time, never during pointer or streamed-update work.
- [ ] **AC3:** Duplicate creates a new identity and predictable copy name, copies elements and owned assets coherently, resets Undo/Redo, excludes active agent/chip state, and opens the copy.
- [ ] **AC4:** Delete confirmation prevents duplicate destructive commands and removes only assets proven exclusively owned by the Whiteboard.
- [ ] **AC5:** Deletion during agent ownership requires Take Over or explicit stop-and-delete, waits for containment, advances generation, and rejects late updates before removal.
- [ ] **AC6:** Archived Projects retain Whiteboards and Right-sidebar workspace state.
- [ ] **AC7:** Project deletion fences new work, contains agent operations, settles or invalidates Auto-save/images/exports/thumbnails, then removes Project-owned data without late recreation.
- [ ] **AC8:** Cross-Project launcher, lifecycle, and restoration access fail closed; restoration failures retain diagnostic panes.

## Testing Seams

Feature governance: [Decision 0047](../decisions/0047-testing-strategy-governance-reassessment.md).

**Approval status:** Approved — owner approved the proposed seams on 2026-08-26.

- **AC1–AC5, AC8:** Browser launcher/Right-sidebar and real persistence boundary.
- **AC2:** Fake-clock scheduling complemented by a browser-visible cached-thumbnail path.
- **AC3, AC4, AC6, AC7:** Real repository and asset ownership transaction boundary.
- **AC5, AC7:** Production operation-containment and Project-deletion barrier boundary.
