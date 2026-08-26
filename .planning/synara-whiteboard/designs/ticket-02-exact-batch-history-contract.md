# Ticket 02 design contract — exact AI edit-batch Undo and Redo

Status: Proposed for Supervisor decision
Date: 2026-08-26
Ticket: `../issues/02-prove-ai-batch-undo-redo.md`

## Purpose

Ticket 02 is a feasibility gate over the pinned real `@excalidraw/excalidraw@0.18.1` embed. It must prove that one completed, Take-Over-interrupted, or failed partial AI edit batch is exactly one user-visible Undo/Redo event without exposing progressive checkpoints.

This ticket does not wire production RightDock, persistence, agent orchestration, File canvases, or durable version history.

## Authoritative product invariants

- One complete or interrupted AI batch is one Undo event.
- An invalid operation is not applied; prior valid partial work remains and is one Undo event.
- Human events and AI batches share one ordered, in-memory history capped at 20 events per open canvas.
- Undo/Redo state is not restored after restart and is reset on duplication.
- Toolbar and platform keyboard shortcuts use one coherent command route.
- A new semantic edit after Undo invalidates the Redo branch.
- Real Excalidraw Chromium evidence is mandatory; mocked editor behavior is insufficient.
- No fork, private source import, or undocumented package mutation is permitted.

## Exact Excalidraw 0.18.1 evidence

### Public capabilities

`ExcalidrawImperativeAPI` publicly exposes:

- `updateScene` with `captureUpdate`;
- `getSceneElements` and `getSceneElementsIncludingDeleted`;
- `getAppState`;
- `getFiles` and `addFiles`;
- official restore, serialization, and export utilities;
- `history.clear()`.

It does not publicly expose:

- `history.undo()` or `history.redo()`;
- history stack inspection;
- `beginTransaction`, `endTransaction`, a transaction identifier, or a batch commit;
- a public way to trim native history to 20 events.

### Capture semantics

- `IMMEDIATELY` creates an immediate native history increment.
- `NEVER` updates the package snapshot without creating a native history entry.
- `EVENTUALLY` defers capture until a later immediate commit and is not an isolated transaction.

Ticket 01 proved in real Chromium that progressive `NEVER` updates remain visible but do not become an ordinary native Undo step. Therefore AI progress can stay outside native history, but the exact batch recovery event must be Synara-owned.

### Files and images

Native Excalidraw history records element and observed app-state changes, not the `BinaryFiles` map. Image elements reference files separately. Exact image-bearing Undo/Redo therefore requires Synara to retain and preload required file binaries; native history alone is insufficient.

### Native toolbar and keyboard route

Native toolbar buttons and `Cmd/Ctrl+Z` share Excalidraw's internal ActionManager and History instance. The typed public `UIOptions.canvasActions` surface includes export/load/save/theme/background/clear actions, but not Undo or Redo.

The runtime ActionManager can internally gate arbitrary action names, but supplying undocumented `undo`/`redo` keys outside the public type would violate the accepted package boundary.

`viewModeEnabled` disables native Undo/Redo but also prevents human editing, so it is not a complete mixed-history solution.

## Evaluated directions

| Direction                                   | Result                                                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Native history transaction/grouping         | Rejected: no public transaction API or deterministic batch boundary.                                        |
| Hybrid native-human plus Synara-AI history  | Rejected: no native stack inspection/trim, image binaries are outside history, and two cursors can diverge. |
| Remount to restore snapshots                | Rejected: loses API identity/focus/viewport and contradicts non-remount direction.                          |
| Fork or private History/Store access        | Rejected by project boundary.                                                                               |
| Fully Synara-owned snapshot command history | Recommended, subject to native-route containment proof.                                                     |

## Recommended architecture

### One source of truth

Each mounted canvas session owns one `SynaraSessionHistory`:

```text
events: HistoryEvent[]  // maximum 20
cursor: 0..events.length
activeTransaction: none | human | ai-batch | restoring
assetPool: referenced binary files retained once per fingerprint
```

No second user-visible native history may remain active.

### Event model

```ts
type HistoryEvent =
  | {
      kind: "human";
      id: string;
      before: DocumentSnapshot;
      after: DocumentSnapshot;
    }
  | {
      kind: "ai-batch";
      id: string;
      batchId: string;
      outcome: "completed" | "interrupted" | "failed-partial";
      acceptedUpdateCount: number;
      before: DocumentSnapshot;
      after: DocumentSnapshot;
    };
```

A snapshot contains canonical document elements, a semantic fingerprint, whitelisted document state, and references to binaries in a session asset pool. It does not blindly snapshot viewport, selection, focused tool, theme, status UI, or the complete package `AppState`.

### AI batch lifecycle

1. `begin`: capture immutable pre-batch document snapshot and lock human mutation.
2. `progress`: enforce batch identity and contiguous sequence; apply each accepted update through `updateScene(... captureUpdate: "NEVER")`; do not append a history event.
3. `completed`: capture and verify final snapshot; append one event only if a semantic mutation occurred.
4. `interrupted`: finalize only after deterministic containment acknowledgement; reject stale later updates; append the valid partial result as one event.
5. `failed-partial`: do not apply the invalid operation or dependent later operations; retain prior valid progress and append it as one event.
6. `zero-valid failure/no-op`: append no event.

### Undo and Redo

- Undo restores `event.before`; Redo restores `event.after`.
- Required binaries are preflighted and added before scene restore.
- Programmatic restore uses `captureUpdate: "NEVER"`.
- Semantic verification must pass before moving the cursor.
- Restore failure leaves the cursor unchanged and attempts rollback to the command-start snapshot.
- Restore plus rollback failure faults and locks the history coordinator rather than claiming success.
- Viewport and selection are preserved as presentation state unless a later accepted decision explicitly changes that policy.

### Branching and bound

- A new accepted semantic mutation after Undo deletes the Redo branch immediately.
- A no-op interaction does not invalidate Redo.
- Appending event 21 evicts only the oldest event; it does not clear the full stack.
- Current document and retained snapshots hold independent asset references so eviction cannot remove an image needed by the current scene.
- Duplication and fresh session hydration start with an empty history while retaining current content and required assets.

### Human event feasibility scope

Ticket 02 must prove representative real-package grouping for:

- one pointer gesture with multiple callbacks;
- one discrete keyboard mutation such as Delete;
- one multi-keystroke text-edit session.

Selection-only, viewport, zoom, tool selection, and no-op interactions do not create document-history events.

This is feasibility coverage, not production-complete classification of every Excalidraw action.

## Native-route containment gate

Ticket 02 cannot rely on private ActionManager access, undocumented UI option keys, private CSS selectors, or monkey-patching native history.

The first browser work package must test this public-only composition:

1. a Synara-owned toolbar outside the package calls the same `SynaraHistoryCommands` dispatcher as wrapper-level platform keyboard capture;
2. programmatic AI updates and history restores use `captureUpdate: "NEVER"`;
3. after every observed human document mutation, the adapter calls public `api.history.clear()` before exposing a settled Synara event;
4. real Chromium proves native Undo/Redo controls remain disabled and native keyboard handling cannot mutate the scene around the Synara route;
5. wrapper keyboard capture preserves standard `Cmd/Ctrl+Z` and platform Redo behavior through the Synara dispatcher.

For the feasibility harness, disabled native controls may remain rendered. Production UI replacement/hiding remains later work only if the browser proof establishes they are never an active competing route.

If a native control becomes active/reachable, an intermediate state can be restored, or public `history.clear()` cannot contain the route without breaking human event capture, AC4 and AC7 fail. Ticket 02 must record reproducible blocking evidence rather than use undocumented keys or DOM-dependent workarounds.

## Required browser scenarios

1. Completed batch: three progressive states finalize as one event; one Undo jumps final to pre-batch; one Redo restores final.
2. Take Over partial: two valid updates, containment acknowledgement, stale update rejection, one partial event, exact Undo/Redo.
3. Invalid partial: one valid update, invalid next operation, dependent operation skipped, one failed-partial event.
4. Zero-valid failure: no scene change and no new event.
5. Image-bearing batch: Redo restores element references, binaries, and valid SVG/PNG export.
6. Unified commands: Synara toolbar and platform keyboard move the same cursor through human and AI events.
7. Native containment: package-native buttons remain disabled and cannot mutate the scene; no undocumented integration is used.
8. Redo invalidation: Undo then a new human mutation removes the Redo branch.
9. Mixed bound: 21 alternating human/AI events retain only the newest 20; exactly 20 Undo and 20 Redo operations remain.
10. Duplicate and fresh-session reset: content survives the harness transition while history starts empty.
11. Human grouping: pointer gesture, Delete, and text-edit session each create one event.
12. Restore failure and missing asset: no partial success, cursor remains unchanged, diagnostic is explicit.
13. AC7 reproduction: if public-only route containment is impossible, record exact package/browser/steps/observed competing behavior and stop broad implementation.

## Diagnostics

Diagnostics must identify AC, phase, package version, session/event/batch identity, expected versus observed result, and recoverability. Required surfaces include capture failure, sequence mismatch, invalid operation, stale update, missing asset, semantic mismatch, native-history containment failure, restore failure, rollback failure, and unexpected human mutation during AI lock.

## Performance boundary

Feasibility may use full immutable before/after snapshots with deduplicated assets. Capture occurs at transaction boundaries, not at every AI progress update. Measurements must cover normal and image-bearing scenes without inventing a production budget. Delta history is deferred unless evidence demonstrates a need.

## Proposed Supervisor decisions

1. **D1 — History ownership:** Synara owns the complete user-visible session history; native history is containment-only and may only be cleared through the public API.
2. **D2 — Public-only route gate:** A Synara toolbar plus wrapper keyboard capture is acceptable only if real Chromium proves native controls remain disabled and cannot mutate the scene. Otherwise Ticket 02 fails AC7; undocumented UI keys/DOM workarounds are forbidden.
3. **D3 — No-op batches:** A batch with zero accepted semantic mutation consumes no history event.
4. **D4 — Presentation state:** Undo/Redo restore document content while preserving current viewport, zoom, and selection.
5. **D5 — Asset semantics:** Canonical active file references define image state. Orphan binary data remaining in Excalidraw's internal cache is a non-blocking bounded limitation; no private deletion API is used.
6. **D6 — Human feasibility scope:** Ticket 02 proves pointer, discrete keyboard, and text-edit grouping; exhaustive action classification belongs to later implementation.
7. **D7 — Snapshot-first boundary:** Full before/after document snapshots with a deduplicated asset pool are the feasibility architecture; optimization is evidence-driven later.
8. **D8 — Work order:** Implement native-route containment and one completed batch first. Do not build the full 20-event matrix until this hard public-boundary gate passes.

## Expected change surface

- Extend the existing isolated adapter only with Synara-owned snapshot/restore and package-history-clear seams.
- Add a package-independent history coordinator under a new Ticket 02 folder.
- Add a lazy Ticket 02 harness and real-Chromium acceptance suite.
- Reuse Ticket 01 fixture, semantic comparator, diagnostics, exports, viewport handling, and package pin.
- Do not modify production navigation, server, contracts, persistence, package version, or lockfile.
