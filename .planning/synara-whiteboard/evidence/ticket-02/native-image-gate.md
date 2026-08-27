# Ticket 02 WP-NATIVE-IMAGE-DROP-GATE — bounded PASS evidence

**Authority:** Decision 0060, as amended by Decision 0061
**Measured source candidate:** `c37dbf1b3f8ccc8cc6fc2ad16057a1fb337247a2`
**Candidate subject:** `test(whiteboard): prove native image history gate via drop`
**Authority ancestor:** `e1c43616519c66edb85484c2b526eb100b09de80`

## Bounded verdict

```text
TICKET 02 NATIVE IMAGE DROP GATE: BOUNDED PASS
```

Pinned `@excalidraw/excalidraw@0.18.1` accepted a deterministic image through its real drag-and-drop handler and preserved complete package-owned image closure and meaningful official exports through user Delete, native Undo, native Redo, and a second native Undo in two exact-candidate stable-Chromium runs.

This is a bounded native-package result only. It does not pass Ticket 02, AC6, any other acceptance criterion, AI image restoration, production integration, feature review, or final acceptance. Later work packages remain unauthorized.

## Source and commit provenance

The measured source candidate is:

```text
c37dbf1b3f8ccc8cc6fc2ad16057a1fb337247a2
```

Its source ancestry after Decision 0061 contains only:

```text
apps/web/src/components/whiteboard/ticket02/SynaraNativeImageHistoryGate.acceptance.browser.tsx
```

Pre-review candidate `fd002ea901c275dfb9fe9d5ee8e01f590edf007d` established the package route and normalized closure but was superseded after independent review returned `NEEDS REMEDIATION`. Candidate `c37dbf1b3f8ccc8cc6fc2ad16057a1fb337247a2` closes every review finding and is the only formally claimed source. Formal Run A and Run B were rerun from the beginning on `c37dbf1b3f8ccc8cc6fc2ad16057a1fb337247a2` with a clean source tree.

The browser test replaces the superseded Decision 0059 file-chooser probe. No runtime, harness, package, lockfile, browser config, fixture, or helper path changed.

## Package and environment provenance

- `@excalidraw/excalidraw`: exact resolved version `0.18.1`
- `browser-fs-access`: lock-resolved `0.29.1`
- lock integrity for Excalidraw: `sha512-6i5Gt7IDTOH//qa0Z315Ly5iVRhjWpu2whrlQFqkuwrkKUWgRsMk0P5qdE7bpyDpai7jeLeWYkyj1eVAfni1lw==`
- Bun: `1.3.12`
- Node.js: `v24.14.1`
- Vitest: `4.1.10`
- Playwright core: `1.58.2`
- Chromium: Google Chrome for Testing `145.0.7632.6`
- OS: macOS `26.4.1` build `25E253`
- architecture: `arm64`

The isolated worktree used the repository's existing installed dependencies. Vite emitted the known external-font allow-list warnings for the shared dependency installation. Both tests passed despite those non-behavioral warnings.

## Deterministic source sentinel

The source candidate defines the complete sentinel inside the browser test:

- file name: `ticket02-sentinel.png`
- MIME: `image/png`
- dimensions: `32 × 16`
- source byte length: `120`
- source SHA-256: `820a2c5650f64161d184782ba6659456d5cfca6af1bc7d45a3241416aa33a37e`
- color type: opaque RGB; decoded alpha is `255`
- eight predeclared opaque colors:
  - `(17,34,51,255)`
  - `(73,91,109,255)`
  - `(131,149,167,255)`
  - `(193,211,229,255)`
  - `(29,71,113,255)`
  - `(47,89,173,255)`
  - `(101,37,139,255)`
  - `(223,157,61,255)`

Before dispatch, the test decodes the inline base64, asserts the source byte length and SHA-256, creates the real `File`, checks its MIME and size, browser-decodes the source PNG to `32 × 16`, and verifies the exact spatial 8 × 8 block pixel map for all 512 opaque source pixels.

`/Users/anhpham99/Downloads/avt.jpg` was not used as a fixture or evidence input.

## Real package drag-and-drop route

The test uses only browser-standard interaction objects:

```text
new File(source bytes, "ticket02-sentinel.png", { type: "image/png" })
→ new DataTransfer()
→ dataTransfer.items.add(file)
→ bubbling/cancelable dragenter
→ bubbling/cancelable dragover
→ bubbling/cancelable drop
→ real `.excalidraw.excalidraw-container`
→ Excalidraw handleAppOnDrop
```

The event coordinates are finite points inside the real container's bounding rectangle. The test does not call `addFiles`, `updateScene`, `initialData`, adapter insertion, scene restore, package internals, raw Playwright, CDP, or any chooser/global replacement.

The package created and selected the image through its own image initialization path.

## Package-normalized closure

As recorded by Decision 0061, Excalidraw deterministically normalizes the source PNG at initial ingestion while preserving dimensions, MIME, and source pixel semantics.

The candidate asserts the exact normalized package-owned baseline and retains its full data URL as part of the recovery identity:

- stored byte length: `171`
- stored SHA-256: `7d9fc3dfc16b9293589a2f87239dfa7a8325441bb1648eac3729f11819e3858c`
- stored MIME: `image/png`
- stored dimensions: `32 × 16`
- stored decoded pixels: exact `32 × 16` spatial block map for all 512 pixels, matching the source sentinel

Initial closure additionally requires:

- exactly one active image element;
- non-empty element ID and file ID;
- `files[fileId]` exists;
- file record ID equals the element file ID;
- finite positive `created` metadata;
- element is not deleted;
- image is selected after package insertion;
- Synara AI event history remains empty and lock state remains `unlocked`.

The Excalidraw element `status` field is not used as the file-availability oracle. Package-owned local images may retain `status: "pending"`; closure is instead proven by the referenced binary, decoded pixels, and successful official exports.

## Official export proof

Every present-image state calls the existing adapter wrappers around Excalidraw's public official export utilities.

### SVG

The test requires:

- parseable SVG root;
- non-empty SVG content;
- an `<image>` node;
- an embedded `data:image/png` payload.

### PNG

The test requires:

- MIME `image/png`;
- exact eight-byte PNG signature;
- successful `createImageBitmap` decode;
- positive decoded dimensions;
- all eight predeclared opaque sentinel colors present in decoded pixels.

The pixel scan covers the exported image rather than assuming fixed export coordinates, allowing normal scene padding while still rejecting blank, transparent, missing, or recolored image output.

Every absent-image state requires:

- no active image element;
- no SVG image node or embedded PNG payload;
- none of the eight sentinel colors in the decoded official PNG.

The package file cache may retain an unreferenced file after deletion; the Gate's removal invariant concerns active element/file-reference closure and rendered export evidence.

## Native history state matrix

| Stage              | Element/file closure                                                | Official SVG                 | Official PNG                           | AI history         |
| ------------------ | ------------------------------------------------------------------- | ---------------------------- | -------------------------------------- | ------------------ |
| Initial drop       | Exactly one image; complete normalized closure; selected            | Embedded image present       | Decodable; all sentinel colors present | 0 events, unlocked |
| User Delete        | No active image/reference                                           | No image payload             | Sentinel colors absent                 | 0 events, unlocked |
| Native Undo        | Same element ID, file ID, normalized hash, dimensions, MIME, colors | Image payload restored       | All sentinel colors restored           | 0 events, unlocked |
| Native Redo        | No active image/reference                                           | No image payload             | Sentinel colors absent                 | 0 events, unlocked |
| Second native Undo | Same element ID, file ID, normalized hash, dimensions, MIME, colors | Image payload restored again | All sentinel colors restored again     | 0 events, unlocked |

The user-deletion path focuses the real editor, selects the inserted image through a real pointer click on the interactive canvas, then presses `{Delete}` through public `userEvent.keyboard`.

Native Undo and Redo use the package's publicly accessible `Undo` and `Redo` buttons by exact role/name. No native-stack inspection or undocumented action key is used.

Every state asserts Synara AI history remains at zero events with lock state `unlocked`. Both runs also require no critical Synara diagnostics at the final recovered state.

## Formal exact-candidate runs

Both ports were checked free before execution. Both runs used candidate `c37dbf1b3f8ccc8cc6fc2ad16057a1fb337247a2`, separate logs, Bash `set -o pipefail`, and explicit `${PIPESTATUS[0]}` capture.

| Run |    Port |   Result | Test count | Log SHA-256                                                        |
| --- | ------: | -------: | ---------: | ------------------------------------------------------------------ |
| A   | `52631` | exit `0` |   1/1 pass | `dcfee7fed0e106ca6f165cdc33cfa47c456a1819237df572cbb5b55a0ac62189` |
| B   | `52642` | exit `0` |   1/1 pass | `10b37aca3b6e57b0a8b4389c3f6c7dcc73623a00f5b6516fd4ec0f9a3ca88e5c` |

Command shape:

```bash
set -o pipefail
VITEST_BROWSER_API_PORT=<port> \
  bun run --cwd apps/web test:browser:stable -- \
  src/components/whiteboard/ticket02/SynaraNativeImageHistoryGate.acceptance.browser.tsx \
  2>&1 | tee <dedicated-log>
run_status=${PIPESTATUS[0]}
printf 'RUN_EXIT=%s\n' "$run_status"
test "$run_status" -eq 0
```

Run A:

```text
Test Files  1 passed (1)
Tests       1 passed (1)
RUN_A_EXIT=0
```

Run B:

```text
Test Files  1 passed (1)
Tests       1 passed (1)
RUN_B_EXIT=0
```

## Public-boundary and changed-path audit

Source range after Decision 0061:

```text
apps/web/src/components/whiteboard/ticket02/SynaraNativeImageHistoryGate.acceptance.browser.tsx
```

Evidence range:

```text
.planning/synara-whiteboard/evidence/ticket-02/native-image-gate.md
.planning/synara-whiteboard/evidence/ticket-02/native-image-gate.run-a.browser.log
.planning/synara-whiteboard/evidence/ticket-02/native-image-gate.run-b.browser.log
```

Absent from both ranges:

- package manifests and `bun.lock`;
- Vitest, Vite, Playwright, and browser configuration;
- Ticket 01 source/tests;
- Ticket 02 runtime/harness/history modules;
- server, contracts, shared, WebSocket, stores, lifecycle, Pi, Agentation, and unrelated planning paths;
- external fixture files.

The source candidate passed `git diff --check` before commit and formal measurement. Logs were captured directly and were not normalized after execution.

## Independent review remediation

The first independent read-only review of candidate `fd002ea901c275dfb9fe9d5ee8e01f590edf007d` returned `NEEDS REMEDIATION`, while confirming the real drop route, public native-history route, official exports, package pin, exact path inventory, and commit/log provenance. It identified four assertion gaps:

1. source dimensions and spatial pixel map were not decoded before dispatch;
2. recovery compared element ID, file ID, and hash but not the full normalized data URL and byte length;
3. stored pixel proof checked color-set presence rather than the exact spatial map;
4. AI history `0/unlocked` was not asserted at every matrix state.

Candidate `c37dbf1b3f8ccc8cc6fc2ad16057a1fb337247a2` remediates all four:

- source File size/MIME, dimensions, hash, and all 512 spatial pixels are asserted before drop;
- the full normalized data URL, byte length, hash, element ID, and file ID are compared on both recoveries;
- normalized stored pixels are checked against the exact spatial source map;
- AI history zero/unlocked is asserted before drop and after initial drop, Delete, first Undo, Redo, and second Undo.

Run A and Run B were discarded and rerun on the new source candidate. The superseded pre-review evidence commit `1fe00c2d8f710bf1e9ab450099d0891900d3f4a2` is not part of this PASS claim. A fresh independent remediation re-review remains required before governance records the PASS.

## Limitations and routing

This Gate establishes a bounded native-image result in the committed Ticket 02 harness. It does not prove:

- AI asset ownership, `addFiles` restore, rollback, or AI Undo/Redo images;
- production operation transport or outcomes;
- production lifecycle reset;
- cap, accessibility, RightDock, persistence, Focus mode, or integrated application behavior;
- Ticket 02 AC6 acceptance outside later governance and integrated evidence.

Return to governance. No production package, feature review, AC disposition, or final acceptance is authorized by inference from this PASS.
