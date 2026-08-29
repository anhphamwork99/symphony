# Decision 0066 — Authorize Ticket 02 WP-AI-ASSETS-RESTORE-FAILURE

**Status:** Binding — bounded browser-owned AI asset, restore, rollback, and locked-fault package authorized; no production provider/UI integration or Ticket acceptance authorized
**Date:** 2026-08-29
**Trigger:** Material technical decision verification/escalation after `WP-OPERATION-TRANSPORT-OUTCOMES` achieved independently reviewed BOUNDED PASS
**Prior decision disposition:** Decisions 0055 and 0062–0065 remain binding. Decision 0063 §17’s required return to governance is satisfied by this record.
**Supersedes:** None
**Final-acceptance consultation consumed:** No
**Owner-approved decisions reopened:** None

## Question

After the independently reviewed bounded PASS of `WP-OPERATION-TRANSPORT-OUTCOMES`, may Ticket 02 proceed to the separately reserved AI asset, exact restore, rollback, and locked-fault package? If so, what exact ownership, behavior, write-set, verification, evidence, failure, and downstream boundaries govern it?

## Governing references

### Authoritative

1. [Project Home](../PROJECT.md), authoritative routing for Ticket 02.
2. [Decision 0055](0055-ticket-02-fallback-dual-history-contract-approved.md), especially exact AI asset recovery, cross-route invalidation, rollback, and no-false-success obligations.
3. [Decision 0062](0062-ticket-02-native-image-drop-gate-passed-routing.md), recording bounded native image recovery through the real pinned package without establishing AI image recovery or AC6.
4. [Decision 0063](0063-ticket-02-operation-transport-outcomes-authorization.md), especially §§8, 13, and 17, which reserve assets/restore/failure to a separate package and require this governance return.
5. [Decision 0064](0064-ticket-02-canonical-rpc-write-set-reassessment.md), preserving canonical RPC topology and prohibiting supplemental protocol groups.
6. [Decision 0065](0065-ticket-02-server-authority-websocket-seam.md), preserving the image-free, ephemeral server authority and canonical WebSocket mechanics.
7. [Operation transport/outcomes evidence](../evidence/ticket-02/operation-transport-outcomes.md), integrated on main through `8aa47efb9`.

### Supporting

8. [Ticket 02](../issues/02-prove-ai-batch-undo-redo.md), especially AC3 and the asset/failure portion of AC8.
9. [Accepted fallback dual-history contract](../designs/ticket-02-fallback-dual-history-contract.md), especially §§8–10.
10. [Fallback implementation plan](../plans/02-fallback-dual-history-implementation.md), especially §§7, 12, and 13.

## Evidence scope

The completed predecessor package has exact lineage:

```text
measured source: 09d609b8d4852fcb6a88d3f8a3a1515e773952ea
integrated main lineage ending: 8aa47efb9
```

Its independent structured review returned PASS for R1–R9 with no blocking findings, confirmed scope/evidence integrity, and preserved deferred claims. The accepted predecessor verdict is only:

```text
WP-OPERATION-TRANSPORT-OUTCOMES: BOUNDED PASS
```

The native image Gate under Decision 0062 separately proves package-owned native image closure. It does not prove Synara-owned AI snapshot assets or AI restore behavior. No predecessor evidence requires remediation before the next isolated package.

## Binding decision

Authorize exactly one bounded package:

```text
WP-AI-ASSETS-RESTORE-FAILURE
```

Project and Ticket 02 routing advance to:

```text
active-ai-assets-restore-failure
```

This package owns browser-local, session-only AI snapshot assets; exact image-aware AI Undo/Redo restoration; preflight; public `addFiles`; semantic and file-closure verification; meaningful official SVG/PNG verification; recoverable restore failure; command-start rollback; and unrecoverable locked-fault behavior.

It does not expand the operation-session protocol. Contracts, server service, and canonical WebSocket route remain strict and image-free. No binary, data URL, raw Excalidraw object, file map, asset body, or asset ownership state may enter the operation RPC surface, server service, orchestration events, persistence, or diagnostics.

The package remains dormant in the Ticket 02 harness and focused tests. It does not mount Whiteboard, the operation bridge, AI history, recovery UI, or a provider producer into the production application.

## 1. Ownership invariants

### AI asset pool

A dedicated browser-local asset pool owns immutable copies of AI-history binary file records. It must validate file ID, MIME metadata, data encoding, decoded bytes, and bounded size before admission; derive deterministic content identity; deduplicate identical content without conflating file IDs; reject conflicting content for one file ID; retain assets while referenced by current content, event before/after snapshots, active batches, restore commands, or rollback snapshots; and release only after reference owners are atomically removed.

The pool is session-only and in-memory. Snapshots retain immutable active-file references and asset-pool handles rather than mutable package-owned records or independently duplicated binaries. The 20-event cap remains deferred.

### Document snapshot owner

`SynaraDocumentSnapshot` remains the canonical semantic projection. Image-aware snapshots preserve exact active image element-to-file-ID closure and normalized metadata, reject missing retained assets, exclude unreferenced files, and keep viewport/tool/dialog/theme/transient state outside historical semantics.

### AI-history coordinator

`SynaraAiHistoryCoordinator` remains sole owner of event/cursor state, Redo-branch deletion, route/revision, native-history clear ordering, restore applicability, rollback, lock/fault state, asset-reference release, and truthful result exposure.

### Excalidraw adapter

The adapter remains sole owner of public `addFiles`, `updateScene(..., { captureUpdate: "NEVER" })`, opaque scopes/callback correlation, scene/file capture, native-history clear, official SVG/PNG export, and adapter diagnostics. It does not decide cursor movement, event retention, rollback success, or acceptance.

### Operation bridge and transport

The operation bridge and transport remain image-free and unchanged. Browser-local image-aware proof is bounded asset/restore evidence, not production provider delivery or full operation integration.

## 2. Exact restore and exposure invariants

AI Undo/Redo must: verify identity/applicability; capture command-start semantic/file/viewport/selection rollback authority; preflight every target asset; acquire target/rollback leases; lock; open a restore scope; call public `addFiles` with the complete target files; apply target elements with `captureUpdate: "NEVER"`; await correlation/drain; verify semantic target and exact active file closure; verify meaningful SVG/PNG for images; close scope; clear native history exactly once; prove post-clear stability; move cursor/route/revision exactly once; expose success; unlock; and release command-only leases.

`addFiles` completion, scene invocation, callback delivery, fingerprint-only equality, SVG-only success, or PNG-only success is insufficient. Restore preserves command-start viewport/zoom, filters selection to present elements, retains focus predictably, and never invokes native Undo/Redo.

## 3. Meaningful image verification

Use a deterministic non-transparent sentinel PNG with fixed bytes/hash/dimensions/MIME and multiple opaque colors. Verify exact active image/file closure, retained bytes/metadata, meaningful official SVG with expected image payload, and valid decoded PNG with sentinel-colored samples. Absent-image targets contain no active image reference or sentinel evidence. Package-normalized retained content becomes the exact baseline.

## 4. Failure, rollback, and diagnostics

Missing/invalid/conflicting assets fail before any write: scene/cursor/route/revision/native history/events remain unchanged, cleanup unlocks, and a retryable diagnostic is exposed.

After mutation begins, any add-files/write/callback/semantic/file/export/post-clear failure must not expose success or move cursor. Before native clear/cursor movement, attempt exactly one rollback through the same public preflight/addFiles/scoped-write/correlation/closure/export path.

Successful rollback exactly restores command-start scene/files, preserves cursor/events/route/revision, avoids native clear, unlocks, emits `restore-rollback-succeeded`, and reports a retryable “Nothing changed” failure.

Rollback failure preserves observable content, never hydrates empty, keeps cursor/events, locks fault, retains uncertain assets, emits originating diagnostic plus `restore-rollback-failed`, and requires later authorized recovery/reset.

Extend diagnostics with at least:

```text
asset-preflight-failed
asset-missing
asset-invalid
asset-reference-mismatch
asset-content-conflict
asset-add-files-failed
svg-export-verification-failed
png-export-verification-failed
restore-write-failed
restore-rollback-succeeded
restore-rollback-failed
```

Diagnostics contain no binary bodies, complete data URLs, raw package objects, private state, stack dumps, or acceptance claims.

## 5. Retention and branch invariants

Prove shared asset dedupe, Undo/Redo retention, Redo-branch deletion releases, human-settlement invalidation releases, no release for no-op/presentation changes, unchanged ownership on failed restore/successful rollback, and conservative retention on locked fault. Event cap and lifecycle resets remain deferred.

## 6. Exact authorized write set

### Create

```text
apps/web/src/components/whiteboard/ticket02/SynaraAiAssetPool.ts
apps/web/src/components/whiteboard/ticket02/SynaraAiAssetPool.test.ts
apps/web/src/components/whiteboard/ticket02/SynaraAiAssetsRestoreFailure.test.ts
apps/web/src/components/whiteboard/ticket02/SynaraAiAssetsRestoreFailure.acceptance.browser.tsx
```

### Modify additively

```text
apps/web/src/components/whiteboard/ticket01/SynaraExcalidrawAdapter.tsx
apps/web/src/components/whiteboard/ticket02/ExcalidrawTicket02Harness.tsx
apps/web/src/components/whiteboard/ticket02/SynaraDocumentSnapshot.ts
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryTypes.ts
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryCoordinator.ts
apps/web/src/components/whiteboard/ticket02/SynaraHistoryGate.test.ts
```

Adapter changes are limited to production-shaped public asset/add-files/restore/export seams, dependency-based deterministic failure injection, and necessary diagnostics. No monkey-patching, private imports, or `__test` runtime API.

### Evidence: create

```text
.planning/synara-whiteboard/evidence/ticket-02/ai-assets-restore-failure.md
.planning/synara-whiteboard/evidence/ticket-02/ai-assets-restore-failure.focused.log
.planning/synara-whiteboard/evidence/ticket-02/ai-assets-restore-failure.run-a.browser.log
.planning/synara-whiteboard/evidence/ticket-02/ai-assets-restore-failure.run-b.browser.log
```

No other path is authorized.

## 7. Prohibited and deferred paths

Do not modify:

```text
apps/web/package.json
apps/web/src/main.tsx
bun.lock
apps/web/vitest.browser*.config.ts
packages/contracts/**
packages/shared/**
apps/server/**
apps/web/src/wsTransport.ts
apps/web/src/components/whiteboard/ticket02/SynaraWhiteboardOperationBridge.ts
apps/web/src/components/whiteboard/ticket02/SynaraWhiteboardOperationBridge.test.ts
apps/web/src/components/whiteboard/ticket02/SynaraOperationTransportOutcomes.acceptance.browser.tsx
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryActions.tsx
apps/web/src/components/Sidebar.tsx
apps/web/src/components/chat/**
apps/web/src/rightDockStore*
apps/web/src/store*
.planning/synara-pi-*/**
```

Protected WIP `apps/web/package.json`, `apps/web/src/main.tsx`, and `bun.lock` is expressly prohibited. Also deferred: protocol/server changes; production provider/UI mounting; RightDock/layout/accessibility; 20-event cap; lifecycle resets; persistence/durable state; mixed history/private APIs/remount/fork/package mutation; workspace fmt/lint/typecheck; AC3/AC8/AC6/Ticket acceptance; feature review and final acceptance.

## 8. Required focused verification

```bash
set -o pipefail
bun run --cwd apps/web test -- \
  src/components/whiteboard/ticket02/SynaraAiAssetPool.test.ts \
  src/components/whiteboard/ticket02/SynaraAiAssetsRestoreFailure.test.ts \
  src/components/whiteboard/ticket02/SynaraHistoryGate.test.ts \
  2>&1 | tee .planning/synara-whiteboard/evidence/ticket-02/ai-assets-restore-failure.focused.log
focused_status=${PIPESTATUS[0]}
printf 'FOCUSED_EXIT=%s\n' "$focused_status"
test "$focused_status" -eq 0
```

Focused tests prove immutable ownership, strict validation/conflict detection, reference accounting/releases, preflight/addFiles/NEVER ordering, exact closure/export verification, viewport/selection preservation, all failure classifications, exactly-one rollback, successful rollback invariants, failed rollback locked-fault/no-empty behavior, bounded diagnostics, no cap/lifecycle implementation, and prior image-free Gate behavior.

## 9. Required two-run stable-Chromium verification

Freeze/commit the clean source candidate and record SHA plus Excalidraw 0.18.1. Run the acceptance file twice on distinct free ports, each with pipefail, captured exit, and immutable logs:

```text
apps/web/src/components/whiteboard/ticket02/SynaraAiAssetsRestoreFailure.acceptance.browser.tsx
```

The real-browser matrix proves image-aware before/after closures; successful public addFiles/NEVER AI Undo/Redo with exact files and meaningful SVG/PNG; shared asset retention; branch/human invalidation release; preflight no-write; post-write failure plus exact rollback; rollback-failure locked fault/no empty/no false success; and no native Undo/Redo, private integration, production mount, or binary transport.

## 10. Evidence requirements

Record source/baseline, pinned version provenance, commands/ports/counts/exits, SHA-256 logs, exact/prohibited paths, sentinel identity, ownership matrix, restore traces, closure/export results, failure/rollback matrices, cursor/route/revision/native-clear/lock/diagnostics, unchanged image-free protocol, bridge dormancy, and deferred claims. After source measurement only four evidence paths may change. Source correction creates a new candidate and requires all runs again. Run diff-check/path/hash audits and one independent read-only package review.

## 11. Bounded PASS wording

A passing package may claim only:

```text
WP-AI-ASSETS-RESTORE-FAILURE: BOUNDED PASS
Browser-local immutable AI asset ownership: PASS
Exact image-aware AI Undo/Redo through public addFiles and captureUpdate NEVER: PASS
Canonical scene and active file-reference verification: PASS
Meaningful official SVG and PNG restore verification: PASS
Missing/invalid asset preflight with no scene mutation: PASS
Recoverable restore failure and exact rollback: PASS
Unrecoverable rollback failure and locked-fault protection: PASS
Asset release on AI Redo-branch deletion and human invalidation: PASS
Operation transport remains image-free: PASS
AI-only 20-event cap: DEFERRED — NOT CLAIMED
Lifecycle reset and recovery hydration: DEFERRED — NOT CLAIMED
Accessibility/RightDock/production UI: DEFERRED — NOT CLAIMED
Provider mounting and full integrated application path: DEFERRED — NOT CLAIMED
Workspace fmt/lint/typecheck: DEFERRED — NOT CLAIMED
AC3/AC8, AC6, and Ticket 02 acceptance: NOT CLAIMED
Feature review and final acceptance: NOT CLAIMED
```

## 12. Stop conditions

Stop and return to governance if exact ownership requires prohibited packages/server/contracts/persistence/config/main paths; binary transport; private APIs; non-deterministic meaningful exports; rollback outside the public scoped path; any failed restore advances cursor/clears history/exposes success/loses events; rollback cannot reproduce command start; rollback failure unlocks/hydrates empty/releases uncertain assets; conflicts are overwritten; either browser run fails/disagrees; lineage/hashes/cleanliness fail; or any unauthorized/deferred scope is attempted. No assertion weakening or best-effort rollback may turn failure into PASS.

## 13. Rejected alternatives

Rejected: predecessor remediation without evidence; monolithic assets/cap/lifecycle/accessibility/integration; binary protocol/server state; native Gate as AI proof; binary duplication per snapshot; best-effort restore without rollback; remount/empty recovery; immediate production provider/RightDock mounting.

## 14. Assumptions and residual uncertainty

Assume current browser snapshot/coordinator seams can extend within authorized paths; pinned public addFiles/updateScene/getFiles/export boundaries can prove exact recovery; failure injection can remain dependency-based; operation transport remains image-free; fixtures remain bounded. Deferred uncertainty includes production provider acquisition/UI mounting, measured cap/memory, lifecycle/restart/recovery, accessibility/RightDock, persistence, integrated evidence, workspace checks, feature review, and final acceptance.

## 15. Failure and rollback implications

The package is additive/browser-local and has no migration. On failure preserve evidence, do not production-mount or alter the image-free protocol, avoid private/remount/empty/durable fallbacks, revert bounded additions if needed, preserve prior decisions, and return to governance.

## 16. Downstream routing

After persistence, only `WP-AI-ASSETS-RESTORE-FAILURE` may begin. After bounded PASS, evidence, and one independent package review, return to governance. A later decision may authorize `WP-CAP-LIFECYCLE` or require remediation; no downstream scope follows by inference. Ticket final acceptance remains exactly once after complete integrated Ticket verification and one feature-level review.

## Reopening conditions

Reassess only if public addFiles/NEVER cannot restore exact active closure; ownership cannot remain browser-local/session-only; binary transport becomes necessary; meaningful public exports are unavailable; rollback cannot preserve command-start content without prohibited techniques; required code exceeds write set; prior transport PASS is contradicted by asset-relevant evidence; or bounded fixtures conceal actual correctness/memory failure.
