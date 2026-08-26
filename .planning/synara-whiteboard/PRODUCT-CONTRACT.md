# Synara Whiteboard product contract

Status: confirmed by the owner on 2026-08-26.

## Outcome

Synara adds an Excalidraw-based, Project-owned Whiteboard tool to the Right sidebar. People can draw manually, use selected visual elements as Main-chat context, ask an agent to create or update diagrams, and work with both Synara-native Whiteboards and Project `.excalidraw` files without creating a second chat surface.

## Native Whiteboards

- A Project may own multiple named Whiteboards shared by every Main conversation in that Project.
- The first automatic name is `board`; later names use the next available numbered form.
- Whiteboards open as multi-instance tabs in the existing Right-sidebar workspace.
- Native Whiteboards use Synara's database as their canonical store and Auto-save after changes settle.
- Saving exposes `Saving...`, `Saved`, and a persistent retryable `Not saved` state.
- Closing a native Whiteboard in `Not saved` state requires Retry save, Discard changes, or Cancel.
- The launcher supports New, recent cached thumbnails, name search, Rename, Duplicate, Export, and confirmed Delete.
- Duplicate copies elements and image assets into a new Whiteboard identity, resets Undo/Redo, opens the copy, and excludes AI execution and composer-chip state.
- Focus mode expands the same Whiteboard, hides the transcript, retains the single Main composer, and restores the same tab and viewport when closed.
- The canvas follows Synara's theme and displays a FigJam-like dot grid.

## Main conversation context

- Whiteboard has no separate chat or composer.
- Every selected element appears as its own lightweight chip in the Main composer.
- Canvas selection and chips synchronize in both directions.
- Switching Main conversations clears all unsent Whiteboard chips and deselects their elements; chips are not copied, persisted, or restored across conversations.
- A selection above the measured safe per-element-chip threshold is represented by one selection-set chip backed by the complete selected-ID set and bounded agent reads.
- A chip is a context reference, not an authorization or editing boundary.
- Before send, a chip contains only Whiteboard identity, element identity, and revision information.
- At send, Synara resolves the latest current state of each selected element and snapshots it with minimal directly related context such as bound text, connected endpoints, group, or frame relationships.
- Sent snapshots preserve the request's original meaning and do not navigate back to a Whiteboard.
- Deleted unsent context is removed; temporarily unavailable context remains diagnostic and contributes no fabricated payload.
- Synara never injects an entire unselected Whiteboard JSON document into the prompt. Agents inspect required content through the Whiteboard tool API.

## Agent editing

- Agents use a validated Synara Whiteboard tool API rather than raw Excalidraw JSON.
- Agent editing requires explicit context: a named Whiteboard, selected chips, a clear request about the Active Whiteboard, or an explicit diagram-creation request.
- A clear diagram request creates `board` automatically when no Whiteboard exists.
- New content is placed in available space near selected context or the current viewport and does not overwrite unrelated diagrams.
- Multi-element generated diagrams are placed in named frames.
- While an agent edits, direct element interaction is locked, but pan and zoom remain available.
- Progressive updates remain visible under a fixed `Agent is working on it...` status bar with Take Over.
- Take Over preserves valid partial work, stops further updates, prevents retry, and ends the agent turn in a controlled way.
- Every streamed update is fenced by operation identity so stale updates after Take Over, failure, or deletion are rejected.
- An invalid operation is not applied; the edit stops, prior valid work remains, the board unlocks, and Retry and Undo remain available.
- One completed, interrupted, or failed partial AI edit batch is one Undo event.

## Undo and Redo

- Each open canvas retains at most 20 recent Undo/Redo events in memory.
- The limit covers both human actions and AI edit batches.
- Undo/Redo is not restored after Synara restarts.
- The product has no durable Version history.

## File canvases

- Opening a Project `.excalidraw` file opens a File canvas rather than raw JSON.
- A File canvas remains backed by its file and is not listed as a native Whiteboard unless explicitly imported.
- An agent may edit an explicitly referenced File canvas; accepted edits participate in host-owned File-canvas Auto-save.
- Human and agent edits make the File canvas temporarily `Unsaved`; settled Auto-save writes the backing Project file and may create a Git working-tree change without a separate Save action.
- A clean File canvas automatically reloads an external file change.
- If local unsaved changes exist because Auto-save is pending, failed, or conflicted, Synara preserves them and offers appropriate Retry, Reload, Save As, Keep Editing, Discard, or Cancel actions.
- Closing an `Unsaved` File canvas requires Retry save, Discard changes, or Cancel.
- Synara does not auto-merge divergent Excalidraw JSON.
- Import as Whiteboard creates a separate native Whiteboard.
- Opening a third canvas flushes pending Auto-save for the canvas selected for unmount. If the write fails or conflicts, unresolved content remains explicit and must not be represented as saved.
- Quitting Synara consolidates unresolved native and File-canvas changes into an explicit retry, discard, or cancel flow. Crash or force-kill restores only confirmed native content and confirmed file writes.

## Import, export, and images

- Importing `.excalidraw` creates a new native Whiteboard by default and never silently replaces the active board.
- Export supports editable `.excalidraw`, PNG, and SVG.
- PNG and SVG omit the dot grid by default and offer `Include grid background`.
- Whiteboards accept pasted images, dropped images, and images selected from Project Files.
- Image binaries are stored separately from element and chip metadata.
- Oversized images are resized or compressed when safe and otherwise rejected with a clear diagnostic.

## Right-sidebar and performance contract

- Embed the official `@excalidraw/excalidraw` package behind a Synara-owned integration boundary; do not fork Excalidraw.
- Follow existing Right-sidebar sizing, remembered width, clamping, tab, Project ownership, restoration-diagnostic, and lifecycle conventions.
- Do not enter Focus mode automatically.
- Keep at most the active and most recently used canvas instances mounted; flush Auto-save and unload the older eligible canvas before mounting another.
- Do not publish selection changes at pointer-move frequency or serialize element payloads into composer drafts.
- Drive progressive edits through ordered imperative scene updates rather than remounting Excalidraw.
- Generate and cache thumbnails only after settled successful saves.
- The first release adds no dedicated large-board mode, element limit, or large-board warning.

## First-release non-goals

- Real-time multiplayer or shared cursors.
- A Whiteboard-specific chat or composer.
- Durable Version history.
- A template library.
- Navigation from sent chips back to elements.
- A View changes camera action during agent work.
- Canvas-specific Right-sidebar sizing behavior.
- Whiteboard-specific global keyboard shortcuts.
- Automatic merge of divergent `.excalidraw` files.
- A special reduced-function mode for large Whiteboards.

## Acceptance scenarios

1. **Native board creation**: a Project without Whiteboards receives a clear diagram request → Synara creates and opens `board`, the agent streams a valid diagram, and the board Auto-saves.
2. **Bidirectional context**: selecting three elements → three lightweight chips appear; deselecting one or closing one chip removes the corresponding selection without payload churn.
3. **Agent containment**: while an agent streams updates → direct editing is locked, pan/zoom work, Take Over stops stale updates, partial content remains, and one Undo removes the batch.
4. **Invalid agent operation**: a streamed operation fails validation → it is not applied, later dependent operations stop, prior valid work remains, and the board unlocks with diagnostic Retry and Undo.
5. **Project continuity**: switching Main conversations within one Project → the same Whiteboard tabs and state remain; switching Projects → each Project's Whiteboards remain isolated.
6. **Session history**: more than 20 edit events occur → only the newest 20 remain undoable; restarting Synara preserves current content but not Undo/Redo.
7. **File canvas persistence**: an agent edits an opened `.excalidraw` file → the canvas becomes temporarily Unsaved, host Auto-save writes the backing file atomically after changes settle, and Git may show the resulting change without a separate Save action.
8. **External file conflict**: a backing file changes while local edits exist → Synara preserves local state and requires Reload, Save As, or Keep Editing rather than merging or overwriting.
9. **Import/export**: importing creates a new native Whiteboard; exporting produces valid `.excalidraw`, PNG, and SVG, with grid inclusion opt-in for rendered formats.
10. **Bounded resource use**: many Whiteboard tabs are opened → only the active and most recent canvas remain mounted, while clean unloaded tabs restore their document and viewport when revisited.
