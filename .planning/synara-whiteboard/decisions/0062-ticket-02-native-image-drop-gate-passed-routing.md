# Decision 0062: Record Ticket 02 native-image drop Gate PASS and return to governance

**Status:** Binding — bounded native-package Gate result and routing record; no production package authorized
**Date:** 2026-08-27
**Trigger:** Decision 0060/0061 exact-candidate evidence plus independent remediation re-review PASS
**Prior decision disposition:** Decision 0060's execution authority is fulfilled; Decision 0061's normalization semantics remain binding
**Final-acceptance consultation consumed:** No

## Question

Did pinned Excalidraw `0.18.1` preserve meaningful native image closure through the authorized real drag-and-drop path and native Delete/Undo/Redo sequence, and what may happen next?

## Decision

Record:

```text
TICKET 02 NATIVE IMAGE DROP GATE: BOUNDED PASS
Measured source candidate: c37dbf1b3f8ccc8cc6fc2ad16057a1fb337247a2
```

Within the bounded real-Chromium harness, Excalidraw accepted the deterministic image through its real drop handler and preserved exact package-owned image closure and meaningful official exports through:

```text
initial drop
→ user Delete
→ native Undo
→ native Redo
→ second native Undo
```

This does not pass Ticket 02, AC6, or any other acceptance criterion. It does not prove AI image restoration or integrated production behavior.

Project and Ticket 02 routing advance from:

```text
active-native-image-drop-gate
```

to:

```text
awaiting-post-native-image-gate-governance-reassessment
```

No production work package is authorized by this decision.

## Evidence and provenance

- Authority:
  - [Decision 0060](0060-ticket-02-native-image-drop-gate-authorization.md)
  - [Decision 0061](0061-ticket-02-native-image-drop-normalization-amendment.md)
- Measured source: `c37dbf1b3f8ccc8cc6fc2ad16057a1fb337247a2`
  - subject: `test(whiteboard): prove native image history gate via drop`
- Evidence: `ad0755ec5bee5725240396ff91dff51a26bd5f7e`
  - subject: `test(whiteboard): record native image gate evidence`
- Main integration merge: `c6a0c67ff`
  - preserves the source and evidence commit identities
- Evidence document:
  - [native-image-gate.md](../evidence/ticket-02/native-image-gate.md)
- Immutable logs:
  - `native-image-gate.run-a.browser.log`
  - `native-image-gate.run-b.browser.log`

The source ancestry after Decision 0061 changes only the authorized browser-test path. The evidence commit changes only the three authorized evidence paths.

## Exact-candidate runs

Both runs used `c37dbf1b3f8ccc8cc6fc2ad16057a1fb337247a2`, separate raw logs, distinct prechecked ports, Bash `pipefail`, and explicit `PIPESTATUS[0]`.

- Chromium A, port `52631`: 1/1 pass, exit `0`
  - log SHA-256: `dcfee7fed0e106ca6f165cdc33cfa47c456a1819237df572cbb5b55a0ac62189`
- Chromium B, port `52642`: 1/1 pass, exit `0`
  - log SHA-256: `10b37aca3b6e57b0a8b4389c3f6c7dcc73623a00f5b6516fd4ec0f9a3ca88e5c`

The raw logs end with the blank line emitted by the test process. Their hashes match the committed bytes; the resulting `git diff --check` log warning is non-invalidating and the logs were not normalized.

## Bounded findings

### Real insertion route

The test uses:

```text
File
→ DataTransfer
→ dragenter / dragover / drop
→ real `.excalidraw.excalidraw-container`
→ Excalidraw handleAppOnDrop
```

No direct `addFiles`, `updateScene`, `initialData`, adapter insertion, package internal, raw Playwright/CDP, chooser replacement, or runtime/config change is used.

### Source and normalized package closure

The source PNG is proven before dispatch:

- `32 × 16`;
- `120` bytes;
- SHA-256 `820a2c5650f64161d184782ba6659456d5cfca6af1bc7d45a3241416aa33a37e`;
- MIME `image/png`;
- exact 512-pixel spatial map of eight opaque colors.

The package-normalized initial file is proven:

- `171` bytes;
- SHA-256 `7d9fc3dfc16b9293589a2f87239dfa7a8325441bb1648eac3729f11819e3858c`;
- same dimensions, MIME, and exact spatial pixel map;
- complete element ID, file ID, file record, data URL, created metadata, and active-reference closure.

Both native recoveries reproduce the same:

- element ID;
- file ID;
- full normalized data URL;
- normalized byte length and SHA-256;
- dimensions, MIME, and spatial pixel map.

### Meaningful exports

Present-image states prove:

- official SVG parses, has rendered content, includes an image node, and embeds PNG data;
- official PNG has a valid signature, decodes, has positive dimensions, and includes all eight opaque sentinel colors.

Delete and Redo states prove:

- no active image element/reference;
- no SVG image payload;
- no sentinel colors in official PNG.

### Native route and AI separation

- The inserted image is selected through a real pointer click.
- Delete uses the public keyboard path.
- Undo and Redo use package buttons by public role/name.
- Synara AI history remains zero events and `unlocked` at every matrix state.
- No critical Synara diagnostic is present at final recovery.

## Independent review disposition

The first independent review returned `NEEDS REMEDIATION` while validating the route and provenance. It required:

1. source-side dimensions and spatial pixel proof;
2. full normalized data URL/bytes/length recovery comparison;
3. exact stored spatial pixel proof;
4. AI history assertions at every state.

Candidate `c37dbf1b3f8ccc8cc6fc2ad16057a1fb337247a2` closed all four findings and both formal runs were repeated from the beginning.

The independent remediation re-review returned:

```text
PASS
Confidence: High
Needs: None
```

It verified the actual source, evidence, authority, commit graph, path inventories, source sentinel, normalized identity, matrix assertions, and raw log hashes. It identified no new severity finding.

## Explicitly deferred and unclaimed

This result does not prove:

- AI image asset ownership, preflight, restore, rollback, or failures;
- production operation transport or outcomes;
- real Take Over and failed-partial behavior;
- AI-only 20-event cap;
- production lifecycle reset;
- production accessibility, RightDock, persistence, Focus mode, or integrated application behavior;
- Decision 0047 final integrated-browser evidence;
- Ticket 02 AC1–AC10 disposition;
- feature-level review, workspace gates, or final acceptance.

## Required next decision

The next step is a post-native-image-Gate governance reassessment, not implementation by inference.

That decision must:

1. cite Decisions 0055, 0057, 0058–0062;
2. preserve the ephemeral Whiteboard operation-session architecture ratified by Decision 0058;
3. decide whether `WP-OPERATION-TRANSPORT-OUTCOMES` may begin;
4. define its exact production write set and protected concurrent paths;
5. keep `WP-AI-ASSETS-RESTORE-FAILURE` separate unless explicitly authorized later;
6. preserve AC6 as requiring later integrated evidence even though this bounded package Gate passed;
7. leave feature review and final acceptance unconsumed.

Until that decision exists, production operation transport, outcomes, AI assets/restore/failure, cap/lifecycle, accessibility, RightDock, persistence, integrated app, feature review, workspace gates, and final acceptance remain unauthorized.

## Traceability

- Product contract: [Decision 0055](0055-ticket-02-fallback-dual-history-contract-approved.md).
- Fallback Gate PASS: [Decision 0057](0057-ticket-02-fallback-wp-gate-passed-routing.md).
- File-chooser BLOCKER: [Decision 0059](0059-ticket-02-native-image-gate-blocked-routing.md).
- Drop Gate authority: [Decision 0060](0060-ticket-02-native-image-drop-gate-authorization.md).
- Normalization amendment: [Decision 0061](0061-ticket-02-native-image-drop-normalization-amendment.md).
- Evidence: [native-image-gate.md](../evidence/ticket-02/native-image-gate.md).
- Testing governance: [Decision 0047](0047-testing-strategy-governance-reassessment.md).
- Ticket: [02 — Prove fallback dual-history Undo and Redo](../issues/02-prove-ai-batch-undo-redo.md).
