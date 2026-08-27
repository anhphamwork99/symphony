# 02 — Prove fallback dual-history Undo and Redo

**What to build:** Plan and then prove, with the pinned real Excalidraw embed, the approved fallback contract: Excalidraw-native human history remains separate from Synara-owned AI-batch history, while every mutated AI batch remains exactly one AI-batch event with exact scene and asset recovery.

**Bounded by:** [Decision 0060](../decisions/0060-ticket-02-native-image-drop-gate-authorization.md) — WP-NATIVE-IMAGE-DROP-GATE-only authorization — following the file-chooser [Decision 0059](../decisions/0059-ticket-02-native-image-gate-blocked-routing.md), [Decision 0058](../decisions/0058-ticket-02-native-image-gate-authorization.md), [Decision 0057](../decisions/0057-ticket-02-fallback-wp-gate-passed-routing.md), and the owner-approved [Decision 0055](../decisions/0055-ticket-02-fallback-dual-history-contract-approved.md).

**Status:** active-native-image-drop-gate

Decision 0060 authorizes only a replacement real-Chromium Gate through Excalidraw's actual drag-and-drop handler. It permits standard `File`, `DataTransfer`, `DragEvent`, and `dispatchEvent` on the real `.excalidraw` container, while preserving all direct-insertion, runtime, config, package, and private-API prohibitions. The Gate must prove complete image/file closure, meaningful official SVG and PNG exports, user Delete, native Undo recovery, native Redo removal, and second native Undo recovery in two exact-candidate runs.

## Acceptance criteria

- [ ] **AC1 — Route ownership and labels:** In stable Chromium with the pinned real Excalidraw embed, native Excalidraw toolbar Undo/Redo and package-supported platform shortcuts mutate only human history. Synara exposes only visibly labeled, keyboard-accessible `Undo AI batch` and `Redo AI batch` actions for AI history. There is no generic dispatcher, mixed-history panel, shared cursor, or first-release AI keyboard shortcut; no native route invokes AI snapshots and no AI action invokes native Undo/Redo.
- [ ] **AC2 — Exact AI event semantics:** A completed AI batch, an acknowledged Take Over interruption with valid partial mutations, and a failed-partial batch with valid earlier mutations each finalize as exactly one AI-batch event. Progressive updates never become user-visible events; zero-mutation, semantic no-op, zero-valid failure, and pre-batch capture failure create no AI event. Invalid operations are unapplied and dependent operations stop.
- [ ] **AC3 — Exact AI Undo/Redo and assets:** AI Undo restores the verified pre-batch semantic scene and AI Redo restores the verified finalized scene, including active image/file references. Every restore preflights required binaries, uses public `addFiles`, writes with `captureUpdate: "NEVER"`, verifies the target before moving the AI cursor, and preserves command-start viewport/zoom without restoring transient presentation state.
- [ ] **AC4 — Cross-route invalidation:** Every committed semantically mutated AI boundary, including successful AI Undo/Redo restore, clears all native Excalidraw Undo and Redo through the supported public history-clear seam before exposing or unlocking the result. After AI activity, the first settled semantic human mutation—including native human Undo/Redo—clears all AI Undo and Redo and releases unreferenced AI snapshot assets. Proven no-ops, selection-only changes, pan, zoom, tool changes, and focus changes do not clear AI history. After AI Undo, a new mutated AI batch clears only the AI Redo branch.
- [ ] **AC5 — Separate retention cap:** At most 20 finalized AI-batch events are retained per open canvas session. Event 21 evicts only the oldest AI event. The test must not assert or implement a native 20-event cap, a combined cap, or a native exact capacity claim; native grouping and branch behavior remain package-defined.
- [ ] **AC6 — Native image acceptance gate:** Real stable Chromium proves native human image add/delete/native Undo/Redo restores meaningful image element/file references and produces meaningful official SVG and PNG exports. If this gate fails, the native exact-image promise is narrowed or left unaccepted before Ticket 02 final acceptance; AI image recovery remains independently exact under AC3.
- [ ] **AC7 — Lifecycle reset:** Remount, API or mount identity change, bounded-canvas eviction, reload/fresh hydration, application restart, close/session termination, duplication, import as a new identity, conflict replacement, and unrecoverable-fault recovery reset both native and AI histories. Current durable content may follow persistence rules, but neither history is restored or persisted. Same-instance Main-conversation switching does not reset history.
- [ ] **AC8 — Failure, rollback, and diagnostics:** Missing/invalid assets, semantic mismatch, callback-provenance failure, restore failure, and rollback failure produce explicit diagnostics, never claim success, never hydrate an empty scene, never silently drop image data, and never advance the AI cursor without verified target state. Successful rollback leaves content and history unchanged; unrecoverable failure keeps editing locked with actionable recovery diagnostics. Take Over and containment acknowledgement are required before unlock.
- [ ] **AC9 — Accessibility and focus seam:** The `AI history` group has exact labels, announced unavailable reasons, `aria-disabled="true"` rather than native disabled controls, keyboard activation through Enter/Space, standard toolbar navigation, predictable focus retention, polite completion/failure announcements, and no advertised AI key chord. The native route remains accessible and package-owned.
- [ ] **AC10 — Browser evidence and prohibited integration:** Acceptance uses the real pinned Excalidraw embed in stable Chromium for route ownership, AI lock, completed/interrupted/failed-partial batches, no-ops and human settlement, cross-route invalidation, delayed/duplicate callbacks, assets/failures, native image gate, cap, lifecycle reset, constrained-width accessibility, and Focus mode. Test-only native-control observation is allowed, but runtime private DOM/CSS dependency is not. Private APIs/imports, undocumented action keys, native-stack inspection, monkey-patching, package mutation, remount restore, fork, package upgrade, and lockfile change are prohibited.

## Required planning order

1. Define the bounded implementation work packages and browser fixtures for the two independent routes.
2. Prove public route ownership, AI lock, and one completed AI batch with exact AI Undo/Redo before broad matrix work.
3. Prove cross-route invalidation, failure/asset semantics, native image gate, cap, lifecycle reset, and accessibility seams.
4. Record reproducible failure evidence and stop the affected work if any public-boundary, native-image, containment, asset, or exactness gate fails. Do not silently weaken the contract.

## Testing seams

Feature governance remains the accepted project-scoped [Testing Strategy Governance Reassessment](../decisions/0047-testing-strategy-governance-reassessment.md).

- **Route seam:** real embedded Excalidraw toolbar, human pointer/keyboard/text-edit behavior, and package-native shortcuts; test-only observation may verify native controls without becoming a runtime dependency.
- **AI seam:** Synara-owned AI action group, immutable before/after snapshots, route epochs, revision/mount fencing, and exact AI cursor movement.
- **Cross-route seam:** public `api.history.clear()` at committed AI boundaries and settled human-mutation invalidation of all AI events/assets.
- **Asset/failure seam:** public `addFiles`, official restore/export, preflight, semantic comparison, rollback, containment acknowledgement, and actionable diagnostics.
- **Lifecycle seam:** mount/identity/eviction/reload/restart/close/duplicate/import/conflict/recovery reset behavior with durable content kept separate from history.
- **Accessibility seam:** named toolbar, exact labels, `aria-disabled`, focus, announcements, constrained width, keyboard-only, screen-reader, and Focus-mode behavior.
- **Browser seam:** real stable Chromium against the pinned package; mocks cannot substitute for route ownership, native image, or blocking failure evidence.

## Preserved obligations and prohibitions

This fallback changes only the mixed human/AI history boundary. It preserves exact AI batch semantics, progressive-update fencing, valid partial work, Take Over containment, no-op behavior, asset ownership and recovery, explicit failure/rollback diagnostics, session-only history, no durable Version history, and the existing File-canvas and persistence contracts.

Do not modify `@excalidraw/excalidraw`, `bun.lock`, runtime source, package manifests, protected Agentation work, unrelated planning projects, or evidence logs under this planning-only route. Do not claim AC4, AC7, the native image gate, or the Ticket 02 gate passed before the required implementation and browser evidence exists.

## Current evidence and references

- [Decision 0058 — WP-NATIVE-IMAGE-GATE authorization](../decisions/0058-ticket-02-native-image-gate-authorization.md)
- [Decision 0059 — native-image Gate BLOCKER and governance routing](../decisions/0059-ticket-02-native-image-gate-blocked-routing.md)
- [Decision 0060 — native-image drag-and-drop Gate authorization](../decisions/0060-ticket-02-native-image-drop-gate-authorization.md)
- [Native-image Gate BLOCKER exact-candidate evidence](../evidence/ticket-02/native-image-gate.md)
- [Decision 0057 — bounded WP-GATE PASS and post-Gate routing](../decisions/0057-ticket-02-fallback-wp-gate-passed-routing.md)
- [Fallback WP-GATE exact-candidate evidence](../evidence/ticket-02/fallback-gate.md)
- [Decision 0056 — active WP-GATE-only implementation authorization](../decisions/0056-ticket-02-fallback-wp-gate-authorization.md)
- [Remediated fallback dual-history implementation plan](../plans/02-fallback-dual-history-implementation.md)
- [Decision 0055 — approved fallback dual-history contract](../decisions/0055-ticket-02-fallback-dual-history-contract-approved.md)
- [Decision 0054 — research failure and fallback activation](../decisions/0054-ticket-02-public-history-boundary-research-failed-fallback-activated.md)
- [Decision 0053 — package/public-API reassessment](../decisions/0053-ticket-02-owner-package-reassessment-with-ai-history-fallback.md)
- [Decision 0051 — preserved historical single-route direction](../decisions/0051-ticket-02-exact-batch-history-direction.md)
- [Accepted fallback design](../designs/ticket-02-fallback-dual-history-contract.md)
- Initial Gate source/evidence: `2d5103b60` / `cd69bc867`
- Timing-probe source/evidence: `49c679888` / `fe8fa88ed`
- Completed three-progress Synara Undo/Redo remains partial evidence only; the prior native-route AC4/AC7 failure remains historical evidence for the fallback boundary.

**Routing:** `active-native-image-drop-gate`

**Current authorization boundary:** [Decision 0060](../decisions/0060-ticket-02-native-image-drop-gate-authorization.md) authorizes only the four-path drag-and-drop native-image Gate and exact-candidate two-run evidence protocol. No production implementation, later work package, AC claim, feature review, or final acceptance follows by inference.
