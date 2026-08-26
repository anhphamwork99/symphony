# Ticket 01 Undo feasibility — real `@excalidraw/excalidraw@0.18.1`

Status: feasibility evidence only. This document does **not** accept Ticket 02 and does not claim an exact one-event AI Undo guarantee.

## Public controls observed

- The public `updateScene` API accepts `captureUpdate` through the documented `SceneData` boundary.
- Ticket 01 progressive updates use `captureUpdate: "NEVER"`. This is a documented history-capture control, not a transaction API.
- The public imperative API exposes `history.clear`, but no public `beginTransaction`, `endTransaction`, batch boundary, or API that converts an arbitrary progressive sequence into exactly one native history entry.
- The harness deliberately uses only these public APIs and does not read private history state or fork Excalidraw.

## Real Chromium probe

The acceptance browser test (`undo-feasibility-probe`) runs the pinned package in Chromium. It:

1. captures a pre-batch scene snapshot;
2. applies two progressive `updateScene` calls with `captureUpdate: "NEVER"`;
3. performs an ordinary user deletion in the real canvas;
4. invokes the real keyboard Undo command; and
5. verifies that ordinary Undo restores the scene containing the latest progressive state rather than reverting to the pre-batch snapshot.

This records the useful positive fact that progressive external updates with `captureUpdate: "NEVER"` do not contaminate the ordinary user Undo entry in this probe. It also records the boundary: ordinary Undo restores the user edit's prior state, not a Synara-owned pre-batch snapshot.

## Implication for Ticket 02

A future AI batch needs to retain a pre-batch scene snapshot (including files and relevant app state) if it must recover a completed, interrupted, or failed progressive batch as one Synara operation. Ticket 01 does not implement that recovery boundary, does not claim exact one-event semantics, and does not accept Ticket 02. Ticket 02 must provide its own real-package proof for completed, interrupted, and failed partial batches.

## Limitation classification

`undo-transaction-boundary` is a non-blocking Ticket 01 limitation under Decision 0048: the pinned public API provides capture controls but no documented transaction begin/end boundary. This is not a product budget and is not evidence that an exact AI Undo implementation is impossible; it is the reason the concrete recovery proof remains in Ticket 02.
