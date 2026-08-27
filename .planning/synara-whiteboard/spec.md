# Synara Whiteboard

**Project:** synara-whiteboard
**Project home:** [PROJECT.md](PROJECT.md)
**Status:** ready-for-fallback-implementation-planning
**Tracker:** Local Markdown
**History amendment:** [Decision 0055](decisions/0055-ticket-02-fallback-dual-history-contract-approved.md)

## Problem Statement

Synara users can run Main conversations beside Project tools, but they do not have a Project-owned visual workspace for sketching ideas, mapping flows, explaining architecture, or turning conversation content into diagrams. They must leave Synara, use an unrelated drawing application, manually transfer context, and manage visual files separately from the Project workspace.

The missing integration also prevents agents from safely understanding and editing visual material. There is no bounded way to attach selected diagram elements to the Main composer, no validated agent operation surface, no visible and interruptible streaming edit lifecycle, and no reliable distinction between a native Synara document and a Project `.excalidraw` file. A naive embed would risk large composer payloads, canvas remount churn, uncontrolled filesystem writes, ambiguous ownership, stale streamed updates, and misleading save or cancellation states.

Users need one predictable Whiteboard experience that follows the existing Project-owned Right-sidebar workspace, preserves Main conversation continuity, performs reliably under active drawing and agent streaming, and makes every persistence, conflict, failure, and takeover state explicit.

## Solution

Add an Excalidraw-based **Whiteboard tool** to the existing Right sidebar. Each Project can own multiple named **Whiteboards** that are shared across all Main conversations in that Project, restored across navigation and restart, and isolated from other Projects. Whiteboards stored canonically by Synara Auto-save after changes settle.

Whiteboard uses the existing Main conversation rather than creating another chat. Selected canvas elements appear as lightweight **Whiteboard selection chips** in the Main composer, while a selection above the measured safe threshold appears as one **Whiteboard selection-set chip**. Canvas selection and chips remain synchronized in both directions, and switching Main conversations clears all unsent Whiteboard chips and deselects their elements. Before send, chips contain bounded references only; at send, Synara resolves the latest current element state and creates immutable context snapshots with the minimum related visual context needed by the agent.

Agents interact through a validated Synara-owned Whiteboard tool API instead of raw Excalidraw JSON. An **AI Whiteboard edit** streams ordered changes into the canvas while direct element editing is locked. The user can still pan and zoom, observe progress under an `Agent is working on it...` status bar, and use **Take Over** to contain the operation and resume control. A completed, acknowledged interrupted, or failed-partial **AI edit batch** with valid semantic mutations is exactly one Synara AI-batch event, recoverable through explicitly labeled `Undo AI batch` and `Redo AI batch` actions.

The same editor also opens Project `.excalidraw` files as **File canvases**. File canvases remain file-backed and distinct from native Whiteboards. Human and agent edits participate in host-owned settled Auto-save to the backing Project file, so accepted canvas edits may create Git working-tree changes without a separate Save action.

The experience follows existing Right-sidebar ownership, sizing, tab, restoration, and lifecycle conventions. It embeds the official `@excalidraw/excalidraw` package behind a Synara-owned integration boundary, uses a FigJam-like dot grid, supports Focus mode, images, import and export, bounds mounted canvas instances, and avoids moving full scene data through the composer or prompt.

## User Stories

1. As a Project user, I want to create a blank Whiteboard explicitly, so that Projects without visual work do not accumulate unused documents.
2. As a Project user, I want a clear diagram request in the Main conversation to create `board` when no Whiteboard exists, so that the agent can fulfill my explicit intent without a separate setup step.
3. As a Project user, I want the first automatic Whiteboard name to be `board`, so that creation is predictable.
4. As a Project user, I want later automatic names to use `board 2`, `board 3`, and the next available number, so that unnamed Whiteboards remain distinguishable.
5. As a Project user, I want to rename a Whiteboard without changing its identity, so that references and persistence survive display-name changes.
6. As a Project user, I want multiple Whiteboards in one Project, so that separate visual topics do not need to share one document.
7. As a Project user, I want every Main conversation in a Project to access the same Whiteboards, so that visual work belongs to the Project rather than one conversation.
8. As a Project user, I want Whiteboards from different Projects to remain isolated, so that content cannot cross Project boundaries.
9. As a Project user, I want a Whiteboard to open in the existing Right-sidebar tab system, so that it behaves like the Project’s other tools.
10. As a Project user, I want opening an already-open Whiteboard to activate its existing tab, so that the same document is not represented by duplicate tabs.
11. As a Project user, I want native Whiteboards to Auto-save after changes settle, so that ordinary editing does not require a Save button.
12. As a Project user, I want truthful `Saving...`, `Saved`, and persistent `Not saved` states, so that I know whether current content is durable.
13. As a Project user, I want failed Auto-save to remain retryable, so that transient persistence failures do not discard my work.
14. As a Project user, I want closing a tab or quitting Synara with unresolved changes to require Retry save, Discard changes, or Cancel, so that orderly close cannot silently lose content.
15. As a Project user, I want current native Whiteboard content restored after Synara restarts, so that the Whiteboard is durable.
16. As a Project user, I want corrupt or unrestorable Whiteboard content to remain visible as an explicit diagnostic tab, so that failure is not hidden by opening an empty replacement.
17. As a Project user, I want to duplicate a Whiteboard with all elements and owned images, so that I can branch visual work safely.
18. As a Project user, I want a duplicate to receive a new identity and predictable copy name, so that it is independent from the original.
19. As a Project user, I want duplication to reset Undo/Redo and exclude active agent and composer-chip state, so that transient session state does not leak into the copy.
20. As a Project user, I want the duplicate to open as the Active Whiteboard, so that I can work on it immediately.
21. As a Project user, I want deleting a whole Whiteboard to require confirmation, so that a visual document is not removed accidentally.
22. As a Project user, I want deletion to remove only assets owned by that Whiteboard, so that unrelated images remain intact.
23. As a Project user, I want deletion during an AI Whiteboard edit to require Take Over or explicit stop-and-delete, so that late updates cannot target deleted content.
24. As a Project user, I want archived Projects to retain their Whiteboards, so that restoring a Project restores its visual workspace.
25. As a Project user, I want deleting a Project to delete its Whiteboards after active operations are contained, so that Project-owned data does not remain accessible.
26. As a Project user, I want a Whiteboard launcher in the Right sidebar, so that I can create and find visual documents without leaving the workspace.
27. As a Project user, I want the launcher to show recent Whiteboards with names, cached thumbnails, and recent activity, so that I can recognize documents quickly.
28. As a Project user, I want to search Whiteboards by name, so that a Project with many Whiteboards remains navigable.
29. As a Project user, I want launcher actions for Rename, Duplicate, Export, and confirmed Delete, so that lifecycle actions are available where I choose a board.
30. As a Project user, I want a Whiteboard icon when no thumbnail is available, so that preview generation never blocks navigation.
31. As a Project user, I want thumbnails generated only after settled successful saves and idle time, so that drawing and agent streaming remain responsive.
32. As a Project user, I want Whiteboard to use the existing Main conversation, so that visual and textual work remain in one conversation history.
33. As a Project user, I want each element in an ordinary selection to appear as its own Whiteboard selection chip, so that I can provide precise visual context.
34. As a Project user, I want deselecting an element to remove its corresponding chip, so that the composer reflects current selection.
35. As a Project user, I want closing a chip to deselect its corresponding element, so that canvas and composer remain synchronized.
36. As a Project user, I want chips to remain lightweight references before send, so that selection does not serialize large element payloads into the composer.
37. As a Project user, I want a selection above the measured safe threshold represented by one selection-set chip without losing selected IDs, so that large selections do not overwhelm the composer.
38. As a Project user, I want sending a request to snapshot the latest current state of each selected element, so that the agent receives what exists when I press Send without repeated draft updates.
39. As a Project user, I want sent context to include minimal bound text, connector endpoints, group, and frame relationships, so that the agent understands the selected element.
40. As a Project user, I want related context distinguished from explicitly selected elements, so that the system does not imply I selected more than I did.
41. As a Project user, I want switching Main conversations to clear unsent Whiteboard chips and deselect their elements, so that visual context cannot leak into another conversation.
42. As a Project user, I want an unsent chip removed when its source element or Whiteboard is deleted, so that deleted context is not sent.
43. As a Project user, I want temporarily unavailable unsent context to remain visible with a diagnostic, so that restoration problems are explicit.
44. As a Project user, I want an unselected Whiteboard represented by a bounded reference rather than complete scene JSON, so that prompts remain efficient.
45. As an agent, I want to inspect only required Whiteboard content through the tool API, so that I do not need the whole document in every prompt.
46. As a Project user, I want selection chips to provide context without restricting the agent to those elements, so that related requested changes remain possible.
47. As a Project user, I want agent editing to require explicit Whiteboard context or diagram-creation intent, so that unrelated Whiteboards are not modified proactively.
48. As a Project user, I want an explicitly named Whiteboard to take targeting precedence, so that direct naming is deterministic.
49. As a Project user, I want a clearly referenced Active Whiteboard to be the default unnamed target, so that continuation requests remain convenient.
50. As a Project user, I want the sole Whiteboard used only after an eligible edit request is established, so that its existence does not manufacture edit intent.
51. As a Project user, I want the agent to ask me to choose when multiple target candidates remain, so that it cannot guess and modify the wrong document.
52. As a Project user, I want agents to use validated operations rather than raw Excalidraw JSON, so that malformed edits cannot corrupt the document.
53. As an agent, I want operations to read, create, update, move, resize, style, connect, group, frame, and delete elements by stable identity, so that visual work has a maintained API.
54. As a Project user, I want operations validated for Project ownership, document revision, element identity, references, bounds, and supported values, so that invalid mutations fail closed.
55. As a Project user, I want progressive AI Whiteboard updates to remain visible, so that I can observe work rather than wait for an opaque replacement.
56. As a Project user, I want direct element interaction locked while the agent owns an edit, so that human and agent mutations cannot race.
57. As a Project user, I want pan and zoom to remain available while editing is locked, so that I can inspect the changing document.
58. As a Project user, I want a fixed `Agent is working on it...` status bar with Take Over, so that operation ownership is always visible.
59. As a Project user, I want Take Over to preserve valid partial work, so that interruption does not discard useful progress.
60. As a Project user, I want Take Over to stop later updates and end the agent turn in a controlled way, so that control genuinely returns to me.
61. As a Project user, I want Take Over to prevent automatic retry, so that the agent cannot resume work I stopped.
62. As a Project user, I want the Whiteboard to unlock only after containment is acknowledged or a failure is shown, so that UI state cannot misrepresent a live operation.
63. As a Project user, I want streamed updates fenced by operation identity and generation, so that duplicate, out-of-order, late, stale, or post-Take-Over updates cannot change canonical state.
64. As a Project user, I want an invalid agent operation left unapplied and dependent operations stopped, so that failures do not cascade.
65. As a Project user, I want valid operations before a failure to remain visible, so that recoverable partial work is retained.
66. As a Project user, I want an invalid operation to unlock the board with a diagnostic, Retry, and Undo, so that recovery is explicit.
67. As a Project user, I want Retry to create a new operation generation against current state, so that a failed generation cannot resume.
68. As a Project user, I want agent-created content placed in free space near selected context or my current viewport, so that unrelated diagrams are not overwritten.
69. As a Project user, I want multi-element generated diagrams placed in named frames, so that generated results form understandable visual units.
70. As a Project user, I want AI-generated diagrams to use restrained colors, clear contrast, and consistent styling, so that they remain readable.
71. As a Project user, I want the camera to remain under my control during AI work, so that streamed updates do not unexpectedly move my viewport.
72. As a Project user, I want one completed AI edit batch to be exactly one Synara AI-batch event, so that a multi-operation result can be reverted once through `Undo AI batch`.
73. As a Project user, I want an acknowledged interrupted or failed-partial AI edit batch with valid mutations to remain exactly one AI-batch event, while progressive updates, no-ops, and zero-valid failures create none.
74. As a Project user, I want Excalidraw's native toolbar and platform shortcuts to own human Undo/Redo, while Synara's explicitly labeled AI actions own AI-batch recovery, so that the routes cannot be confused; native exact image recovery is accepted only after a real-Chromium gate.
75. As a Project user, I want every committed AI boundary to clear all native Undo/Redo, so that stale native history cannot be applied after an AI snapshot restore.
76. As a Project user, I want the first settled semantic human mutation after AI activity to clear all AI Undo/Redo, while proven no-ops and presentation-only changes preserve it, so that stale AI snapshots cannot overwrite later manual work.
77. As a Project user, I want at most 20 finalized AI-batch events retained per open canvas session, with event 21 evicting only the oldest AI event, while native capacity remains package-defined and unclaimed.
78. As a Project user, I want both native and AI histories reset on remount, reload, restart, close or eviction, duplication/import as a new identity, conflict replacement, and recovery hydration, so that history remains session-only.
79. As a Project user, I want no durable Version history surface, so that the first release remains a working canvas rather than a document-versioning product.
80. As a Project user, I want opening a Project `.excalidraw` file to open a File canvas rather than raw JSON, so that I can work visually.
81. As a Project user, I want a File canvas to remain backed by its Project file and separate from native Whiteboards, so that ownership is unambiguous.
82. As a Project user, I want a File canvas excluded from the Whiteboard launcher unless imported, so that native and file-backed documents are not conflated.
83. As a Project user, I want an explicitly referenced File canvas to support in-memory agent editing, so that I can use agent assistance on repository diagrams.
84. As a Project user, I want human and agent edits to mark a File canvas temporarily `Unsaved` until host Auto-save succeeds, so that save truth remains explicit.
85. As a Project user, I want settled File-canvas edits Auto-saved through authorized atomic Project-file writes, so that the backing `.excalidraw` file remains current without a separate Save action.
86. As a Project user, I want a clean File canvas to reload when its backing file changes externally, so that it follows the current file safely.
87. As a Project user, I want dirty local File-canvas changes preserved when the backing file changes, so that external updates cannot overwrite my work.
88. As a Project user, I want Reload, Save As, and Keep Editing choices for a dirty conflict, so that resolution is explicit.
89. As a Project user, I want Synara never to auto-merge divergent Excalidraw JSON, so that unsafe structural merges are not presented as trustworthy.
90. As a Project user, I want failed or conflicting File-canvas Auto-save to preserve `Unsaved` state and diagnostics, so that the UI cannot claim persistence that failed.
91. As a Project user, I want opening a third canvas to flush pending Auto-save before the older File canvas is unmounted, so that bounded canvas mounting cannot lose file changes.
92. As a Project user, I want Import as Whiteboard to create an independent native Whiteboard, so that later native and file changes do not silently mirror each other.
93. As a Project user, I want importing `.excalidraw` to create a new native Whiteboard by default, so that import never silently replaces the Active Whiteboard.
94. As a Project user, I want malformed or unsupported `.excalidraw` input rejected with a clear diagnostic, so that invalid documents cannot corrupt native storage.
95. As a Project user, I want to export editable `.excalidraw`, so that Whiteboards remain interoperable with Excalidraw.
96. As a Project user, I want to export PNG and SVG, so that Whiteboards can be shared as rendered assets.
97. As a Project user, I want PNG and SVG to omit the dot grid by default, so that the workspace background is not unexpectedly included.
98. As a Project user, I want an `Include grid background` option, so that I can intentionally preserve the grid.
99. As a Project user, I want export failures reported without claiming success, so that missing output is diagnosable.
100. As a Project user, I want to paste, drop, or choose Project images, so that visual references fit normal desktop workflows.
101. As a Project user, I want image binaries stored separately from elements and chips, so that document metadata and composer context remain bounded.
102. As a Project user, I want oversized images safely resized or compressed when acceptable, so that they do not make the canvas unresponsive.
103. As a Project user, I want an unsafe image rejected with a clear diagnostic, so that performance is protected without silent degradation.
104. As a Project user, I want missing or corrupt image assets represented diagnostically, so that the rest of the Whiteboard remains recoverable.
105. As a Project user, I want Focus mode to expand the same Whiteboard, so that identity and editing state remain continuous.
106. As a Project user, I want Focus mode to hide the transcript while retaining the Main composer, so that the canvas gains space without creating another chat.
107. As a Project user, I want selection chips and sending to continue in Focus mode, so that expanded visual work remains connected to the Main conversation.
108. As a Project user, I want leaving Focus mode to restore the same tab, viewport, and zoom, so that presentation changes do not reset my place.
109. As a Project user, I want Escape to leave Focus mode when the canvas does not own Escape, so that the expanded state has a conventional exit.
110. As a Project user, I want Whiteboard to follow existing Right-sidebar width, resizing, clamping, and Main-conversation minimum width, so that layout remains consistent.
111. As a Project user, I want constrained width to avoid overwriting my preferred width, so that the workspace restores when space returns.
112. As a Project user, I want Whiteboard never to enter Focus mode automatically, so that layout changes remain under my control.
113. As a Project user, I want switching Main conversations within one Project to retain Whiteboard tabs and document state while clearing unsent chips and canvas selection, so that the workspace remains Project-owned without transferring prompt context.
114. As a Project user, I want switching Projects to restore each Project’s separate Whiteboards, so that continuity does not compromise isolation.
115. As a Project user, I want standard Excalidraw editing shortcuts to remain available, so that the drawing experience is familiar.
116. As a Project user, I want no Whiteboard-specific global shortcut in the first release, so that global keyboard behavior is not expanded without a broader design.
117. As a Project user, I want at most the Active Whiteboard and most recently used canvas mounted, so that memory does not grow with every open tab.
118. As a Project user, I want a clean unloaded canvas to restore its document and viewport when revisited, so that resource bounds do not lose context.
119. As a Project user, I want progressive scene updates applied in order without remounting Excalidraw, so that streaming stays responsive and view state survives.
120. As a Project user, I want pointer movement excluded from composer-draft writes, so that drawing does not cause Main-conversation churn.
121. As a Project user, I want selected context materialized once at send, so that context generation does not repeat during editing.
122. As a Project user, I want thumbnails excluded from pointer and streamed-update work, so that previews cannot compete with active interaction.
123. As a Project user, I want no arbitrary element limit or reduced-function mode, so that document size does not introduce a separate product state.
124. As a keyboard user, I want launcher actions, tabs, Focus mode, dialogs, Save, Retry, Undo, conflict actions, and Take Over keyboard-operable, so that core workflows do not require a pointer.
125. As a screen-reader user, I want save, AI operation, lock, conflict, failure, and completion states announced meaningfully, so that visual status is not the only source of truth.
126. As a user with motion sensitivity, I want streaming and status transitions to respect reduced-motion preferences, so that agent editing remains comfortable.
127. As a Project user, I want focus to move predictably across launcher, tabs, Focus mode, dialogs, and Take Over completion, so that keyboard context is not lost.
128. As a Project user, I want duplicate destructive actions disabled while confirmation or containment is pending, so that repeated input cannot create conflicting operations.
129. As a Project user, I want failures represented by persistent or actionable diagnostics rather than transient disappearance, so that failure remains distinguishable from success.
130. As a Project user, I want performance and failure behavior verified on empty, representative normal, image-bearing, and large-selection Whiteboards, so that acceptance is not based only on trivial documents.

## Implementation Decisions

### Domain model and ownership

- Model a native **Whiteboard** and a **File canvas** as distinct document kinds that share one editor integration but have different ownership and persistence semantics.
- Give every native Whiteboard a stable identity independent of its editable display name.
- Scope Whiteboards, owned image assets, selection references, pane descriptors, agent operations, and persistence commands to exactly one Project.
- Keep **Active Whiteboard** as presentation and targeting state, not document ownership.
- Represent current native document state with a revision suitable for optimistic persistence, context snapshots, stale-operation rejection, and diagnostics.
- Treat dot-grid, viewport, zoom, and theme-derived appearance as presentation state rather than ordinary drawable elements.
- Do not introduce durable Version history.

### Contracts

- Add strict shared schemas for Whiteboard identity, document kind, metadata, native document state, image references, pane descriptors, per-element and selection-set references, sent element snapshots, agent operations, ordered progress, operation generations, diagnostics, and File-canvas Auto-save state.
- Keep the shared contracts package schema-only; runtime mutation, persistence, and Excalidraw translation belong outside it.
- Bound identifiers, names, diagnostics, operation counts, element-reference counts, and serialized payload sizes.
- Reject malformed, unknown, oversized, stale, cross-Project, partial, or unsupported data rather than repairing it silently.
- Keep compatibility additive for the new Right-sidebar pane kind and preserve explicit restoration diagnostics for unsupported or failed content.

### Native persistence and assets

- Use Synara’s database as the canonical store for native Whiteboards.
- Persist current document content, metadata, viewport restoration state, dot-grid preference, image references, revision, save state required for recovery, and thumbnail metadata.
- Do not persist Undo/Redo history.
- Store image binaries separately and link them through owned references rather than embedding them in selection chips or repeatedly duplicating them in document metadata.
- Use revision-checked, Project-scoped writes and coalesce ordinary changes into settled Auto-save operations rather than writing per pointer movement.
- Preserve truthful `Saving...`, `Saved`, and retryable `Not saved` transitions.
- On restart, restore only confirmed durable content; never claim that an unsettled or failed revision was saved.
- Duplicate content and exclusively owned assets under a new Whiteboard identity without exposing an incoherent partial duplicate.
- Delete only assets proven to belong exclusively to the deleted Whiteboard.
- Preserve archived Project data and remove Project-owned Whiteboard data during confirmed Project deletion.

### Excalidraw integration boundary

- Embed a pinned official `@excalidraw/excalidraw` release behind a Synara-owned integration boundary; do not fork Excalidraw.
- Keep Excalidraw implementation details out of canonical domain persistence, composer context, and agent contracts.
- Make the integration boundary responsible for hydration, restoration, normalized serialization, selection settlement, imperative scene updates, edit locking, viewport capture and restoration, image insertion, import/export, operation translation, and the separate native-human/AI-batch history seams.
- Drive progressive AI work through ordered imperative scene updates; do not remount the editor or repeatedly replace initial data.
- Keep direct editing locked during AI ownership while retaining pan and zoom.
- Keep Excalidraw native Undo/Redo as the human route and expose only labeled `Undo AI batch`/`Redo AI batch` actions for AI snapshots; do not add a first-release AI keyboard shortcut or generic dispatcher.
- Clear all native history after every committed AI boundary and clear all AI history after the first settled semantic human mutation.
- Do not claim native history capacity or exact native image recovery without the required real-Chromium gate; AI image recovery remains exact through public asset preflight and verification.
- Reset both histories at every approved mount, lifecycle, identity, and recovery boundary; neither history is durable.
- Do not rely on an undocumented Excalidraw history transaction for AI exactness; Synara owns the AI edit-batch recovery boundary.

### Right-sidebar panes and canvas retention

- Add Whiteboard as a Project-owned, multi-instance Right-sidebar tool kind.
- Use content identity to activate an already-open native Whiteboard or File canvas rather than creating duplicate tabs.
- Preserve active tab, tab order, preferred width, rendered clamping, viewport, Focus-mode presentation, and restoration diagnostics across Main-conversation switches.
- Isolate pane and document restoration by Project.
- Follow existing Right-sidebar open width, resize, Main minimum-width, and preferred-width behavior without canvas-specific automatic Focus handling.
- Keep at most two canvas instances mounted: the active instance and the most recently used eligible instance.
- Flush settled persistence and unload the older eligible inactive canvas while retaining restorable viewport state.
- Before unmounting a File canvas to open a third canvas, flush pending host Auto-save through the authorized backing-file write path.
- If native or File-canvas persistence fails or conflicts, preserve unresolved content and present an actionable Retry, Discard, Save As, Keep Editing, or Cancel path rather than reporting success or discarding work.
- Closing a tab with unresolved content or quitting Synara requires an explicit consolidated resolution flow; crash or force-kill restores only confirmed native content and confirmed File-canvas writes.
- Retain failed restoration as an explicit diagnostic pane.

### Launcher and lifecycle commands

- Provide launcher data for New, recent native Whiteboards, cached thumbnails, recent activity, name search, Rename, Duplicate, Export, and confirmed Delete.
- Generate automatic names from the first available `board`, `board 2`, `board 3`, and later numbered form.
- Generate duplicate names as `<name> copy`, then `copy 2`, `copy 3`.
- Duplicate elements and owned images, reset Undo/Redo, omit active AI operation and composer-chip state, and activate the new tab.
- Require confirmation before deleting a whole Whiteboard.
- When deletion encounters active agent ownership, require Take Over or explicit stop-and-delete, wait for confirmed containment, advance the operation generation, then remove canonical data and owned assets.
- Generate and cache thumbnails only after a confirmed settled save and idle interval; use a Whiteboard icon when no cached thumbnail exists.

### Main-composer context bridge

- Represent each visible per-element chip as one bounded reference containing Project identity, Whiteboard identity, element identity, and source revision used for provenance and diagnostics.
- Above a centralized measured threshold, replace per-element rendering with one selection-set chip backed by the complete selected-ID set and bounded batched agent reads; never silently truncate the selection.
- Do not store element JSON, scene JSON, image binaries, or full bound-context payloads in composer editor state or persisted drafts.
- Publish chip changes only when settled selected-element identities actually change; element content changes do not republish composer draft state.
- Synchronize canvas selection and chip removal in both directions without feedback loops.
- Switching Main conversations clears all unsent Whiteboard chips and deselects their elements without copying or restoring them in another conversation draft.
- At send, resolve each reference or selection set exactly once against the latest current element state and produce immutable snapshots plus minimal directly related context.
- Mark related context distinctly from explicit selections.
- Remove a chip when its source is confirmed deleted; retain a diagnostic chip when the source is temporarily unavailable and send no empty or fabricated payload.
- Preserve sent snapshots independently of later rename, deletion, or mutation.
- Do not make sent snapshots navigable back to mutable Whiteboard state in the first release.
- For an explicitly referenced but unselected Whiteboard, send bounded identity context only and let the agent read on demand.

### Agent Whiteboard tool API

- Expose a strict, versioned Synara-owned API rather than raw Excalidraw JSON.
- Separate bounded read operations from mutation operations.
- Read operations support metadata, summaries, element lookup, relation lookup, and relevant-region inspection.
- Mutation operations support create, update, move, resize, style, connect, group, frame, and delete by stable element identity.
- Every mutation carries Project identity, document kind and identity, expected document revision, AI edit-batch identity, operation identity, generation, and sequence position.
- Validate an operation completely before applying it.
- Reject malformed, unsupported, oversized, cross-Project, stale-revision, stale-generation, duplicate, out-of-order, and invalid-reference operations.
- Stop dependent later operations after the first invalid operation while retaining prior valid changes as the partial AI edit batch.
- File-canvas mutation authority is in-memory only; the agent API has no filesystem Save capability.
- Distinguish validation failure, stale state, cancellation, containment timeout, persistence failure, and document unavailability in tool results and diagnostics.
- Retry creates a fresh operation and generation against current state rather than reviving the failed generation.

### Agent targeting, streaming, and containment

- Establish edit eligibility before target resolution: the request must name a Whiteboard, contain its chips, clearly refer to the Active Whiteboard, explicitly reference a File canvas, or explicitly request diagram creation.
- After eligibility, resolve explicit identity or name first, then the Active Whiteboard, then the sole available Whiteboard; ask the user when ambiguity remains.
- Treat a clear diagram request as explicit creation authority and create `board` only when the Project has no Whiteboard.
- Use one AI edit-batch identity per user request and apply operations in strict order.
- Show progressive changes under a fixed operation status outside the canvas.
- Take Over advances the generation for immediate stale-update rejection, dispatches stop, waits for containment acknowledgement, prevents retry, and ends the associated agent turn.
- Do not unlock solely because the local UI dispatched cancellation.
- Reject stale updates at canonical-state admission, not only in rendering.
- On stop dispatch failure or acknowledgement timeout, keep the board protected and expose an actionable failure state.
- On invalid operation, stop the stream, retain prior valid changes, finalize one partial AI edit batch, unlock after containment, and expose Retry and Undo.
- Apply the same containment protocol before deleting a Whiteboard with active agent ownership.

### Placement and generated style

- Place new content near selected context when selection exists and otherwise near the current viewport in available space.
- Detect occupied bounds and avoid moving, replacing, or covering unrelated diagrams merely to create room.
- Put multi-element generated diagrams in named frames.
- Preserve stable identities when updating existing elements.
- Generate restrained colors, strong contrast, legible typography, clear connector routing, and internally consistent style.
- Do not move the user’s viewport automatically during streamed work and do not add a View changes action.

### Undo and Redo

- Keep native Excalidraw human Undo/Redo and Synara AI-batch Undo/Redo as separate in-memory routes per open canvas session; do not model them as one stack, cursor, or combined event list.
- Excalidraw owns native human pointer, keyboard, text-edit, toolbar, Undo, and Redo behavior. Synara owns only labeled `Undo AI batch` and `Redo AI batch` actions; no AI keyboard shortcut is added in the first release.
- After every committed semantically mutated AI batch or successful AI restore, clear all native Excalidraw Undo and Redo through the supported public history-clear seam before exposing or unlocking the resulting state.
- After the first settled semantic human mutation following AI activity, clear all AI Undo and Redo. Native human Undo/Redo count as mutations; proven no-ops and presentation-only changes do not.
- Retain at most 20 finalized AI-batch events per open canvas session. Event 21 evicts only the oldest AI event; native capacity, grouping, and eviction remain package-defined and unclaimed.
- Capture immutable AI before/after snapshots. Progressive updates create no events; completed, acknowledged interrupted, and failed-partial mutated batches create exactly one; zero-mutation and successful rollback outcomes create none.
- AI Undo/Redo restores exact semantic scene and active image/file references through public asset preflight, `addFiles`, `captureUpdate: "NEVER"`, and post-restore verification. Native human image recovery is a real-Chromium gate and must be narrowed if it fails.
- After AI Undo, a new mutated AI batch clears only the AI Redo branch. Native branch behavior remains native.
- Remount, reload, restart, close or eviction, duplication/import as a new identity, conflict replacement, and recovery hydration reset both histories. Neither route is persisted.

### File-canvas persistence and conflicts

- Dispatch Project `.excalidraw` files to the visual editor rather than a generic JSON preview.
- Keep the normalized in-memory document and backing-file revision or fingerprint distinct.
- Opening a File canvas does not create a native Whiteboard record or launcher entry.
- Agent operations mutate the in-memory File canvas and mark it temporarily `Unsaved`; the agent API itself exposes no filesystem-write command.
- Host-owned settled Auto-save writes human and agent edits through a server-authorized Project path, expected backing fingerprint, and atomic replacement.
- Successful Auto-save updates the backing fingerprint and clears `Unsaved`; failed or conflicting Auto-save retains unresolved state and an actionable diagnostic.
- Automatically reload an external change only while the File canvas is clean.
- When an external change arrives while dirty, stop automatic reload and offer Reload, Save As, and Keep Editing.
- Do not auto-merge divergent Excalidraw JSON.
- Flush pending Auto-save before File-canvas unmount; if flushing fails or conflicts, preserve unresolved state and follow the confirmed lifecycle-resolution flow.
- Import as Whiteboard copies the chosen current state into a new native identity and creates no ongoing synchronization.

### Import, export, and images

- Validate imported `.excalidraw` data through strict decoding and official restoration utilities before creating native state.
- Import creates a new native Whiteboard and never replaces the Active Whiteboard implicitly.
- Support editable `.excalidraw`, PNG, and SVG through official Excalidraw utilities.
- Treat the dot grid as a rendering preference, omit it from PNG/SVG by default, and include it only through the explicit option.
- Preserve the grid preference in editable document state where supported.
- Route clipboard paste, drag-and-drop, and Project-file image selection through one ingestion boundary.
- Decode and measure an image before committing element or asset state.
- Resize or compress images that exceed measured safe bounds when quality remains acceptable.
- Reject images that remain unsafe without leaving partial assets or elements.
- Preserve current document state and expose actionable diagnostics on import, image, or export failure.

### Focus mode and accessibility

- Implement Focus mode as presentation state of the existing Whiteboard tab, not a new document, route owner, or conversation.
- Hide the transcript while retaining the same Main composer and current Main conversation.
- Preserve selection chips, viewport, zoom, tab identity, and Project ownership across entry and exit.
- Provide visible exit controls and support Escape when it does not conflict with an active Excalidraw interaction.
- Do not enter Focus mode automatically.
- Make launcher actions, tabs, dialogs, save states, AI status, Take Over, Retry, Undo/Redo, export controls, and conflict actions keyboard-operable.
- Announce saving, saved, not saved, unsaved, conflict, agent working, stop pending, stopped, validation failure, hydration failure, and export failure with meaningful semantics.
- Manage focus explicitly across launcher, tab activation, Focus mode, confirmations, conflicts, and operation completion.
- Respect reduced-motion preferences and maintain sufficient contrast for dot grid, chips, diagrams, diagnostics, and lock states.
- Do not encode success or failure only through color, transient toast, or disappearance.

### Performance and policy values

- Measure empty, representative normal, image-bearing, and large-selection Whiteboards.
- Keep chip storage and composer updates bounded by per-element references or one selection-set reference rather than scene size.
- Virtualize or collapse large-selection presentation at the measured threshold, preserve the complete selected-ID set, and read it in bounded batches.
- Materialize the latest selected context once per send.
- Coalesce progressive updates while preserving semantic order and never remount Excalidraw per update.
- Instrument and enforce the two-mounted-canvas bound.
- Suspend avoidable visible-only work for the hidden retained canvas.
- Generate thumbnails only after successful settled saves and idle time.
- Do not serialize full unselected documents into Main-chat context.
- Select Auto-save delay, selection-settlement delay, thumbnail idle delay, cancellation timeout, image bounds, and latency or memory budgets from profiling; centralize them as measurable policy rather than scattered UI literals.
- Do not add a special large-board mode, product-level element limit, or large-board warning.

## Testing Decisions

See the accepted project-scoped [Testing Strategy Governance Reassessment Decision Record](decisions/0047-testing-strategy-governance-reassessment.md).

## Out of Scope

- Real-time multiplayer collaboration, shared cursors, or presence.
- A Whiteboard-specific chat, transcript, or composer.
- Durable Version history or recovery points across restart.
- A template library for Flowchart, Mind map, Kanban, or other diagram types.
- Navigation from a sent Whiteboard selection chip back to a mutable element.
- A View changes action or automatic camera following during agent work.
- Canvas-specific Right-sidebar width or automatic Focus-mode behavior.
- Whiteboard-specific global keyboard shortcuts.
- Automatic merge of divergent `.excalidraw` files.
- A dedicated large-Whiteboard warning, product-level element limit, or reduced-function mode.
- Automatic Whiteboard creation during Project provisioning or unrelated conversation.
- Proactive agent modification of a Whiteboard without explicit eligible context.
- Persisted Undo/Redo stacks.
- Continuous mirroring between a native Whiteboard and a File canvas imported from it.
- Forking or maintaining a Synara-specific Excalidraw drawing engine.

## Further Notes

- The confirmed product contract and project decision records are binding for implementation. Tickets may refine implementation seams but must not reopen confirmed product behavior without decision-changing evidence and owner authority.
- Project vocabulary in `terms.md` is normative for this effort. In particular, **Whiteboard**, **Whiteboard tool**, **File canvas**, **Active Whiteboard**, **Whiteboard selection chip**, **Whiteboard selection-set chip**, **AI Whiteboard edit**, **AI edit batch**, **Focus mode**, and **Take Over** must not be replaced with ambiguous alternatives.
- The [Project-owned Right-sidebar workspace ADR](../../docs/adr/0001-project-owned-right-sidebar-workspace.md) remains authoritative for ownership, persistence across Main-conversation switches, Project isolation, restoration diagnostics, preferred width, and Project lifecycle behavior.
- Concrete delays, timeouts, image thresholds, and performance budgets are implementation policy values that must be selected from profiling and verified through the accepted testing strategy. Selecting those values does not authorize a new product-visible mode or warning.
- The exact one-event AI Undo mechanism must be proven with the pinned real Excalidraw package before implementation is accepted; it must not rely solely on undocumented internal history assumptions.
- Local Markdown is the normative tracker. Future implementation tickets belong under this Project Home and carry the configured triage labels without duplicating the normative spec elsewhere.
