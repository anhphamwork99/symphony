# Decision 0058: Authorize Ticket 02 WP-NATIVE-IMAGE-GATE only

**Status:** Binding — bounded native-image Gate authorized; production implementation remains prohibited
**Date:** 2026-08-27
**Trigger:** Decision 0057 post-Gate governance reassessment and supervisor adjudication
**Prior decision disposition:** Decision 0057 routing is fulfilled and advances to the bounded native-image Gate; Decisions 0055, 0057, and 0047 remain binding
**Final-acceptance consultation consumed:** No — this was a technical routing consultation, not Ticket 02 final acceptance

## Question

After the fallback dual-history WP-GATE passed, which work package may begin next, and which production architecture principles govern later planning without authorizing production implementation?

## Decision

Authorize exactly one work package:

```text
WP-NATIVE-IMAGE-GATE
```

The production-seam principles in this record are ratified for later planning, but the production implementation write set remains:

```text
none
```

All outcomes, assets, failures, cap, lifecycle, accessibility, RightDock, persistence, File-canvas, integrated application, final review, and final acceptance packages remain unauthorized.

Project and Ticket 02 routing advance to:

```text
active-native-image-gate
```

## Why this package is next

The native-image Gate:

- resolves the smallest remaining package-owned uncertainty;
- requires no production runtime change;
- has an exact four-path boundary;
- avoids current dirty Pi, Agentation, server, and Whiteboard adapter work;
- has a predeclared owner consequence if valid native behavior fails;
- can be reproduced independently against pinned Excalidraw `0.18.1`;
- avoids prematurely combining transport, outcomes, containment, binary ownership, rollback, lifecycle, UI composition, and integrated application behavior.

The broad production-seam proposal remains useful directional evidence, but its multi-layer write set is not authorized. Partial progress toward AC2, AC8, or AC10 does not justify a package whose failures would be difficult to attribute.

## Exact four-path write set

Only these paths may be created:

```text
apps/web/src/components/whiteboard/ticket02/SynaraNativeImageHistoryGate.acceptance.browser.tsx
.planning/synara-whiteboard/evidence/ticket-02/native-image-gate.md
.planning/synara-whiteboard/evidence/ticket-02/native-image-gate.run-a.browser.log
.planning/synara-whiteboard/evidence/ticket-02/native-image-gate.run-b.browser.log
```

The deterministic sentinel PNG bytes, fixed hash, dimensions, MIME metadata, and expected pixel samples must be defined inside the browser test. No fixture file or runtime helper is authorized.

Existing committed Ticket 01/02 runtime and harness code may be imported or composed as-is. It may not be modified to make the Gate pass.

## Objective

Determine whether pinned `@excalidraw/excalidraw@0.18.1`, in stable real Chromium, can:

1. accept a meaningful image through a supported user file-chooser path;
2. restore the complete image element/file closure through native Undo;
3. remove it through native Redo;
4. recover it through a second native Undo; and
5. produce meaningful official SVG and PNG exports before and after native recovery.

This package evaluates native Excalidraw behavior only. It does not implement or prove AI image restoration.

## Required scenario

Use a deterministic non-transparent sentinel PNG of at least `3×2` pixels with multiple distinct opaque RGBA colors and known hash and sample locations.

The real-browser scenario must:

1. insert the sentinel through the package-supported browser file chooser;
2. verify an image element, active file ID, binary hash, MIME type, dimensions, and file metadata;
3. export through official Excalidraw SVG and PNG utilities;
4. verify meaningful SVG image data/dimensions and decoded PNG dimensions plus deterministic opaque sentinel-colored samples;
5. delete the image through a normal user action;
6. invoke native Excalidraw Undo and repeat the complete closure and export proof;
7. invoke native Redo and prove the closure and sentinel export evidence are absent;
8. invoke native Undo again and repeat the complete recovery and export proof.

An element shell, placeholder, stale file ID, missing binary, transparent output, blank output, or SVG-only success is not meaningful image recovery.

## Prohibited under this decision

WP-NATIVE-IMAGE-GATE must not modify:

```text
apps/web/package.json
apps/web/src/main.tsx
bun.lock
apps/server/**
packages/contracts/**
packages/shared/**
apps/web/src/components/whiteboard/ticket01/**
apps/web/src/components/whiteboard/ticket02/ExcalidrawTicket02Harness.tsx
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryActions.tsx
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryCoordinator.ts
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryTypes.ts
apps/web/src/components/whiteboard/ticket02/SynaraDocumentSnapshot.ts
apps/web/src/components/whiteboard/ticket02/SynaraHistoryGate.acceptance.browser.tsx
apps/web/src/components/whiteboard/ticket02/SynaraHistoryGate.test.ts
apps/web/src/components/whiteboard/ticket02/SynaraHumanMutationSettlement.ts
apps/web/src/components/chat/**
apps/web/src/rightDockStore*
apps/web/src/store*
apps/web/src/wsNativeApi.ts
apps/web/src/wsTransport.ts
.planning/synara-pi-*/**
```

It also must not:

- change production runtime source or browser configuration;
- change the Excalidraw version, package manifest, or lockfile;
- use `initialData`, direct `addFiles`, `updateScene`, cache preloading, or adapter-mediated insertion as proof of user insertion;
- use private imports, package internals, native-stack inspection, undocumented action keys, monkey-patching, a fork, DOM/CSS suppression, or remount restoration;
- implement AI assets, AI restore, rollback, production operation transport, Take Over, cap, lifecycle, accessibility, RightDock, persistence, launcher, Focus mode, import, duplication, or File-canvas behavior;
- claim any Ticket 02 AC or final acceptance;
- run or claim `bun fmt`, `bun lint`, or `bun typecheck` completion.

If the supported scenario requires a prohibited path or technique, execution stops as `BLOCKER`; scope does not expand.

## PASS rules

The Gate passes only if all required insertion, closure, export, Undo, Redo, and second-Undo proofs pass in both stable-Chromium runs on one exact committed source candidate.

Both runs must use:

- the same committed source candidate;
- a clean source tree;
- distinct prechecked browser ports;
- separate immutable logs;
- Bash `set -o pipefail`;
- explicit `${PIPESTATUS[0]}` capture;
- unchanged package/lockfile resolution at Excalidraw `0.18.1`;
- a public-boundary and changed-path audit with no prohibited work.

A PASS may state only:

```text
TICKET 02 NATIVE IMAGE GATE: BOUNDED PASS
```

It does not pass Ticket 02, any general AC, Decision 0047 integrated evidence, or final acceptance.

## FAIL and BLOCKER rules

The Gate validly fails if a reproducibly driven supported scenario shows:

- native Undo restores an image element without its referenced binary;
- file metadata or hash differs from the sentinel;
- SVG lacks meaningful recovered image content;
- PNG is blank, transparent, undecodable, dimensionally invalid, or lacks expected rendered samples;
- native Redo leaves image/file or sentinel-render evidence;
- second native Undo does not reproduce recovery;
- Run A and Run B disagree;
- candidate or evidence provenance is lost after valid measurement.

On valid failure, preserve evidence and return to the owner to choose:

1. narrow the native exact-image promise; or
2. leave the applicable native-image criterion and Ticket 02 unaccepted.

Execution stops as `BLOCKER`, not native-behavior FAIL, if:

- a supported file-chooser route cannot be driven reproducibly;
- runtime or harness modification appears necessary;
- any path outside the four-path write set is required;
- package, lockfile, browser config, server, contracts, shared, Pi, subagent, or Agentation work is required;
- private or undocumented package behavior is required;
- exact source/log provenance cannot be maintained.

## Exact-candidate evidence protocol

### Source candidate

1. Work in an isolated worktree based on this decision.
2. Change only the browser test path.
3. Audit changed paths, protected paths, package/lock absence, resolved Excalidraw `0.18.1`, and `git diff --check`.
4. Commit the browser test before formal measurement with:

```text
test(whiteboard): prove native image history gate
```

5. Record `SOURCE_CANDIDATE=$(git rev-parse HEAD)` and require a clean tree.

### Run A and Run B

For each run:

```bash
set -o pipefail
VITEST_BROWSER_API_PORT=<distinct-free-port> \
  bun run --cwd apps/web test:browser:stable -- \
  src/components/whiteboard/ticket02/SynaraNativeImageHistoryGate.acceptance.browser.tsx \
  2>&1 | tee <dedicated-run-log>
run_status=${PIPESTATUS[0]}
printf 'RUN_EXIT=%s\n' "$run_status"
test "$run_status" -eq 0
```

Do not edit, append, normalize, or reuse logs after capture.

### Evidence document and commit

`native-image-gate.md` records candidate/package/browser/OS provenance, sentinel bytes/hash/sample map, insertion route, commands/ports/exits, log hashes, all four state proofs, SVG/PNG verification, path/public-boundary audits, limitations, and bounded verdict.

After measurement, only the three evidence paths may differ. Commit them separately with:

```text
test(whiteboard): record native image gate evidence
```

If a test defect is found, create a new source candidate and rerun both browser measurements. Do not patch source in the evidence commit.

An independent read-only Gate review is required before a later governance PASS or failure record. That review is not Ticket 02 feature review or final acceptance.

## Production architecture principles ratified for later planning

These principles authorize no production writes.

### Operation seam

Use a dedicated ephemeral Whiteboard operation-session service over the existing production WebSocket RPC transport. Progressive Whiteboard scene operations must not be encoded as durable orchestration journal events.

WebSocket delivery alone never proves scene application. The browser acknowledges an operation only after adapter callback correlation and semantic target verification.

### Ownership

- Server operation-session owner: admission, operation identity/generation, producer sequence, dependencies, terminal outcomes, retry identity, Take Over dispatch, and authoritative containment acknowledgement/failure.
- Browser operation bridge: applies admitted operations and truthfully acknowledges verified application.
- Browser AI-history coordinator: owns snapshots, cursor, branching, AI-only 20-event cap, and session-only history.
- Excalidraw adapter: owns synthetic provenance, public scene writes, native-history clear ordering, and package diagnostics.

### Lifecycle

The browser Whiteboard session runtime owns one atomic reset operation. Hosts that cause lifecycle transitions emit typed reasons; they do not clear independent history fragments.

A transient reconnect to the same server authority is not by itself a reset. Changed server/application authority or lost operation-session identity is a reset or fail-closed condition.

### Integrated evidence

Before final claims, an authorized package must compose the real web app, production WebSocket RPC route, real operation contracts/server authority, actual pinned Excalidraw embed, deterministic fake provider, and actual browser lifecycle hosts.

### Outcomes/assets/failure split

The monolithic package is rejected and split into:

1. `WP-OPERATION-TRANSPORT-OUTCOMES` — image-free production operation sessions, ordering, acknowledgements, completion, Take Over, failed-partial, no-op, zero-valid, invalid/dependent, stale, and post-containment behavior.
2. `WP-AI-ASSETS-RESTORE-FAILURE` — binary ownership, preflight, public `addFiles`, image restore/export verification, mismatch, restore failure, rollback, and locked-fault behavior.

No `packages/shared` change is presumed. Any future shared-runtime path requires concrete cross-runtime duplication evidence.

## Rejected alternatives

- immediate monolithic outcomes/assets/failure implementation;
- immediate broad multi-layer production seam;
- orchestration-journal delivery of progressive Whiteboard operations;
- temporary RightDock or lifecycle scaffolding merely to close Ticket 02;
- simulated lifecycle signals as final AC7 evidence;
- package upgrade, private API, or runtime workaround for image behavior.

## Downstream routing

After this record is committed and authoritative, only WP-NATIVE-IMAGE-GATE may execute.

A bounded PASS returns to governance for routing. A valid native failure returns to the owner. A `BLOCKER` returns to governance without a native-behavior verdict.

All production outcomes, assets, cap/lifecycle, accessibility, integration, feature review, workspace gates, and final acceptance remain unauthorized.

## Traceability

- Product contract: [Decision 0055](0055-ticket-02-fallback-dual-history-contract-approved.md).
- WP-GATE PASS routing: [Decision 0057](0057-ticket-02-fallback-wp-gate-passed-routing.md).
- Testing governance: [Decision 0047](0047-testing-strategy-governance-reassessment.md).
- Implementation direction: [Ticket 02 fallback dual-history plan](../plans/02-fallback-dual-history-implementation.md), §§7–11.
- Gate evidence: [fallback-gate.md](../evidence/ticket-02/fallback-gate.md).
