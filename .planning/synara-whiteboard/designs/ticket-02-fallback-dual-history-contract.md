# Ticket 02 accepted fallback contract — dual human/AI history

**Status: Accepted — owner-approved**
**Decision:** [Decision 0055 — fallback dual-history contract approved](../decisions/0055-ticket-02-fallback-dual-history-contract-approved.md)
**Date:** 2026-08-27
**Ticket:** [02 — Prove exact AI edit-batch Undo and Redo](../issues/02-prove-ai-batch-undo-redo.md)
**Activated direction:** [Decision 0054](../decisions/0054-ticket-02-public-history-boundary-research-failed-fallback-activated.md), following [Decision 0053](../decisions/0053-ticket-02-owner-package-reassessment-with-ai-history-fallback.md)
**Supporting UX design:** `/tmp/synara-ticket02-fallback-ux-result.md`
**Supporting independent challenge review:** `/tmp/synara-ticket02-fallback-review-result.md`

> The owner explicitly replied **`Đồng ý`** to all six rules in this contract. Decision 0055 makes this an accepted binding product amendment. It authorizes only bounded implementation planning; it does not authorize source, test, package, lockfile, evidence-log, or broad Ticket 02 implementation changes.

## 1. Purpose and approved boundary

Decision 0054 records that the supported Excalidraw public surface cannot provide the previously required host-owned single history route. Direction 4 is therefore active for contract design only:

- Excalidraw owns native human Undo/Redo.
- Synara owns dedicated AI-batch Undo/Redo over verified snapshots.
- The routes are deliberately separate; this contract does not claim one stack, one cursor, or one mixed Version-history timeline.

The approved fallback boundary includes this explicit tradeoff: a committed AI route boundary clears all native human history, and the first settled semantic human mutation clears all Synara AI history. Decision 0055 revises the affected product and Ticket 02 acceptance language. A later bounded implementation-boundary decision is still required before source work; broad implementation remains prohibited.

## 2. User mental model

The user-facing explanation is:

> **Manual edits and AI changes have separate history.**
>
> - Excalidraw's ordinary **Undo/Redo** changes manual edits only.
> - Synara's **Undo AI batch/Redo AI batch** changes AI batches only.
> - Starting a semantic edit through the other route closes the previous route's history epoch.

This is not presented as a single timeline, shared cursor, combined event list, or durable Version history. The safety promise is stronger than cross-route continuity: an old full-document AI snapshot must never be offered after later manual work, and stale native history must never be offered after an AI boundary.

A first-use, dismissible, non-focus-stealing explanation may appear once after the first mutated AI batch:

> **AI changes have separate history**
> Use **Undo AI batch** here. `⌘Z` on Mac or `Ctrl+Z` on Windows and Linux only undoes manual edits.

## 3. Route ownership and presentation

### Native human route — Excalidraw-owned

- Excalidraw owns the package-native toolbar Undo/Redo and package-native platform keyboard behavior.
- Human pointer, keyboard, text-edit, native toolbar, native Undo, and native Redo behavior remains package-owned.
- Synara does not shadow every human mutation as an event and does not provide a generic replacement for native controls.
- Synara does not claim a native event count, native stack cap, oldest-native-event eviction, or exact native image recovery until real Chromium proves the relevant behavior.
- Native controls remain in their normal package location. They are not relabeled, duplicated, hidden, intercepted, or replaced by Synara.

### Synara AI route — Synara-owned

Place a Synara-owned group outside the Excalidraw canvas, in the Whiteboard header/status rail at the trailing edge of the canvas header. The hierarchy is:

1. Whiteboard identity and save state;
2. active agent-operation status, when present;
3. flexible space;
4. a visibly labeled **AI history** toolbar containing:
   - `Undo AI batch`;
   - `Redo AI batch`;
5. existing document-level overflow actions.

The group remains visible for a healthy open canvas even when both actions are unavailable. In constrained width, the entire group moves into a document-level overflow section titled **AI history**; it must not collapse into ambiguous bare Undo/Redo icons. Focus mode preserves the same separation and relative hierarchy. There is no mixed history panel, shared cursor, generic `Undo changes` command, or unlabeled paired arrows.

### No generic dispatcher

There is no dispatcher that chooses between a human event and an AI event based on the latest activity. Native human commands stay in Excalidraw; AI commands are explicit Synara actions. A source implementation must not reintroduce the earlier shared `undo`/`redo` command route or make a generic label appear to operate on both histories.

## 4. Exact labels, states, and announcements

The Synara labels are always exactly:

- **Undo AI batch**
- **Redo AI batch**

They must not be shortened to `AI Undo`, `Undo AI`, `Undo changes`, or `Undo`.

| State | Visible label | Tooltip / accessible description |
| --- | --- | --- |
| AI Undo enabled | `Undo AI batch` | `Undo the latest AI batch. Manual undo is separate.` |
| AI Redo enabled | `Redo AI batch` | `Redo the last undone AI batch. Manual redo is separate.` |
| Empty Undo | `Undo AI batch` | `No AI batch to undo.` |
| Empty Redo | `Redo AI batch` | `No AI batch to redo.` |
| Cleared by human mutation | `Undo AI batch` | `Unavailable because manual edits started after the AI change.` |
| Redo cleared by human mutation | `Redo AI batch` | `Unavailable because manual edits started after the undone AI change.` |
| Redo cleared by new AI batch | `Redo AI batch` | `Unavailable because a new AI batch replaced the redo branch.` |
| AI operation active or Take Over pending | both unchanged | `Available after the agent finishes or Take Over is confirmed.` |
| Undo running | `Undoing AI batch…` | `Undoing the latest AI batch.` |
| Redo running | `Redoing AI batch…` | `Redoing the last undone AI batch.` |
| Recoverable restore error | normal label | `AI batch was not undone. Try again.` / `AI batch was not redone. Try again.` |
| Faulted recovery or unrestored canvas | normal label | `Unavailable while Whiteboard recovery needs attention.` / `Unavailable until the Whiteboard is restored.` |

AI controls use `aria-disabled="true"`, not native HTML `disabled`, so the unavailable action remains discoverable and its exact reason can be announced. Activation while unavailable is inert. Persistent recoverable diagnostics include **Try again** and **Copy diagnostics**; a critical diagnostic says:

> **Whiteboard recovery failed**
> Editing is locked to protect the current canvas state.

Polite announcements include:

- `AI batch completed. Undo AI batch is available.`
- `AI batch stopped. Partial AI changes were kept as one batch.`
- `AI batch failed. Valid partial changes were kept as one batch.`
- `AI batch undone.`
- `AI batch redone.`
- `AI history cleared because manual editing started.`

## 5. Conservative keyboard and focus policy

### First release has no AI keyboard shortcut

The first release adds **no dedicated AI keyboard chord**. This resolves the UX/reviewer disagreement conservatively and avoids competing with Excalidraw, text editing, browser, assistive technology, or external input behavior.

- AI actions are visible, explicitly labeled, and keyboard-accessible buttons.
- `Enter` and `Space` invoke the focused AI action.
- Standard toolbar navigation uses Left/Right Arrow and Home/End.
- Native `Cmd/Ctrl+Z`, native Redo, and any package-supported alternatives remain entirely package-owned.
- Synara does not capture, stop, or reinterpret native Undo/Redo keyboard events.
- No `aria-keyshortcuts` value is advertised for AI actions in this release because there is no AI chord.

### Focus precedence

1. In the ordinary canvas, native human chords pass untouched to Excalidraw.
2. During Excalidraw text editing, native text-edit behavior remains native; AI actions are not invoked and Synara never ends text editing to restore a scene.
3. In the Main composer, search, rename field, dialog field, external input, or any `contenteditable`, Synara handles no history shortcut.
4. In the named `role="toolbar"` with accessible name `AI history`, arrow navigation, Home/End, Enter, and Space follow standard toolbar behavior. Unavailable controls remain focusable and inert.
5. While an agent streams or Take Over acknowledgement is pending, both history routes are unavailable. Pan and zoom remain available if the supported view-mode/edit-lock boundary permits it.
6. Dialogs and menus retain keyboard scope and cannot be bypassed by AI controls.

Pointer and keyboard activation leave focus on the invoked AI button. Successful restore does not focus a restored element, open text editing, recenter the camera, or animate the viewport. First-use education, status announcements, and recovery diagnostics do not steal focus.

## 6. Identity, epoch, and revision model

The coordinator must never decide applicability from a semantic fingerprint alone. A fingerprint can repeat after unrelated edits (the ABA problem). Every history record and synthetic callback is checked against all of:

```text
canvasIdentity   // stable native Whiteboard or File-canvas identity
mountIdentity    // current Excalidraw instance identity
sessionEpoch     // increments when the in-memory history session is reset
mutationRevision // monotonic semantic document revision within the epoch
routeEpoch       // human/AI boundary generation
```

A Synara AI event stores:

- `canvasIdentity`, `mountIdentity`, `sessionEpoch`, and `routeEpoch`;
- operation identity and operation generation;
- immutable semantic `before` and `after` document snapshots;
- expected `beforeRevision` and `afterRevision`;
- outcome: `completed`, `interrupted`, or `failed-partial`;
- accepted semantic mutation count and active image/file references;
- asset-pool ownership needed by both snapshots and rollback.

A snapshot contains canonical elements, semantic document state, a stable semantic projection/fingerprint, and references to retained binaries. It does not restore historical viewport, zoom, active tool, dialogs, theme, operation status, or the complete package `AppState`.

Revision/epoch invariants:

- A synthetic AI progress write may advance `mutationRevision`, but it never creates an AI event.
- An event is exposed only after its final semantic projection verifies against the current `canvasIdentity`, `mountIdentity`, `sessionEpoch`, and expected revision.
- A delayed callback with the wrong operation generation, route epoch, mount identity, or revision is stale and is rejected.
- A callback with unknown provenance is not guessed to be human or synthetic: the coordinator fails closed, retains diagnostics, and keeps mutation/history locked until a safe recovery decision.
- The AI cursor moves only after target restoration and semantic verification succeed.

## 7. Exact cross-route invalidation rules

At most one route has actionable history after a semantic route boundary. This is intentional loss of cross-route continuity, not a hidden shared stack.

### Committed AI boundary clears all native history

For each successfully finalized, semantically mutated AI batch, and for each successful `Undo AI batch` or `Redo AI batch` restore:

1. finish and verify the Synara operation/restore;
2. clear **all native Excalidraw Undo and Redo** through the supported public `api.history.clear()` boundary before exposing/unlocking the resulting state;
3. advance the route epoch and revision;
4. expose only the applicable AI route state.

The public API cannot selectively clear native Redo, so prior native Undo is deliberately lost too. A failed finalization, failed restore, or failed rollback does not clear native history or advance the AI cursor unless the failure policy explicitly reaches a locked fault state.

### First settled semantic human mutation clears all AI history

After an AI batch or AI-history action, the first **settled semantic human mutation**:

1. remains owned and applied by Excalidraw's native route;
2. clears the entire Synara AI Undo and Redo history, including any AI Redo branch;
3. releases no-longer-referenced AI snapshot assets;
4. advances the human route epoch and mutation revision;
5. records `Unavailable because manual edits started after the AI change.` for AI Undo and `Unavailable because manual edits started after the undone AI change.` for AI Redo where applicable;
6. politely announces `AI history cleared because manual editing started.`

Native human Undo and native human Redo are semantic document mutations for this rule. A new AI batch therefore captures the post-native-command state in a new route epoch. Selection-only changes, viewport movement, zoom, tool selection, focus movement, dialogs, and proven semantic no-ops do not clear AI history.

The implementation must use a public settlement signal for pointer, keyboard, and text-edit mutations. If settlement or no-op status cannot be established safely, it must choose conservative invalidation and diagnostics rather than preserve a possibly stale AI event.

### AI branch rules

- Consecutive mutated AI batches append events in the current AI epoch.
- Event 21 evicts only the oldest AI event; it never claims to cap native history.
- After AI Undo, a new mutated AI batch deletes the AI Redo branch before appending its event.
- A no-op AI batch, zero-valid failure, failed finalization with successful rollback, selection change, pan, zoom, or tool change does not invalidate AI Redo.
- AI Undo/Redo never invokes native Undo/Redo and native Undo/Redo never invokes AI snapshots.

## 8. AI event and operation semantics

The AI route retains the exact batch obligation from the accepted design, but the event is explicitly an **AI-batch event**:

- A completed batch with one or more semantic mutations is exactly one event.
- An acknowledged Take Over interruption with valid partial mutations is exactly one event.
- A failed-partial batch with valid earlier mutations is exactly one event; the invalid operation is not applied and dependent operations stop.
- Progressive updates use `updateScene(..., { captureUpdate: "NEVER" })` and create no user-visible AI event.
- A zero-mutation batch, zero-valid failure, or semantic no-op consumes no event and does not clear either route.
- Pre-batch capture failure accepts no update and changes neither route.
- Take Over fences updates immediately; history stays unavailable until containment acknowledgement. Retry starts a new operation generation against current state and never resumes the failed generation.

AI Undo restores the event's verified `before` snapshot; AI Redo restores its verified `after` snapshot. A restore:

- preflights every required image binary;
- supplies files through public `addFiles` before scene replacement;
- writes the scene only with `captureUpdate: "NEVER"`;
- runs under a synthetic-write/restoring fence and supported edit lock;
- verifies the semantic target before moving the cursor;
- preserves command-start viewport and zoom;
- filters selection IDs to those still valid;
- does not restore historical tool, dialog, theme, status, or complete package state;
- does not move focus or camera to restored content.

## 9. Native route limitations and explicit browser gate

The fallback does not silently promise capabilities the public Excalidraw API cannot expose:

- Native capacity, grouping, stack inspection, selective trimming, and a native 20-event cap remain package-defined and unclaimed.
- Native exact image Undo/Redo is **unproven** because image binaries are separate from element history. It must pass a real pinned-Chromium gate with meaningful SVG/PNG export, or the native image promise is narrowed before implementation acceptance.
- Native history belongs to the mounted Excalidraw instance. A remount, reload, or new identity cannot retain in-memory history through a separate coordinator.
- `history.clear()` is a route-boundary reset, not a substitute for synthetic callback fencing. The Decision 0052 timing failure showed that clearing after a human callback does not make native controls a host-owned route.
- No private ActionManager/History access, undocumented action key, native-stack inspection, DOM/CSS suppression, monkey-patching, package mutation, remount restore, fork, package upgrade, or lockfile change is allowed.

While AI is streaming, restoring, or rolling back, direct document mutation and both history routes are locked through the supported public edit/view boundary. Pan and zoom may remain available. If real Chromium proves that a native toolbar or keyboard command can still mutate the document while that boundary is active, the fallback gate fails and source work remains blocked.

## 10. Asset and failure handling

AI snapshots retain active file references and a deduplicated session asset pool. A binary remains retained while referenced by current content, an AI `before`/`after` snapshot, an active batch, or a rollback snapshot. Eviction removes only unreferenced assets.

Before any AI restore:

1. preflight all required file IDs, binary contents, and supported image metadata;
2. call public `addFiles` for the complete required set;
3. only then apply the semantic scene snapshot with `captureUpdate: "NEVER"`;
4. verify element/file references and meaningful official SVG/PNG export where images are involved.

Missing or invalid assets fail before scene replacement:

> **Couldn't undo AI batch because an image is unavailable. Nothing changed.**

The Redo equivalent uses `redo` in the same sentence. The AI cursor and route epoch remain unchanged. A recoverable restore error attempts rollback to the command-start snapshot; if rollback succeeds, the canvas remains editable and the persistent message is:

> **Couldn't undo AI batch. Nothing changed.**

(or `redo`). Provide **Try again** and **Copy diagnostics**, and do not claim success or move focus.

A restore, rollback, callback-provenance, or semantic-verification failure that cannot be safely recovered leaves editing locked with:

> **Whiteboard recovery failed**
> Editing is locked to protect the current canvas state.

Preserve current content and diagnostics. Never hydrate an empty scene, silently drop images, remount as recovery, discard unsaved content, advance the cursor, or report success.

## 11. Separate caps and lifecycle resets

### AI cap

Synara may honestly claim only:

> **At most 20 finalized AI-batch events are retained per open canvas session. Event 21 evicts only the oldest AI event.**

Progressive updates and no-op/zero-valid batches consume no event. This is not a combined human-plus-AI cap.

### Native human capacity

Native history capacity and gesture grouping remain whatever the pinned supported Excalidraw package provides. Synara makes no 20-event, oldest-event, or exact-cap claim for native history.

### Reset both routes together

Reset both native and AI history, increment `sessionEpoch`, and require a fresh document/mount boundary on:

- Excalidraw adapter remount, `mountIdentity`/API identity change, or canvas eviction;
- explicit reload or fresh hydration that replaces the in-memory document;
- application restart;
- new Whiteboard/File-canvas identity;
- duplication target creation;
- import as a new canvas;
- clean external File-canvas reload;
- conflict resolution that replaces the current document;
- unrecoverable coordinator fault followed by recovery hydration;
- canvas close, tab termination, quit, or session termination.

Current saved content may be restored by the existing persistence contract, but neither history route is restored. The duplicate retains copied content/assets while starting with both routes empty. No UI implies old AI batches are recoverable after restart or reload.

A same-instance Main-conversation switch clears unsent chips and selection according to the existing product contract but does not reset history. Pan, zoom, selection-only changes, tool choice, and proven no-ops do not reset history.

## 12. Browser acceptance matrix

All rows require the real pinned Excalidraw embed in stable Chromium. Native-control observation is test-only; it must not become a runtime DOM dependency.

| Scenario | Required sequence | Required assertions |
| --- | --- | --- |
| Native route and focus | Human pointer edit, Delete, text edit, native toolbar Undo/Redo, native platform shortcuts | No Synara AI event; native route changes human content; text-edit Undo is not redirected; native shortcuts remain package-owned. |
| AI lock | Progressive AI update; attempt native toolbar, pointer edit, native Undo/Redo shortcuts, and accessibility activation during streaming/Take Over pending | No native document mutation; pan/zoom remain usable; both routes unlock only after completion, acknowledgement, or failure containment. |
| AI outcomes | Completed, acknowledged Take Over partial, failed-partial, and zero-valid failure | Each mutated outcome creates exactly one AI event; progressive checkpoints and zero-valid outcomes create none; dedicated AI Undo/Redo are exact. |
| Cross-route invalidation | `H1 → A1 → AI Undo → native Redo`; `A1 → AI Undo → H2 → AI Redo`; `H1 → native Undo → A2` | Every committed AI boundary clears all native history; first settled semantic human mutation clears all AI history; stale branches cannot mutate content. |
| Synthetic restore fence | AI Undo/Redo with delayed/duplicate callbacks and revision/epoch changes | Every write uses `captureUpdate: NEVER`; synthetic callbacks cannot become human events; unknown provenance fails closed; cursor advances only after verification. |
| No-op and settlement | Selection/pan/zoom; cancelled pointer gesture; multi-callback gesture; Delete; text-edit session | Proven no-ops preserve AI Redo; one settled semantic human mutation clears AI history; raw callback count is not the event model; uncertain settlement takes conservative invalidation. |
| Assets and failure | AI image batch Undo/Redo; missing/invalid binary; semantic mismatch; rollback failure; SVG/PNG export | Required assets are preflighted; AI image references/export are exact; failures make no partial claim; rollback/lock diagnostics are explicit. |
| Native image gate | Human image add/delete/native Undo/Redo and export | Native image recovery either proves meaningful file references and export or the native exact-image promise remains narrowed/unaccepted. |
| Cap and lifecycle | 21 AI events; 21 human events; remount/eviction; duplicate/import; restart/reload; same-instance conversation switch | Newest 20 AI events remain; no native cap claim; both routes empty at reset boundaries; same-instance conversation switch preserves history. |
| Accessibility | 200% zoom, constrained width, keyboard-only, screen reader, Focus mode | Named `AI history` toolbar; exact labels/reasons; `aria-disabled`; Enter/Space and standard toolbar navigation; focus and announcements remain predictable. |

## 13. Accepted replacement of promises — Decision 0055

The following original promises are removed or replaced by Decision 0055:

| Superseded promise | Accepted fallback replacement |
| --- | --- |
| Human and AI edits share one ordered Undo/Redo history. | Native human history and Synara AI-batch history are separate routes with route epochs; no shared cursor is claimed. |
| Toolbar Undo, toolbar Redo, and `Cmd/Ctrl+Z` use one coherent route. | Package-native human controls/shortcuts remain native; Synara uses only visible `Undo AI batch` / `Redo AI batch` actions. |
| Every open canvas has a combined maximum of 20 events with oldest-event eviction. | Only Synara AI history has a 20-finalized-AI-event cap; native capacity is package-defined and unclaimed. |
| A generic new-edit-after-Undo rule applies globally. | A settled semantic human mutation clears all AI history; a new mutated AI batch after AI Undo clears only the AI Redo branch; native package branching remains native. |
| AI Undo remains available after arbitrary later human edits. | The first settled semantic human mutation clears AI Undo and Redo to prevent stale full-snapshot overwrite. |
| Native human image Undo/Redo is exact. | Native exact image recovery is a browser-gated promise; until proven, it is narrowed/unaccepted. AI image recovery remains exact by asset preflight and verification. |
| Undo history survives remount or bounded-instance eviction. | Both routes reset on remount/eviction, reload, restart, and new identity; current durable content follows existing persistence rules. |
| `Cmd/Ctrl+Z` undoes the most recent AI batch. | Native shortcuts undo only package-owned human history; AI recovery is explicit and labeled. |

The following obligations remain unchanged in substance for AI work: one event per mutated completed/interrupted/failed-partial batch; no progressive user-visible checkpoints; exact AI scene/file restoration; explicit failure/rollback behavior; no durable Version history; no private or undocumented integration.

## 14. Accepted boundary and prohibited work

Decision 0055 records the owner's approval of all six rules in this contract and authorizes only implementation planning. The approved rules are:

1. all-native-history clearing at every committed AI boundary, including loss of prior native Undo;
2. clearing all AI history on the first settled semantic human mutation;
3. an AI-only, not combined, 20-event cap;
4. no dedicated AI keyboard shortcut in the first release;
5. native image Undo/Redo as a real-Chromium gate rather than an unqualified promise;
6. both routes resetting on remount, reload, restart, close/eviction, and new identity.

The following remain prohibited until a separate bounded implementation decision authorizes source work:

- source, tests, package manifests, lockfiles, or evidence-log changes;
- broad Ticket 02 implementation or WP-CORE;
- private APIs, undocumented keys, native-stack inspection, DOM/CSS suppression, monkey-patching, package mutation, remount restore, package upgrade, or a fork;
- claims that the native image gate, fallback acceptance criteria, AC4, AC7, or the Ticket 02 gate have passed;
- changes to protected Agentation work.

**Accepted disposition:** route project and Ticket 02 to `ready-for-fallback-implementation-planning`.
