# Ticket 02 WP-GATE containment evidence

- Source candidate: `f0775f723` (`feat(whiteboard): add Ticket 02 public history gate`)
- Measurement provenance: clean source worktree at the candidate commit; no package or lockfile changes.
- Package: `@excalidraw/excalidraw@0.18.1` (installed package metadata verified as `0.18.1`).
- Browser: Playwright `1.58.2`, Google Chrome for Testing `145.0.7632.6`, Chromium headless shell.
- Host: macOS `26.4.1`, arm64.
- Commands:
  - `PATH="$HOME/.bun/bin:$PATH" bun run --cwd apps/web test -- src/components/whiteboard/ticket02/SynaraHistoryGate.test.ts`
  - `PATH="$HOME/.bun/bin:$PATH" VITEST_BROWSER_API_PORT=51217 bun run --cwd apps/web test:browser:stable -- src/components/whiteboard/ticket02/SynaraHistoryGate.acceptance.browser.tsx`
  - `PATH="$HOME/.bun/bin:$PATH" VITEST_BROWSER_API_PORT=51219 bun run --cwd apps/web test:browser:stable -- src/components/whiteboard/ticket02/SynaraHistoryGate.acceptance.browser.tsx`
- Raw browser output: `gate-browser.log` (clean-source runs A and B); independent copies were retained at `/tmp/ticket02-browser-clean-run-a.log` and `/tmp/ticket02-browser-clean-run-b.log` during measurement.

## Public runtime boundary

The candidate uses only the documented imperative surface:

- `getSceneElements`, `getAppState`, and `getFiles` for snapshots;
- `updateScene({ ..., captureUpdate: "NEVER" })` for progress and restore;
- `addFiles` before restore;
- `history.clear()` for native-history containment;
- official existing adapter restore/serialization/export seams.

The Ticket 02 runtime has no native-control locator, package selector, private ActionManager/History import, undocumented `canvasActions` key, package mutation, monkey patch, CSS suppression, or remount restore. Native control queries exist only in the browser test for accessible observation.

## Positive completed-batch trace

Unit Gate: 3/3 passed. Three progress calls (`sequence` 1, 2, 3) remain outside the event list, completion appends one event with `acceptedUpdateCount: 3`, Undo verifies the pre fingerprint before moving cursor `1 -> 0`, and Redo verifies the final fingerprint before moving cursor `0 -> 1`.

Browser Gate runs both reached the completed batch and the second keyboard-containment scenario passed. The first browser scenario also reached the exact semantic Undo/Redo checks before the containment assertion failed after a real package Delete mutation.

## Activation/containment matrix

| Scenario | Result | Evidence |
| --- | --- | --- |
| Initial native Undo/Redo accessible observation | PASS at the tested initial state | Browser test reaches `assertNativeControlsDisabledAndInert()` before the batch. |
| Three progressive AI updates | PASS | Native controls remained disabled at each checked progress boundary; event list stayed empty. |
| Synara toolbar Undo | PASS before containment failure | One toolbar input reached the Synara dispatcher and exact pre-state. |
| Synara toolbar Redo | PASS before containment failure | One toolbar input restored exact final state. |
| `Meta+Z` from canvas focus | PASS | Same dispatcher restored exact pre-state; no package intermediate checkpoint was observed. |
| `Meta+Shift+Z` from canvas focus | PASS in the second test | Same dispatcher restored exact final state. |
| Native pointer/focus/keyboard/accessibility matrix after human mutation | BLOCKED by first hard containment failure | The required disabled/inert assertion failed before continuing the matrix, as required by Decision 0051 D2/D8. |
| Native enabled-window check after real Delete | FAIL | Accessible native `Undo` was enabled (`disabled === false`, no `aria-disabled="true"`) after the adapter's public `history.clear()` containment point. |

## Cursor/fingerprint and human-capture result

- Three-progress event count: `0` before completion.
- Completed event count: `1`, cursor `1`.
- Toolbar Undo: cursor `1 -> 0`, semantic fingerprint matched pre-batch.
- Toolbar Redo: cursor `0 -> 1`, semantic fingerprint matched final batch.
- Canvas `Meta+Z`: cursor `1 -> 0`, semantic fingerprint matched pre-batch.
- The real package Delete mutation was observed after the adapter clear hook and produced one Synara human event in the harness. The subsequent native-control assertion failed because package-native Undo was still enabled.
- No remount was used; the adapter identity remained stable through the completed-batch and command checks.

## Verdict

Public `history.clear()` is insufficient to keep the package-native Undo control disabled/inert after a real human mutation. The permitted alternatives are unavailable under Decision 0051: runtime DOM/CSS suppression and private/undocumented package integration are forbidden, while `viewModeEnabled` disables human editing. This is a direct Decision 0051 D2 contradiction, not a repairable test issue within WP-GATE.

GATE VERDICT: FAIL
AC4 containment: FAIL
Completed three-progress batch: PASS
Broad Ticket 02 work: BLOCKED
Required next action: Supervisor bounded reassessment of Decision 0051 boundary
