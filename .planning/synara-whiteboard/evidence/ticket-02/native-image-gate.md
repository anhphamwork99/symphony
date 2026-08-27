# Ticket 02 WP-NATIVE-IMAGE-GATE — public file-chooser BLOCKER

**Decision authority:** Decision 0058
**Measured source candidate:** `209ca21370415afcea5e860474ca8fdefd166bae`
**Candidate parent:** `2001ea66332bcee18baa513aab28f4cb56fc4138`
**Candidate subject:** `test(whiteboard): prove native image history gate`

## Bounded verdict

```text
TICKET 02 NATIVE IMAGE GATE: BLOCKER — SUPPORTED FILE-CHOOSER ROUTE CANNOT BE DRIVEN THROUGH THE AUTHORIZED PUBLIC TEST SURFACE
```

This is **not** a native-image behavior FAIL. The required user insertion scenario did not reach a selected file, so native Delete/Undo/Redo and SVG/PNG recovery behavior were not measured.

No Ticket 02 acceptance criterion is claimed passed, failed, or accepted. Production work and every later work package remain unauthorized.

## Why this is a BLOCKER rather than FAIL

Decision 0058 requires insertion through the package-supported browser file chooser and requires an immediate `BLOCKER` if that route cannot be driven reproducibly without runtime, harness, browser-config, private API, or write-set expansion.

The public interaction reached Excalidraw's real `Insert image` toolbar action. In the installed stable Chromium, `window.showOpenFilePicker` exists, so Excalidraw opened the native picker rather than creating a connected legacy `input[type=file]`. The public Vitest click remained pending while the chooser waited for a user selection. No connected file input appeared during the bounded observation window.

The official Vitest Browser API exposes `userEvent.upload(element, files)` only for an `Element | Locator` representing a file input. It explicitly states that `vitest/browser`'s `page` is not the Playwright `Page`; direct Playwright Page access requires the Commands API. Adding a server-side browser command/config/setup path is outside Decision 0058's exact four-path write set and browser-configuration prohibition. Raw/private provider access, monkey-patching `showOpenFilePicker`, patching `document.createElement`, direct `addFiles`, or adapter-mediated insertion are also prohibited.

Therefore no remaining authorized public mechanism can provide the file to the already-open native picker.

Documentation checked:

- Vitest Browser `userEvent.upload`: changes a file input element and requires an `Element | Locator`.
- Vitest Browser `page`: is not Playwright's Page; Playwright Page access requires Commands API.

## Candidate and changed-path audit

Candidate diff from Decision 0058 authority contains exactly:

```text
apps/web/src/components/whiteboard/ticket02/SynaraNativeImageHistoryGate.acceptance.browser.tsx
```

The candidate:

- imports/composes committed Ticket 01/02 code without modifying it;
- uses stable public toolbar identity `data-testid="toolbar-image"`;
- uses public `userEvent.click` and public DOM observation only;
- does not patch the package, browser, chooser, globals, or document creation;
- does not use `initialData`, `addFiles`, `updateScene`, adapter insertion, private Playwright Page access, or native-stack inspection;
- leaves package manifests, `bun.lock`, browser config, runtime source, server, contracts, shared, Pi, Agentation, and other planning paths unchanged;
- passed source-candidate `git diff --check` before commit;
- had a clean source tree before both runs.

## Package and environment provenance

- `@excalidraw/excalidraw`: exact resolved version `0.18.1`
- `bun.lock` entry: `@excalidraw/excalidraw@0.18.1`
- lock integrity: `sha512-6i5Gt7IDTOH//qa0Z315Ly5iVRhjWpu2whrlQFqkuwrkKUWgRsMk0P5qdE7bpyDpai7jeLeWYkyj1eVAfni1lw==`
- Bun: `1.3.12`
- Node.js: `v24.14.1`
- Vitest: `4.1.10`
- Playwright core: `1.58.2`
- Chromium: Google Chrome for Testing `145.0.7632.6`
- OS: macOS `26.4.1` build `25E253`
- architecture: `arm64`

The isolated worktree used the repository's existing `node_modules` installation. Vite emitted the already-known font allow-list warnings caused by the external module path; they did not alter the chooser observation.

## Sentinel provenance

The test defines its candidate sentinel entirely in the authorized browser test:

- encoded PNG bytes: in-file base64 constant
- byte length: `80`
- SHA-256: `f4c9aa77ea404b705139be6723be2d2cf74154a9b6a437868ebf8953a754187b`
- PNG dimensions from IHDR: `4 × 2`
- MIME type intended for upload: `image/png`

Because chooser selection was blocked, the sentinel was never delivered to Excalidraw and no pixel/export claim is made.

## Formal reproducibility runs

Both runs used source candidate `209ca21370415afcea5e860474ca8fdefd166bae`, a clean source tree, distinct prechecked ports, separate logs, Bash `set -o pipefail`, and explicit `${PIPESTATUS[0]}` capture.

| Run | Port | Test-process exit | Log | SHA-256 |
|---|---:|---:|---|---|
| A | `52551` | `1` (`RUN_A_EXIT=1`) | `native-image-gate.run-a.browser.log` | `2b82ec9ede01e3dc281bdddc4673ec1dc35956cc8b15cdf3d3e2ea6efb6139c5` |
| B | `52562` | `1` (`RUN_B_EXIT=1`) | `native-image-gate.run-b.browser.log` | `f55e8c950998499e2c943e8f54623c91f24e69df236d5921c76fb98b77de113c` |

Command shape for each run:

```bash
set -o pipefail
VITEST_BROWSER_API_PORT=<port> \
  bun run --cwd apps/web test:browser:stable -- \
  src/components/whiteboard/ticket02/SynaraNativeImageHistoryGate.acceptance.browser.tsx \
  2>&1 | tee <dedicated-log>
run_status=${PIPESTATUS[0]}
printf 'RUN_EXIT=%s\n' "$run_status"
```

The two non-zero exits are expected proof that the required public chooser precondition was not met; they are not represented as native-image test failures.

## Reproduced observation

Run A and Run B produced the same material trace:

```text
show-open-file-picker-typeof=function
pre-click-file-inputs=0
image-tool-before=false
toolbar-click=TIMEOUT
connected-input-found=false
file-inputs-after-window=0
sightings=[]
scene-elements=5
image-elements=0
selection=[]
```

Interpretation:

1. The real embedded Excalidraw mounted and was ready.
2. The real package image toolbar was found and activated.
3. Chromium exposed the native File System Access picker.
4. The public click remained pending for the bounded 8-second period while the native picker awaited selection.
5. No connected file input existed before or during the following 4-second observation window.
6. Public locator upload therefore had no valid target.
7. No image element was inserted.

The probe deliberately fails at `imageCount > 0` so the blocked precondition cannot be mistaken for a pass.

## Required scenario disposition

| Decision 0058 row | Result |
|---|---|
| Supported user file-chooser insertion | `BLOCKER` — chooser opened, but authorized public test API cannot supply a selection |
| Initial element/file closure | Not reached |
| Initial official SVG/PNG proof | Not reached |
| Delete → native Undo recovery | Not reached |
| Native Redo removal | Not reached |
| Second native Undo recovery | Not reached |
| Native-image behavior verdict | Not measured; no PASS or FAIL claim |

## Prohibited alternatives not used

The following could bypass the observation but are outside Decision 0058 and were not used:

- modifying Vitest browser config/setup to register a server-side Playwright command;
- accessing raw/private Playwright provider objects;
- monkey-patching `window.showOpenFilePicker`;
- forcing browser-fs-access onto its legacy input fallback;
- patching `document.createElement` to capture detached inputs;
- direct Excalidraw `addFiles` or `updateScene` insertion;
- adapter/harness runtime modification;
- package, lockfile, or browser-configuration changes.

## Routing consequence

Execution stops under Decision 0058's immediate stop rule:

```text
BLOCKER — supported file-chooser route cannot be driven reproducibly within the exact public/write boundary
```

Return to governance. Do not narrow the native exact-image product promise yet, because native image behavior itself was not validly measured. A later decision may either:

1. authorize a narrowly specified public Vitest Commands API bridge and browser-config/setup write set solely for native file-chooser selection, followed by a new exact candidate and complete rerun; or
2. choose another governance-approved, genuinely user-path browser boundary.

No production implementation, later WP, AC disposition, or final acceptance follows from this evidence.
