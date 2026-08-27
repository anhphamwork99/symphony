# Ticket 02 implementation plan — fallback dual human/AI history

**Status:** Planning artifact only — implementation-ready only after a separate owner/supervisor implementation-boundary decision
**Date:** 2026-08-27
**Binding authority:** [Decision 0055](../decisions/0055-ticket-02-fallback-dual-history-contract-approved.md)
**Accepted design:** [Ticket 02 fallback dual-history contract](../designs/ticket-02-fallback-dual-history-contract.md)
**Frontier:** [Ticket 02](../issues/02-prove-ai-batch-undo-redo.md)
**Testing governance:** [Decision 0047](../decisions/0047-testing-strategy-governance-reassessment.md)
**Accepted feasibility boundary:** [Decision 0048](../decisions/0048-ticket-01-excalidraw-feasibility-boundary.md) and [Decision 0050](../decisions/0050-ticket-01-final-acceptance-hold-removed.md)
**Challenge input:** [Ticket 02 fallback contract challenge review](../reviews/ticket-02-fallback-contract-challenge.md)

> This file authorizes nothing. Decision 0055 permits planning only. Source, tests, evidence, package, lockfile, Project/Ticket, and decision changes require a later bounded implementation decision that cites this plan.

## 1. Goal and success model

Implement and prove only the isolated Ticket 01/02 feasibility harness/module surface for the owner-approved fallback:

- Excalidraw exclusively owns human Undo/Redo through its native toolbar and package-supported platform shortcuts.
- Synara exclusively owns visibly labeled `Undo AI batch` and `Redo AI batch` actions over an AI-only session history.
- A committed semantically mutated AI boundary, including successful AI Undo/Redo, clears all native history through public `api.history.clear()` before exposure or unlock.
- The first settled semantic human mutation after AI activity, including native human Undo/Redo, clears all AI Undo/Redo and releases unreferenced AI snapshot assets.
- Completed, acknowledged Take Over partial, and failed-partial mutated AI outcomes each become exactly one AI event; progressive writes and contract-defined no-ops become none.
- AI restores are exact for semantic scene and active files, preserve command-start viewport/zoom, use public `addFiles` plus `captureUpdate: "NEVER"`, and move the cursor only after verification.
- AI history retains at most 20 finalized AI events per open canvas session; no native or combined cap is claimed.
- Revision, route epoch, session epoch, canvas identity, mount/API identity, and operation generation fence stale, duplicate, delayed, or unknown-provenance callbacks.
- Both routes reset at the lifecycle boundaries named by Decision 0055; history remains session-only.
- Stable real Chromium proves route ownership, locking, exact AI behavior, and the conditional native image gate without runtime private DOM/CSS dependencies.

Ticket 02 is successful only after AC1–AC10 are evidenced on one exact candidate, focused and final gates pass, one independent feature-level review passes, and a later exactly-once Supervisor consultation accepts the candidate. This plan cannot make any of those claims.

## 2. Non-goals

The implementation planned here must not:

- wire production navigation, RightDock, Whiteboard header/status rail, launcher, tabs, Focus-mode production composition, or any production route;
- implement WP-CORE, Ticket 03+, durable Version history, persistence, database, server/WebSocket orchestration, File-canvas Auto-save/conflicts, composer chips, thumbnails, or production two-canvas retention;
- add or change a package, upgrade Excalidraw, edit a manifest or lockfile, or modify the pinned `@excalidraw/excalidraw@0.18.1` resolution;
- use private APIs/imports, ActionManager/History internals, native-stack inspection, undocumented action keys, DOM/CSS suppression, monkey-patching, package mutation, remount restore, or a fork;
- hide, relabel, duplicate, intercept, or replace native Excalidraw history controls;
- capture, stop, reinterpret, or advertise a keyboard chord for AI history;
- create a generic history dispatcher, combined event array, mixed cursor, mixed panel, or Synara-owned human event history;
- claim native history capacity/grouping, a native 20-event cap, or native exact-image recovery before its browser gate passes;
- weaken a failing public boundary by silently narrowing acceptance. A contract-relevant failure stops the affected work and returns to the Supervisor/owner.

## 3. Write boundaries

### 3.1 Current planning task

The only allowed write for this planning task is:

```text
.planning/synara-whiteboard/plans/02-fallback-dual-history-implementation.md
```

Everything else is prohibited, including source, tests, evidence, `PROJECT.md`, Ticket 02, decisions, designs, Product Contract/spec, package manifests, and lockfiles.

### 3.2 Proposed implementation write set

A later implementation-boundary decision may authorize exactly the following isolated surface. Deletion/rename of the superseded Ticket 02 prototype files is included; no other path is implied.

```text
apps/web/src/components/whiteboard/ticket01/SynaraExcalidrawAdapter.tsx
apps/web/src/components/whiteboard/ticket02/ExcalidrawTicket02Harness.tsx
apps/web/src/components/whiteboard/ticket02/SynaraDocumentSnapshot.ts
apps/web/src/components/whiteboard/ticket02/SynaraHistoryTypes.ts                 # delete after replacement
apps/web/src/components/whiteboard/ticket02/SynaraHistoryCommands.ts              # delete after replacement
apps/web/src/components/whiteboard/ticket02/SynaraSessionHistory.ts                # delete after replacement
apps/web/src/components/whiteboard/ticket02/SynaraHistoryGate.test.ts              # replace existing assumptions
apps/web/src/components/whiteboard/ticket02/SynaraHistoryGate.acceptance.browser.tsx # replace existing assumptions
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryTypes.ts
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryCoordinator.ts
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryActions.tsx
apps/web/src/components/whiteboard/ticket02/SynaraAiAssetPool.ts
apps/web/src/components/whiteboard/ticket02/SynaraHumanMutationSettlement.ts
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryCoordinator.test.ts
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryFailure.test.ts
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryAssets.acceptance.browser.tsx
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryLifecycle.acceptance.browser.tsx
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryAccessibility.acceptance.browser.tsx
apps/web/src/components/whiteboard/ticket02/SynaraNativeImageHistory.acceptance.browser.tsx
.planning/synara-whiteboard/evidence/ticket-02/fallback-gate.md
.planning/synara-whiteboard/evidence/ticket-02/fallback-gate.browser.log
.planning/synara-whiteboard/evidence/ticket-02/fallback-matrix.md
.planning/synara-whiteboard/evidence/ticket-02/fallback-matrix.browser.log
.planning/synara-whiteboard/evidence/ticket-02/native-image-gate.md
.planning/synara-whiteboard/evidence/ticket-02/native-image-gate.browser.log
.planning/synara-whiteboard/evidence/ticket-02/final-verification.md
.planning/synara-whiteboard/evidence/ticket-02/final-verification.log
.planning/synara-whiteboard/reviews/ticket-02-fallback-implementation-review.md
```

The review file is reviewer-owned, not implementation-worker-owned. A Supervisor decision is outside this write set and requires separate authority.

### 3.3 Prohibited implementation writes

```text
apps/web/package.json                       # protected Agentation WIP
apps/web/src/main.tsx                       # protected Agentation WIP
bun.lock                                    # protected Agentation WIP
**/package.json
apps/web/vitest.browser*.config.ts
apps/server/**
packages/contracts/**
packages/shared/**
.planning/synara-whiteboard/PROJECT.md
.planning/synara-whiteboard/issues/**
.planning/synara-whiteboard/decisions/**
.planning/synara-whiteboard/designs/**
.planning/synara-whiteboard/PRODUCT-CONTRACT.md
.planning/synara-whiteboard/spec.md
.planning/synara-whiteboard/evidence/ticket-01/**
production RightDock/navigation/store/header/launcher paths
all Ticket 03+ source, tests, plans, and evidence
```

A need to change any prohibited path is a `BLOCKER`, not implementation-time discretion.

## 4. Current symbols and required replacements

The existing prototype encodes the superseded single/combined-route model and must be replaced, not wrapped or retained underneath the fallback.

| Current symbol/behavior | Required replacement |
| --- | --- |
| `SynaraSessionHistory.events` contains both `kind: "ai-batch"` and `kind: "human"` | `SynaraAiHistoryCoordinator` stores AI-batch events only. Human changes are never appended. |
| `SynaraHistoryEvent.kind` and `SynaraHistoryTransaction = "none" | "ai-batch" | "human"` | `SynaraAiHistoryEvent` has no human kind; explicit operation/restoring/rollback/fault state is AI-route-only. |
| `SynaraHistoryCommand = "undo" | "redo"` and `SynaraHistoryCommands` generic dispatcher | Explicit `undoAiBatch()` / `redoAiBatch()` actions; no generic latest-route selection and no native command dispatch. |
| Harness `onKeyDownCapture` intercepts `Cmd/Ctrl+Z` and Redo | Remove entirely. Native shortcuts pass untouched to Excalidraw and text editing. No `aria-keyshortcuts` for AI controls. |
| Harness labels `Synara Undo`, `Synara Redo`, toolbar name `Synara history controls` | `SynaraAiHistoryActions`: toolbar accessible name `AI history`; exact labels `Undo AI batch` and `Redo AI batch`; exact unavailable/running descriptions and announcements from the accepted contract. |
| Harness sets `containNativeHistory: true` | Remove containment mode from Ticket 02 use. Normal human callbacks do not clear native history. |
| Adapter `onChange` clears native history before and after every callback when `containNativeHistory` is true | Delete/retire this Ticket 02 assumption. Keep one explicit public `clearNativeHistory()` seam invoked only by the coordinator at committed AI boundaries. |
| Harness `recordHumanMutation(prior, scene)` appends human events | `SynaraHumanMutationSettlement` classifies settled semantic human mutation versus presentation/no-op, then invalidates all AI history/assets once; it does not record a human event. |
| `suppressedFingerprintsRef` and a boolean suppression flag infer synthetic provenance from fingerprint | Replace with identity/revision/epoch/operation-generation write tokens. Fingerprint remains semantic verification data, never provenance or applicability authority. |
| `SynaraDocumentSnapshot` embeds all files per snapshot and `toSceneSnapshot` invents viewport `{0,0,1}` | Snapshot stores canonical semantic document plus active file references and identity/revision metadata; `SynaraAiAssetPool` owns deduplicated binaries. Restore captures and preserves command-start viewport/zoom and filters selection. |
| `completeAiBatch` supports only `completed` | Finalization supports `completed`, containment-acknowledged `interrupted`, and `failed-partial`, plus explicit no-event outcomes. |
| `dispatch` restores then moves a mixed cursor | AI action preflights assets, locks both routes, restores with `addFiles` + `captureUpdate: NEVER`, verifies, clears native history, advances epochs/cursor, then unlocks/exposes. Failure follows rollback/locked-fault rules. |
| Lifecycle callback only seeds `lastSceneRef` on `api-ready` | Mount/API identity changes reset both histories, invalidate pending tokens, increment session epoch, and require fresh capture; stale callbacks are rejected. |
| Gate tests assert native controls are disabled/inert and platform shortcuts use Synara | Replace with proof that native controls/shortcuts own human history when unlocked, cannot mutate while AI lock is active, and never invoke AI snapshots. |

### Adapter seam after replacement

`SynaraExcalidrawAdapter` remains the only Excalidraw-facing module and may expose only public host abstractions:

- capture semantic scene/files, viewport, valid selection, mount/API identity;
- apply ordered synthetic scene updates with `captureUpdate: "NEVER"`;
- preflight/supply files through public `addFiles`;
- clear all native history through public `api.history.clear()`;
- set supported edit/view lock while retaining proven pan/zoom;
- export through official SVG/PNG utilities;
- report lifecycle and scene observations with monotonic adapter callback sequence and current public identities.

It must not expose the raw package API, native history stack, action manager, internal transaction state, or runtime DOM control locators.

## 5. Dependency graph and execution policy

```text
WP-GATE
  ├─ FAIL → preserve reproducible Gate evidence → STOP all later WPs → Supervisor/owner reassessment
  └─ PASS → CHECKPOINT-GATE commit
                  ↓
       WP-OUTCOMES-ASSETS-FAILURE
                  ↓
          WP-CAP-LIFECYCLE
                  ↓
           WP-ACCESSIBILITY
                  ↓
         WP-NATIVE-IMAGE-GATE
          ├─ FAIL → preserve exact conditional failure; do not claim AC6 → Supervisor narrows/holds promise
          └─ PASS
                  ↓
          WP-FINAL-EVIDENCE
                  ↓
          independent review
                  ↓
 exactly-once Supervisor final-acceptance consultation
```

All implementation WPs are serialized because they consume or mutate the same adapter/coordinator/harness contract. Test/evidence drafting inside a WP may proceed in parallel only when its write set does not overlap source being changed, but no downstream behavior may be implemented before its dependency commit passes. WP-GATE is deliberately narrow to minimize feedback-loop risk.

## 6. WP-GATE — decisive fallback route and exact completed-batch proof

### Objective and observable outcome

On one exact candidate, prove in stable Chromium:

1. native toolbar and package-supported shortcuts own human Undo/Redo when unlocked;
2. AI streaming/restoring lock prevents pointer, keyboard, native toolbar, and accessibility-triggered document mutation while preserving proven pan/zoom;
3. three progressive AI writes finalize as one completed AI event;
4. `Undo AI batch` restores exact pre-state and `Redo AI batch` restores exact final state, one cursor movement per action;
5. completed AI finalization and successful AI Undo/Redo clear all native history before result exposure/unlock;
6. the first settled semantic human mutation after AI activity clears all AI Undo/Redo, while selection/pan/zoom/focus/proven no-op do not;
7. delayed/duplicate synthetic callbacks cannot be classified as human, cannot append/clear history, and stale/unknown provenance fails closed;
8. adapter mount/API identity stays stable through progress, finalization, Undo, Redo, native human edit, and invalidation.

This Gate owns the first decisive evidence for AC1, AC3, AC4, AC8, and AC10 and partial evidence for AC2 and AC9. It does not implement the broad outcome, asset-failure, cap, lifecycle, accessibility-layout, or native-image matrices.

### Read set

- Decision 0055, accepted fallback design, Ticket 02 AC1–AC10, Decisions 0047/0048/0050.
- `SynaraExcalidrawAdapter.tsx` and all current `ticket02/*` files.
- Ticket 01 fixture, comparator, export, viewport, and browser-test utilities.
- Historical Gate evidence only to understand the failed containment assumption; do not edit it or reuse its verdict.

### Allowed writes

```text
apps/web/src/components/whiteboard/ticket01/SynaraExcalidrawAdapter.tsx
apps/web/src/components/whiteboard/ticket02/ExcalidrawTicket02Harness.tsx
apps/web/src/components/whiteboard/ticket02/SynaraDocumentSnapshot.ts
apps/web/src/components/whiteboard/ticket02/SynaraHistoryTypes.ts                    # delete
apps/web/src/components/whiteboard/ticket02/SynaraHistoryCommands.ts                 # delete
apps/web/src/components/whiteboard/ticket02/SynaraSessionHistory.ts                   # delete
apps/web/src/components/whiteboard/ticket02/SynaraHistoryGate.test.ts                 # replace
apps/web/src/components/whiteboard/ticket02/SynaraHistoryGate.acceptance.browser.tsx  # replace
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryTypes.ts
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryCoordinator.ts
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryActions.tsx
apps/web/src/components/whiteboard/ticket02/SynaraAiAssetPool.ts
apps/web/src/components/whiteboard/ticket02/SynaraHumanMutationSettlement.ts
.planning/synara-whiteboard/evidence/ticket-02/fallback-gate.md
.planning/synara-whiteboard/evidence/ticket-02/fallback-gate.browser.log
```

### Implementation contract

- Delete the wrapper keyboard capture and generic dispatcher before adding fallback assertions; do not leave a dormant shared route.
- Make the coordinator AI-only from its type model upward. No `human` event variant or mixed cursor may remain.
- Track `canvasIdentity`, `mountIdentity`/API identity, `sessionEpoch`, `mutationRevision`, `routeEpoch`, operation identity, and operation generation on events and pending synthetic writes.
- Use a coordinator-issued synthetic write token for each progress/restore write. Match callbacks by the complete token context plus expected revision/semantic target; never by fingerprint alone.
- Unknown callback provenance produces a structured fail-closed diagnostic and keeps mutation/history locked until recovery; delayed/duplicate callbacks are rejected without changing cursor, events, epochs, or assets.
- Begin AI work by capturing an immutable pre-batch snapshot before accepting progress. Ordered progress uses the existing mounted adapter with `captureUpdate: "NEVER"` and creates no AI event.
- Keep both routes unavailable during streaming, Take Over pending, restore, and rollback. Prove the public edit/view boundary blocks document mutation but retains pan/zoom.
- Finalize one semantically mutated completed batch only after semantic verification. Then clear native history, advance revision/route epoch, expose one AI event, unlock, and announce availability.
- AI Undo/Redo must preflight referenced files, preserve command-start viewport/zoom, restore without historical transient AppState, verify target, clear native history, move the AI cursor once, and then expose/unlock.
- A settled semantic human mutation is package-owned. It clears the entire AI array/cursor and unreferenced pool, advances human route epoch/revision, records exact unavailable reasons, and announces the clear. Presentation-only/no-op observations do not clear it.
- Native toolbar/shortcut tests are test-only browser observation. Runtime source cannot locate native controls through DOM/CSS.
- Keep the same adapter mount/API identity throughout; no remount recovery or key churn.

### Gate fixture design

Create one deterministic real-package fixture derived from Ticket 01 with:

- one text element, one ordinary shape, and one selected/deletable shape;
- stable semantic IDs/custom data for three distinct AI progress states;
- a viewport/zoom and valid selection that make preservation observable;
- no image dependency in this first Gate;
- a deterministic fake AI producer with operation ID/generation, sequences 1–3, controllable callback delay/duplication, completion, and lock/ack state;
- test-only accessible native-control observation and scene fingerprint/identity traces, never imported by runtime code.

Browser scenarios, in this order:

1. **Native baseline:** pointer or Delete human mutation; native toolbar Undo/Redo and platform shortcut mutate the human scene; AI event count stays zero; no Synara keyboard interception.
2. **AI lock:** start AI; attempt pointer mutation, Delete, native toolbar Undo/Redo, platform shortcuts, and accessible activation; document remains unchanged except accepted synthetic progress; pan/zoom remains usable.
3. **Completed batch:** apply three distinct progress states; event count remains zero until completion; completion produces exactly one AI event.
4. **Exact AI actions:** activate exact labeled buttons using pointer then keyboard Enter/Space; pre/final semantic states, active refs, viewport/zoom, selection filtering, focus retention, cursor, and one-dispatch behavior match the contract.
5. **Native clear:** create native human Undo/Redo availability before each committed AI boundary; after batch finalization, AI Undo, and AI Redo, native commands cannot restore any pre-boundary state.
6. **Human invalidation:** after AI activity, selection/pan/zoom/focus/no-op preserve AI history; one settled Delete or text edit clears all AI history; subsequent AI action is inert with exact reason.
7. **Synthetic callback fence:** deliver duplicate, delayed old-generation, wrong-route-epoch, wrong-mount/revision, and unknown-provenance callbacks; assert rejection/diagnostic, no human invalidation, no cursor/event change, and fail-closed lock for unknown provenance.
8. **Identity:** assert mount/API identity equality over every scenario that does not explicitly test lifecycle reset.

### Gate diagnostics and failure proof

Every diagnostic records: code, AC, phase, package/browser/platform, scenario, canvas/mount/API/session/route/revision identity, operation/generation/batch/event where applicable, expected, observed, recoverability, lock state, rollback result, and a copyable stable summary.

Minimum Gate diagnostic codes:

```text
adapter-not-ready
pre-batch-capture-failed
sequence-mismatch
stale-operation-generation
stale-route-epoch
stale-mount-identity
stale-mutation-revision
duplicate-synthetic-callback
unknown-callback-provenance
semantic-verification-mismatch
native-history-clear-failed
edit-lock-failed
native-mutation-during-ai-lock
restore-failed
rollback-failed
identity-changed-unexpectedly
human-settlement-uncertain
```

Feature and failure verification:

```bash
bun run --cwd apps/web test -- \
  src/components/whiteboard/ticket02/SynaraHistoryGate.test.ts

VITEST_BROWSER_API_PORT=<unique-port> bun run --cwd apps/web test:browser:stable -- \
  src/components/whiteboard/ticket02/SynaraHistoryGate.acceptance.browser.tsx \
  2>&1 | tee .planning/synara-whiteboard/evidence/ticket-02/fallback-gate.browser.log
```

Run the stable-Chromium Gate twice from the same clean candidate using different free ports. `fallback-gate.md` records exact candidate SHA, package/version, Chromium/OS/architecture, commands and exits, public APIs used, runtime prohibited-technique audit, scenario matrix, identity/revision/epoch traces, semantic fingerprints, diagnostics, raw-log path, and one verdict.

### CHECKPOINT-GATE

PASS text:

```text
FALLBACK WP-GATE: PASS
Native route ownership: PASS
AI lock: PASS
Completed AI batch exactness: PASS
AI Undo/Redo exactness: PASS
Native clear at committed AI boundaries: PASS
Human mutation invalidates AI history: PASS
Synthetic callback fence: PASS
Adapter identity stability: PASS
Later Ticket 02 packages: ELIGIBLE FOR SEPARATE EXECUTION
```

Any failed row makes the Gate fail. Preserve reproducible evidence, revert the Gate source/evidence commit as a unit if instructed, and stop. Do not scaffold or continue later WPs. A private API, runtime DOM/CSS dependency, shortcut interception, remount workaround, package change, silent contract weakening, or inability to lock native mutation is an immediate `BLOCKER` requiring Supervisor/owner reassessment.

### Commit boundary

One commit only after both focused unit and twice-run browser Gate pass:

```text
feat(whiteboard): prove fallback dual-history gate
```

Do not mix later outcomes/assets/cap/accessibility/native-image work into this commit.

## 7. WP-OUTCOMES-ASSETS-FAILURE — exact outcomes, Take Over, assets, rollback

**Dependency:** exact WP-GATE PASS commit. If Gate regressions appear, stop and return to CHECKPOINT-GATE.

**AC ownership:** completes AC2, AC3, and AC8; expands AC4 and AC10.

### Allowed writes

```text
apps/web/src/components/whiteboard/ticket01/SynaraExcalidrawAdapter.tsx
apps/web/src/components/whiteboard/ticket02/ExcalidrawTicket02Harness.tsx
apps/web/src/components/whiteboard/ticket02/SynaraDocumentSnapshot.ts
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryTypes.ts
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryCoordinator.ts
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryActions.tsx
apps/web/src/components/whiteboard/ticket02/SynaraAiAssetPool.ts
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryCoordinator.test.ts
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryFailure.test.ts
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryAssets.acceptance.browser.tsx
.planning/synara-whiteboard/evidence/ticket-02/fallback-matrix.md
.planning/synara-whiteboard/evidence/ticket-02/fallback-matrix.browser.log
```

### Implementation contract

- Add explicit finalizers for `completed`, containment-acknowledged `interrupted`, and `failed-partial`. Each mutated valid result is one event; invalid/dependent operations are not applied.
- Take Over fences updates immediately. Both routes stay unavailable until containment acknowledgement; timeout/dispatch failure is diagnostic and cannot unlock locally.
- Retry creates a new operation generation against current state; it never resumes or accepts callbacks from the failed/interrupted generation.
- Zero mutation, semantic no-op, zero-valid failure, pre-batch capture failure, and finalization failure with successful rollback create no event and do not alter either route or AI Redo.
- A new mutated AI batch after AI Undo deletes only the AI Redo branch before appending.
- `SynaraAiAssetPool` deduplicates binary ownership and retains data referenced by current content, event before/after snapshots, active batch, or rollback snapshot. Release only unreferenced data after branch deletion, human invalidation, eviction, or lifecycle reset.
- Before restore, validate all required IDs, bytes/data URLs, MIME/metadata, and file-reference closure. Supply the full set with public `addFiles`; then update scene with `captureUpdate: "NEVER"`; then verify references and semantic target.
- For image-bearing AI restore, require meaningful official SVG and PNG export. Orphan package-cache data is not canonical and must not be called bounded without measurement.
- Missing/invalid assets fail before scene replacement with the exact `Couldn't undo/redo AI batch because an image is unavailable. Nothing changed.` message.
- Recoverable restore/finalization failures rollback to command-start state. Successful rollback leaves content, cursor, epochs, events, and native history unchanged and offers `Try again` and `Copy diagnostics`.
- Failed rollback or unprovable callback provenance enters a persistent locked fault with exact `Whiteboard recovery failed` / `Editing is locked to protect the current canvas state.` copy. Never empty-hydrate, drop images, remount, discard unsaved content, advance cursor, or announce success.

### Fixture and verification matrix

Use deterministic producers for completed, Take Over after progress 2 of 3, invalid operation after one valid mutation, dependent operation after invalid input, zero-valid failure, no-op, pre-capture throw, semantic mismatch, addFiles/preflight failure, restore throw, rollback success, and rollback failure. Use a real image fixture from Ticket 01 for browser restore/export; use the smallest lower seam only for deterministic corruption/throw injection and retain the nearest public-boundary browser test.

```bash
bun run --cwd apps/web test -- \
  src/components/whiteboard/ticket02/SynaraAiHistoryCoordinator.test.ts \
  src/components/whiteboard/ticket02/SynaraAiHistoryFailure.test.ts

VITEST_BROWSER_API_PORT=<unique-port> bun run --cwd apps/web test:browser:stable -- \
  src/components/whiteboard/ticket02/SynaraHistoryGate.acceptance.browser.tsx \
  src/components/whiteboard/ticket02/SynaraAiHistoryAssets.acceptance.browser.tsx \
  2>&1 | tee .planning/synara-whiteboard/evidence/ticket-02/fallback-matrix.browser.log
```

Expected evidence includes event/cursor traces for every outcome; acknowledged containment timing; stale-generation rejection; invalid/dependent operation trace; no-op invariance; asset ownership/refcount trace; preflight/addFiles/restore/export order; meaningful SVG/PNG assertions; rollback before/after fingerprints; and locked-fault diagnostic copy.

**Stop rule:** any partial success claim, cursor movement before verification, unlock before Take Over acknowledgement, silent asset loss, rollback that changes history, or Gate regression stops this and all later WPs.

**Commit:** `feat(whiteboard): complete AI history outcomes and recovery`

## 8. WP-CAP-LIFECYCLE — AI-only cap and dual-route resets

**Dependency:** WP-OUTCOMES-ASSETS-FAILURE PASS.

**AC ownership:** AC5 and AC7; cap/lifecycle portions of AC10.

### Allowed writes

```text
apps/web/src/components/whiteboard/ticket02/ExcalidrawTicket02Harness.tsx
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryTypes.ts
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryCoordinator.ts
apps/web/src/components/whiteboard/ticket02/SynaraAiAssetPool.ts
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryCoordinator.test.ts
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryLifecycle.acceptance.browser.tsx
.planning/synara-whiteboard/evidence/ticket-02/fallback-matrix.md
.planning/synara-whiteboard/evidence/ticket-02/fallback-matrix.browser.log
```

### Implementation and proof

- Append 21 finalized mutated AI events; retain exactly events 2–21, preserve their order/cursor semantics, and evict only assets no longer referenced by current content or retained snapshots.
- Create 21 native human edits as a negative assertion: do not trim, count, mirror, or claim the native stack; verify only package-owned behavior required by the scenario.
- Reset native history through public clear and AI history/assets/tokens together, increment `sessionEpoch`, and fresh-capture identity on adapter remount, API/mount identity change, bounded harness eviction, explicit reload/fresh hydration, simulated application restart, close/session termination, duplicate/new identity, import/new identity, clean external reload, conflict replacement, and recovery hydration after fault.
- The feasibility harness may simulate production-origin lifecycle commands as explicit inputs; it must not implement production navigation/persistence/eviction.
- Duplicate/import retains copied current content/assets while both histories start empty. Reload/restart may hydrate current content but never history.
- Same-instance Main-conversation switch is a harness signal proving no history reset. Pan/zoom/selection/tool/no-op also do not reset.
- Reject callbacks and events from a prior session epoch/mount identity after every reset.

```bash
bun run --cwd apps/web test -- \
  src/components/whiteboard/ticket02/SynaraAiHistoryCoordinator.test.ts

VITEST_BROWSER_API_PORT=<unique-port> bun run --cwd apps/web test:browser:stable -- \
  src/components/whiteboard/ticket02/SynaraHistoryGate.acceptance.browser.tsx \
  src/components/whiteboard/ticket02/SynaraAiHistoryLifecycle.acceptance.browser.tsx
```

Evidence records the 21-event IDs, eviction/assets result, absence of a native-cap assertion, each reset trigger with pre/post identities and epochs, stale callback rejection, duplicate/import content equality with empty history, and same-instance switch preservation.

**Stop rule:** inability to reset both routes at a named boundary, history restored after hydration, event 21 evicting more than the oldest AI event, native cap implementation/claim, or stale prior-epoch acceptance blocks later work.

**Commit:** `feat(whiteboard): bound and reset AI session history`

## 9. WP-ACCESSIBILITY — explicit AI actions and focus behavior

**Dependency:** WP-CAP-LIFECYCLE PASS.

**AC ownership:** AC1 and AC9; accessibility portion of AC10.

### Allowed writes

```text
apps/web/src/components/whiteboard/ticket02/ExcalidrawTicket02Harness.tsx
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryActions.tsx
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryAccessibility.acceptance.browser.tsx
.planning/synara-whiteboard/evidence/ticket-02/fallback-matrix.md
.planning/synara-whiteboard/evidence/ticket-02/fallback-matrix.browser.log
```

### Implementation and proof

- Render a named `role="toolbar"` with accessible name `AI history` outside the Excalidraw canvas.
- Use exact labels and contract descriptions for enabled, empty, human-cleared, AI-branch-cleared, active/Take-Over-pending, running, recoverable error, and faulted states.
- Keep unavailable actions focusable with `aria-disabled="true"`, inert activation, discoverable reason, and no native HTML `disabled`.
- Support Enter/Space activation, Left/Right Arrow and Home/End toolbar navigation, and retained focus on the invoked control.
- Add no `aria-keyshortcuts`; leave native shortcuts untouched in canvas, text edit, composer/search/rename/dialog/external input/contenteditable fixtures.
- Provide polite exact completion/interruption/failure/undo/redo/history-cleared announcements without stealing focus.
- At 200% zoom and constrained width, move the whole named group into a harness-only document overflow section titled `AI history`; never collapse to ambiguous icons. Harness Focus mode preserves hierarchy/separation without production navigation wiring.
- Screen-reader assertions inspect roles, names, descriptions, live-region updates, focus order, and locked/recovery messaging using browser-accessible semantics.

```bash
VITEST_BROWSER_API_PORT=<unique-port> bun run --cwd apps/web test:browser:stable -- \
  src/components/whiteboard/ticket02/SynaraHistoryGate.acceptance.browser.tsx \
  src/components/whiteboard/ticket02/SynaraAiHistoryAccessibility.acceptance.browser.tsx
```

**Failure/diagnostic proof:** unavailable activation changes nothing; keyboard scope does not escape modal/text contexts; duplicate announcements are suppressed; recoverable and locked-fault reasons remain copyable/discoverable; layout does not hide the group or replace exact labels.

**Stop rule:** any AI chord/interception, native shortcut capture, inaccessible unavailable reason, focus theft, ambiguous labels, or Gate regression blocks continuation.

**Commit:** `feat(whiteboard): expose accessible AI history actions`

## 10. WP-NATIVE-IMAGE-GATE — conditional package-native image proof

**Dependency:** WP-ACCESSIBILITY PASS. This package is a gate, not an opportunity to change native history behavior.

**AC ownership:** AC6 and native-image portion of AC10.

### Allowed writes

```text
apps/web/src/components/whiteboard/ticket02/SynaraNativeImageHistory.acceptance.browser.tsx
.planning/synara-whiteboard/evidence/ticket-02/native-image-gate.md
.planning/synara-whiteboard/evidence/ticket-02/native-image-gate.browser.log
```

### Browser fixture and proof

Using the pinned real package and public user interaction/official exporters:

1. add a valid image through a supported native human path;
2. capture meaningful element/file-reference and SVG/PNG export evidence;
3. delete the image through a native human mutation;
4. invoke native Undo and verify meaningful image element plus corresponding file/binary reference and meaningful official SVG/PNG export;
5. invoke native Redo and verify the expected deleted state/export;
6. invoke native Undo again to prove repeatable recovery;
7. assert no AI event/action was used and adapter identity stayed stable.

Do not inspect the native stack or package cache. Test-only native control discovery may use browser-accessible role/name observation; runtime files are not touched by this WP.

```bash
VITEST_BROWSER_API_PORT=<unique-port> bun run --cwd apps/web test:browser:stable -- \
  src/components/whiteboard/ticket02/SynaraNativeImageHistory.acceptance.browser.tsx \
  2>&1 | tee .planning/synara-whiteboard/evidence/ticket-02/native-image-gate.browser.log
```

Run twice on the exact candidate. `native-image-gate.md` records package/browser/platform, fixture identity/hash, user sequence, element/file closure, SVG dimensions/content checks, PNG signature/dimensions/non-empty checks, identity, commands/exits, raw log, and exact PASS/FAIL.

**FAIL policy:** preserve evidence and stop final acceptance routing. Do not patch Excalidraw, preload private cache state, substitute AI restore, or call AC6 passed. Return to the Supervisor/owner to narrow or leave the native exact-image promise unaccepted as Decision 0055 requires. Other completed WP evidence remains usable but Ticket 02 is not fully accepted.

**Commit:** `test(whiteboard): gate native image history in Chromium`

## 11. WP-FINAL-EVIDENCE — exact candidate, regression, and workspace gates

**Dependency:** all prior WPs pass, including the native image gate or a new owner-approved contract amendment explicitly changes AC6. No executor may infer that amendment.

**AC ownership:** final integrated check for AC1–AC10.

### Allowed writes

```text
.planning/synara-whiteboard/evidence/ticket-02/fallback-matrix.md
.planning/synara-whiteboard/evidence/ticket-02/fallback-matrix.browser.log
.planning/synara-whiteboard/evidence/ticket-02/final-verification.md
.planning/synara-whiteboard/evidence/ticket-02/final-verification.log
```

No source changes belong in this WP. Any failure returns to the owning WP and creates a new source commit followed by a complete re-run on the new exact candidate.

### Focused feature gates

```bash
bun run --cwd apps/web test -- \
  src/components/whiteboard/ticket01 \
  src/components/whiteboard/ticket02

VITEST_BROWSER_API_PORT=<unique-port> bun run --cwd apps/web test:browser:stable -- \
  src/components/whiteboard/ticket01/SynaraExcalidrawAdapter.acceptance.browser.tsx \
  src/components/whiteboard/ticket02
```

The browser matrix must include native pointer/Delete/text-edit/toolbar/shortcuts; AI lock; completed/interrupted/failed-partial/no-op; all committed AI boundary clears; human settlement/no-op; branch invalidation; delayed/duplicate/unknown callbacks; AI image/assets/export/failures; 21-event cap; resets; constrained-width/200%/screen-reader/Focus-mode accessibility; and native image proof.

### Final workspace-gate policy under `AGENTS.md`

- Never run `bun test`; use `bun run test`.
- `bun fmt`, `bun lint`, and `bun typecheck` are mandatory before completion but may be run only when the current implementation authorization explicitly permits the owner-requested final pass.
- Bundle them once, after focused feature/browser tests pass, rather than repeatedly during iteration.
- If the later implementation decision does not explicitly authorize these heavyweight commands, record an `INFORMATION_GAP`; do not claim completion and ask the owner/Supervisor to authorize the final bundled pass.

When authorized, run from the repository root in one final pass:

```bash
bun fmt
bun lint
bun typecheck
```

Record full command text, start/end time, exit code, candidate SHA, and any warnings separately from errors. A compile/typecheck-only result is not feature proof.

### Final evidence requirements

`final-verification.md` and its raw log must record:

- exact candidate and ancestor Gate/each WP commit;
- Decision 0055 and accepted-design hashes/references;
- changed-path inventory and explicit confirmation that `apps/web/package.json`, `apps/web/src/main.tsx`, and `bun.lock` are unchanged;
- package pin/lockfile provenance and stable Chromium/OS/architecture;
- public APIs used and prohibited-technique audit;
- AC1–AC10 matrix pointing to exact test/evidence rows;
- feature and failure/diagnostic results;
- native image verdict;
- all focused and final command exits;
- residual package limitations without converting them into unsupported claims.

**Commit:** `test(whiteboard): record fallback dual-history evidence`

## 12. Review and Supervisor sequence

1. Freeze the exact candidate after WP-FINAL-EVIDENCE passes; no source or evidence changes afterward without invalidating review.
2. Assign one independent feature-level reviewer who did not implement the candidate.
3. Reviewer reads Decision 0055, accepted design, Ticket AC1–AC10, Decisions 0047/0048/0050, challenge review, exact diff, Gate and final evidence, and raw browser/workspace logs.
4. Reviewer audits replacement—not layering—of the old combined history and keyboard capture; public-only boundaries; AI-only event/cap; committed native clears; human invalidation; revision/epoch/mount fencing; Take Over/no-op/assets/rollback; lifecycle resets; accessibility; native image gate; scope/protected files; and exact-candidate verification.
5. Reviewer writes `.planning/synara-whiteboard/reviews/ticket-02-fallback-implementation-review.md` with per-AC PASS/FAIL, blocking findings, evidence links, candidate SHA, and a clear recommendation. Reviewer PASS is evidence, not acceptance.
6. Any reviewer finding returns to the owning WP, creates a new fix commit, reruns the Gate plus affected and final matrices, refreshes evidence, and requires review of the new exact candidate.
7. After one clean independent PASS, invoke exactly one Supervisor final-acceptance consultation. Only a binding acceptance decision may mark Ticket 02 done or update Project routing.

## 13. Clean commit sequence and rollback

Required isolated-worktree commit sequence:

```text
1. feat(whiteboard): prove fallback dual-history gate
2. feat(whiteboard): complete AI history outcomes and recovery
3. feat(whiteboard): bound and reset AI session history
4. feat(whiteboard): expose accessible AI history actions
5. test(whiteboard): gate native image history in Chromium
6. test(whiteboard): record fallback dual-history evidence
7. docs(whiteboard): review fallback dual-history implementation   # reviewer-owned
```

Each source commit includes its focused tests and no downstream package. Evidence commits must name the exact source candidate they measured. Never amend a measured source commit without regenerating evidence.

Rollback rules:

- Before Gate PASS, revert the whole Gate commit; do not preserve a half-converted coordinator or keyboard route.
- After Gate PASS, the last passing Gate commit is the safety baseline. A later Gate regression removes eligibility for all later work until fixed and re-proved.
- Revert a failed later WP as one coherent commit when its partial state cannot preserve the prior passing contract.
- Never roll back by restoring the old combined human+AI history, wrapper keyboard capture, or per-human-callback native clear.
- Never roll back through package/lock changes, remount recovery, private APIs, or protected Agentation files.
- Evidence from a superseded candidate remains historical only and cannot satisfy final acceptance.

## 14. Diagnostics contract

Diagnostics are user-actionable and test-stable without exposing private package state. In addition to Gate codes, later WPs add at least:

```text
take-over-dispatch-failed
take-over-ack-timeout
post-take-over-update
invalid-operation
dependent-operation-stopped
zero-valid-outcome
asset-preflight-failed
asset-missing
asset-invalid
asset-reference-mismatch
svg-export-verification-failed
png-export-verification-failed
restore-rollback-succeeded
restore-rollback-failed
ai-history-cleared-by-human
ai-redo-cleared-by-new-ai-batch
ai-event-evicted
lifecycle-history-reset
prior-session-callback
unavailable-action
announcement-failed
native-image-recovery-failed
```

Expected diagnostic behavior:

- no false success, cursor/epoch movement, or unlock on failure;
- exact unavailable and recovery copy from the accepted contract;
- persistent recoverable actions `Try again` and `Copy diagnostics`;
- critical locked-fault copy and preserved current content;
- deterministic IDs/context sufficient to reproduce delayed, stale, duplicate, and cross-identity events;
- no raw binary contents or private internal state in copied diagnostics.

## 15. AC traceability

| AC | Primary owner | Final proof |
| --- | --- | --- |
| AC1 route ownership/labels | WP-GATE + WP-ACCESSIBILITY | Native route browser scenarios; exact AI toolbar/labels; no generic dispatcher/chord. |
| AC2 AI event semantics | WP-OUTCOMES-ASSETS-FAILURE | Completed/interrupted/failed-partial/no-op/zero-valid matrix. |
| AC3 exact AI restore/assets | WP-GATE + WP-OUTCOMES-ASSETS-FAILURE | Semantic before/after, addFiles/preflight, viewport/selection, image export. |
| AC4 cross-route invalidation | WP-GATE + outcome regressions | Native clear at each committed AI boundary; first settled human mutation clears AI; AI branch rule. |
| AC5 separate cap | WP-CAP-LIFECYCLE | 21 AI events retain newest 20; no native/combined cap. |
| AC6 native image gate | WP-NATIVE-IMAGE-GATE | Twice-run real-Chromium image add/delete/native Undo/Redo/export verdict. |
| AC7 lifecycle reset | WP-CAP-LIFECYCLE | Every named reset plus same-instance conversation non-reset. |
| AC8 failures/rollback/diagnostics | WP-OUTCOMES-ASSETS-FAILURE | Preflight, mismatch, callback provenance, rollback success/failure, locked fault. |
| AC9 accessibility/focus | WP-ACCESSIBILITY | 200%, constrained width, keyboard, roles/names/descriptions/live regions, Focus-mode harness. |
| AC10 browser/prohibitions | Every WP; finalized by WP-FINAL-EVIDENCE | Stable real embed, full matrix, exact-candidate audit, protected/prohibited path confirmation. |

No AC is unowned. AC6 remains explicitly conditional on its gate and cannot be silently waived.

## 16. Decisions, planning choices, and implementation questions

### Supplied binding decisions

- Dual routes are separate; native human and explicit Synara AI history never dispatch each other.
- Every committed mutated AI boundary clears all native history.
- First settled semantic human mutation clears all AI history/assets.
- Only AI history has a 20-event cap.
- There is no first-release AI keyboard chord.
- Native image exactness is a real-Chromium gate.
- Named lifecycle boundaries reset both routes.
- Exact labels/copy, AI outcomes, assets, Take Over, no-op, rollback, locking, revision/epoch/mount fencing, and public-only constraints are contract-determined.

Executors must not reopen these as design questions.

### Evidence-backed planning choices

- Replace the old coordinator/types/commands rather than adapt their mixed event model; this prevents hidden layering of superseded assumptions.
- Keep one decisive Gate and serialize later WPs because adapter/coordinator/harness write sets overlap and every later proof depends on Gate invariants.
- Separate the native image gate so a package limitation is recorded honestly without contaminating AI exactness evidence.
- Use deterministic lower-seam fault injection only for failures that cannot be induced reliably through the public browser boundary, paired with the nearest real-browser proof under Decision 0047.

### Open implementation questions bounded by the contract

These are discovery tasks inside the named WP, not authority to change product semantics:

1. **Public human-settlement signal:** determine the smallest public adapter observation/timing policy that reliably distinguishes settled pointer, Delete, text-edit, native Undo/Redo, and presentation/no-op behavior. If certainty is unavailable, conservatively invalidate AI history and emit `human-settlement-uncertain`; do not preserve stale AI history.
2. **Native control activation in browser tests:** use stable accessibility roles/names or direct user shortcuts only in test code. If the pinned package exposes no stable observable native control for a required assertion, preserve behavior-level evidence and report the test observability gap; do not add runtime selectors.
3. **Fault injection seam:** prefer injected adapter operations/producer scheduling over package mocks. If a required missing-asset/rollback fault cannot be induced without changing production-shaped APIs, stop for review of the smallest test-only substitution allowed by Decision 0047.
4. **Canvas identity fixture:** the isolated harness must inject a stable test canvas identity and explicit lifecycle signals; it must not import production navigation/store ownership. Production identity integration remains later scope.
5. **Constrained-width overflow fixture:** implement only a harness-local layout seam sufficient to prove semantics/hierarchy; do not wire the production Whiteboard header or overflow.

A need for package/config/lock changes, production lifecycle/navigation, private history access, or contract weakening is not an open question; it is a `BLOCKER`.

## 17. Plan safety validation

- **Acyclic dependencies:** PASS — Gate precedes all later serialized WPs; review and Supervisor are terminal consumers.
- **Parallel write safety:** PASS — no implementation WPs are declared parallel; reviewer owns only the review artifact after candidate freeze.
- **Acceptance ownership:** PASS — AC1–AC10 each have a primary owner and final exact-candidate check.
- **Produced-contract consumers:** PASS — Gate contracts feed all later WPs; outcome/assets feed cap/lifecycle and final matrix; all evidence feeds review; review feeds Supervisor consultation.
- **Protected scope:** PASS — protected Agentation files, production navigation, WP-CORE, package/lock/config, Project/Ticket/decisions, and unrelated source are prohibited.
- **Failure/diagnostic coverage:** PASS at plan level — every material success seam has explicit negative/diagnostic proof and stop conditions.
- **Rollback safety:** PASS — no intermediate state reintroduces combined history or keyboard capture; last passing Gate remains baseline.
- **Decision gates:** PASS — native image failure and any public-boundary failure return to owner/Supervisor rather than being silently resolved.

**Plan disposition:** bounded and dependency-ordered. It becomes executable only if a later implementation-boundary decision cites Decision 0055, approves this exact scope/write set, explicitly authorizes source/test/evidence work and the final `AGENTS.md` workspace-gate policy, and preserves the protected Agentation exclusions.
