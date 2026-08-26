# Whiteboard integration research

Research date: 2026-08-26

## Local Synara seams

- Composer context chips already have reusable insertion, rendering, removal, draft persistence, and send-time materialization patterns in:
  - `apps/web/src/lib/terminalContext.ts`
  - `apps/web/src/composerDraftDomain.ts`
  - `apps/web/src/components/ComposerPromptEditor.tsx`
  - `apps/web/src/components/composer-nodes/index.tsx`
  - `apps/web/src/components/ChatView.tsx`
- Existing context chips may carry full text payloads. Whiteboard selection chips must not copy element JSON into the prompt, Lexical editor state, or local storage. The performance-safe shape is a bounded reference containing Whiteboard identity, selected element IDs, and a revision.
- Composer draft subscriptions currently expose the whole thread draft object. Selection updates must not be published at pointer-move frequency because doing so would repeatedly render the Main conversation.
- The recommended event boundary is selection settlement, such as pointer-up plus a short debounce. Send-time materialization resolves the referenced elements once.
- Right-sidebar pane identity, Project ownership, restoration diagnostics, keep-mounted behavior, and tab deduplication are implemented through:
  - `apps/web/src/rightDockStore.logic.ts`
  - `apps/web/src/rightDockStore.ts`
  - `apps/web/src/components/chat/RightDock.tsx`
  - `apps/web/src/components/chat/SingleChatSurface.tsx`
- Workspace file opening currently routes every supported path to a generic file pane. `.excalidraw` requires explicit extension dispatch if it is to open as a canvas rather than JSON text.
- The existing execution-strip pattern provides server-acknowledged cancellation states, disabled pending actions, diagnostics, and a suitable visual precedent for the Whiteboard status bar.

## Official Excalidraw API findings

- Current researched package version: `@excalidraw/excalidraw` 0.18.1. It is ESM-only.
- `onChange` provides the full element collection and `appState`; selected IDs are available through `appState.selectedElementIds`. Synara must compare selected IDs and skip downstream work when they have not changed.
- `excalidrawAPI.updateScene` supports imperative progressive scene updates without remounting the component.
- `viewModeEnabled` provides a host-controlled coarse editing lock while preserving viewing behavior.
- `captureUpdate` supports `IMMEDIATELY`, `EVENTUALLY`, and `NEVER`, but Excalidraw does not expose a public begin/end history transaction.
- Excalidraw has no cancellation token or operation identity for `updateScene`. Synara must fence streamed updates with its own operation generation so updates arriving after Take Over are ignored.
- Official utilities support `.excalidraw` serialization and PNG/SVG export.
- Excalidraw does not provide durable Version history; Synara owns canonical persistence.

## Recommended performance contract

1. Keep Excalidraw mounted while its pane is hidden; suspend unnecessary visible-only work rather than rebuilding the canvas.
2. Store one lightweight selection reference per chip: Whiteboard ID, selected element IDs, and source revision.
3. Publish selection changes only after pointer-up or a short debounce; never serialize the scene during pointer movement.
4. Resolve and serialize selected content only when the user sends the Main-chat request.
5. Drive AI updates through one ordered operation stream and `updateScene`, never through repeated `initialData` replacement.
6. Lock editing while AI owns the operation, but keep progressive scene updates visible.
7. Increment an operation generation on Take Over and reject every later update from the old generation.
8. Own the AI edit-batch undo boundary in Synara. Do not depend solely on Excalidraw's eventual history capture for the exact one-Undo product guarantee.

## Authoritative sources

- https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api
- https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props
- https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/excalidraw-api
- https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/initialdata
- https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/ui-options
- https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils
- https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils/export
- https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils/restore
- https://github.com/excalidraw/excalidraw/releases/tag/v0.18.0
- https://github.com/excalidraw/excalidraw/discussions/3778
