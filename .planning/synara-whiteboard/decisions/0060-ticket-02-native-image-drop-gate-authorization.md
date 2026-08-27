# Decision 0060: Authorize Ticket 02 native-image drag-and-drop Gate only

**Status:** Binding — bounded drag-and-drop Gate authorized; production implementation remains prohibited
**Date:** 2026-08-27
**Trigger:** Owner selected direction 1 after Decision 0059's file-chooser automation BLOCKER
**Owner decision:** Do not use `/Users/anhpham99/Downloads/avt.jpg` as the formal Gate fixture; use the real Excalidraw drag-and-drop user path
**Prior decision disposition:** Decision 0059's BLOCKER remains valid for `showOpenFilePicker`; its governance-reassessment requirement is fulfilled by this bounded authorization
**Final-acceptance consultation consumed:** No

## Question

May Ticket 02 measure native image history through Excalidraw's real drag-and-drop user insertion path after the package-supported file chooser proved unautomatable within the public test boundary?

## Decision

Authorize exactly one replacement measurement package:

```text
WP-NATIVE-IMAGE-DROP-GATE
```

The Gate may use browser-standard `File`, `DataTransfer`, `DragEvent`, and `dispatchEvent` on the real Excalidraw drop container. This explicitly authorizes the package's real `handleAppOnDrop` path as the user insertion boundary for AC6 measurement.

This does not authorize synthetic scene insertion, adapter insertion, production runtime changes, or any later Ticket 02 work package.

Project and Ticket 02 routing advance to:

```text
active-native-image-drop-gate
```

## Why `/Users/anhpham99/Downloads/avt.jpg` is not the formal fixture

The file is a valid JPEG:

- dimensions: `640 × 640`
- byte length: `59,741`
- SHA-256: `e9e4ef88535472f28dc544bf1bc47ba7b129a93832c1d99adeb2121933808351`

It is not suitable as the formal Gate fixture because:

- a local path still cannot be supplied to `showOpenFilePicker` through the authorized Vitest Browser surface;
- it is outside the repository and unavailable to CI and independent reviewers;
- its external bytes and availability are not controlled by the exact candidate;
- a personal image is unnecessary for deterministic native-history proof.

The formal Gate must instead define a small deterministic opaque multi-color PNG entirely inside the browser test. The owner's JPEG may be used only for optional local manual exploration and may not be cited as acceptance evidence.

## Exact four-path write set

Only these existing paths may be modified:

```text
apps/web/src/components/whiteboard/ticket02/SynaraNativeImageHistoryGate.acceptance.browser.tsx
.planning/synara-whiteboard/evidence/ticket-02/native-image-gate.md
.planning/synara-whiteboard/evidence/ticket-02/native-image-gate.run-a.browser.log
.planning/synara-whiteboard/evidence/ticket-02/native-image-gate.run-b.browser.log
```

The browser test replaces the prior file-chooser probe. The evidence files replace the Decision 0059 BLOCKER evidence only after a new source candidate is committed and measured.

No fixture file, runtime helper, browser command, setup file, or config change is authorized.

## Authorized insertion mechanism

The Gate must use this public browser and package route:

```text
deterministic PNG bytes
→ new File(...)
→ new DataTransfer()
→ dataTransfer.items.add(file)
→ dragenter / dragover / drop on the real `.excalidraw` container
→ Excalidraw handleAppOnDrop
→ package image initialization and file ownership
```

Requirements:

- target the real `.excalidraw.excalidraw-container`;
- use finite client coordinates inside its bounding rectangle;
- dispatch cancelable, bubbling drag events;
- include the real `File` in `DataTransfer.files`;
- allow Excalidraw's own async image initialization to complete;
- use no direct package or adapter scene write.

This event construction is authorized public DOM interaction, not monkey-patching.

## Objective

Determine whether pinned `@excalidraw/excalidraw@0.18.1`, in stable real Chromium, can:

1. accept a deterministic meaningful image through its real drag-and-drop handler;
2. preserve complete image element/file closure;
3. produce meaningful official SVG and PNG exports;
4. remove the image through a normal user deletion;
5. restore complete closure and exports through native Undo;
6. remove it through native Redo; and
7. recover it through a second native Undo.

This Gate evaluates native Excalidraw behavior only. It does not prove AI image restoration.

## Deterministic sentinel

The browser test must define:

- PNG bytes or base64;
- byte length and SHA-256;
- dimensions of at least `3 × 2`;
- MIME type `image/png`;
- multiple distinct opaque colors;
- expected source pixel/color map;
- expected file metadata and binary closure.

The sentinel must not depend on `/Users/anhpham99/Downloads/avt.jpg` or any external path.

## Required scenario

Both formal stable-Chromium runs must prove all rows on one exact source candidate.

### Initial insertion and closure

- exactly one new active image element exists;
- its `fileId` is a non-empty string;
- `files[fileId]` exists;
- file ID, MIME type, data URL, created metadata, dimensions, and binary hash match the sentinel;
- the image is active, not deleted, and meaningfully rendered;
- Synara AI history remains empty and unlocked.

### Official export proof

Use only public official Excalidraw export utilities, directly or through the existing adapter wrappers:

- SVG parses successfully, has positive dimensions/content, contains an image node and embedded image payload;
- PNG has the correct signature/MIME, decodes successfully, has positive dimensions, and contains deterministic opaque sentinel colors;
- Blob existence or SVG-only success is insufficient.

Because the exported scene may include other elements and padding, deterministic color proof may scan decoded PNG pixels for the predeclared opaque sentinel colors rather than assume fixed export coordinates. The assertion must exclude blank or transparent output.

### Native history sequence

1. Select the inserted image through normal pointer interaction.
2. Delete it through a normal keyboard delete action.
3. Prove the active image/file reference closure and sentinel export evidence are absent.
4. Invoke native Excalidraw Undo through the public toolbar or platform shortcut.
5. Repeat complete element/file/SVG/PNG proof.
6. Invoke native Redo through the public toolbar or platform shortcut.
7. Repeat complete removal proof.
8. Invoke native Undo again.
9. Repeat complete recovery proof.

Recovery must preserve the same image identity, file ID, data bytes/hash, dimensions, MIME, and meaningful exports.

## PASS, FAIL, and BLOCKER taxonomy

### PASS

The Gate passes only if every insertion, closure, export, Delete, Undo, Redo, and second-Undo invariant passes in both runs:

```text
TICKET 02 NATIVE IMAGE DROP GATE: BOUNDED PASS
```

A PASS does not pass Ticket 02 or any general AC by itself.

### Native-behavior FAIL

The Gate validly fails if the real drop path is reproducibly driven but:

- the package does not create complete image/file closure;
- official SVG or PNG is blank, transparent, undecodable, or lacks sentinel evidence;
- native Undo restores an element shell without its binary;
- native Redo leaves active image/sentinel evidence;
- second native Undo does not reproduce exact recovery;
- Run A and Run B disagree after a valid drop.

On FAIL, preserve evidence and return to the owner. Do not patch around package behavior.

### BLOCKER

Execution stops as `BLOCKER` if:

- standard `DataTransfer`/`DragEvent` cannot deliver the file to the real Excalidraw drop handler;
- runtime, harness, browser config, raw provider access, package internals, or paths outside the four-path write set are required;
- exact source/log provenance cannot be maintained.

## Exact-candidate protocol

### Source candidate

1. Work in an isolated clean worktree based on this decision.
2. Modify only the browser-test path.
3. Audit protected paths, package/lock absence, resolved Excalidraw `0.18.1`, and `git diff --check`.
4. Commit before formal measurement with:

```text
test(whiteboard): prove native image history gate via drop
```

5. Record the exact source SHA and require a clean source tree.

### Runs

For each run:

```bash
set -o pipefail
VITEST_BROWSER_API_PORT=<distinct-prechecked-port> \
  bun run --cwd apps/web test:browser:stable -- \
  src/components/whiteboard/ticket02/SynaraNativeImageHistoryGate.acceptance.browser.tsx \
  2>&1 | tee <dedicated-log>
run_status=${PIPESTATUS[0]}
printf 'RUN_EXIT=%s\n' "$run_status"
test "$run_status" -eq 0
```

Both logs must be immutable and captured from the same committed source candidate.

### Evidence

Replace `native-image-gate.md` with candidate/package/browser/OS provenance, sentinel bytes/hash/dimensions/MIME/color map, drop event route, commands/ports/exits, log hashes, complete state matrix, official SVG/PNG evidence, path/public-boundary audit, limitations, and bounded verdict.

Commit only the three evidence paths with:

```text
test(whiteboard): record native image gate evidence
```

If the test is defective, create a new source candidate and rerun both measurements. Do not patch source in the evidence commit.

## Prohibited

The Gate must not:

- modify any path outside the exact four-path write set;
- change `apps/web/package.json`, `apps/web/src/main.tsx`, `bun.lock`, browser/Vitest/Vite config, server, contracts, shared, Pi, Agentation, Ticket 01, Ticket 02 runtime/harness, stores, transport, or unrelated planning projects;
- use `initialData`, direct `addFiles`, `updateScene`, adapter-mediated insertion, cache preload, or scene restoration as proof of insertion;
- import Excalidraw internals or dist chunks;
- access raw/private Playwright or undocumented CDP behavior;
- monkey-patch `DataTransfer`, `DragEvent`, Excalidraw handlers, `showOpenFilePicker`, `document.createElement`, `File`, or browser globals;
- force the legacy file-input fallback;
- use DOM/CSS suppression, a remount workaround, package patch, fork, package upgrade, or lockfile change;
- claim AI image recovery, any Ticket 02 AC, feature review, or final acceptance;
- run or claim `bun fmt`, `bun lint`, or `bun typecheck` completion under this bounded Gate.

## Independent review

An independent read-only Gate review is required after PASS, FAIL, or BLOCKER evidence. It must verify:

- the drop was delivered through the real Excalidraw container and handler;
- no direct insertion or prohibited mechanism occurred;
- exact path/candidate/log provenance;
- complete element/file/SVG/PNG closure across all history states;
- both runs agree;
- later work remains unauthorized.

This is not Ticket 02 feature review or final acceptance.

## Downstream routing

A bounded PASS returns to governance for production-package routing. A valid native failure returns to the owner. A new `BLOCKER` returns to governance.

No production operation transport, outcomes, AI assets/restore/failure, cap/lifecycle, accessibility, RightDock, persistence, integrated app, feature review, workspace gate, or final acceptance work may begin by inference.

## Traceability

- Owner direction: current-session approval of direction 1.
- Prior BLOCKER: [Decision 0059](0059-ticket-02-native-image-gate-blocked-routing.md).
- Prior file-chooser authority: [Decision 0058](0058-ticket-02-native-image-gate-authorization.md).
- Product contract: [Decision 0055](0055-ticket-02-fallback-dual-history-contract-approved.md).
- Testing governance: [Decision 0047](0047-testing-strategy-governance-reassessment.md).
- Ticket: [02 — Prove fallback dual-history Undo and Redo](../issues/02-prove-ai-batch-undo-redo.md).
