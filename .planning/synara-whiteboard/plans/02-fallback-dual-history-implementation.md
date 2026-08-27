# Ticket 02 implementation plan — fallback dual human/AI history

**Status:** Remediated planning artifact only — recommendation is to authorize **WP-GATE only** in Decision 0056; every later work package is directional and non-authorized pending post-Gate/governance reassessment
**Date:** 2026-08-27
**Binding authority:** [Decision 0055](../decisions/0055-ticket-02-fallback-dual-history-contract-approved.md)
**Accepted design:** [Ticket 02 fallback dual-history contract](../designs/ticket-02-fallback-dual-history-contract.md)
**Frontier:** [Ticket 02](../issues/02-prove-ai-batch-undo-redo.md)
**Testing governance:** [Decision 0047](../decisions/0047-testing-strategy-governance-reassessment.md)
**Accepted feasibility boundary:** [Decision 0048](../decisions/0048-ticket-01-excalidraw-feasibility-boundary.md) and [Decision 0050](../decisions/0050-ticket-01-final-acceptance-hold-removed.md)
**Challenge input:** [Ticket 02 fallback contract challenge review](../reviews/ticket-02-fallback-contract-challenge.md)
**Independent remediation input:** `/tmp/synara-ticket02-plan-review-result.md`

> This file authorizes nothing. Decision 0055 permits planning only. The safest next decision, Decision 0056, may authorize only the bounded WP-GATE described here. It must not authorize the deferred packages, integrated production work, final acceptance, or final workspace checks.

## 1. Goal, bounded claim, and success model

The target product contract remains:

- Excalidraw exclusively owns human Undo/Redo through its native toolbar and package-supported platform shortcuts.
- Synara exclusively owns visibly labeled `Undo AI batch` and `Redo AI batch` actions over an AI-only session history.
- A committed semantically mutated AI boundary, including successful AI Undo/Redo, clears all native history through public `api.history.clear()` before exposure or unlock.
- The first settled semantic human mutation after AI activity, including native human Undo/Redo, clears all AI Undo/Redo and releases unreferenced AI snapshot assets.
- Completed, acknowledged Take Over partial, and failed-partial mutated AI outcomes each become exactly one AI event; progressive writes and contract-defined no-ops become none.
- AI restores are exact for canonical semantic content and active files, preserve command-start viewport/zoom, use public `addFiles` plus `captureUpdate: "NEVER"`, and move the cursor only after verification.
- AI history retains at most 20 finalized AI events per open canvas session; no native or combined cap is claimed.
- Canvas, mount/API, session, route, revision, operation generation, operation-local producer sequence, and adapter-global synthetic sequence fence stale, duplicate, delayed, or unknown-provenance callbacks.
- Both routes reset at the lifecycle boundaries named by Decision 0055; history remains session-only.

WP-GATE is only a bounded feasibility proof. It uses a deterministic fake operation producer with the real pinned Excalidraw embed in stable Chromium. It may establish the isolated adapter/coordinator semantics listed in §6, but it cannot satisfy final AC2, AC7, AC8, or AC10 claims that depend on production WebSocket operation delivery or production lifecycle triggers.

Ticket 02 is successful only after a separately authorized integrated implementation boundary supplies the Decision 0047 production WebSocket/browser path and production lifecycle wiring; AC1–AC10 are evidenced on one committed exact source candidate; focused, browser, and authorized final workspace gates pass; one independent feature-level review passes; and a later exactly-once Supervisor consultation accepts the candidate. This plan and WP-GATE cannot make those claims.

## 2. Authorization phases and non-goals

### 2.1 Recommended Decision 0056 authorization

Decision 0056 should authorize **WP-GATE only**:

- the exact Gate source/test paths in §6.3;
- the exact Gate evidence paths in §6.8;
- one source-candidate commit before measurement and one evidence-only commit after measurement;
- focused unit tests and two stable-Chromium runs under the exact-candidate protocol in §6.8.

Decision 0056 should explicitly leave all later WPs in §§7–11 non-authorized and require a post-Gate governance reassessment before any of them start.

### 2.2 Prohibited under WP-GATE

WP-GATE must not:

- wire production WebSocket, server orchestration, navigation, RightDock, Whiteboard header/status rail, launcher, tabs, persistence, lifecycle stores, or production Focus-mode composition;
- implement production Take Over triggers, invalid/dependent operation transport, application restart, duplicate/import, eviction, conflict replacement, or recovery hydration;
- claim final AC2, AC7, AC8, AC10, Ticket 02 acceptance, or Decision 0047 integrated-path completion;
- implement WP-CORE, Ticket 03+, durable Version history, File-canvas Auto-save/conflicts, composer chips, thumbnails, or production two-canvas retention;
- add/change a package, upgrade Excalidraw, edit a manifest/lockfile/config, or modify the pinned `@excalidraw/excalidraw@0.18.1` resolution;
- use private APIs/imports, ActionManager/History internals, native-stack inspection, undocumented action keys, DOM/CSS suppression, monkey-patching, package mutation, remount restore, or a fork;
- hide, relabel, duplicate, intercept, or replace native Excalidraw controls, or capture/reinterpret/advertise an AI keyboard chord;
- create a generic history dispatcher, combined event array, mixed cursor/panel, or Synara-owned human event history;
- claim native capacity/grouping, a native 20-event cap, or native exact-image recovery before the later native-image gate passes;
- add first-use education. The accepted dismissible first-use explanation is deferred to a separately authorized production UI boundary; no Gate-only placeholder or harness copy may be presented as product proof;
- run `bun fmt`, `bun lint`, or `bun typecheck`. Those commands require an explicit later full-implementation authorization as described in §11.

A need to cross any prohibition is a `BLOCKER`, not implementation-time discretion.

## 3. Write boundaries

### 3.1 Current planning remediation

The only allowed write for this planning task is:

```text
.planning/synara-whiteboard/plans/02-fallback-dual-history-implementation.md
```

Everything else is prohibited, including source, tests, evidence, `PROJECT.md`, Ticket 02, reviews, decisions, designs, Product Contract/spec, package manifests, and lockfiles.

### 3.2 WP-GATE write set recommended for Decision 0056

Deletion/rename of the superseded Ticket 02 prototype files is included. No asset pool, broad failure suite, lifecycle suite, native-image suite, production path, or future scaffold is permitted.

```text
apps/web/src/components/whiteboard/ticket01/SynaraExcalidrawAdapter.tsx
apps/web/src/components/whiteboard/ticket02/ExcalidrawTicket02Harness.tsx
apps/web/src/components/whiteboard/ticket02/SynaraDocumentSnapshot.ts
apps/web/src/components/whiteboard/ticket02/SynaraHistoryTypes.ts                    # delete
apps/web/src/components/whiteboard/ticket02/SynaraHistoryCommands.ts                 # delete
apps/web/src/components/whiteboard/ticket02/SynaraSessionHistory.ts                   # delete
apps/web/src/components/whiteboard/ticket02/SynaraHistoryGate.test.ts                 # replace
apps/web/src/components/whiteboard/ticket02/SynaraHistoryGate.acceptance.browser.tsx  # replace
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryTypes.ts
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryCoordinator.ts
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryActions.tsx
apps/web/src/components/whiteboard/ticket02/SynaraHumanMutationSettlement.ts
.planning/synara-whiteboard/evidence/ticket-02/fallback-gate.md
.planning/synara-whiteboard/evidence/ticket-02/fallback-gate.unit.log
.planning/synara-whiteboard/evidence/ticket-02/fallback-gate.run-a.browser.log
.planning/synara-whiteboard/evidence/ticket-02/fallback-gate.run-b.browser.log
```

### 3.3 Protected/prohibited writes

```text
apps/web/package.json
apps/web/src/main.tsx
bun.lock
**/package.json
apps/web/vitest.browser*.config.ts
apps/server/**
packages/contracts/**
packages/shared/**
.planning/synara-whiteboard/PROJECT.md
.planning/synara-whiteboard/issues/**
.planning/synara-whiteboard/decisions/**
.planning/synara-whiteboard/designs/**
.planning/synara-whiteboard/reviews/**
.planning/synara-whiteboard/PRODUCT-CONTRACT.md
.planning/synara-whiteboard/spec.md
.planning/synara-whiteboard/evidence/ticket-01/**
production RightDock/navigation/store/header/launcher paths
all Ticket 03+ source, tests, plans, and evidence
```

The inherited Ticket 01 adapter may retain its previously accepted asset-readiness DOM observation. The Gate audit must identify it as inherited Ticket 01 behavior, not a new native-history-control dependency. No new runtime DOM/CSS query or selector may discover, suppress, invoke, or infer native Undo/Redo controls.

## 4. Required replacement contracts

The existing prototype encodes the superseded combined route and must be replaced, not wrapped.

| Current behavior | Required replacement |
| --- | --- |
| Mixed `human` and `ai-batch` events | AI-only coordinator; humans are settlement/invalidation inputs, never events. |
| Generic `undo`/`redo` dispatcher | Explicit `undoAiBatch()` and `redoAiBatch()`; no native dispatch. |
| Wrapper `Cmd/Ctrl+Z` capture | Delete entirely; native shortcuts pass untouched. |
| `Synara Undo` / `Synara Redo` | `AI history`, `Undo AI batch`, `Redo AI batch`. |
| Per-callback native clear/containment | One explicit public clear invoked only at committed AI boundaries. |
| Fingerprint suppression/provenance | Adapter-owned opaque synthetic write scopes; fingerprints verify content only. |
| Shallow/raw snapshots | Deep-owned canonical semantic snapshots and explicit active-file references. |
| One global sequence with restore bypass | Operation-local producer sequence plus adapter-global synthetic write sequence covering every synthetic write. |
| Event epoch equality as applicability | Immutable event provenance separated from current command applicability. |

### 4.1 Deep canonical snapshot ownership

`SynaraDocumentSnapshot` must:

- deep-clone and deep-freeze all owned canonical elements, approved semantic document fields, and active file-reference metadata at capture time;
- exclude viewport, zoom, selection, active tool, dialogs, theme, transient status, and complete package `AppState` from historical restore state;
- normalize ordering and package defaults through one named canonical semantic projection used by capture, verification, no-op comparison, and evidence;
- retain no mutable package object, array, map, binary view, or caller-owned reference;
- compute fingerprints only from the canonical semantic projection; a fingerprint is never provenance, identity, callback correlation, or command-applicability authority.

WP-GATE is image-free, so it stores active file IDs/metadata only as an empty closed set. Deduplicated binary ownership belongs to the deferred asset WP.

### 4.2 Adapter-owned opaque synthetic write-scope API

The adapter, not the coordinator or Excalidraw callback payload, owns synthetic provenance. The public host abstraction must have equivalent semantics to:

```text
openSyntheticWriteScope(context) -> OpaqueSyntheticWriteScope
scope.issue({ operationLocalSequence, expectedBeforeRevision, targetProjection, apply })
  -> { adapterGlobalSyntheticSequence, acknowledgement }
scope.drain() -> acknowledgement that every issued write reached a correlated callback or failed
scope.close() -> succeeds only after drain; retains bounded correlation tombstones for delayed callbacks
scope.abort(reason) -> fail-closed; invalidates unissued work and reports unresolved callbacks
```

Required semantics:

1. Only one mutation-capable synthetic scope is open at a time, under the supported edit/history lock.
2. `operationLocalSequence` starts at 1 for each operation/generation and is strictly contiguous. Duplicate, skipped, or out-of-order producer input is rejected before a scene write.
3. `adapterGlobalSyntheticSequence` is monotonic for the lifetime of the adapter mount and increments for **every** synthetic scene/app-state write: progress, finalize normalization, AI Undo, AI Redo, and rollback. Restore cannot bypass it.
4. Before invoking the public Excalidraw write, the adapter registers an internal pending record containing the opaque scope identity, both sequences, expected callback window, identities/epochs/revisions, and expected target projection. The coordinator receives only the opaque scope/receipt and stable diagnostic correlation ID, never a forgeable token.
5. The adapter associates callbacks from its monotonic callback stream to registered pending records while the synthetic lock is held. Association is based on adapter-owned invocation order, callback sequence window, scope state, and complete identity/revision context—not fingerprint equality.
6. The acknowledgement resolves only when the correlated callback has arrived and the canonical target verifies. `drain()` waits for every issued acknowledgement plus the bounded callback-drain window defined by the Gate; completion/finalization/clear/unlock cannot precede it.
7. `close()` is legal only after successful drain. Closed-scope correlation tombstones remain until the Gate's delayed-callback horizon has passed, so a delayed duplicate can be diagnosed and rejected without being reclassified as human.
8. A callback that cannot be uniquely correlated, an extra callback inside a synthetic scope, an unresolved issued write at timeout, or a callback after tombstone expiry is `unknown-callback-provenance`: fail closed, preserve current content, keep editing/history locked, and do not infer origin from fingerprints.
9. A callback correlated to a stale operation generation, route/session epoch, mount/API identity, or expected revision is rejected diagnostically without moving cursor/events/assets.
10. Scope acknowledgement proves adapter/coordinator correlation only. It is not production operation acknowledgement and cannot prove Decision 0047's WebSocket or Take Over containment path.

### 4.3 Sequence, epoch, revision, and applicability model

Keep these concepts distinct:

- **Producer sequence:** operation-local, starts at 1 for each operation generation, validates ordered fake/production progress input.
- **Adapter synthetic sequence:** adapter-global and mount-local, increments for every synthetic write regardless of operation or restore/rollback purpose.
- **Adapter callback sequence:** adapter-global and mount-local, increments for every public scene callback, human or synthetic.
- **Event provenance:** immutable creation fields (`canvasIdentity`, `mountIdentity`, `sessionEpoch`, creation route epoch, operation/generation, before/after revisions, outcome).
- **Current applicability:** evaluated at command time from current canvas/mount/session identity, current route lineage, cursor position, current canonical projection/revision, and the selected event's expected before/after side.

`routeEpoch` advances at committed human/AI route boundaries; `mutationRevision` advances for each verified semantic write. An existing event's creation epoch/revisions are not rewritten and need not equal the current route epoch after AI Undo. Redo is valid only when the cursor selects that event, current identities/session/lineage are valid, no human invalidation occurred, and current canonical state/revision is the event's verified `before` side produced by the preceding Undo. Undo uses the analogous `after` side. A new mutated AI batch after Undo deletes only the AI Redo branch before append. Lifecycle reset starts a new session epoch and invalidates all events/scopes/tombstones.

## 5. Human settlement protocol

`SynaraHumanMutationSettlement` consumes only public host observations and canonical snapshots. It does not intercept native behavior or depend on control selectors.

### 5.1 Public inputs

- adapter callback sequence plus canonical before/after projection and current mount/API/session identity;
- Excalidraw public pointer down/up observations and pointer-cancel/lost-capture observation available at the host boundary;
- non-cancelling host capture observations for `keydown`/`keyup`, composition start/update/end, and focus transitions; these observations never call `preventDefault`, `stopPropagation`, or dispatch history;
- public app-state observations sufficient to identify text-edit active/inactive and presentation-only changes;
- adapter synthetic-scope state, acknowledgements, and tombstones so correlated synthetic callbacks are excluded before human settlement.

### 5.2 Settlement families

1. **Pointer gesture:** opens on public pointer-down; coalesces all semantic callbacks through pointer-up/cancel/lost-capture; settles after pointer termination and the common drain window.
2. **Discrete keyboard mutation:** opens on observed Delete/Backspace or package-supported native Undo/Redo keydown; coalesces through keyup and the common drain window. The observer records a candidate family only and never captures the chord.
3. **Text-edit/composition:** opens when public text-edit/composition becomes active; coalesces all callbacks through composition end and edit commit/blur; settles only after text-edit inactive and the common drain window. Cancelled composition whose final canonical projection equals its start is a no-op.
4. **Native toolbar or other package command:** because runtime source cannot locate native controls, the first uncorrelated semantic callback outside pointer/text/synthetic scope opens a generic native-command candidate; callbacks coalesce through the common drain window. Browser tests may use accessible native controls to generate the input, but runtime classification remains selector-free.
5. **Presentation/no-op candidate:** selection, pan, zoom, tool, focus, menu/dialog, or a gesture/command whose final canonical projection equals its start is a proven no-op and does not invalidate AI history.

### 5.3 Coalescing, drain, and stop criteria

The common drain window is: current JavaScript task completes, queued microtasks drain, two `requestAnimationFrame` turns complete, and no new adapter callback appears in the second frame. Any callback restarts the two-frame count, bounded by a test-configured maximum of 500 ms in the Gate harness. The production value is not selected by this feasibility plan.

A family settles exactly once. Compare the deep canonical start/end projections:

- changed projection => one settled semantic human mutation; clear all AI history once;
- equal projection => proven no-op; preserve AI history;
- overlapping families, missing termination, callbacks beyond 500 ms, inability to establish a start snapshot, or an uncorrelatable callback => `human-settlement-uncertain`; conservatively invalidate AI history, report the family/input trace, and mark that family **unproven**.

Gate PASS requires reliable changed/no-op settlement for pointer, Delete, text edit, native toolbar Undo/Redo, cancelled pointer, selection, pan, zoom, tool, and focus scenarios without an uncertainty diagnostic. If any required family cannot meet that stop criterion twice in stable Chromium, WP-GATE fails; conservative invalidation protects state but does not convert uncertainty into acceptance evidence.

## 6. WP-GATE — only recommended authorized package

### 6.1 Objective and bounded outcome

Using a deterministic fake producer plus the real pinned Excalidraw embed in stable Chromium, prove:

1. native toolbar/shortcuts own human Undo/Redo when unlocked and never dispatch AI snapshots;
2. supported AI streaming/restoring lock blocks pointer, keyboard, native toolbar, and accessibility-triggered document mutation while retaining proven pan/zoom;
3. three operation-local progress updates use three adapter-global synthetic writes, drain/acknowledge, and finalize as one completed AI event;
4. explicit AI Undo/Redo restore exact canonical pre/final states and move the AI cursor once after verification;
5. the initial committed AI batch clears browser-observed pre-existing native history before exposure/unlock;
6. successful AI Undo/Redo invoke the ordered native-clear lifecycle at the required point, proved by a test-only adapter operation trace, without claiming a behaviorally non-empty native stack at those impossible mixed states;
7. public human settlement clears AI history exactly once for changed families and preserves it for proven no-ops;
8. delayed/duplicate callbacks are correlated/rejected through the opaque scope contract; uncorrelatable provenance fails closed without fingerprint inference;
9. adapter mount/API identity remains stable in non-lifecycle scenarios.

The Gate may claim only bounded feasibility evidence for isolated coordinator/adapter semantics. Fake completion is not production operation completion; simulated operation signals are not production WebSocket, Take Over acknowledgement, invalid/dependent-operation, or lifecycle-trigger proof.

### 6.2 Read set

- Decision 0055, accepted fallback design, Ticket 02 AC1–AC10, Decisions 0047/0048/0050.
- `SynaraExcalidrawAdapter.tsx` and all current `ticket02/*` files.
- Ticket 01 fixture, canonical comparator, export, viewport, browser-test utilities, and inherited asset-readiness behavior.
- Historical Ticket 02 Gate evidence only to understand the failed containment assumption; never edit or reuse its verdict.

### 6.3 Allowed writes

Only the WP-GATE paths in §3.2. No unused future file may be scaffolded.

### 6.4 Implementation contract

- Delete wrapper keyboard capture, generic dispatcher, mixed human events, and fingerprint suppression before adding fallback assertions.
- Implement §§4–5 exactly: deep snapshot ownership; opaque adapter write scopes; all three sequences; provenance/current-applicability distinction; public settlement families.
- Begin fake AI work by deep-capturing pre-state before progress. Ordered progress uses `captureUpdate: "NEVER"`, creates no event, and cannot finalize before all scope acknowledgements drain.
- Keep both history routes unavailable during synthetic scope, restore, clear, and rollback. Native package controls remain present/package-owned.
- Finalize the completed batch only after canonical verification, scope drain/close, public native clear, bounded post-clear drain, and no reappearance. Then advance current lineage/revision, expose one AI event, unlock, and announce.
- AI Undo/Redo preflight the Gate's empty active-file closure, capture command-start viewport/zoom, restore with a new scope, verify, invoke native clear, complete the bounded post-clear drain, move cursor once, and only then expose/unlock.
- Unknown provenance, extra callback, unresolved acknowledgement, semantic mismatch, clear failure, or native-state reappearance keeps editing/history locked and records a diagnostic; no rollback implementation beyond the smallest Gate-safe command-start restoration is authorized.
- Runtime source has no native control locator. Browser tests may observe controls by stable accessibility role/name or use direct user shortcuts.

### 6.5 Native-clear proof split

A single browser state cannot contain both actionable AI Undo/Redo and newly recreated native history: a human mutation that recreates native history also clears AI history. Therefore the Gate uses two complementary proofs:

**Browser-observed initial commit proof**

1. create native human Undo/Redo availability;
2. start and finalize the AI batch;
3. assert the native control/shortcut cannot restore the pre-AI human state after clear;
4. observe through the post-clear drain window: current task, microtasks, two animation frames, with the second frame callback-free;
5. any restoration, re-enabled command that restores old content, or old-content reappearance records `native-history-reappeared-after-clear`, keeps the Gate locked, and fails.

**Test-only ordered clear invocation trace for AI Undo/Redo**

The adapter exposes no native stack, but a test-only injected trace sink may record these lifecycle steps without changing behavior:

```text
restore-write-issued
restore-callback-acknowledged
restore-target-verified
native-history-clear-invoked
native-history-clear-returned
post-clear-drain-complete
cursor-moved
result-exposed
lock-released
```

Unit and real-browser tests assert exactly one ordered trace for AI Undo and AI Redo. The trace proves invocation order, not a non-empty native stack. No test may recreate native history between AI Undo and Redo and still claim the AI event remains actionable.

### 6.6 Gate fixture and scenarios

Use one image-free deterministic fixture with text, ordinary shape, deletable shape, stable semantic IDs/custom data, observable viewport/zoom/selection, and fake operation ID/generation with operation-local sequences 1–3. The adapter trace records adapter-global synthetic and callback sequences, scope acknowledgement/drain/close, identities/revisions/epochs, and clear lifecycle.

Run in order:

1. native pointer/Delete/text/native toolbar/native shortcuts; AI event count remains zero;
2. AI lock attempts pointer, Delete, toolbar, shortcuts, accessible activation; only accepted synthetic progress changes content; pan/zoom remains usable;
3. three progress writes, event count zero until drained completion, then exactly one event;
4. AI Undo by pointer and Redo by Enter/Space; exact canonical states, viewport/zoom, filtered selection, focus, cursor, and trace order;
5. split native-clear proof from §6.5;
6. settlement families: changed pointer, Delete, text, native Undo, native Redo; no-op selection, pan, zoom, tool, focus, cancelled pointer/composition;
7. duplicate, delayed closed-scope, old operation generation, wrong route/session epoch, wrong mount/revision, extra callback, and unknown provenance;
8. stable mount/API identity throughout non-reset scenarios.

### 6.7 Diagnostics ownership and schema

The adapter owns low-level public-boundary diagnostics: readiness, scope lifecycle, sequences/callback correlation, identity/revision mismatch, public write/clear/lock/export failure, and inherited Ticket 01 asset-readiness diagnostics. The coordinator owns domain diagnostics: operation applicability, event/cursor transitions, human settlement, rollback/fault state, AI availability, and lifecycle resets. Neither layer emits the other's conclusion.

The harness accepts both through one append-only reporter and serializes schema `synara.whiteboard.history-diagnostic/v1`:

```text
schema
owner                  # adapter | coordinator
code
severity               # info | warning | error | critical
recoverability         # retryable | reset-required | locked | none
acApplicability         # bounded Gate evidence or AC identifiers; never an acceptance verdict
phase
scenario
message
summary
packageVersion
browser
platform
canvasIdentity
mountIdentity
apiIdentity
sessionEpoch
routeEpoch
mutationRevision
operationId?
operationGeneration?
operationLocalSequence?
adapterSyntheticSequence?
adapterCallbackSequence?
scopeCorrelationId?    # stable opaque diagnostic ID, not a forgeable token
batchId?
eventId?
expected
observed
lockState
rollbackResult?
timestamp
```

Required Gate codes include `adapter-not-ready`, `synthetic-sequence-mismatch`, `synthetic-scope-unresolved`, `duplicate-synthetic-callback`, `unknown-callback-provenance`, `stale-operation-generation`, `stale-route-epoch`, `stale-session-epoch`, `stale-mount-identity`, `stale-mutation-revision`, `semantic-verification-mismatch`, `native-history-clear-failed`, `native-history-reappeared-after-clear`, `edit-lock-failed`, `native-mutation-during-ai-lock`, `identity-changed-unexpectedly`, and `human-settlement-uncertain`.

Diagnostics contain no binary body, raw package object/state, private stack data, or opaque token value. Tests validate exact required fields, stable serialization, ownership, copyable summary, and no false success/cursor movement/unlock.

### 6.8 Exact-candidate measurement and evidence protocol

#### A. Freeze source candidate before measurement

1. Start from the authorized isolated worktree.
2. Implement only Gate source/tests.
3. Review `git diff --check`, changed-path inventory, and protected-path absence.
4. Commit source/tests **before** running the evidence commands:

```text
feat(whiteboard): prove fallback dual-history gate
```

5. Record `SOURCE_CANDIDATE=$(git rev-parse HEAD)` and require `git status --short` to be empty. Any source/test/formatting change after this point creates a new candidate and requires all Gate runs again.

#### B. Run with pipefail, explicit exit capture, and distinct logs

Use Bash, not an unspecified shell pipeline. Do not overwrite or append one run into another.

```bash
set -o pipefail
bun run --cwd apps/web test -- \
  src/components/whiteboard/ticket02/SynaraHistoryGate.test.ts \
  2>&1 | tee .planning/synara-whiteboard/evidence/ticket-02/fallback-gate.unit.log
unit_status=${PIPESTATUS[0]}
printf 'UNIT_EXIT=%s\n' "$unit_status"
test "$unit_status" -eq 0

set -o pipefail
VITEST_BROWSER_API_PORT=<run-a-free-port> bun run --cwd apps/web test:browser:stable -- \
  src/components/whiteboard/ticket02/SynaraHistoryGate.acceptance.browser.tsx \
  2>&1 | tee .planning/synara-whiteboard/evidence/ticket-02/fallback-gate.run-a.browser.log
run_a_status=${PIPESTATUS[0]}
printf 'RUN_A_EXIT=%s\n' "$run_a_status"
test "$run_a_status" -eq 0

set -o pipefail
VITEST_BROWSER_API_PORT=<different-run-b-free-port> bun run --cwd apps/web test:browser:stable -- \
  src/components/whiteboard/ticket02/SynaraHistoryGate.acceptance.browser.tsx \
  2>&1 | tee .planning/synara-whiteboard/evidence/ticket-02/fallback-gate.run-b.browser.log
run_b_status=${PIPESTATUS[0]}
printf 'RUN_B_EXIT=%s\n' "$run_b_status"
test "$run_b_status" -eq 0
```

The executor must also record the three exit values in `fallback-gate.md`; a successful `tee` cannot substitute for the test process exit. Run A and B use the same `SOURCE_CANDIDATE`, clean source tree, distinct free ports, and separate immutable log files.

#### C. Evidence-only commit

`fallback-gate.md` records source SHA, package/pin/lock provenance, Chromium/OS/architecture, commands/exits, run-A/run-B log hashes, public APIs, inherited Ticket 01 asset-readiness DOM query, proof that no new runtime control selector exists, scenario matrix, scope/sequence traces, settlement traces, native-clear split proof, diagnostics, and bounded verdict.

After logs/document are complete, confirm the diff contains only the four authorized Gate evidence files, then commit:

```text
test(whiteboard): record fallback dual-history gate evidence
```

This evidence-only commit names the measured source SHA. Evidence changes never alter the measured candidate. If evidence reveals a source defect, do not patch in the evidence commit: create a new source candidate and rerun unit, run A, and run B.

### 6.9 Gate checkpoint and stop rules

A passing checkpoint may say only:

```text
FALLBACK WP-GATE: BOUNDED FEASIBILITY PASS
Measured source candidate: <sha>
Real pinned Chromium embed: PASS
Native human route ownership in isolated harness: PASS
AI lock in isolated harness: PASS
Completed fake-produced batch exactness: PASS
Opaque synthetic write-scope correlation: PASS
Initial AI commit browser-observed native clear: PASS
AI Undo/Redo ordered clear invocation trace: PASS
Public human settlement families: PASS
Adapter identity stability: PASS
Production WebSocket/real operation evidence: DEFERRED — NOT CLAIMED
Production lifecycle-trigger evidence: DEFERRED — NOT CLAIMED
Later work packages: NON-AUTHORIZED — GOVERNANCE REASSESSMENT REQUIRED
```

Any failed row, uncertainty in a required settlement family, unknown callback provenance, native-history reappearance, inability to lock native mutation, pipeline/log/candidate mismatch, prohibited technique, or protected-path change fails the Gate. Preserve reproducible evidence, stop, and return to the Supervisor/owner. Do not scaffold later WPs.

## 7. Deferred WP-OUTCOMES-ASSETS-FAILURE — directional only

**Authorization:** none. **Dependency:** bounded WP-GATE PASS plus a new governance/implementation decision.

A later decision must resolve Decision 0047 before this WP can own final AC2/AC8/AC10 evidence. The required boundary is a production WebSocket/browser path using the real operation contracts and deterministic fake model/provider. If server/contract changes are required, that later decision must name them; the current prohibited write set cannot be silently expanded.

Directional scope:

- production operation start/progress/generation, acknowledged Take Over, invalid/dependent stop, completion/failure, retry, stale/post-containment updates;
- explicit finalizers for completed, acknowledged interrupted, and failed-partial outcomes;
- deduplicated asset pool with deep-owned binaries referenced by current content, event snapshots, active batch, or rollback;
- public `addFiles`, `captureUpdate: "NEVER"`, canonical verification, meaningful AI image export;
- rollback success/failure and locked-fault diagnostics;
- real browser plus production WebSocket proof, with smallest lower seam only for deterministic corruption/throw injection.

This WP may not claim completion from a harness-only fake producer. Exact write set, commands, logs, source/evidence commit boundaries, and diagnostics must be replanned after the Gate and governance decision.

## 8. Deferred WP-CAP-LIFECYCLE — directional only

**Authorization:** none. **Dependency:** authorized integrated outcomes/assets boundary.

Directional coordinator semantics:

- append 21 finalized AI events and retain exactly 2–21; never count/trim/claim native history;
- reset native history plus AI events/assets/scopes on explicit lifecycle inputs;
- reject prior-session callbacks after reset;
- duplicate/import current content with empty histories; same-instance Main-conversation switch preserves history.

Harness-injected lifecycle commands prove only **coordinator reset semantics under simulated signals**. They cannot satisfy final AC7 for real remount/API change, eviction, reload/fresh hydration, application restart, close/session termination, duplication/import, conflict replacement, or recovery hydration. A later production boundary must prove those triggers are actually emitted and current durable content is restored without either history. Exact production owners and write paths require post-Gate authorization.

## 9. Deferred WP-ACCESSIBILITY — directional only

**Authorization:** none. **Dependency:** authorized integrated coordinator boundary.

Directional scope:

- named `role="toolbar"` / `AI history`; exact labels/reasons; `aria-disabled="true"`; Enter/Space and toolbar navigation; focus retention and polite announcements;
- no AI shortcut or native shortcut interception;
- 200% zoom, constrained width, screen-reader, modal/text-context, and Focus-mode semantics;
- first-use education belongs to the later production UI owner and must be a dismissible explanation after the first mutated AI batch without stealing focus. The Gate does not own or prove it.

Harness-only layout may support component semantics, but production header/overflow/Focus integration and first-use education require their own authorized production write set.

## 10. Deferred WP-NATIVE-IMAGE-GATE — directional only

**Authorization:** none. **Dependency:** post-Gate decision.

Use a deterministic non-transparent sentinel PNG, not the inherited 1×1 fixture: at least 3×2 pixels with distinct opaque RGBA colors, fixed bytes/hash, and known corner/center samples. Insert it through a real supported user path using browser file chooser; also exercise paste or drag-and-drop if the pinned package advertises that public user path. Never use `initialScene`, direct `addFiles`, `updateScene`, or private cache preloading as the native insertion proof.

Required real-Chromium sequence:

1. user inserts sentinel image;
2. assert image element/file-ID closure and exact sentinel binary hash/metadata;
3. export through official SVG/PNG utilities;
4. assert SVG contains the image reference/data and dimensions; decode exported PNG and assert canvas dimensions plus sentinel-colored/non-transparent pixels at deterministic rendered sample locations;
5. user deletes image, invokes native Undo, and repeats closure/export/pixel assertions;
6. native Redo removes the image and export no longer contains sentinel pixels/reference;
7. native Undo repeats recovery; no AI action or direct adapter insertion is used.

Run twice on one committed source candidate with separate run-A/run-B logs, `set -o pipefail`, explicit `PIPESTATUS[0]`, and an evidence-only commit. Failure leaves AC6 narrowed/unaccepted and returns to the owner; do not patch Excalidraw or substitute AI restore.

## 11. Deferred final integration, evidence, review, and workspace gates

**Authorization:** none. A later **full implementation boundary** must explicitly authorize this phase, the production integrated write set, and the final `AGENTS.md` workspace commands. Decision 0056 must not authorize it.

### 11.1 Required integrated boundary

Before final AC claims, compose the real web application, production WebSocket route, real operation contracts, actual Excalidraw embed, and deterministic fake model/provider as required by Decision 0047. Prove production operation triggers for completed/interrupted/failed-partial/no-op/invalid/dependent/stale cases and production lifecycle triggers for AC7. The isolated Gate remains supporting evidence only.

### 11.2 Exact-candidate final log capture

After all source/tests are committed, freeze `FINAL_SOURCE_CANDIDATE=$(git rev-parse HEAD)` with a clean tree. Capture focused tests, integrated browser tests, and authorized workspace commands into one append-only `final-verification.log` with explicit delimiters and exits. Equivalent required shell structure:

```bash
set -o pipefail
: > .planning/synara-whiteboard/evidence/ticket-02/final-verification.log

run_logged() {
  label="$1"
  shift
  printf '\n===== %s START =====\n' "$label" | tee -a .planning/synara-whiteboard/evidence/ticket-02/final-verification.log
  "$@" 2>&1 | tee -a .planning/synara-whiteboard/evidence/ticket-02/final-verification.log
  status=${PIPESTATUS[0]}
  printf '===== %s EXIT=%s END =====\n' "$label" "$status" | tee -a .planning/synara-whiteboard/evidence/ticket-02/final-verification.log
  return "$status"
}
```

The later plan must instantiate each exact command rather than hide it behind unrecorded shell state. Browser reruns use distinct run-A/run-B logs or clearly delimited append-only sections. Any source/test/formatter change invalidates the final candidate and requires affected Gate/integration reruns.

### 11.3 Final workspace checks

Only when the later full implementation decision explicitly authorizes the owner-requested bundled pass, run once from repository root after focused/integrated feature tests pass:

```bash
bun fmt
bun lint
bun typecheck
```

`bun fmt` is mutating. Inspect its diff immediately. Revert out-of-scope drift; any authorized source formatting change creates a new final source candidate and rerun obligation. If authorization is absent, report `INFORMATION_GAP` and do not claim completion.

### 11.4 Evidence-only commit, independent review, and acceptance

Final evidence is committed after measuring the frozen source candidate and contains no source change. It records candidate/ancestor commits, log hashes, complete AC matrix, production integration/lifecycle proof, native image verdict, diagnostics, protected-path audit, and all command exits. One independent reviewer reviews that exact candidate. Findings create a new source candidate and reruns. After one clean PASS, invoke exactly one Supervisor final-acceptance consultation.

## 12. Diagnostic extensions for deferred WPs

Deferred layers must extend, not replace, `synara.whiteboard.history-diagnostic/v1`. Adapter remains owner of public Excalidraw/write/export correlation failures; coordinator remains owner of event/operation/settlement/rollback state; production orchestration owns WebSocket request/acknowledgement/generation/containment transport diagnostics; lifecycle integration owns trigger/source identity and durable-content restoration diagnostics.

Later required codes include `take-over-dispatch-failed`, `take-over-ack-timeout`, `post-take-over-update`, `invalid-operation`, `dependent-operation-stopped`, `zero-valid-outcome`, `asset-preflight-failed`, `asset-missing`, `asset-invalid`, `asset-reference-mismatch`, `svg-export-verification-failed`, `png-export-verification-failed`, `restore-rollback-succeeded`, `restore-rollback-failed`, `ai-history-cleared-by-human`, `ai-redo-cleared-by-new-ai-batch`, `ai-event-evicted`, `lifecycle-history-reset`, `production-lifecycle-trigger-missing`, `prior-session-callback`, `unavailable-action`, `announcement-failed`, and `native-image-recovery-failed`.

No diagnostic may claim acceptance, report local unlock as containment acknowledgement, expose binary/private package state, or omit its owner and applicability.

## 13. AC traceability and authorization status

| AC | WP-GATE bounded evidence | Final owner/status |
| --- | --- | --- |
| AC1 | Native route ownership, explicit AI actions, no chord in isolated real embed | Gate partial; deferred accessibility/integrated UI final proof. |
| AC2 | Completed fake-produced batch only | **Not finalizable by Gate**; production WebSocket operation boundary required. |
| AC3 | Image-free exact canonical Undo/Redo and empty file closure | Deferred assets/integrated proof required. |
| AC4 | Initial browser-observed clear, ordered Undo/Redo clear trace, human settlement | Gate bounded proof; later regressions/integration required. |
| AC5 | None | Deferred cap WP. |
| AC6 | None | Deferred sentinel native-image Gate. |
| AC7 | None beyond possible coordinator input API shape | **Not finalizable by simulated signals**; production lifecycle triggers required. |
| AC8 | Scope-provenance fail-closed diagnostics only | **Not finalizable by Gate**; production operation, assets, rollback, containment required. |
| AC9 | Exact Gate labels/basic focus partial | Deferred full accessibility and first-use UI proof. |
| AC10 | Real pinned embed and prohibited-technique Gate audit | **Not finalizable by Gate**; production integrated path/full matrix required. |

No AC is accepted by Decision 0056 or WP-GATE. Later ownership is directional until a post-Gate decision authorizes exact write sets and verification.

## 14. Decisions, planning choices, decision gates, and blockers

### Supplied binding decisions

- Dual routes are separate and never dispatch each other.
- Every committed mutated AI boundary clears all native history.
- First settled semantic human mutation clears all AI history/assets.
- Only AI history has a 20-event cap.
- No first-release AI chord.
- Native image exactness is a real-Chromium gate.
- Named lifecycle boundaries reset both routes.
- Public-only integration, exact outcomes/assets/locking/rollback/diagnostics, and no false success remain binding.

### Evidence-backed planning choices

- Replace the combined prototype rather than layer over it.
- Put callback provenance inside an adapter-owned opaque scope because public scene callbacks carry no trustworthy origin token.
- Separate immutable event provenance from current command applicability to permit valid Redo after Undo without weakening identity/revision fencing.
- Split native-clear proof because the contract makes a non-empty native stack at actionable AI Undo/Redo behaviorally impossible.
- Use explicit settlement families with measurable drain/stop criteria; conservative invalidation protects state but does not prove a family.
- Keep WP-GATE narrow and commit source before measurement; commit logs/evidence afterward.

### Decision gates

- **Decision 0056:** may authorize WP-GATE only and its focused commands/evidence paths.
- **Post-Gate governance reassessment:** must decide and authorize the production WebSocket/browser seam and exact server/contract/web write set before outcomes/failure AC claims.
- **Production lifecycle boundary:** must assign owners/paths for real reset triggers before AC7 can be claimed.
- **Full implementation boundary:** must authorize all remaining source/tests/evidence and the final bundled `bun fmt`/`bun lint`/`bun typecheck` pass.
- **Native image failure:** returns to owner to narrow/leave AC6 unaccepted.

### `BLOCKER` / `INFORMATION_GAP` conditions

- `BLOCKER`: opaque scope cannot uniquely correlate delayed callbacks without fingerprint inference; required settlement family remains uncertain; native history reappears after the bounded clear drain; native mutation bypasses lock; package/private/runtime-selector/remount workaround is required; exact source candidate/log provenance is lost; protected path is needed without authorization; Decision 0047 integrated path cannot be supplied in the later boundary.
- `INFORMATION_GAP`: later decision does not name production operation/lifecycle owners and write paths; final workspace commands are not explicitly authorized; exact supported paste/drag native image path is undocumented (file chooser remains mandatory, and no unsupported path may be invented).

## 15. Plan safety validation

- **Acyclic dependencies:** PASS for planning — WP-GATE precedes every deferred package; final review/acceptance remain terminal.
- **Parallel write safety:** PASS for WP-GATE — one serialized package; source candidate and evidence-only commit have non-overlapping phases.
- **Exact-candidate/log safety:** REMEDIATED — source is committed before measurement; `pipefail` and `PIPESTATUS[0]` are required; unit/run-A/run-B logs are separate; evidence commits contain no source; final log capture is explicitly deferred and specified.
- **Synthetic provenance:** REMEDIATED AT CONTRACT LEVEL — adapter-owned opaque issuance/acknowledgement/drain/close/tombstone semantics are defined; fingerprint provenance is prohibited. Runtime feasibility remains a Gate stop condition.
- **Native-clear proof:** REMEDIATED — initial browser-observed drain plus ordered test-only Undo/Redo clear trace; no impossible mixed-history state is claimed; reappearance is diagnostic and blocking.
- **Human settlement:** REMEDIATED AT CONTRACT LEVEL — public inputs, five families, coalescing, no-op rules, 500 ms Gate bound, and pass/stop criteria are explicit. Runtime feasibility remains a Gate stop condition.
- **Sequence/applicability:** REMEDIATED — operation-local producer, adapter-global synthetic, callback sequences, event provenance, and current applicability are separate.
- **Decision 0047:** OPEN BY DESIGN — WP-GATE claims bounded feasibility only. Production WebSocket and lifecycle evidence are deferred to separately authorized boundaries; final AC2/AC7/AC8/AC10 cannot be claimed beforehand.
- **Native image proof:** DIRECTIONALLY REMEDIATED — sentinel/user insertion/export pixel requirements are explicit, but the WP is non-authorized.
- **Diagnostics:** REMEDIATED AT CONTRACT LEVEL — layer ownership and serialized v1 fields/codes are explicit.
- **Protected scope:** PASS for this plan and proposed Gate — Gate write set is trimmed; first-use education and production paths are deferred; inherited Ticket 01 asset-readiness DOM observation is distinguished from prohibited new native-control selectors.
- **Deep ownership:** REMEDIATED AT CONTRACT LEVEL — canonical deep clone/freeze and semantic projection are required.
- **Acceptance ownership:** INTENTIONALLY INCOMPLETE UNTIL GOVERNANCE — Gate owns bounded evidence only; final AC owners that require integration are decision-gated rather than falsely assigned to an isolated harness.

**Plan disposition:** safe to recommend **WP-GATE-only** authorization in Decision 0056. The full serialized implementation is **not execution-ready and must not be authorized** from this artifact. Later WPs remain useful directional planning, but their write sets, commands, ownership, and acceptance claims require post-Gate/governance reassessment. Final workspace checks may be authorized only in a later full implementation boundary.
