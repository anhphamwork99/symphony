# Decision 0041: Whiteboard testing strategy governance

Status: Superseded by Decision 0047
Date: 2026-08-26

## Scope

This record governs testing for the Synara Whiteboard feature as a whole. Normative implementation tickets own their concrete seams and may refine them during codebase exploration, but they must preserve this feature-level strategy.

## Strategy

Prefer the highest stable public boundary that proves each behavior, with the fewest lower seams needed for deterministic failure and performance evidence:

1. **Contract boundaries** prove strict schemas and compatibility for Whiteboard identity, native-document state, image references, lightweight element context, Project-owned pane descriptors, agent operations, ordered progress, operation generations, cancellation, diagnostics, and file-canvas state. Malformed, oversized, unknown, stale, cross-Project, and partial payloads fail closed.
2. **Repository and lifecycle boundaries** use the real persistence implementation and temporary storage to prove native Whiteboard create/read/update/duplicate/delete, settled Auto-save, revision checks, separate image ownership, Project isolation, archive retention, Project deletion, restart restoration, and explicit save-state truth. Current durable content survives restart; session Undo/Redo does not.
3. **Server orchestration boundaries** exercise public orchestration or WebSocket APIs for agent operation start, progressive ordered updates, invalid-operation stop, Take Over acknowledgement, stale-generation rejection, Retry, and delete containment. Project-file writes occur only after an explicit user Save or Save As command.
4. **Web domain and component boundaries** prove Right-sidebar pane identity and deduplication, launcher actions, selection-to-chip and chip-to-selection synchronization, send-time context snapshotting, Focus mode, bounded 20-event Undo/Redo, two-canvas retention, save and conflict presentation, and restoration diagnostics.
5. **Real embedded-canvas browser boundaries** use the actual pinned `@excalidraw/excalidraw` package for behavior whose public meaning depends on the drawing engine: selection settlement, imperative progressive rendering without remount, edit lock with pan/zoom, exact one-event AI Undo, Take Over during streaming, viewport restoration after eviction, image insertion, import, PNG/SVG/`.excalidraw` export, dot-grid export choice, and File-canvas editing.
6. **Performance measurements** cover representative empty, normal, and image-bearing boards. They must prove that selection chips carry bounded references rather than element payloads; pointer movement does not publish composer-draft writes; send-time materialization occurs once; hidden tabs do not create unbounded mounted Excalidraw instances; thumbnails are not regenerated during active edits; and progressive agent updates are coalesced without remounting the canvas.
7. **One integrated acceptance path** composes the real web application, production WebSocket route, real persistence, and actual Excalidraw embed with a deterministic fake agent-operation producer. It covers native board creation from Main chat, three selected elements producing three chips, streamed agent updates, Take Over, one Undo for the partial batch, Auto-save, Main-conversation switching within the Project, restart restoration, and absence of restored Undo history.
8. **One integrated File-canvas path** uses a temporary Project `.excalidraw` file to prove file-open routing, in-memory agent editing, `Unsaved` truth, no filesystem or Git-visible change before user Save, explicit Save, external clean reload, and dirty conflict choices without auto-merge.

## Required success and failure or diagnostic coverage

Every material success path must be paired with applicable failure or diagnostic proof, including:

- malformed or unsupported `.excalidraw` input;
- corrupt native Whiteboard state or missing image asset;
- Auto-save failure, retry, stale revision, and restart during an unsettled save;
- temporarily unavailable or deleted unsent element context;
- invalid agent operation and a later operation that depends on it;
- duplicate, out-of-order, late, stale-generation, and post-Take-Over agent updates;
- Take Over dispatch failure or acknowledgement timeout;
- deletion requested while an agent operation is active;
- cross-Project Whiteboard access or pane restoration;
- File-canvas external change with and without local unsaved edits;
- Save or Save As failure without false `Saved` state;
- oversized image optimization failure;
- export failure and grid-inclusion correctness;
- attempted third mounted canvas and eviction of an unsaved File canvas;
- canvas hydration failure retained as an explicit Right-sidebar diagnostic.

Tests must not treat any of the following as success:

- a local UI unlock without acknowledged containment of the active agent operation;
- dropping a late update only in the rendered canvas while canonical state still accepts it;
- an Excalidraw history assumption without proving exact one-event Undo through the real embedded package;
- a mocked editor or mocked export utility as the only proof of Excalidraw behavior;
- an in-memory native document as proof of durable Auto-save or restart restoration;
- an `Unsaved` badge as proof that a Project file remained unchanged;
- a full element or scene payload hidden inside a composer chip, editor state, or persisted draft;
- silently removing a pane whose backing content failed to restore.

## Preferred public boundaries and prior art

- Shared contract schemas and strict decoding.
- Native API or production WebSocket request/push boundaries.
- Real repository persistence and temporary Project filesystem boundaries.
- Project-owned Right-sidebar store and restoration projections.
- Main composer draft/send boundary and rendered chip behavior.
- Browser-visible actual Excalidraw integration.

Existing prior art includes Project-owned Right-sidebar routing and acceptance tests, RightDock reducer and sizing tests, workspace file-opening tests, terminal-context and assistant-selection composer tests, composer draft persistence tests, execution-strip cancellation presentation tests, production WebSocket integration harnesses, and temporary Project filesystem test patterns.

## Permitted boundary substitutions

- A deterministic fake agent-operation producer may replace a real model/provider for operation ordering, validation, cancellation, retry, and fault injection. It must be complemented by the integrated production WebSocket and browser path; a component-only mock is insufficient.
- Temporary filesystem roots may replace a user repository for File-canvas tests.
- Deterministic image encoder or storage fakes may induce size and write failures, but at least one real image import and PNG/SVG export path must use Excalidraw's official utilities.
- Fake clocks may drive settled Auto-save, thumbnail idle work, cancellation timeout, and retry schedules, while at least one integrated path proves real scheduling does not save per pointer movement.
- A lower seam is permitted only when the nearest stable public boundary cannot reliably induce the failure or observe the invariant. The normative ticket must document why, retain the nearest useful public-boundary test, and add only the smallest lower-level test required.

## Commands and repository constraints

- Use focused Vitest suites during implementation.
- Use browser tests for actual Excalidraw interaction and rendered accessibility states.
- Use `bun run test`, never `bun test`.
- Follow repository authorization for `bun fmt`, `bun lint`, and `bun typecheck`; when the owner requests them, bundle them into one final verification pass.
- Match proof to risk: real restart for restoration, real temporary files for File canvas, real embedded Excalidraw for selection/history/export, and measured instrumentation for performance claims.

## Exceptions and changes

Ordinary tickets own their concrete test seams and do not require another Decision Record. Removing a required integrated path, replacing actual Excalidraw evidence with editor mocks, weakening acknowledged Take Over containment, dropping failure pairing, or materially changing the performance evidence requires a new owner-approved project-scoped Decision Record.
