# Ticket 02 WP-GATE failure

## Reproduction

Source candidate `f0775f723` was measured from a clean worktree with exact `@excalidraw/excalidraw@0.18.1` in real Chromium. The stable browser Gate was run twice on isolated API ports `51217` and `51219`:

```text
PATH="$HOME/.bun/bin:$PATH" VITEST_BROWSER_API_PORT=51217 bun run --cwd apps/web test:browser:stable -- src/components/whiteboard/ticket02/SynaraHistoryGate.acceptance.browser.tsx
PATH="$HOME/.bun/bin:$PATH" VITEST_BROWSER_API_PORT=51219 bun run --cwd apps/web test:browser:stable -- src/components/whiteboard/ticket02/SynaraHistoryGate.acceptance.browser.tsx
```

Both runs reproduce the same failure after a real package `Delete` mutation:

```text
AssertionError: native history control Undo must stay disabled: expected false to be true
at assertNativeControlsDisabledAndInert (...SynaraHistoryGate.acceptance.browser.tsx:66:6)
... (...SynaraHistoryGate.acceptance.browser.tsx:142:4)
```

Observed native `Undo`: `disabled === false` and `aria-disabled` was not `true`. The candidate had already invoked only public `api.history.clear()` from the adapter's scene-change containment hook. Therefore the package-native control remained enabled/reachable after human mutation, violating the no-transient-enabled-window and inertness requirements.

Environment: macOS `26.4.1`, arm64; Playwright `1.58.2`; Google Chrome for Testing `145.0.7632.6`; package `0.18.1`. The raw logs are in `gate-browser.log`.

## Scope decision

The completed three-progress batch itself passed the unit Gate and reached exact semantic Undo/Redo before the containment assertion. The second browser scenario covering canvas `Meta+Z` and `Meta+Shift+Z` passed. Broad Ticket 02 work was stopped immediately at the first hard containment failure; the remaining pointer/focus/programmatic/rapid/accessibility matrix was not run after the failure.

No private/internal API, undocumented action key, package mutation, DOM/CSS suppression, monkey patch, or remount workaround was attempted. The failure is a direct contradiction in the accepted public-only boundary: public `history.clear()` does not make the native route inert after a real human mutation, while the forbidden alternatives are the only apparent containment mechanisms and `viewModeEnabled` also disables human editing.

GATE VERDICT: FAIL
AC4: FAIL
AC7: FAIL
Broad Ticket 02 work: BLOCKED
Required next action: Supervisor bounded reassessment of Decision 0051 boundary

## Decision 0052 timing-remediation result

Decision 0052 authorized one bounded event-driven timing probe: synchronous public `history.clear()`, followed by one `queueMicrotask` public clear before exposing settled human state.

Clean source candidate `49c67988823efd5f71e3a1a7fb396df866de9a3d` reproduced a transient native Undo enablement after the real Delete:

```text
before:Undo:true:null
before:Redo:true:null
mutation:Undo:false:null
mutation:Redo:true:null
```

The observer started before Delete and remained active through both clears, settlement, a later browser task, an animation frame, and another task. Native Undo becoming enabled at any point satisfies Decision 0052's immediate stop condition.

No second timing variant, delay, poll, retry, private API, undocumented option, DOM/CSS suppression, package mutation, remount, fork, or version change was attempted.

GATE VERDICT: FAIL
AC4: FAIL
AC7: FAIL
Broad Ticket 02 work: BLOCKED
Public timing remediation: EXHAUSTED
Required next action: human-owner boundary decision
