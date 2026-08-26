# Ticket 02 WP-GATE failure verification

Status: CONFIRMED GATE FAIL — SUPERVISOR REASSESSMENT REQUIRED
Date: 2026-08-26
Exact candidate: `cd69bc867d38f051f7cf6beebf06b12f60043ad6`
Source commit: `2d5103b60`
Evidence commit: `cd69bc867`

## Scope

This is a bounded hard-gate review under Decision 0051, not a feature-level final review. WP-CORE and every later Ticket 02 package remain unauthorized.

Reviewed paths:

- `apps/web/src/components/whiteboard/ticket01/SynaraExcalidrawAdapter.tsx`
- `apps/web/src/components/whiteboard/ticket02/**`
- `.planning/synara-whiteboard/evidence/ticket-02/gate-containment.md`
- `.planning/synara-whiteboard/evidence/ticket-02/gate-browser.log`
- `.planning/synara-whiteboard/evidence/ticket-02/gate-failure.md`

No package, lockfile, server, contracts, persistence, production navigation, or protected Agentation path is part of the Gate candidate.

## Verdict

The failure is reproducible and satisfies Decision 0051's hard-stop condition:

- the completed three-progress Synara event and exact Synara Undo/Redo proof passes;
- native history containment fails after a real human mutation;
- package-native Undo remains enabled after the adapter invokes public `api.history.clear()`;
- AC4 and AC7 therefore fail;
- broad Ticket 02 implementation must remain blocked.

## Direct verification

A fresh clean detached worktree at the exact evidence candidate was verified on isolated port `51221`:

| Check                                    | Result                            |
| ---------------------------------------- | --------------------------------- |
| Frozen install                           | PASS; 2,887 packages              |
| Focused Ticket 01 + Ticket 02 unit tests | PASS; 3 files, 19 tests           |
| Stable Chromium Gate                     | Expected FAIL; 1 passed, 1 failed |
| Exact failure match                      | PASS                              |
| Final worktree cleanliness               | PASS                              |

Observed Chromium failure:

```text
native history control Undo must stay disabled: expected false to be true
```

The failing assertion occurs after the real package Delete mutation. The control reports `disabled === false` and does not report `aria-disabled="true"`.

The worker's clean-source runs on isolated ports `51217` and `51219` reproduced the same failure. The independent run on `51221` provides a third reproduction.

## Completed-batch result

Before reaching the containment assertion, the candidate proves:

- three progressive states create no exposed history event;
- completed finalization creates exactly one Synara event;
- Synara toolbar Undo restores the pre-batch semantic snapshot;
- Synara toolbar Redo restores the final semantic snapshot;
- captured platform shortcut uses the Synara cursor;
- adapter identity remains stable; no remount occurs.

This partial success does not satisfy Ticket 02 because Decision 0051 requires one effective user-visible route for both human and AI history.

## Causal classification

The adapter's containment hook calls public `api.history.clear()` before exposing the observed scene change to the Ticket 02 harness. Despite that call, the package-native Undo control remains enabled after the human Delete.

The exact observed behavior contradicts Decision 0051 D2's required invariant that native controls never become active or invokable, including transiently, around human settlement.

This is not explained by:

- dependency drift — exact package is 0.18.1;
- dirty measurement state — the worktree is clean;
- missing unit behavior — the coordinator unit suite passes;
- Ticket 01 regression — Ticket 01 focused and Chromium regressions pass in the worker evidence;
- a private workaround attempt — none was made.

## Public-boundary audit

The Ticket 02 runtime uses:

- public scene/app/files reads;
- public `updateScene(... captureUpdate: "NEVER")`;
- public `api.history.clear()`;
- Synara-owned snapshots, coordinator, toolbar, and wrapper keyboard capture.

It does not use:

- private ActionManager or History;
- private package imports;
- undocumented `canvasActions.undo/redo` keys;
- native stack inspection;
- monkey-patching;
- runtime native-control selectors or DOM/CSS suppression;
- remount-based restore;
- package/version changes.

The existing Ticket 01 adapter has a document query used for its previously reviewed runtime asset-readiness diagnostic. It is not used by Ticket 02 history containment. Native-control discovery exists only in the Chromium test to observe the hard gate, which Decision 0051 permits.

## Evidence completeness

The full pointer/focus/programmatic/rapid/accessibility activation matrix was intentionally not continued after the first definitive hard failure. Decision 0051 requires stopping broad Gate work at that point. Additional activation attempts cannot convert an already-enabled native control into a PASS.

## Required disposition

```text
GATE VERDICT: FAIL
AC4: FAIL
AC7: FAIL
Broad Ticket 02 work: BLOCKED
Required next action: Supervisor bounded reassessment of Decision 0051 boundary
```

No Gate remediation is authorized within the accepted public boundary. The next action is a Supervisor Reassessment to decide whether the package/public integration boundary or product requirement must be escalated to the human owner.
