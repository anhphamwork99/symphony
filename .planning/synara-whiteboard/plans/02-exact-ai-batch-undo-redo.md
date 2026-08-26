# Ticket 02 execution plan — exact AI batch Undo/Redo

Status: Execution-ready
Date: 2026-08-26
Binding authority: [Decision 0051](../decisions/0051-ticket-02-exact-batch-history-direction.md)
Frontier: [Ticket 02](../issues/02-prove-ai-batch-undo-redo.md)

## Success model

Ticket 02 succeeds only when real Chromium with exact `@excalidraw/excalidraw@0.18.1` proves:

- three or more progressive AI updates create no exposed intermediate history events;
- completed, containment-acknowledged interrupted, and failed partial batches are each exactly one event when they produce a semantic mutation;
- zero-valid/no-op batches produce no event;
- Undo restores the exact pre-batch document and Redo restores the exact final or retained partial result;
- image-bearing Redo restores active element/file references, binaries, and meaningful official SVG/PNG export;
- Synara toolbar and platform keyboard shortcuts use one dispatcher/cursor and package-native history cannot compete;
- a semantic edit after Undo invalidates Redo while no-op/presentation-only input does not;
- representative pointer, Delete, and text-edit sessions share one ordered history with AI batches;
- the newest 20 events remain undoable and event 21 evicts only event 1;
- duplicate/fresh hydration retains current content but resets history;
- any inability to contain native history through the documented public boundary creates an honest AC4/AC7 failure and stops broad implementation.

Reliability invariants:

- cursor moves only after semantic verification;
- restore failure leaves cursor unchanged and attempts rollback;
- restore/finalization plus rollback failure enters explicit faulted/locked state;
- snapshots contain document state, not complete presentation/transient package state;
- viewport/zoom at command start are preserved;
- selection retains only valid non-deleted IDs;
- required assets are preflighted and supplied through public `addFiles`;
- runtime code has no private/DOM/test-selector containment dependency.

## Non-goals and forbidden scope

Ticket 02 does not:

- wire production RightDock/navigation/launcher/tabs/Focus mode;
- modify server orchestration, WebSocket/shared contracts, persistence, database, File canvases, Auto-save, thumbnails, composer chips, or production Take Over;
- add durable history or production duplication/restart lifecycle;
- change package manifests, package version, or `bun.lock`;
- fork/patch Excalidraw or use private imports, ActionManager/History access, stack inspection, undocumented action keys, monkey-patching, runtime DOM/CSS suppression, or remount-based restore;
- modify protected Agentation WIP or later Whiteboard tickets.

Global forbidden paths:

```text
bun.lock
**/package.json
apps/server/**
packages/contracts/**
packages/shared/**
production RightDock/navigation/store paths
apps/web/vitest.browser*.config.ts
.planning/synara-whiteboard/issues/03-*.md and later
```

A browser-config change is a challenge, not implicit write authority.

## Reusable boundaries

- `apps/web/src/components/whiteboard/ticket01/SynaraExcalidrawAdapter.tsx`
- `apps/web/src/components/whiteboard/ticket01/ExcalidrawTicket01Harness.tsx`
- Ticket 01 representative fixture and semantic comparator.
- Ticket 01 diagnostics, exports, viewport handling, exact package pin, acceptance and performance findings.
- Existing Chromium configs `apps/web/vitest.browser.config.ts` and `vitest.browser.stable.config.ts`.

## Dependency graph and mandatory checkpoint

```text
WP-GATE
  ├─ FAIL → preserve AC7 evidence → STOP broad work → Supervisor reassessment
  └─ PASS → CHECKPOINT-GATE
                ↓
              WP-CORE
                ↓
              WP-ASSET
                ↓
              WP-HUMAN
                ↓
              WP-MATRIX
                ↓
              WP-FINAL
                ↓
              WP-REVIEW
                ↓
         Supervisor final acceptance
```

No later package may be scaffolded, implemented, or run in parallel with WP-GATE.

# WP-GATE — Public-only native containment and one completed batch

## Objective

Build only the minimum unit needed to prove:

1. public snapshot, restore, and `history.clear()` adapter seams;
2. one package-independent Synara command route and minimum event/cursor coordinator;
3. a lazy isolated Ticket 02 harness with Synara toolbar and wrapper keyboard capture;
4. real-Chromium native-route containment;
5. a completed three-progress-update batch as exactly one event with exact Undo and Redo.

## Allowed write set

```text
apps/web/src/components/whiteboard/ticket01/SynaraExcalidrawAdapter.tsx
apps/web/src/components/whiteboard/ticket02/SynaraHistoryTypes.ts
apps/web/src/components/whiteboard/ticket02/SynaraDocumentSnapshot.ts
apps/web/src/components/whiteboard/ticket02/SynaraSessionHistory.ts
apps/web/src/components/whiteboard/ticket02/SynaraHistoryCommands.ts
apps/web/src/components/whiteboard/ticket02/ExcalidrawTicket02Harness.tsx
apps/web/src/components/whiteboard/ticket02/SynaraHistoryGate.test.ts
apps/web/src/components/whiteboard/ticket02/SynaraHistoryGate.acceptance.browser.tsx
.planning/synara-whiteboard/evidence/ticket-02/gate-containment.md
.planning/synara-whiteboard/evidence/ticket-02/gate-browser.log
.planning/synara-whiteboard/evidence/ticket-02/gate-failure.md  # FAIL only
```

## Explicitly deferred from Gate

- interrupted/failed-partial outcomes;
- complete asset pool and image matrix;
- full human grouping taxonomy;
- Redo branch matrix;
- 20-event implementation and reset matrix;
- broad restore-failure matrix;
- production UI hiding.

## Input contracts

- Decision 0051 D1, D2, D4, D7, and D8.
- Ticket 01 semantic projection and representative fixture.
- Exact package pin 0.18.1.
- Public API only: scene/app/file reads, `updateScene`, `addFiles`, `history.clear()`, and official restore/export utilities when needed.

## Produced contracts

- `SynaraHistoryCommands` is the only toolbar and keyboard history route.
- Minimum coordinator exposes immutable events, cursor, one AI begin/progress/complete lifecycle, verified Undo/Redo, and structured diagnostics.
- Adapter exposes snapshot/restore/history-clear without exposing package History, ActionManager, or API objects to the coordinator.
- `gate-containment.md` has one exact `PASS` or `FAIL` verdict.

## Implementation requirements

- Wrapper keyboard handling uses capture phase and consumes matched shortcuts before package handling.
- Cover macOS `Meta+Z`/`Meta+Shift+Z` and control-key Undo/Redo mappings represented by browser/platform evidence.
- Canvas focus and active text-edit focus are tested.
- Synara toolbar and keyboard use the same dispatcher instance.
- After the minimum observed human document mutation used by the containment probe, public `history.clear()` occurs before settled event exposure or a user-visible command can run.
- Runtime code contains no native-control locator or package DOM selector. Test-only accessible observation is allowed.
- Three AI updates have distinct semantic progress states and use `captureUpdate: "NEVER"`.
- Pre/final/Undo/Redo compare through semantic projection, not byte/object equality.
- Cursor and semantic fingerprints are logged before/after every command.
- Attempt pointer, focus/keyboard, programmatic browser, rapid repeated, and accessibility activation of native controls.
- Prove human mutation capture still works after native history clearing.
- During an active human transaction, a command settles one event before execution or is consumed without scene mutation; it never reaches native history.
- Adapter API and mount identity remain stable; no remount.

## Gate verification

```bash
bun run --cwd apps/web test -- \
  src/components/whiteboard/ticket02/SynaraHistoryGate.test.ts

bun run --cwd apps/web test:browser:stable -- \
  src/components/whiteboard/ticket02/SynaraHistoryGate.acceptance.browser.tsx \
  2>&1 | tee .planning/synara-whiteboard/evidence/ticket-02/gate-browser.log
```

Required assertions:

- package reports 0.18.1;
- one toolbar input produces one dispatcher invocation and at most one cursor move;
- one platform shortcut uses the same dispatcher/cursor;
- native pointer/focus/keyboard/accessibility attempts are inert;
- no transient native enabled window around human mutation and clear;
- package-native keyboard cannot mutate the scene;
- progressive checkpoints are unreachable;
- human capture remains reliable after clear;
- Undo/Redo semantically match pre/final states;
- no remount/API identity change.

Required negative diagnostics:

- adapter not ready;
- snapshot capture failure;
- semantic verification mismatch;
- duplicate dispatch;
- native control active/invokable;
- native keyboard mutation;
- human capture broken by clear.

Diagnostics identify AC, phase, package/browser/platform, scenario, session/event/batch identity where present, expected, observed, and recoverability.

## Gate evidence

`gate-containment.md` records:

- exact candidate commit;
- package, Chromium, OS, and architecture;
- command/build mode;
- public APIs used;
- runtime audit showing no prohibited technique;
- activation-attempt matrix;
- command/cursor and fingerprint traces;
- human-capture-after-clear result;
- raw-log link;
- exact verdict.

## CHECKPOINT-GATE

Broad work is authorized only when the same candidate proves both containment and the completed batch.

PASS ending:

```text
GATE VERDICT: PASS
AC4 containment: PASS
Completed three-progress batch: PASS
Broad Ticket 02 work: AUTHORIZED
```

FAIL triggers include any transient/invokable native route, double handling, intermediate state reachability, unreliable human capture, private/undocumented/DOM/CSS dependence, text-focus containment failure, or non-Chromium-only assertion.

FAIL evidence must end:

```text
GATE VERDICT: FAIL
AC4: FAIL
AC7: FAIL
Broad Ticket 02 work: BLOCKED
Required next action: Supervisor bounded reassessment of Decision 0051 boundary
```

No worker may workaround failure with private APIs, undocumented keys, DOM/CSS suppression, remount, fork, or package change.

# Conditional packages after Gate PASS

## WP-CORE — Coordinator, partial outcomes, branching, rollback

Dependency: Gate PASS on exact ancestor candidate.

Write set:

```text
apps/web/src/components/whiteboard/ticket02/SynaraHistoryTypes.ts
apps/web/src/components/whiteboard/ticket02/SynaraDocumentSnapshot.ts
apps/web/src/components/whiteboard/ticket02/SynaraSessionHistory.ts
apps/web/src/components/whiteboard/ticket02/SynaraHistoryCommands.ts
apps/web/src/components/whiteboard/ticket02/SynaraSessionHistory.test.ts
apps/web/src/components/whiteboard/ticket02/SynaraHistoryFailure.test.ts
```

Owns completed/no-op, acknowledged interrupted, failed-partial, zero-valid failure, identity/sequence/generation/stale rejection, Redo invalidation, finalization/restore rollback, and faulted state.

Verification covers capture-before-mutate failure, sequence gap, stale update, invalid first operation, final mismatch, rollback success/failure, cursor boundaries, and Gate browser regression.

## WP-ASSET — Asset pool and image-bearing restore/export

Dependency: WP-CORE PASS.

Write set:

```text
apps/web/src/components/whiteboard/ticket02/SynaraAssetPool.ts
apps/web/src/components/whiteboard/ticket02/SynaraAssetPool.test.ts
apps/web/src/components/whiteboard/ticket02/SynaraDocumentSnapshot.ts
apps/web/src/components/whiteboard/ticket02/SynaraSessionHistory.ts
apps/web/src/components/whiteboard/ticket02/ExcalidrawTicket02Harness.tsx
apps/web/src/components/whiteboard/ticket02/SynaraHistoryAssets.acceptance.browser.tsx
```

The Ticket 01 adapter may change only if an additional public files/restore/export seam is required.

Owns collision-resistant binary dedupe, restorable file-ID aliases, active/current/history/transaction/rollback references, preflight, add-before-restore, missing/corrupt failure, meaningful SVG/PNG proof, and normal/image snapshot measurements without invented budget.

## WP-HUMAN — Human grouping and mixed-route containment

Dependency: WP-ASSET PASS.

Write set:

```text
apps/web/src/components/whiteboard/ticket02/SynaraHumanTransaction.ts
apps/web/src/components/whiteboard/ticket02/SynaraHumanTransaction.test.ts
apps/web/src/components/whiteboard/ticket02/SynaraSessionHistory.ts
apps/web/src/components/whiteboard/ticket02/SynaraHistoryCommands.ts
apps/web/src/components/whiteboard/ticket02/ExcalidrawTicket02Harness.tsx
apps/web/src/components/whiteboard/ticket02/SynaraHistoryHuman.acceptance.browser.tsx
apps/web/src/components/whiteboard/ticket01/SynaraExcalidrawAdapter.tsx
```

Owns pointer, Delete, and text-edit transaction boundaries; exclusion of presentation/no-op input; deterministic settle-or-consume commands; human Redo invalidation; and full native-containment regression around settlement.

## WP-MATRIX — Bound, reset, integrated outcomes, failures, measurements

Dependency: WP-HUMAN PASS.

Write set includes Ticket 02 coordinator/harness/tests and `.planning/synara-whiteboard/evidence/ticket-02/**`.

Owns:

- completed/interrupted/failed/zero-valid matrix;
- image Redo/export;
- unified toolbar/keyboard and native inertness;
- semantic/no-op branch behavior;
- mixed 21 events with exactly newest 20;
- duplicate/fresh-session reset;
- restore/finalization/missing-asset/fault diagnostics;
- snapshot/restore measurements and incompatibility report.

Focused verification:

```bash
bun run --cwd apps/web test -- src/components/whiteboard/ticket02
bun run --cwd apps/web test:browser:stable -- src/components/whiteboard/ticket02
```

## WP-FINAL — Exact candidate and repository gates

Dependency: WP-MATRIX PASS.

Run from a clean isolated worktree:

```bash
bun run --cwd apps/web test -- \
  src/components/whiteboard/ticket01 \
  src/components/whiteboard/ticket02

bun run --cwd apps/web test:browser:stable -- \
  src/components/whiteboard/ticket01/SynaraExcalidrawAdapter.acceptance.browser.tsx \
  src/components/whiteboard/ticket02

bun run fmt
bun run lint
bun run typecheck
```

The owner has authorized the final bundled `fmt/lint/typecheck` pass in this conversation. Do not run the heavyweight set repeatedly during iteration.

Record exact candidate, Decision 0051 commit, package/lock unchanged, browser/runtime/OS, changed paths, protected Agentation exclusion, Gate ancestry, focused exits, final-gate exits, and limitations.

## WP-REVIEW and final acceptance

After exact-candidate evidence passes:

1. one independent reviewer audits Decision 0051 compliance, public-only containment, AC1–AC7, rollback/assets/human/bound/reset semantics, diagnostics, scope, and final gates;
2. reviewer PASS is evidence, not approval;
3. invoke exactly one Supervisor final-acceptance consultation;
4. only an accepted binding decision may mark Ticket 02 done and advance Project routing.

## Parallel safety

Implementation is intentionally serialized. Every conditional package mutates or consumes the same coordinator/cursor/harness seam. No later WP is parallel-safe with the Gate or its predecessor.

## Challenge and rollback triggers

Immediately challenge/stop if evidence requires or shows:

- active/transient native Undo/Redo;
- package-native keyboard scene mutation;
- text-edit history not publicly containable;
- `history.clear()` breaking human capture/grouping;
- private ActionManager/History, private import, stack inspection, undocumented key, DOM/CSS suppression, remount, fork, package/lock change;
- public files/restore inability to recover active image references;
- an evidenced operational constraint invalidating snapshot-first architecture;
- contradiction of Decision 0051 D1–D8.

Before Gate PASS, rollback is limited to the bounded adapter extension, Ticket 02 Gate files, and evidence. After Gate PASS, retain the last passing SHA; any later Gate regression removes authorization for broad work until reassessment.

Do not weaken diagnostics, semantic comparison, activation tests, or real-browser proof to regain green status.
