# Decision 0061: Amend native-image drop Gate binary exactness for package normalization

**Status:** Binding amendment to Decision 0060
**Date:** 2026-08-27
**Trigger:** Pre-candidate Chromium iteration proved that Excalidraw `0.18.1` normalizes the dropped PNG before storing it
**Scope:** Measurement semantics only; write set and production prohibitions unchanged
**Final-acceptance consultation consumed:** No

## Question

Must Excalidraw's stored image data URL retain byte-for-byte identity with the user's dropped PNG, or must native history retain the package-normalized image closure exactly after insertion?

## Observed package behavior

The deterministic source PNG was successfully delivered through the real Excalidraw drag-and-drop handler:

- source dimensions: `32 × 16`
- source MIME: `image/png`
- source byte length: `120`
- source SHA-256: `820a2c5650f64161d184782ba6659456d5cfca6af1bc7d45a3241416aa33a37e`

Excalidraw created a complete image element/file closure and preserved the same dimensions, MIME, and all eight predeclared opaque colors, but stored a normalized PNG:

- normalized stored byte length: `171`
- normalized stored SHA-256: `7d9fc3dfc16b9293589a2f87239dfa7a8325441bb1648eac3729f11819e3858c`

Official SVG and PNG exports rendered the expected sentinel colors. The normalization happened during initial package ingestion, before any native Undo/Redo measurement.

This observation came from an uncommitted iterative test run. It is not formal PASS evidence and does not consume the exact-candidate protocol.

## Decision

Decision 0060's phrase:

```text
binary hash match the sentinel
```

is amended to distinguish two boundaries.

### Source-to-package ingestion

The Gate must prove that the dropped source file is the declared sentinel by checking its source bytes, length, SHA-256, dimensions, MIME, and color map before dispatch.

After package ingestion, byte-for-byte equality with the source PNG is **not required** if Excalidraw performs a deterministic package-supported normalization.

The initial package-owned file must instead prove:

- non-empty decodable PNG bytes;
- MIME `image/png`;
- dimensions equal to the source sentinel;
- all predeclared opaque sentinel colors;
- a recorded normalized byte length and SHA-256;
- complete element/file reference closure;
- meaningful official SVG and PNG exports.

### Native history exactness

Native Undo, Redo, and second Undo are exact relative to the verified initial package-owned state.

Every recovered state must retain:

- the same image element ID;
- the same file ID;
- the same normalized data URL bytes;
- the same normalized byte length and SHA-256;
- the same dimensions and MIME;
- the same sentinel color map;
- the same meaningful official SVG/PNG evidence.

Native Redo must remove the active image/file-reference and sentinel export evidence.

Silent or inconsistent re-normalization during recovery remains a native-behavior failure.

## Why this amendment is correct

The product requirement is exact image recovery, not preservation of incidental PNG compression bytes before the package accepts ownership.

PNG encoders may lawfully produce different byte streams for identical opaque pixels and dimensions. Treating deterministic package ingestion as a failure would test encoder identity rather than image-history correctness.

The stronger native-history invariant begins after package ingestion:

```text
verified package-owned image closure
→ native history
→ exact recovery of that same package-owned closure
```

Pixel semantics remain anchored to the original source sentinel, so normalization cannot conceal blank, transparent, recolored, dimensionally changed, or otherwise degraded content.

## Non-amendments

This decision does not:

- weaken the required source sentinel provenance;
- permit arbitrary image transformation;
- permit missing or stale binary references;
- permit identity, MIME, dimension, pixel, stored-hash, SVG, or PNG drift across native history;
- authorize direct `addFiles`, `updateScene`, adapter insertion, runtime changes, package changes, browser config, or any new path;
- pass AC6 or Ticket 02;
- authorize production implementation or later work packages.

Decision 0060's exact four-path write set, two-run exact-candidate protocol, PASS/FAIL/BLOCKER taxonomy, independent review requirement, and all prohibitions remain binding.

## Traceability

- Gate authority: [Decision 0060](0060-ticket-02-native-image-drop-gate-authorization.md).
- Prior chooser BLOCKER: [Decision 0059](0059-ticket-02-native-image-gate-blocked-routing.md).
- Product contract: [Decision 0055](0055-ticket-02-fallback-dual-history-contract-approved.md).
- Ticket: [02 — Prove fallback dual-history Undo and Redo](../issues/02-prove-ai-batch-undo-redo.md).
