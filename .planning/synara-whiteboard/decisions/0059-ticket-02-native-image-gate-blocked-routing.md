# Decision 0059: Record Ticket 02 native-image Gate BLOCKER and return to governance

**Status:** Binding — bounded measurement blocker and routing record; no later work package authorized
**Date:** 2026-08-27
**Trigger:** Exact-candidate WP-NATIVE-IMAGE-GATE evidence plus independent read-only `PASS-BLOCKER` review
**Prior decision disposition:** Decision 0058's execution authority is fulfilled by a valid `BLOCKER`; its product boundaries, prohibitions, and no-acceptance rule remain binding
**Native-image behavior verdict:** Not measured
**Final-acceptance consultation consumed:** No

## Question

Could Decision 0058's required package-supported file-chooser scenario be driven through the authorized public browser-test surface, and what may happen next?

## Decision

The Ticket 02 native-image Gate is recorded as:

```text
TICKET 02 NATIVE IMAGE GATE: BLOCKER
Reason: the package-supported File System Access picker cannot be supplied a file
through the authorized public Vitest Browser surface and exact four-path write set
Measured source candidate: 209ca21370415afcea5e860474ca8fdefd166bae
```

This is a test-boundary and authorization-boundary result. It is **not** a native Excalidraw image-history failure. The sentinel was not delivered to Excalidraw, so native Delete, Undo, Redo, second Undo, element/file closure, and official SVG/PNG recovery behavior remain unmeasured.

No Ticket 02 acceptance criterion is passed, failed, narrowed, or accepted by this decision.

Project and Ticket 02 routing advance from:

```text
active-native-image-gate
```

to:

```text
awaiting-native-image-gate-governance-reassessment
```

No production implementation or later work package is authorized.

## Evidence and provenance

### Exact candidates

- Source candidate: `209ca21370415afcea5e860474ca8fdefd166bae`
  - subject: `test(whiteboard): prove native image history gate`
  - parent: Decision 0058 commit `2001ea66332bcee18baa513aab28f4cb56fc4138`
- Evidence-only commit: `8dd68ad21a582d204b9ca077709f90b4e24d2501`
  - subject: `test(whiteboard): record native image gate evidence`
- Main integration merge: `607c2491f`
  - preserves both exact commit identities in main history
- Evidence:
  - [native-image-gate.md](../evidence/ticket-02/native-image-gate.md)
  - `native-image-gate.run-a.browser.log`
  - `native-image-gate.run-b.browser.log`

The source candidate added exactly the Decision 0058 browser-test path. The evidence commit added exactly the three Decision 0058 evidence paths. Package manifests, `bun.lock`, browser configuration, production runtime, server, contracts, shared, Pi, Agentation, Ticket 01, and other protected work were absent.

### Reproducibility runs

Both stable-Chromium runs used source candidate `209ca21370415afcea5e860474ca8fdefd166bae`, separate immutable logs, distinct prechecked ports, Bash `pipefail`, and explicit `PIPESTATUS[0]` capture:

- Run A, port `52551`: exit `1`
- Run B, port `52562`: exit `1`

Both runs reproduced the same material observation:

```text
show-open-file-picker-typeof=function
pre-click-file-inputs=0
image-tool-before=false
toolbar-click=TIMEOUT
connected-input-found=false
file-inputs-after-window=0
sightings=[]
image-elements=0
```

The non-zero exits deliberately preserve the unmet insertion precondition. They are not represented as native-image behavior failures.

## Mechanism finding

The pinned package route is:

```text
Excalidraw image toolbar
→ setActiveTool(image)
→ onImageAction
→ browser-fs-access fileOpen
→ window.showOpenFilePicker
```

In the measured Chromium, `showOpenFilePicker` exists. `browser-fs-access@0.29.1` therefore selects its modern File System Access branch and does not create the legacy `input[type=file]` target.

The authorized public Vitest Browser surface cannot complete that picker:

- `userEvent.upload` changes a file input and requires an `Element | Locator`; no such input exists;
- Vitest Browser `page` is not Playwright's server-side Page and exposes no native-picker selection API;
- a custom Commands API bridge requires browser setup/configuration paths outside Decision 0058;
- raw/private provider access, undocumented CDP use, chooser/global replacement, legacy-fallback forcing, package patching, and direct Excalidraw insertion are prohibited;
- Playwright/CDP input-file mechanisms target input elements and do not independently answer `showOpenFilePicker`.

Therefore Decision 0058's explicit `BLOCKER` stop rule applies.

## Independent review disposition

The independent read-only Gate review returned:

```text
PASS-BLOCKER
Confidence: High
Needs: None before governance routing
```

The reviewer directly verified:

- exact source/evidence ancestry and path inventories;
- clean diffs and committed evidence hashes;
- sentinel byte length, hash, dimensions, and distinct opaque colors;
- Excalidraw `0.18.1`, `browser-fs-access@0.29.1`, and Vitest Browser `4.1.10` mechanism surfaces;
- absence of a permitted public API that can supply the File System Access picker;
- absence of prohibited source, package, config, or runtime changes.

The review also recorded non-invalidating cautions:

1. “Picker opened and awaited selection” is an evidence-backed mechanism inference, not a directly visible headed-dialog observation.
2. A synthetic file drop is a distinct Excalidraw user insertion path, not the Decision 0058 file-chooser route; it would require a separate governance decision if considered.
3. Merely authorizing a Vitest Commands API bridge would not by itself make `showOpenFilePicker` selectable. A later authorization must name a technically valid boundary and must not disguise global replacement or legacy-fallback forcing as ordinary chooser automation.
4. Any later full candidate must define the required in-test pixel sample map before a PASS can be measured.

None changes the `BLOCKER` classification.

## Explicitly unmeasured and unclaimed

The following remain `NOT MEASURED — NOT CLAIMED`:

- native image element/file closure;
- official SVG and decoded PNG meaning;
- native Delete and Undo recovery;
- native Redo removal;
- second native Undo recovery;
- AI image restoration;
- every Ticket 02 AC1–AC10 disposition;
- production operation transport, outcomes, assets, failures, cap, lifecycle, accessibility, RightDock, persistence, and integrated application behavior;
- feature-level review, workspace gates, and final acceptance.

The owner-approved native exact-image promise is not narrowed by this record because package behavior was not validly exercised.

## What remains prohibited

Until a later governance decision explicitly authorizes a new bounded write set:

- no production runtime implementation;
- no `WP-OPERATION-TRANSPORT-OUTCOMES`;
- no `WP-AI-ASSETS-RESTORE-FAILURE`;
- no cap, lifecycle, accessibility, RightDock, persistence, launcher, Focus-mode, or integrated-app work;
- no package, lockfile, browser-config, server, contracts, shared, Pi, or Agentation changes for Ticket 02;
- no chooser monkey-patching, private/raw provider access, undocumented action keys, package internals, direct `addFiles`, `updateScene`, adapter insertion, or remount workaround;
- no Ticket 02 AC claim, feature review, or final acceptance;
- no `bun fmt`, `bun lint`, or `bun typecheck` completion claim under this bounded result.

## Required next decision

The next step is governance reassessment, not implementation.

That reassessment must choose one of these classes of outcome explicitly:

1. authorize a new, technically valid, narrowly bounded real-browser measurement route and exact write set;
2. authorize a different genuine user insertion boundary and amend the native-image acceptance requirement accordingly; or
3. leave the native-image criterion unmeasured and decide the consequence for Ticket 02 sequencing.

The reassessment must not infer that Commands API or raw Playwright access can answer `showOpenFilePicker` without naming and validating the actual mechanism. It must also decide whether production work remains blocked behind native-image measurement or whether a separately bounded package may proceed without weakening AC6.

## Traceability

- Product authority: [Decision 0055](0055-ticket-02-fallback-dual-history-contract-approved.md).
- Fallback Gate result: [Decision 0057](0057-ticket-02-fallback-wp-gate-passed-routing.md).
- Native-image Gate authority and stop rules: [Decision 0058](0058-ticket-02-native-image-gate-authorization.md).
- Evidence: [native-image-gate.md](../evidence/ticket-02/native-image-gate.md).
- Testing governance: [Decision 0047](0047-testing-strategy-governance-reassessment.md).
- Ticket: [02 — Prove fallback dual-history Undo and Redo](../issues/02-prove-ai-batch-undo-redo.md).
