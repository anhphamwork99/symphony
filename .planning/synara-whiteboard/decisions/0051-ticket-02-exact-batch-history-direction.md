# Decision 0051: Govern Ticket 02 exact AI batch Undo/Redo through a Synara-owned session history

Status: Binding — implementation direction accepted
Date: 2026-08-26
Trigger: Material technical decision verification/escalation
Supersedes: None
Reopens Decisions 0047, 0048, or 0050: No

## Question

Before implementing Ticket 02, how must Synara own and prove exact AI batch Undo/Redo on `@excalidraw/excalidraw@0.18.1`, particularly when the package exposes no public undo/redo transaction, stack inspection, grouping, or stack cap; and how must native toolbar/keyboard routes be contained without undocumented or private integration?

## Governing references

### Authoritative

1. `.planning/synara-whiteboard/PROJECT.md`
2. `.planning/synara-whiteboard/issues/02-prove-ai-batch-undo-redo.md`
3. `.planning/synara-whiteboard/PRODUCT-CONTRACT.md`
4. `.planning/synara-whiteboard/spec.md`
5. `.planning/synara-whiteboard/decisions/0050-ticket-01-final-acceptance-hold-removed.md`
6. `.planning/synara-whiteboard/decisions/0048-ticket-01-excalidraw-feasibility-boundary.md`
7. `.planning/synara-whiteboard/decisions/0047-testing-strategy-governance-reassessment.md`
8. Decisions 0006, 0010, 0011, 0014, 0027, 0031, and 0039.

### Supporting

1. `.planning/synara-whiteboard/designs/ticket-02-exact-batch-history-contract.md` at commit `20ca8417e`.
2. `.planning/synara-whiteboard/RESEARCH.md`.
3. `.planning/synara-whiteboard/evidence/ticket-01/undo-feasibility.md`.
4. Exact-package public type/source and official documentation evidence summarized by the design contract.

## Material findings

1. Excalidraw 0.18.1 publicly exposes `updateScene` with `captureUpdate`, scene/app/file reads, `addFiles`, official restore/export utilities, and `history.clear()`.
2. It does not publicly expose undo, redo, stack inspection, transaction begin/end, grouping, or trimming native history to 20 events.
3. `captureUpdate: "EVENTUALLY"` is not an isolated transaction boundary.
4. Ticket 01 proved in real Chromium that `captureUpdate: "NEVER"` shows progressive updates without making each update an ordinary native Undo step.
5. Native Excalidraw history does not own the `BinaryFiles` map required for exact image-bearing Redo.
6. Typed public `UIOptions.canvasActions` does not contain Undo/Redo controls. Undocumented action keys are outside the accepted boundary.
7. `viewModeEnabled` disables native editing as well as native history and cannot implement mixed human/AI session history.
8. The product contract requires one ordered 20-event session history shared by human actions and AI batches, exact partial recovery, deterministic Redo invalidation, and no durable history after restart.

## Binding decisions D1–D8

### D1 — History ownership

Accepted.

Synara owns the complete user-visible Undo/Redo history for each open canvas session. Excalidraw native history is containment-only and must not remain a second active user-visible route. It may be cleared only through public `api.history.clear()`.

AI progress, Synara restore, Undo, Redo, and rollback updates use:

```ts
captureUpdate: "NEVER";
```

Human mutations are observed through supported callbacks and converted into Synara events. Native history must be cleared before a human event is exposed as settled and before a user-visible command can race through the native route.

Standard `Cmd/Ctrl+Z` and platform Redo remain available through the Synara dispatcher; Decision 0039 does not require Excalidraw's private History object to own them.

### D2 — Public-only native-route containment

Accepted as a hard feasibility gate.

A Synara-owned toolbar outside the package and wrapper-level keyboard capture are permitted only if real Chromium proves they are the sole effective history route.

The first Work Package must prove:

1. Toolbar Undo/Redo invoke one `SynaraHistoryCommands` dispatcher.
2. `Cmd/Ctrl+Z` and platform Redo invoke that dispatcher exactly once.
3. Relevant focus states include ordinary canvas focus and text-edit interaction.
4. Native controls never become active between a human mutation and public `history.clear()`.
5. Pointer, keyboard, programmatic, rapid repeated, and accessibility activation attempts cannot invoke native Undo/Redo.
6. Native keyboard handling cannot restore an intermediate AI checkpoint or mutate around the Synara route.
7. Human mutation capture and grouping still work after native-history clearing.
8. During an active human transaction, a command deterministically settles that transaction into one Synara event before execution or is consumed without scene mutation; it never falls through to native history.
9. Runtime containment uses no private package DOM, private selector, internal action name, private import, package mutation, or monkey-patch.

#### Disabled native controls: PASS interpretation

Package-native controls may remain rendered in the feasibility harness only if they are visibly/accessibly disabled or otherwise provably inert in every tested state.

Test-only accessible queries may observe their state but must not become a runtime dependency. PASS additionally requires:

- pointer, focus/keyboard, and accessibility activation cannot invoke them;
- no transient enabled window exists around human settlement;
- every successful toolbar/keyboard command moves only the Synara cursor;
- one input moves the cursor at most once;
- no intermediate AI progress state is reachable.

#### Native containment: FAIL interpretation

AC4 and AC7 fail if:

- a native control becomes active or invokable, even transiently;
- package-native keyboard handling mutates the scene;
- both Synara and Excalidraw handle one command;
- an individual progressive AI state becomes reachable;
- `history.clear()` prevents reliable human event capture;
- containment requires undocumented `canvasActions` keys;
- runtime containment requires private ActionManager/History access, private imports, package mutation, monkey-patching, or DOM/CSS-dependent suppression;
- containment is only asserted or unit-tested rather than proved in real Chromium.

On failure, record exact package/browser/reproduction evidence and stop broad Ticket 02 work immediately. Do not continue the full matrix while hoping to repair containment later.

### D3 — No-op batches

Accepted.

A batch consumes an event only when at least one accepted operation produces a semantic document mutation.

- completed zero-mutation batch: no event;
- interrupted zero-mutation batch: no event;
- invalid first operation with no prior valid mutation: no event;
- final semantic fingerprint equal to the pre-batch fingerprint: no event;
- no-op interaction does not invalidate Redo.

Detection uses canonical semantic projection, not callback count, object identity, serialization bytes, or attempted-operation count.

### D4 — Presentation state

Accepted with precision.

Undo/Redo restore document state, not historical presentation state. They preserve viewport and zoom present when the command begins. Selection is preserved only for IDs still valid and non-deleted after restoration; invalid IDs are filtered deterministically.

Snapshots do not blindly restore viewport, zoom, selection, active tool, dialogs, theme, transient status UI, or complete package `AppState`. Ticket 02 does not authorize camera movement to restored content.

### D5 — Asset semantics

Accepted with a bounded-claim correction.

Canonical active image/file references define document image state. Snapshots and the asset pool preserve enough public data to restore each referenced file under the identity expected by its image element.

Each snapshot records:

- canonical restorable elements and ordering;
- active referenced file IDs;
- file-ID to retained asset data or content fingerprint mapping;
- required public file metadata;
- independent references for `before` and `after`.

Binary bytes may be deduplicated by collision-resistant fingerprint while required file-ID aliases remain restorable.

Assets remain retained while referenced by current content, a retained snapshot, an active transaction, or a rollback snapshot. Eviction releases only coordinator-owned references not required elsewhere.

Before restore, binaries are preflighted and supplied through public `addFiles`. Missing/invalid assets are restore failures. Image Redo must prove element/file references and meaningful official SVG/PNG export.

Orphan data retained in Excalidraw's inaccessible internal cache is not canonical document state and does not block semantic Undo/Redo. No private deletion API is used. Ticket 02 must not call that cache bounded without measurement; report it as a residual package limitation.

### D6 — Human feasibility scope

Accepted.

Real-package browser proof covers:

1. one pointer gesture producing multiple callbacks as one event;
2. one discrete keyboard mutation such as Delete as one event;
3. one multi-keystroke text-edit session as one event.

Boundaries use public host/package-observable behavior; callback count is not the event model. Selection-only changes, viewport movement, zoom, tool selection, and no-op interactions create no document event and do not invalidate Redo.

This is sufficient for Ticket 02 feasibility. Downstream production support must expand coverage for each supported mutation family while preserving one Synara route.

### D7 — Snapshot-first architecture

Accepted.

Ticket 02 uses immutable full `before`/`after` document snapshots and a deduplicated session asset pool.

A snapshot contains:

- canonical restorable elements, including public deletion/tombstone state where required;
- stable identities and meaningful ordering;
- a semantic fingerprint;
- whitelisted document-level state;
- active file references into the asset pool.

It excludes presentation and transient package state from D4. Capture occurs at transaction boundaries, not every AI progress update. Delta history, patch inversion, extra structural sharing, or native stack integration are deferred until measurements establish a need.

Measure normal and image-bearing snapshot/restore behavior without inventing a budget.

### D8 — Work order

Accepted and mandatory.

1. Implement only the minimum public native-route containment seam and common dispatcher.
2. Prove containment in real Chromium.
3. Prove one completed three-progress-update batch as exactly one Synara event with exact Undo and Redo.
4. Only after steps 1–3 pass, implement partial outcomes, assets, human grouping, Redo invalidation, 20-event bound, resets, and failure matrix.

Failure of steps 1–3 blocks step 4 and all broad Ticket 02 implementation. A worker may make minimum code/test changes needed to produce reproducible AC7 failure evidence, but that does not authorize continuing after failure.

## History coordinator semantics

```text
events: HistoryEvent[]        // length <= 20
cursor: 0..events.length
activeTransaction:
  none | human | ai-batch | restoring | faulted
assetPool:
  coordinator-owned retained assets and references
```

### Append and cursor rules

1. `events[0..cursor)` are applied.
2. `events[cursor..events.length)` are the Redo branch.
3. A new accepted semantic mutation after Undo deletes Redo before append.
4. A no-op does not delete Redo.
5. Append stores immutable `before` and `after`.
6. Event 21 evicts only the oldest event.
7. Current content remains unchanged and only the newest 20 remain undoable.
8. Undo at cursor zero and Redo at the end are inert.
9. Cursor moves only after successful semantic verification.

## AI batch rules

### Begin

Capture and verify the immutable pre-batch snapshot before accepting progress. If capture fails, do not begin or mutate. Lock human document mutation while retaining permitted navigation.

### Progress

Enforce batch ID, generation, and contiguous sequence. Validate each operation before applying it with `captureUpdate: "NEVER"`. Do not append intermediate events.

### Completed

Capture and verify final state. Append exactly one event for a semantic mutation and none for a no-op.

### Take Over / interrupted

Fence the operation generation and reject stale updates. Do not finalize on stop dispatch alone; finalize only after deterministic containment acknowledgement. Preserve valid partial progress, append one interrupted event when mutated, and prevent retry for that generation.

### Invalid operation / failed partial

Do not apply the invalid operation or dependent later operations. Contain before unlock. Preserve prior valid progress and append one failed-partial event only if it mutated the document. Retry later uses a new generation.

### Finalization failure

A failed final snapshot or verification cannot expose a mutated document as a successful untracked event. Attempt rollback to the verified pre-transaction snapshot. Rollback success leaves cursor unchanged, appends no event, and reports diagnostics. Rollback failure enters a faulted/locked state and reports both failures.

## Undo/Redo restore protocol

1. Capture command-start rollback snapshot.
2. Resolve target event and snapshot.
3. Preflight every required asset.
4. Add required binaries through public `addFiles`.
5. Restore document with `captureUpdate: "NEVER"`.
6. Preserve/sanitize presentation state under D4.
7. Compare resulting semantic projection with target.
8. Move cursor only after verification succeeds.

Restore failure leaves cursor unchanged and attempts rollback. Restore plus rollback failure faults and locks the coordinator.

## Reset and 20-event semantics

History starts empty for duplicated Whiteboard, fresh application/session hydration, and new canvas identity. Current content/assets survive where lifecycle requires; history is never durable.

Human and AI events share one array capped at 20. Event 21 evicts event 1 only. A mixed 21-event scenario leaves the newest 20 undoable; without branch invalidation, 20 Redos restore final state. Asset retention follows references rather than event age alone.

## Allowed techniques

- Public Excalidraw imperative API.
- `updateScene(... captureUpdate: "NEVER")`.
- Public scene/app/file reads, `addFiles`, and `history.clear()`.
- Official restore, serialization, and export utilities.
- Synara snapshots, fingerprints, cursor, asset pool, toolbar, and dispatcher.
- Stable wrapper event capture for platform shortcuts.
- Public `onChange` and host-observable pointer/keyboard/focus/settlement events.
- Test-only accessibility/browser observation of native control state.
- Real Chromium automation through the existing harness.

## Prohibited techniques

- Private ActionManager or History access.
- Private source imports.
- Undocumented `UIOptions.canvasActions.undo` or `.redo` keys, including casts to bypass types.
- Reading/mutating native stacks.
- Monkey-patching internals or package modifications.
- Runtime dependency on private DOM structure, class names, CSS selectors, or button ordering.
- Private CSS/DOM control suppression.
- Remount-based restore.
- Mock-editor substitution for browser proof.
- Treating tests that call only the Synara dispatcher as containment proof.

## AC traceability

| AC  | Binding proof                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1 | Three or more progressive `NEVER` updates create no intermediate event; completed finalization appends exactly one event.                          |
| AC2 | Completed, acknowledged Take Over, and failed partial batches each restore exact pre-batch content with one Undo; zero-valid failure creates none. |
| AC3 | Redo restores verified final/partial state, active image references, binaries, and meaningful official export.                                     |
| AC4 | Synara toolbar and platform keyboard use one dispatcher/cursor; hard Chromium proof contains native controls and keyboard.                         |
| AC5 | New accepted semantic mutation after Undo truncates Redo; no-op does not.                                                                          |
| AC6 | Pointer, Delete, and text sessions share one ordered 20-event history with AI batches; duplicate and fresh hydration reset.                        |
| AC7 | Inability to satisfy AC4 through the public boundary creates a reproducible blocker and stops broad implementation.                                |

## Implementation boundary

Ticket 02 may extend the isolated adapter with public snapshot/restore/file/history-clear seams; add a package-independent coordinator under Ticket 02 ownership; add a lazy feasibility harness and real-Chromium tests; reuse Ticket 01 fixtures, semantics, diagnostics, exports, viewport handling, and exact pin; and retain focused evidence.

It must not wire production navigation or RightDock; modify server orchestration or shared contracts; implement database/File persistence or durable history; implement production lifecycle/two-canvas retention; change package/lock resolution; add private integration; or implement unrelated tickets.

No package or lockfile change is authorized. Protected unrelated work remains untouched.

## Residual risks

1. `history.clear()` may expose a timing window where native commands activate.
2. Package keyboard handlers may observe events before/outside wrapper capture.
3. Active text editing may use an internal Undo path that cannot be contained.
4. Human actions beyond the required representative scope remain unclassified.
5. Full snapshots may be expensive on large/image-heavy documents.
6. Excalidraw may retain orphan binaries internally.
7. Restore normalization may require semantic rather than byte comparison.
8. Selection preservation requires filtering invalid IDs.
9. Platform Redo mappings differ.

These are measured acceptance risks, not permission to use private integration.

## Failure and downstream effect

Implementation may start only after this record is persisted, tracked, and cited as Authoritative.

The first implementation unit is strictly containment plus one completed-batch proof. Passing it authorizes the remaining Ticket 02 matrix. Failure blocks broad Ticket 02 immediately and permits only reproducible failure evidence plus bounded reassessment.

Later production work must retain a package-independent history coordinator and may not reintroduce competing native history. Ticket 02 final acceptance remains a separate exactly-once consultation after integrated implementation, verification, and one independent feature-level review.

## Reassessment conditions

Reassess if real Chromium shows native controls/keyboard cannot be publicly contained; `history.clear()` breaks human capture; image restore cannot use public APIs; official restore loses required semantics; snapshots exceed an evidenced operational constraint; package resolution changes; a different version/boundary is proposed; private APIs/undocumented keys/DOM containment/remount/fork become necessary; new evidence contradicts D1–D8; or owner governance changes.

Routine implementation details inside this direction do not require reassessment.
