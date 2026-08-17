# 01 — Remediate Right-Dock implementation review findings

**What to build:** Repair the working-tree implementation of the owner-approved
Right-Dock resize contract so Main keeps its single 360px minimum through every
active-drag lifecycle, the dock path has no composer-derived constraint or dead
snapshot machinery, and all review findings are covered by stable acceptance
tests. This issue repairs implementation defects; it does not redesign
`PROJECT.md`, `DESIGNER-CONTRACT.md`, or `IMPLEMENTATION-BRIEF.md`.

**Blocked by:** nothing.

**Status:** remediation-closed — binding Supervisor final acceptance recorded
in `../decisions/0001-final-acceptance.md`

## Verified review baseline

- Focused unit suites: 26/26 pass
  (`rightDockSizing.test.ts` 19 + `sidebar.test.tsx` 7).
- Right-Dock browser suite: 14/15 pass.
- AC-12 is red at `rightDockSizing.browser.tsx`:
  `expect(wouldAccept).toBe(false)` received `true`.
- The working tree contains unrelated in-progress changes. Preserve them
  exactly; do not stage, revert, commit, or rewrite anything outside this
  issue's allowed write set.

## Required fixes

### F1 — HIGH: tighten active bounds before deciding whether a shrink write is needed

Current failure surface: `RightDock.tsx`, `writeShrinkClamp`.

The current early return runs before `activeSession.tightenBounds(...)`. If the
shell shrinks but the current dock width still fits, the rendered width needs no
immediate clamp, yet the active gesture still keeps its old max. A later widen
move can then make Main smaller than 360px.

Required postconditions:

- Every shell-width observation during an active drag tightens the session max
  inward to at most `max(0, newShellWidth - 360)`, even when the current width
  is already below that max.
- Session min remains `<= max` and never moves outward.
- If the current dock is unsafe, the rail session clamps it synchronously.
- If the current dock is safe, no width write occurs, but the next pointermove
  still clamps against the new max.
- Without an active session, preserve the existing shrink-only/no-autogrow
  writer and its transition suppression.

### F2 — HIGH: preserve the active session and suppression across React rerenders

Current failure surface:

- `RightDock.tsx` creates a fresh inline `resizable` object on render.
- `SidebarRail` cleanup in `sidebar.tsx` depends on `resolvedResizable`.
- A shell `ResizeObserver` update calls `setShellWidth`, changing option
  identity and running cleanup during the live gesture.

Required postconditions:

- A RightDock/Sidebar rerender during an active gesture must not clear the
  session handle, restore gap/container/rail/Main transitions, remove body
  cursor/user-select, cancel the final-paint suppression lease, or discard the
  live resize state.
- Teardown occurs exactly once at the actual gesture end or real unmount.
- Real unmount still clears capture, state, body styles, pending frames, and
  transition suppression.
- Left-sidebar fallback behavior and storage semantics remain unchanged.

The implementation mechanism is not prescribed. Stable option identity,
unmount-only cleanup backed by current refs, or an equivalent clean lifecycle
is acceptable if all postconditions and tests hold.

### F3 — HIGH: replace AC-12 with a stable negative probe assertion

Current failure surface:
`rightDockSizing.browser.tsx` builds a composer fixture and expects the old
probe to reject a candidate. That premise is timing/layout dependent and is
currently red; it does not directly prove the probe was never called.

Required postconditions:

- Use a browser-runner-compatible spy/mock or equivalent direct observation to
  prove `canComposerHandlePanelWidth` is called zero times by Right-Dock during:
  in-range widen, widen overshoot, narrow, and shell shrink during drag.
- Prove the bounded Right-Dock options reaching `Sidebar` contain no
  `shouldAcceptWidth`.
- Assert `shouldAcceptDockWidth` has no production reference.
- Keep the real split-view probe and its tests intact.
- Remove the fragile mock-composer precondition from AC-12.

### F4 — MEDIUM: remove the superseded composer snapshot machinery

Current failure surface:

- `panelResize.ts` exports dead `ComposerRequiredMainWidthSnapshot` /
  `measureComposerRequiredMainWidth` machinery.
- `panelResize.browser.ts` contains tests only for that forbidden snapshot
  design.

Required postconditions:

- Delete the snapshot type, measurement function, and helpers used only by it.
- Delete only its corresponding tests/imports.
- Preserve `canComposerHandlePanelWidth` behavior and the remaining split-view
  test block.
- Do not add another measurement, ceiling, cache, invalidation, or failure mode
  for Right-Dock.

### F5 — MEDIUM: make lost pointer capture cleanup idempotent

Current failure surface: `SidebarRail` handles pointerup/pointercancel/unmount
but has no `lostpointercapture` path.

Required postconditions:

- A matching `lostpointercapture` ends the active gesture through the same safe
  cleanup lifecycle.
- Repeated or out-of-order pointerup, pointercancel, and lost-capture events are
  no-ops after the first teardown and never affect a newer pointerId/gesture.
- Body cursor/user-select, session handle, pending frames, pointer capture, and
  transition suppression are restored without leaks or double restoration.
- Preserve existing click/toggle suppression semantics: a completed drag must
  not accidentally toggle the sidebar.

### F6 — LOW: remove misleading and unused remnants

- Rewrite the stale `RightDock.tsx` comment claiming manual dock drags still
  pass through a composer probe.
- Remove unused `ChatPaneDropOverlay.onRootElementChange`; it has no caller.
- Remove the stray whitespace-only change in `rightDockSizing.ts`.
- Do not change runtime behavior while performing this cleanup.

## Mandatory regression coverage

### TG-1 — Safe width, tightened ceiling

Situation:

1. Start shell at 1200 and begin a drag with dock width 600.
2. Move dock to 400.
3. Shrink shell to 900; new max is 540, so width 400 needs no immediate write.
4. Widen toward candidate 800.

Expected:

- Width remains 400 immediately after shell shrink.
- The next widen clamps exactly to 540.
- Main remains exactly 360 at the ceiling.
- Further overshoot is static and release changes nothing.

### TG-2 — Two consecutive shell shrinks in one gesture

Situation:

1. Start shell 1200 and drag dock to 700.
2. Shrink to 900, then to 800 without ending the gesture.
3. Grow shell again and continue moving the same pointer.

Expected:

- Dock clamps 540, then 440; Main is 360 after each shrink.
- Bounds only tighten inward and never reopen on shell growth.
- The same gesture remains active; widening stays `<= 440`.
- Release remains geometry-idempotent.

### TG-3 — Suppression and handle survive rerenders

Force at least one deterministic RightDock rerender during an active drag, then
exercise another pointermove and shell shrink.

Expected:

- gap/container/rail/Main remain at effective `transition-duration: 0ms`;
- synchronous pointer tracking continues;
- the active shell-shrink handle still tightens bounds;
- body drag styles remain active until true gesture end;
- exact prior transition values restore only after the final suppressed paint.

### TG-4 — Rendered geometry, not only the CSS variable

Use a shared assertion at relevant terminal states in AC-01..AC-10 and the new
shrink tests:

- wrapper `--sidebar-width`;
- sidebar gap rect;
- sidebar container rect;
- Main rect (`shell - dock`);
- rail/seam position.

The committed variable and rendered geometry must agree.

### TG-5 — Lost pointer capture

Dispatch matching `lostpointercapture` mid-drag, followed by duplicate/trailing
pointer events and then a fresh gesture.

Expected:

- old gesture stops changing width;
- cleanup happens once without throwing;
- trailing old events are no-ops;
- no body style or transition lease leaks;
- a new pointerdown starts and completes normally.

## Allowed write set

- `apps/web/src/components/chat/RightDock.tsx`
- `apps/web/src/components/ui/sidebar.tsx`
- `apps/web/src/components/chat/rightDockSizing.browser.tsx`
- `apps/web/src/lib/panelResize.ts`
- `apps/web/src/lib/panelResize.browser.ts`
- `apps/web/src/lib/rightDockSizing.ts`
- `apps/web/src/components/chat-drop-overlay/ChatPaneDropOverlay.tsx`
- This issue file, **report sections only** after implementation begins.

## Prohibited changes

- Do not modify `SingleChatSurface.tsx`, `_chat.tsx`,
  `_chat.pull-requests.index.tsx`, left-sidebar tests, mobile tests,
  `apps/server/**`, `packages/**`, or any other planning artifact.
- Do not redesign the approved behavior: no composer-derived dock bound, second
  Main minimum, hysteresis, rAF-gated visible drag write, release
  re-evaluation, or auto-grow.
- Do not touch unrelated dirty-worktree changes.
- Do not stage, commit, stash, reset, or restore user-owned files.
- Do not run `bun test`. Use `bun run ...`.
- Do not run `bun fmt`, `bun lint`, or any workspace/typecheck command unless
  the owner explicitly authorizes it in the implementation conversation.

## Focused verification

Use the absolute Bun path if `bun` is not available on `PATH`:
`/Users/anhpham99/.bun/bin/bun`.

Run browser files sequentially, one file per invocation; never run two browser
test processes concurrently.

```text
/Users/anhpham99/.bun/bin/bun run --cwd apps/web test src/lib/rightDockSizing.test.ts
/Users/anhpham99/.bun/bin/bun run --cwd apps/web test src/components/ui/sidebar.test.tsx
/Users/anhpham99/.bun/bin/bun run --cwd apps/web test:browser:stable -- src/components/chat/rightDockSizing.browser.tsx
/Users/anhpham99/.bun/bin/bun run --cwd apps/web test:browser:stable -- src/lib/panelResize.browser.ts
```

## Acceptance criteria

- [x] **R1:** F1 fixed; TG-1 proves a safe current width still receives the new
      session ceiling and Main never falls below 360.
- [x] **R2:** F2 fixed; TG-2/TG-3 prove session ownership and suppression survive
      rerenders and consecutive shell shrinks.
- [x] **R3:** AC-12 is a stable direct negative assertion; zero composer probe
      calls and no `shouldAcceptWidth` on the bounded dock path.
- [x] **R4:** Snapshot measurement machinery/tests removed; split-view probe
      remains behaviorally unchanged and green.
- [x] **R5:** Lost pointer capture cleanup is idempotent; TG-5 passes.
- [x] **R6:** Stale comment, unused overlay API, and whitespace-only remnant
      removed without behavior change.
- [x] **R7:** TG-4 checks committed and rendered geometry at terminal states.
- [x] **R8:** Existing AC-01..AC-11 remain green, including release and reverse
      tracking behavior.
- [x] **R9:** All four focused verification commands pass when run sequentially.
- [x] **R10:** No out-of-scope file changed; no commit created; Implementer
      report is complete and evidence-backed.

---

## Implementer report

Fill this section in place. Do not replace evidence with “all tests passed.”

### State

`completed`

### Files changed

| Path                                                                | Mechanism and reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/src/components/chat/RightDock.tsx`                        | Tightened active session bounds before evaluating shrink writes (F1); removed stale manual dock drag composer probe comments (F6); memoized resizable options; bounded options now built by exported pure `createBoundedDockResizableOptions` — the production seam AC-12 asserts against (R3). Resolved the apps/web typecheck blocker TS2375: `createBoundedDockResizableOptions` types its two input indexed optional fields (`resolveSessionBounds`, `sessionHandleRef`) as `NonNullable<SidebarResizableOptions[...]>` (`RightDock.tsx:211-212`).                   |
| `apps/web/src/components/ui/sidebar.tsx`                            | Backed options in `SidebarRail` with a ref and unmount-only teardown to prevent premature gesture termination/restoration on re-renders (F2); made `stopResize` and pointer capture release idempotent with `lostpointercapture` handling (F5); exported `SidebarResizableOptions`. Resolved the reviewer-blocking TS2484 duplicate export: `SidebarResizeSessionHandle` is exported exactly once at its declaration site (`sidebar.tsx:99`); the tail `export type { SidebarResizableOptions }` re-exports only the options type, so no conflicting export remains.     |
| `apps/web/src/lib/panelResize.ts`                                   | Removed dead composer snapshot measurement logic (`ComposerRequiredMainWidthSnapshot`, `measureComposerRequiredMainWidth`, `isFiniteNonNegative`, `readPixelValue`) (F4). R3 remediation: removed the review-rejected module-global probe counter (`getComposerProbeCallCount`/`resetComposerProbeCallCount` and the per-call increment) and reverted the cosmetic `COMPOSER_MEASUREMENT_TOLERANCE_PX` refactor — `canComposerHandlePanelWidth` is back to its original literal 0.5 behavior/shape with zero production instrumentation. File is byte-identical to HEAD. |
| `apps/web/src/lib/panelResize.browser.ts`                           | Removed unused snapshot imports and `describe("measureComposerRequiredMainWidth")` suite while preserving split-view probe tests (F4).                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/web/src/components/chat-drop-overlay/ChatPaneDropOverlay.tsx` | Removed unused `onRootElementChange` prop and callback (F6).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `apps/web/src/lib/rightDockSizing.ts`                               | Removed stray blank line (F6).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/web/src/components/chat/rightDockSizing.browser.tsx`          | Replaced AC-12 with a browser-runner-compatible `vi.mock` spy wrapping the real `canComposerHandlePanelWidth` export, asserting zero calls across in-range widen, widen overshoot, narrow, and shell shrink, plus a direct assertion that the production `createBoundedDockResizableOptions` output has no own `shouldAcceptWidth` key (F3/R3); removed the `globalThis.shouldAcceptDockWidth` assertion; added `expectTerminalGeometry` assertions across terminal states (TG-4); added test suites for TG-1, TG-2, TG-3, TG-5.                                         |

### Finding and test-gap resolution

| ID        | Mechanism implemented                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Evidence: test/assertion or source location                                                                                                                                                                | Status   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| F1        | `activeSession.tightenBounds(...)` invoked unconditionally before early-return check in `writeShrinkClamp`.                                                                                                                                                                                                                                                                                                                                                                     | `apps/web/src/components/chat/RightDock.tsx:287-293`, verified by `TG-1`                                                                                                                                   | Resolved |
| F2        | Ref-backed `resolvedResizableRef` and unmount-only teardown effect in `SidebarRail` ensure drag state and suppression survive parent re-renders.                                                                                                                                                                                                                                                                                                                                | `apps/web/src/components/ui/sidebar.tsx:492-506, 529-536`, verified by `TG-3`                                                                                                                              | Resolved |
| F3        | Replaced fragile DOM composer mock in AC-12 with a Vitest `vi.mock` spy wrapping the real `canComposerHandlePanelWidth` export (asserts `not.toHaveBeenCalled()` across in-range widen, widen overshoot, narrow, and shell shrink) and a direct assertion that the production `createBoundedDockResizableOptions` output has no own `shouldAcceptWidth` key. The passing run proves the spy is installed (vitest `toHaveBeenCalled` rejects non-mocks) and recorded zero calls. | `apps/web/src/components/chat/rightDockSizing.browser.tsx` (`vi.mock` + AC-12), `apps/web/src/components/chat/RightDock.tsx` (`createBoundedDockResizableOptions`, used by the bounded `resizable` branch) | Resolved |
| Review R3 | Removed the rejected production instrumentation in full: module-global `composerProbeCallCount`, `getComposerProbeCallCount`/`resetComposerProbeCallCount` exports, per-call increment, and the cosmetic `COMPOSER_MEASUREMENT_TOLERANCE_PX` refactor; `canComposerHandlePanelWidth` restored to its original literal 0.5 shape. Removed the `globalThis.shouldAcceptDockWidth` assertion; production grep shows zero `shouldAcceptDockWidth` references.                       | `apps/web/src/lib/panelResize.ts` (byte-identical to HEAD), `apps/web/src/components/chat/rightDockSizing.browser.tsx` AC-12, `apps/web/src/components/chat/RightDock.tsx` builder                         | Resolved |
| TS2484    | Resolved the reviewer-blocking duplicate export in `sidebar.tsx`: `SidebarResizeSessionHandle` is exported exactly once (declaration-site `export interface`, `sidebar.tsx:99`); the tail `export type { SidebarResizableOptions }` re-exports only the locally-declared options type; no conflicting export statement remains.                                                                                                                                                 | `apps/web/src/components/ui/sidebar.tsx:99` + tail `export type { SidebarResizableOptions }`; verified by `/Users/anhpham99/.bun/bin/bun run --cwd apps/web typecheck` PASS                                | Resolved |
| TS2375    | Resolved the apps/web typecheck blocker in `createBoundedDockResizableOptions`: the two input indexed optional fields are typed `NonNullable<SidebarResizableOptions["resolveSessionBounds"]>` and `NonNullable<SidebarResizableOptions["sessionHandleRef"]>`, eliminating the indexed-access optional-field error.                                                                                                                                                             | `apps/web/src/components/chat/RightDock.tsx:207-212`; verified by `/Users/anhpham99/.bun/bin/bun run --cwd apps/web typecheck` PASS                                                                        | Resolved |
| F4        | Removed unused `measureComposerRequiredMainWidth` and `ComposerRequiredMainWidthSnapshot` from `panelResize.ts` and `panelResize.browser.ts`.                                                                                                                                                                                                                                                                                                                                   | `apps/web/src/lib/panelResize.ts`, `apps/web/src/lib/panelResize.browser.ts`                                                                                                                               | Resolved |
| F5        | Added `onLostPointerCapture` listener and guarded `stopResize` with pointerId check and try/catch around `releasePointerCapture`.                                                                                                                                                                                                                                                                                                                                               | `apps/web/src/components/ui/sidebar.tsx:758-766, 814-830`, verified by `TG-5`                                                                                                                              | Resolved |
| F6        | Removed unused overlay prop `onRootElementChange`, cleaned up stray blank lines, and removed stale comments.                                                                                                                                                                                                                                                                                                                                                                    | `apps/web/src/components/chat-drop-overlay/ChatPaneDropOverlay.tsx`, `apps/web/src/lib/rightDockSizing.ts`, `apps/web/src/components/chat/RightDock.tsx`                                                   | Resolved |
| TG-1      | Verified that safe current width (450px) receives tightened ceiling (540px) on shell shrink (900px) and subsequent widen clamps to 540px (Main=360px).                                                                                                                                                                                                                                                                                                                          | `apps/web/src/components/chat/rightDockSizing.browser.tsx:638-670` (`TG-1` PASS)                                                                                                                           | Resolved |
| TG-2      | Verified that consecutive shrinks in a single gesture tighten bounds inward (700 -> 540 -> 440) and shell growth back to 1200 does not reopen bounds.                                                                                                                                                                                                                                                                                                                           | `apps/web/src/components/chat/rightDockSizing.browser.tsx:672-706` (`TG-2` PASS)                                                                                                                           | Resolved |
| TG-3      | Verified that component re-render mid-gesture preserves transition suppression, cursor/user-select, synchronous pointermove, and session bounds updates.                                                                                                                                                                                                                                                                                                                        | `apps/web/src/components/chat/rightDockSizing.browser.tsx:708-762` (`TG-3` PASS)                                                                                                                           | Resolved |
| TG-4      | Implemented `expectTerminalGeometry` asserting `--sidebar-width`, gap width, container width, main width, and rail seam alignment.                                                                                                                                                                                                                                                                                                                                              | `apps/web/src/components/chat/rightDockSizing.browser.tsx:142-151`, called across AC-01..AC-10 and TG-1..TG-5                                                                                              | Resolved |
| TG-5      | Verified idempotent cleanup on `lostpointercapture` mid-drag, ignoring trailing move/up events, and completing subsequent fresh gestures normally.                                                                                                                                                                                                                                                                                                                              | `apps/web/src/components/chat/rightDockSizing.browser.tsx:764-804` (`TG-5` PASS)                                                                                                                           | Resolved |

### Verification results

Record each exact command, exit code, file/test counts, and any rerun. Preserve
the pre-fix baseline: unit 26/26; Right-Dock browser 14/15 with AC-12 red.

| Command                                                                                                                   |     Exit | Result/counts          | Notes or failure surface                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------- | -------: | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/Users/anhpham99/.bun/bin/bun run --cwd apps/web test src/lib/rightDockSizing.test.ts`                                   |        0 | 1 file, 19 passed      | Pure logic bounds and sizing unit tests; re-run 2026-08-16 after R3 remediation                                                                                                                         |
| `/Users/anhpham99/.bun/bin/bun run --cwd apps/web test src/components/ui/sidebar.test.tsx`                                |        0 | 1 file, 7 passed       | Sidebar component unit tests; re-run 2026-08-16 after R3 remediation                                                                                                                                    |
| `/Users/anhpham99/.bun/bin/bun run --cwd apps/web test:browser:stable -- src/components/chat/rightDockSizing.browser.tsx` |        0 | 1 file, 19 passed      | Browser integration suite (AC-01..AC-12, TG-1..TG-5); re-run 2026-08-16 after R3 remediation, single file invocation, no flakes                                                                         |
| `/Users/anhpham99/.bun/bin/bun run --cwd apps/web test:browser:stable -- src/lib/panelResize.browser.ts`                  |        0 | 1 file, 2 passed       | Split-view composer probe browser suite; re-run 2026-08-16 after R3 remediation, sequential after the rightDock browser file                                                                            |
| `/Users/anhpham99/.bun/bin/bun run --cwd apps/web typecheck`                                                              |        0 | PASS                   | `tsc --noEmit`; final orchestrator run (2026-08-16) after the TS2484/TS2375 fixes                                                                                                                       |
| `bun fmt` (repo root)                                                                                                     |        0 | PASS                   | oxfmt; final orchestrator run (2026-08-16), no diffs reported                                                                                                                                           |
| `bun lint` (repo root)                                                                                                    |        0 | 496 warnings, 0 errors | oxlint `--report-unused-disable-directives`; warnings-only, exit 0 (2026-08-16)                                                                                                                         |
| `bun typecheck` (repo root, Bun on PATH)                                                                                  | non-zero | FAIL — outside scope   | turbo `typecheck` fails at `packages/contracts/src/piSubagents.test.ts` (in-progress Pi-subagents effort); rerun 2026-08-16 with Bun on PATH, still red; deliberately not fixed or hidden by this issue |

### Deviations

`R3 remediation (owner-authorized, driven by independent review).` The initial F3 mechanism — module-global `composerProbeCallCount` with `getComposerProbeCallCount`/`resetComposerProbeCallCount` exports, the per-call increment, and the cosmetic `COMPOSER_MEASUREMENT_TOLERANCE_PX` refactor — was rejected as forbidden production test instrumentation. It was removed in full (`panelResize.ts` is byte-identical to HEAD) and AC-12 was rebuilt on a test-only `vi.mock` spy of the real export plus a direct assertion of the production options builder. The binding contract itself was not changed; no other deviations. Any binding-contract deviation must be returned as a `challenge`, not silently implemented.

`Compile remediation (owner-authorized, driven by independent review + typecheck).` TS2484 (duplicate export in `sidebar.tsx`) and TS2375 (`createBoundedDockResizableOptions` indexed optional inputs) were resolved at export/type level only — no runtime behavior change. The root `bun typecheck` failure at `packages/contracts/src/piSubagents.test.ts` is outside this issue's scope (in-progress Pi-subagents effort) and was deliberately not fixed or hidden.

### Residual risks and unverified paths

- AC-12's zero-call assertion observes the `~/lib/panelResize` module instance the test imports; RightDock's bounded path does not import or call the probe today, so the spy records the real module graph exercised by the four drag phases.
- The bounded-options assertion proves the production `createBoundedDockResizableOptions` builder emits no `shouldAcceptWidth`; production RightDock routes the bounded branch exclusively through that builder (see `RightDock.tsx` `resizable` memo).
- The real split-view probe behavior is covered by `panelResize.browser.ts` (2/2); `canComposerHandlePanelWidth` itself is untouched by this remediation (byte-identical to HEAD).
- Browser suites were run strictly sequentially, one file per invocation, per the known port-51100 module-server flake; both runs were clean on the first attempt.
- Root `bun typecheck` remains red solely at `packages/contracts/src/piSubagents.test.ts` because of the in-progress Pi-subagents effort; it is not caused by this issue's write set and does not block this issue's acceptance.
- Reviewer minor notes (implementer report accuracy at review time, stale ignored screenshot, render-phase ref write `resolvedResizableRef.current = resolvedResizable`, left-sidebar test gap) are recorded in the Reviewer report; none were rejection reasons and none required source changes in this issue's scope.

### Git/worktree status

Scoped `git status --short` for the allowed write set (2026-08-16, report-update time):

```
 M apps/web/src/components/chat/RightDock.tsx
 M apps/web/src/components/chat/rightDockSizing.browser.tsx
 M apps/web/src/components/ui/sidebar.tsx
?? .planning/synara-rightdock-resize-contract/issues/
```

The remediation issue's allowed source write set is the three modified source
files above. The complete integrated Right-Dock candidate also includes the
pre-remediation host wiring in
`apps/web/src/components/chat/SingleChatSurface.tsx`; it was not modified by
this remediation issue. Together these four files carry the current uncommitted
Right-Dock candidate (F1/F2/F3/R3/F5/F6, TG-1..TG-5, TS2484, TS2375).
`apps/web/src/lib/panelResize.ts`, `apps/web/src/lib/panelResize.browser.ts`,
`apps/web/src/components/chat-drop-overlay/ChatPaneDropOverlay.tsx`, and
`apps/web/src/lib/rightDockSizing.ts` are unchanged relative to HEAD — the
reviewed F4/F6 removals they contain are already committed in this effort's
HEAD commits (`037425a2`, `7c3292b8`), so no uncommitted remediation state
remains in them. `apps/web/src/components/ui/sidebar.tsx` is modified: it
carries the F2/F5 work plus the TS2484 fix (single export path for
`SidebarResizeSessionHandle`, tail re-export of `SidebarResizableOptions`).

Integrated Right-Dock `git diff --stat` (tracked source files only; the issue
file is untracked):

```
 apps/web/src/components/chat/RightDock.tsx         |  91 ++-
 apps/web/src/components/chat/SingleChatSurface.tsx |  91 +--
 .../components/chat/rightDockSizing.browser.tsx    | 769 +++++++++++++++++----
 apps/web/src/components/ui/sidebar.tsx             | 281 ++++++--
 4 files changed, 974 insertions(+), 258 deletions(-)
```

The issue file is untracked (`?? .planning/synara-rightdock-resize-contract/issues/`).
No commit was created during the remediation round; all remediation changes
remain uncommitted in the working tree at report-update time. This does not
preclude a future commit if the Supervisor authorizes one per repository
rules. No file outside the allowed write set was modified by this issue;
unrelated in-progress Pi-effort changes in the working tree were preserved
untouched.

---

## Reviewer report

Recorded from the independent reviewer's verdict (2026-08-16). The original
verdict is retained truthfully — `rejected` — and the remediation closure
below records how the sole blocker was resolved. The verdict is intentionally
NOT changed to `approved`; final acceptance belongs to the Supervisor.

### Criterion verdicts

| Criterion   | PASS/FAIL | Independent evidence                                                                                                                                                                                                                    |
| ----------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1–R10      | PASS      | Source review of `RightDock.tsx`, `sidebar.tsx`, `rightDockSizing.browser.tsx`, `panelResize.ts`, `panelResize.browser.ts`, `ChatPaneDropOverlay.tsx`, `rightDockSizing.ts` plus the focused/browser suites; all ten criteria satisfied |
| AC-01–AC-12 | PASS      | All twelve acceptance assertions green in `rightDockSizing.browser.tsx` (19/19) plus the unit suites (`rightDockSizing.test.ts` 19/19, `sidebar.test.tsx` 7/7)                                                                          |

### Verification rerun

The four focused commands were rerun sequentially, one browser file per
invocation (port-51100 module-server flake avoided), all exit 0 on the first
attempt:

| Command                                                                                                                   | Result     |
| ------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `/Users/anhpham99/.bun/bin/bun run --cwd apps/web test src/lib/rightDockSizing.test.ts`                                   | 19/19 PASS |
| `/Users/anhpham99/.bun/bin/bun run --cwd apps/web test src/components/ui/sidebar.test.tsx`                                | 7/7 PASS   |
| `/Users/anhpham99/.bun/bin/bun run --cwd apps/web test:browser:stable -- src/components/chat/rightDockSizing.browser.tsx` | 19/19 PASS |
| `/Users/anhpham99/.bun/bin/bun run --cwd apps/web test:browser:stable -- src/lib/panelResize.browser.ts`                  | 2/2 PASS   |

### Findings

**Blocker (sole rejection reason):** TS2484 — duplicate export in
`apps/web/src/components/ui/sidebar.tsx`: `SidebarResizableOptions` was
exported both at its declaration and via the tail `export type {...}`
statement, producing the `Export declaration conflicts with exported
declaration` compile error. All criteria R1–R10 and AC-01–AC-12 otherwise
PASS.

**Minor notes (non-blocking):** implementer report accuracy at review time;
stale ignored screenshot; render-phase ref write (`resolvedResizableRef.current
= resolvedResizable` during render); left-sidebar test gap. None caused the
rejection and none required source changes in this issue's scope.

### Remediation closure evidence

- TS2484 resolved: `SidebarResizableOptions` is a local declaration
  (`sidebar.tsx:56`) and is exported exactly once by the tail
  `export type { SidebarResizableOptions }`; no conflicting export remains.
- TS2375 resolved: `createBoundedDockResizableOptions` input fields
  `resolveSessionBounds` / `sessionHandleRef` are typed
  `NonNullable<SidebarResizableOptions[...]>` (`RightDock.tsx:211-212`).
- `/Users/anhpham99/.bun/bin/bun run --cwd apps/web typecheck` → PASS.
- Focused suites rerun sequentially → 19/19, 7/7, 19/19, 2/2 PASS.
- Root `bun fmt` → PASS; root `bun lint` → exit 0 (496 warnings, 0 errors).
- Root `bun typecheck` (Bun on PATH) → FAIL solely outside scope at
  `packages/contracts/src/piSubagents.test.ts` (in-progress Pi-subagents
  effort); not fixed or hidden by this issue.
- Contract files were not modified by the implementation or remediation
  rounds; no out-of-scope diff was produced by this issue. Other working-tree
  changes (including the rightdock contract planning files and Pi-effort
  files) were preserved untouched.

### Final verdict

`rejected`

Rejected solely for the TS2484 duplicate export at `sidebar.tsx` (declaration
and tail export), which has since been resolved. Criterion verdicts remain
PASS as recorded above. The verdict is intentionally not amended to
`approved`; with both compile blockers (TS2484, TS2375) resolved and the
verification evidence green, the candidate is ready for Supervisor final
acceptance.
