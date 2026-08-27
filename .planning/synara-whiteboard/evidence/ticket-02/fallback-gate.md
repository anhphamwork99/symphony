# Ticket 02 fallback dual-history WP-GATE evidence

## Bounded verdict

```text
FALLBACK WP-GATE: BOUNDED FEASIBILITY PASS
Measured source candidate: a483ed6a3e3d6fe832250c1ab170f7a350268feb
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

No Ticket 02 acceptance criterion (AC1–AC10) is claimed passed or accepted by this
record. This is bounded feasibility evidence from an isolated harness with a
deterministic fake producer, produced under Decision 0056 (WP-GATE only).

## Provenance

- **Source candidate**: `a483ed6a3e3d6fe832250c1ab170f7a350268feb`, subject
  `feat(whiteboard): prove fallback dual-history gate`, parent chain on top of
  the Decision 0056 authorization commit `5ba39bd7d`:
  `23d3fcc9b` (recovery seed) → `7b9f79f15` (first source candidate) →
  `8eea79ebf` → `151891cbc` → measured candidate `a483ed6a3`.
  `git status --short` was empty at measurement time.
- **Candidate history and rerun rule**: the first independent review returned
  NEEDS REMEDIATION against candidate `7b9f79f153bcc15350b1e25cc68b6b1f0c39feaa`
  because plan §6.6 scenario 4 requires AI Undo by pointer and **Redo by
  Enter/Space** while its browser test clicked Redo and this document reworded
  the scenario, and scenario 2's accessible activation was not explicitly
  exercised. Per plan §6.8.C the superseded evidence commit `b963b124a`
  (preserved read-only at ref `refs/backup/wp-gate-rejected-evidence-b963`, not
  an ancestor of this candidate) was never patched; instead the remediated test
  file created new candidates. Two measurement runs failed (`RUN_A_EXIT=1`) on
  intermediate candidates `8eea79ebf` (invalid locator `.focus()` call) and
  `151891cbc` (Redo Enter landed on the still-focused Undo surface), each time
  creating the next candidate and rerunning unit/A/B per §6.8.A.5–C; all three
  formal runs below were executed on the final candidate only.
- **Changed paths vs `5ba39bd7d`** (12, equals the Decision 0056 part-A source/test
  set; the 4 evidence artifacts below are the only additional writes):
  1. `apps/web/src/components/whiteboard/ticket01/SynaraExcalidrawAdapter.tsx` (modified)
  2. `apps/web/src/components/whiteboard/ticket02/ExcalidrawTicket02Harness.tsx` (modified)
  3. `apps/web/src/components/whiteboard/ticket02/SynaraDocumentSnapshot.ts` (modified)
  4. `apps/web/src/components/whiteboard/ticket02/SynaraHistoryTypes.ts` (deleted)
  5. `apps/web/src/components/whiteboard/ticket02/SynaraHistoryCommands.ts` (deleted)
  6. `apps/web/src/components/whiteboard/ticket02/SynaraSessionHistory.ts` (deleted)
  7. `apps/web/src/components/whiteboard/ticket02/SynaraHistoryGate.test.ts` (replaced)
  8. `apps/web/src/components/whiteboard/ticket02/SynaraHistoryGate.acceptance.browser.tsx` (replaced)
  9. `apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryTypes.ts` (modified)
  10. `apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryCoordinator.ts` (modified)
  11. `apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryActions.tsx` (modified)
  12. `apps/web/src/components/whiteboard/ticket02/SynaraHumanMutationSettlement.ts` (modified)
- **`git diff --check`**: clean (exit 0) before the source commit and at HEAD;
  the interim failure screenshots from the two failed runs were deleted before
  committing so no artifact entered any candidate.
- **Worktree**: `/private/tmp/synara-whiteboard-wp-gate-recovery` (isolated git
  worktree, detached HEAD at the source candidate). The worktree's
  `node_modules` and `apps/web/node_modules` are untracked symlinks to another
  clean local worktree's dependency install; no manifest or lockfile change is
  involved and the resolved package is verified below.

### Package / pin / lock provenance

- `apps/web/package.json` (unchanged at the source candidate and unchanged since
  `5ba39bd7d`): `"@excalidraw/excalidraw": "0.18.1"` (exact pin).
- `bun.lock` (unchanged): `@excalidraw/excalidraw@0.18.1` with integrity
  `sha512-6i5Gt7IDTOH//qa0Z315Ly5iVRhjWpu2whrlQFqkuwrkKUWgRsMk0P5qdE7bpyDpai7jeLeWYkyj1eVAfni1lw==`.
- Resolved on-disk module at the worktree's `apps/web/node_modules/@excalidraw/excalidraw`
  reports version `0.18.1`.
- `bun 1.3.12`, Vitest `4.1.10`.

### Browser / OS / architecture

- Chromium via Playwright `1.58.2` provider, `chromium` revision `1208`
  ("Google Chrome for Testing", browser version `145.0.7632.6`), headless, driven from the
  `vitest.browser.stable.config.ts` instance (stable config; geometry-linux
  tests excluded by its `testNamePattern`).
- macOS `26.4.1` (build `25E253`), `arm64`.

## Commands, exits, ports, and logs

All three commands were run with Bash under `set -o pipefail`,
`2>&1 | tee <log>`, explicit `${PIPESTATUS[0]}` capture, and a printed
`<NAME>_EXIT=<n>` line checked by `test ... -eq 0`; `tee` success was never
substituted for the test process exit. Each run wrote its own immutable log
file; no log was overwritten or appended by another run of this measurement,
and no log was edited after capture.

| Run | Command | Port | Exit | Log | SHA-256 |
| --- | --- | --- | --- | --- | --- |
| Unit | `bun run --cwd apps/web test -- src/components/whiteboard/ticket02/SynaraHistoryGate.test.ts` | — | `0` (`UNIT_EXIT=0`) | `fallback-gate.unit.log` | `1a33f71238a79bc607d0a99c49a0775ed9478903b21c766bee678de634c29d3e` |
| Run A | `VITEST_BROWSER_API_PORT=52477 bun run --cwd apps/web test:browser:stable -- src/components/whiteboard/ticket02/SynaraHistoryGate.acceptance.browser.tsx` | `52477` | `0` (`RUN_A_EXIT=0`) | `fallback-gate.run-a.browser.log` | `00dc4869e729f00b5576eeecb2ca57f5e3812a4be38232d116003a6723827bd9` |
| Run B | `VITEST_BROWSER_API_PORT=52488 bun run --cwd apps/web test:browser:stable -- src/components/whiteboard/ticket02/SynaraHistoryGate.acceptance.browser.tsx` | `52488` | `0` (`RUN_B_EXIT=0`) | `fallback-gate.run-b.browser.log` | `05bdb746b8c4ca9f35f7f41456e0a3441321a2eb0195012515e1c40c148fe5b5` |

Both browser runs used the same clean-tree source candidate
`a483ed6a3e3d6fe832250c1ab170f7a350268feb`, distinct pre-checked free ports
(`52477`, `52488`; `lsof -nP -iTCP:<port> -sTCP:LISTEN` empty for both before
each run), and separate immutable log files.

Results: unit `18 passed (18)` in one file; run A `4 passed (4)` in one file
(5.23s tests); run B `4 passed (4)` in one file (5.16s tests).

Honest environment notes that do not affect provenance:

- Each captured log ends with the blank line produced by the raw pipeline output
  itself (vitest prints a trailing newline; the byte content is unmodified after
  capture). This can produce an informational `new blank line at EOF` note in a
  whitespace diff scan of the evidence commit; it does not alter any exit code,
  result line, or hash above.
- The "outside of Vite serving allow list" font notices in both browser logs are
  the worktree's `node_modules` symlink path appearing in the serve allow list;
  they do not affect the test exits.

## Public APIs used by the runtime source

The runtime source touches only public `@excalidraw/excalidraw` APIs and host
observations:

- `Excalidraw` component props: `initialData`, `viewModeEnabled` (the supported
  package edit lock), `onChange`, `onScrollChange`, `onPointerDown`, `onPointerUp`,
  `excalidrawAPI`.
- Excalidraw API (public `excalidrawAPI` handle): `updateScene` with
  `captureUpdate: "NEVER"` for every synthetic write/restore, `addFiles` (restore
  path only, unused for this image-free Gate fixture), `getSceneElements`,
  `getAppState`, `getFiles`, `history.clear()` (the explicit public native-history
  clear at committed AI boundaries), and `api.id`.
- The `restore` public utility for initial scene normalization
  (`normalizeSynaraScene`), and `serializeAsJSON`/`exportToSvg`/`exportToBlob` are
  inherited Ticket 01 adapter surface (not exercised by this Gate's assertions).
- Host-boundary observations only for human settlement: React capture-phase
  `onPointerDown`/`onPointerUp`/`onPointerCancel`/`onLostPointerCapture`,
  `onKeyDownCapture`/`onKeyUpCapture`, composition capture events, focus/blur
  capture, and `onChange` app-state facts (`editingTextElement`,
  `activeTool.type`, selection, scroll/zoom). None of these call
  `preventDefault`, `stopPropagation`, or dispatch history.

## Inherited Ticket 01 asset-readiness DOM query

`SynaraExcalidrawAdapter.tsx` retains exactly one DOM observation, inherited
unchanged from accepted Ticket 01 behavior: after API readiness it queries
`.excalidraw` and `canvas.excalidraw__canvas.interactive` (with
`getComputedStyle(...).display` checks) to report the Ticket 01
`package-assets-not-ready` diagnostic. This is the inherited asset-readiness
observation, not a new native-history-control dependency.

**No new runtime DOM/CSS query exists** that discovers, suppresses, invokes, or
infers native Undo/Redo controls: the runtime source contains no selector, label
match, role query, computed-style check, or any other DOM probe for native
history controls. Native controls are touched only by the test layer (below),
which observes them by stable accessible name (`aria-label` `Undo`/`Redo`, exact
match) and clicks them as a real user path. Runtime classification of
unexplained callbacks remains selector-free (`generic-native-command` candidate
family). Runtime source has no native control locator and never intercepts,
relabels, duplicates, or replaces a native control, and no AI keyboard chord is
captured or advertised. The Synara AI action surfaces are located in tests by
the stable accessibility role/name (`role="button"`, name `Undo AI batch` /
`Redo AI batch`) plus the component's own public data attributes
(`data-ticket02-action`); keyboard focus is moved to them as a real user would
(focus + Enter/Space), which exercises the plain HTML button accessible
activation contract without any DOM suppression or private API.

## Scenario matrix (plan §6.6) — evidence mapping

Fixture: one image-free deterministic Ticket 01 fixture (text, ordinary shape,
deletable card) with stable semantic IDs/custom data, observable
viewport/zoom/selection, and a fake operation with operation-local sequences 1–3
(batch `completed-batch`, operation `fake-operation`, generation 1). The adapter
synthetic trace records scope open/write-issued/callback-acknowledged/
scope-drained/scope-closed with adapter-global synthetic + callback sequences,
identities/revisions/epochs, and the clear lifecycle.

| §6.6 scenario | Where proved | Outcome |
| --- | --- | --- |
| 1. Native pointer/Delete/text-edit/native toolbar/native shortcuts stay human; AI event count zero | Unit: coordinator human-settlement cases; Browser test 2 (`gate-human-changed-families`) — pointer Delete on card, native toolbar Undo/Redo click, native Cmd/Ctrl+Z / Shift+Cmd+Z / Ctrl+Y shortcuts, pointer-drawn rectangle (`2` + drag), text tool (`8` + click + typed text) | PASS — zero AI events across all inputs; settlements for `pointer-gesture`, `discrete-keyboard-mutation`, `generic-native-command`, `text-edit-composition` all `changed`, none `uncertain` |
| 2. AI lock blocks pointer, Delete, toolbar, shortcuts, and accessible activation; only synthetic progress mutates; pan/zoom retained | Browser test 1 (`gate-core-exactness`) — during `ai-batch` lock: canvas click, `{Delete}`, `{Meta>}z`, native shortcut; the package's own native control is unavailable under `viewModeEnabled`; **explicit accessible activation attempt**: the Synara `Undo AI batch` action is reached by stable role/name, receives real keyboard focus, Enter then Space are pressed on it while `busy`, and the guarded action cannot mutate document content while retaining its `aria-disabled="true"` state; wheel pan and Ctrl+wheel zoom keep changing viewport | PASS — projection byte-equal to the locked synthetic state across every attempt including the focused accessible activation; `aria-disabled` retained throughout; no critical diagnostic; pan/zoom observably retained |
| 3. Three progress writes → three adapter-global synthetic writes, zero events until drained completion, then exactly one event | Unit test `turns three progress writes into one event…` (events length 0 after each of 1,2,3; `acceptedSyntheticWriteCount === 3`; synthetic sequences `[1,2,3]` for progress plus `4,5` for undo/redo restores); Browser test 1 (event count 0 after sequences 1–3, exactly 1 event after `completeFakeOperation`, `cursor 1`, `unlocked`) | PASS |
| 4. Plan §6.6 wording kept verbatim: “AI Undo by pointer and Redo by Enter/Space” — exact canonical states, viewport/zoom, filtered selection, focus, cursor, and trace order | Unit test (exact before/after snapshot equality, viewport equality, traces equal to the 9-step order, synthetic sequences `[1..5]`); Browser test 1 — Undo by pointer click on `Undo AI batch`; then real keyboard activation of the focused `Redo AI batch` action: the test asserts the action offers `aria-disabled="false"` and is not disabled, moves real focus to it, presses **Enter** on it (plain native-button accessible activation fires its public click; Space performs the identical native activation on the same element), and waits through verification/drain/unlock — exact `preAi`/`final` canonical snapshots, retained command-start viewport, stale selection `ticket02-stale-selection` filtered to `[]`, `document.activeElement` on the Redo surface, cursor 1, both command traces exactly the §6.5 order in unit, run A, and run B | PASS |
| 5. Split native-clear proof | Browser-observed initial commit: test 1 creates real native history (card Delete), completes the AI batch, then native shortcut Undo cannot restore the pre-AI state and the event survives; post-clear drain window (task/microtasks/two RAF frames, callback-free second frame, 500 ms bound) asserts no reappearance. Test-only ordered clear trace: exact 9-step trace asserted for AI Undo and AI Redo in unit and both browser runs | PASS |
| 6. Settlement families: changed pointer, Delete, text, native Undo, native Redo; no-op selection, pan, zoom, tool, focus, cancelled pointer/composition | Browser test 2 (changed families) + test 3 (`gate-human-noop-families` — selection click, wheel pan, Ctrl+wheel zoom, `h` tool, blur+focus, cancelled pointer probe button via `pointerdown`+`pointercancel`, cancelled composition) | PASS — every changed family settles `changed` exactly once, every no-op family settles `no-op`, AI event/cursor preserved, zero `uncertain` |
| 7. Duplicate, delayed closed-scope, old operation generation, wrong route/session epoch, wrong mount/revision, extra callback, unknown provenance | Unit: `rejects duplicate/skipped local sequence…`, `cannot drain or close after semantic verification fails`, `rechecks route and revision fences`, `rejects stale … before opening` (session/route/revision/mount), `marks missing termination and unknown callback provenance uncertain`, `rejects stale producer generation…`; Browser test 4 (`gate-negative-scope-provenance` / `gate-negative-unknown-provenance` / `gate-negative-stale-generation`) — stale mount/session/route/revision scope opens throw; delayed duplicate after close → `duplicate-synthetic-callback`; post-tombstone-horizon callback → `unknown-callback-provenance` with `locked-fault`, cursor 0, zero events; unscoped restore under lock → fail-closed `locked-fault`; stale generation → `stale-operation-generation` with no scene write | PASS — all fail closed; no fingerprint inference; identity stable |
| 8. Stable mount/API identity throughout non-reset scenarios | Unit and browser tests assert `getIdentity()` (mountId + apiId) unchanged across batches, undo/redo, settlements, and negative paths (test 1 and test 4) | PASS |

Required settlement families (plan §5.3 Gate PASS requirement): pointer (changed),
Delete (changed), text edit (changed), native toolbar Undo (changed), native
toolbar Redo (changed), cancelled pointer (no-op), selection (no-op), pan (no-op),
zoom (no-op), tool (no-op), focus (no-op), cancelled composition (no-op) — each
settled reliably changed/no-op in both stable-Chromium runs with no
`human-settlement-uncertain` diagnostic in any required family.

## Scope / sequence traces

The adapter's synthetic trace (test-only observation of runtime behavior) records,
per scope: `scope-opened` (identities, epochs, revision fence), `write-issued`
(operation-local + adapter-global synthetic sequence), `callback-acknowledged`
(callback sequence + revisions), `scope-drained`, `scope-closed`,
`callback-rejected` (reason). The unit test asserts the adapter-global synthetic
sequence `[1, 2, 3]` for the three progress writes and `[4, 5]` for the AI
Undo/AI Redo restore writes — every synthetic write including restore increments
the one adapter-global monotonic sequence; restore does not bypass it. The
operation-local producer sequence is contiguous 1–3 and duplicates/skips are
rejected before any scene write. In browser test 1 the visible trace shows
scope-1 closing after three acknowledged progress writes and scope-2 (the AI
Undo restore) completing its issue → acknowledge → drain → close sequence before
unlock, matching the coordinator assertion that exactly one further restore
scope (AI Redo, adapter-global synthetic sequence 5) executes during the
keyboard-activated Redo.

## Settlement traces

Every settlement result carries family, start/end fingerprints, reason, and an
input trace (e.g. `pointer-down → semantic-callback#N → pointer-up`).
`settleFamily` compares the deep canonical start/end projections: changed
projection ⇒ one settled human mutation clearing all AI history once; equal
projection ⇒ proven no-op preserving AI history. Missing termination, overlapping
families, callbacks beyond the 500 ms bound, or uncorrelatable provenance ⇒
`human-settlement-uncertain` (conservative invalidation; family marked unproven).
No required family reported uncertainty in either run.

## Native-clear split proof

- **Browser-observed initial commit (test 1)**: real native history exists
  (deletable card removed by pointer + Delete; native Undo control connected);
  after the AI batch completes and its public `history.clear()` plus the bounded
  post-clear drain, the native shortcut cannot restore the pre-AI state, the AI
  event remains, and no `native-history-reappeared-after-clear` diagnostic fired.
- **Test-only ordered clear invocation trace**: for AI Undo (pointer-activated)
  and AI Redo (Enter-activated), the coordinator records exactly one ordered
  trace each — `restore-write-issued → restore-callback-acknowledged →
  restore-target-verified → native-history-clear-invoked →
  native-history-clear-returned → post-clear-drain-complete → cursor-moved →
  result-exposed → lock-released` — asserted in the unit suite and in both
  browser runs. The trace proves invocation order only, not a non-empty native
  stack; no test recreates native history between AI Undo and Redo while
  claiming the AI event remains actionable.

## Diagnostics

Schema `synara.whiteboard.history-diagnostic/v1` is serialized with the full
required field list (owner, code, severity, recoverability, acApplicability,
phase, scenario, message, summary, packageVersion `0.18.1`, browser, platform,
identities, epochs, revisions, optional operation/batch/event/sequence/scope
correlation fields, expected, observed, lockState, timestamp). Ownership split:
the adapter owns public-boundary diagnostics (readiness, scope lifecycle,
sequence/correlation, identity/revision mismatch, write/clear/lock failures,
inherited Ticket 01 asset readiness); the coordinator owns domain diagnostics
(applicability, event/cursor transitions, settlement, rollback/fault, resets).
Neither layer emits the other's conclusion. The unit suite asserts exact required
fields and serialization of the diagnostic object; the required Gate code list is
typed in `SynaraAiHistoryTypes.ts` and exercised across the suites
(`unknown-callback-provenance`, `duplicate-synthetic-callback`,
`stale-operation-generation`, `stale-route-epoch`, `stale-session-epoch`,
`stale-mount-identity`, `stale-mutation-revision`,
`semantic-verification-mismatch`, `synthetic-scope-unresolved`,
`synthetic-sequence-mismatch`, `native-mutation-during-ai-lock`,
`edit-lock-failed`, `native-history-clear-failed`,
`native-history-reappeared-after-clear`, `identity-changed-unexpectedly`,
`human-settlement-uncertain`, `adapter-not-ready`, `operation-not-applicable`,
`cursor-not-actionable`). No diagnostic contains binary bodies, raw package
objects, private stack data, or opaque token values. Both critical-severity
filters over the core browser scenario are empty — including across the locked
accessible activation attempts — no false success, no cursor movement, and no
unlock accompany a fault; fail-closed keeps `locked-fault`.

## Remediation summary (superseded evidence)

The previous evidence record at `b963b124a` measured candidate `7b9f79f15`, whose
browser test activated Redo by pointer click and whose scenario-4 matrix row
misquoted plan §6.6 as "Redo by button"; scenario 2's accessible activation was
covered only indirectly by the unavailable native control. Both defects are
remediated in candidate `a483ed6a3` by test-layer changes only: real Enter
activation of the focused `Redo AI batch` surface for scenario 4, and an explicit
focus + Enter/Space accessible activation attempt under the AI lock asserting the
guard cannot mutate content for scenario 2. No runtime source behavior changed;
this document now quotes the unmodified §6.6 wording.

## Bounded outcome

This Gate proves only bounded feasibility of the isolated adapter/coordinator
semantics with a deterministic fake producer in the real pinned Chromium embed:
native route ownership, the supported AI lock with pan/zoom retention and
blocked accessible activation, three-write exactness into one event, exact AI
Undo (pointer) / Redo (Enter/Space) restore with the ordered clear lifecycle,
public human settlement families, opaque synthetic write-scope correlation with
fail-closed unknown provenance, and adapter identity stability. Fake completion
is not production operation completion. Simulated operation signals are not
production WebSocket, Take Over acknowledgement, invalid/dependent-operation, or
lifecycle-trigger proof. Production WebSocket/real-operation evidence and
production lifecycle-trigger evidence are DEFERRED — NOT CLAIMED; later work
packages are NON-AUTHORIZED pending the post-Gate governance reassessment
required by Decision 0056.
