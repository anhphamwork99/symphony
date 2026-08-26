# Ticket 02 bounded post-commit timing probe

Status: FAIL — public timing remediation exhausted
Date: 2026-08-26
Authority: [Decision 0052](../../decisions/0052-ticket-02-native-history-timing-probe.md)
Source candidate: `49c67988823efd5f71e3a1a7fb396df866de9a3d`

## Hypothesis

The original synchronous `api.history.clear()` may run before Excalidraw finishes recording the human mutation in native history. Decision 0052 authorized one bounded public-only test of that hypothesis.

The probe uses exactly:

1. the existing synchronous public `api.history.clear()` in the package `onChange` callback;
2. one `queueMicrotask` associated with that observed mutation;
3. one second public `api.history.clear()` inside that microtask;
4. deferred Synara settled-scene exposure until the second clear completes;
5. command consumption while native settlement is pending.

No timeout, debounce, polling loop, retry variant, native-control runtime query, private API, undocumented action key, DOM/CSS suppression, monkey-patching, remount, fork, or package change is used.

## Exact environment

- Package: `@excalidraw/excalidraw@0.18.1`.
- Browser: Google Chrome for Testing `145.0.7632.6` through the existing stable Playwright Chromium configuration.
- Host: macOS 26.4.1, arm64.
- Bun: 1.3.11.
- Clean detached source candidate: `49c67988823efd5f71e3a1a7fb396df866de9a3d`.
- Independent isolated browser port: `51223`.

## Verification

| Check                               | Result                                                 |
| ----------------------------------- | ------------------------------------------------------ |
| Frozen install                      | PASS; 2,887 packages                                   |
| Targeted formatting                 | PASS                                                   |
| Targeted lint                       | PASS; 0 errors and three pre-existing adapter warnings |
| Gate unit tests                     | PASS; 1 file and 3 tests                               |
| Decisive real-Chromium timing probe | Expected FAIL; 1 failed and 2 filtered/skipped         |
| Exact enabled-transition match      | PASS                                                   |
| Final clean worktree                | PASS                                                   |

## Observation protocol

The test installs a `MutationObserver` before the real package Delete mutation. It observes `disabled`, `aria-disabled`, child-list, and subtree changes for package-native Undo/Redo controls. Observation continues through the package mutation, synchronous clear, microtask clear, deferred settlement, a following browser task, one animation-frame opportunity, and another task.

The test records each observed native control state rather than checking only the final disabled state.

## Decisive trace

The worker probe and independent clean-source reproduction observed the same enabled transition. Independent trace:

```text
before:Undo:true:null
before:Redo:true:null
mutation:Undo:false:null
mutation:Redo:true:null
```

`mutation:Undo:false:null` means package-native Undo became enabled and lacked `aria-disabled="true"` during the required observation window.

The second public clear therefore did not prevent a native enabled transition. The no-transient-enabled-window invariant is violated regardless of whether a later state could return to disabled.

## Failure classification

Decision 0052 stop condition 1 is met: test-only observer evidence recorded native Undo becoming enabled during the window.

The failure is deterministic public-boundary evidence, not a test infrastructure error:

- exact package remains 0.18.1;
- unit coordinator proof remains green;
- formatting/lint pass;
- measurement source is clean;
- no prohibited integration was attempted;
- the exact enabled trace is present in the retained raw browser output.

Per Decision 0052, full WP-GATE and later Ticket 02 packages were not run after this definitive stop condition. A second scheduling strategy or timing variant is not authorized.

## Retained partial evidence

The previously implemented completed three-progress batch remains bounded research evidence:

- progressive updates create no intermediate Synara event;
- completion creates one Synara event;
- Synara Undo/Redo restore pre/final semantics;
- adapter identity remains stable.

It does not satisfy Ticket 02 while native human history remains a competing route.

## Irreducible owner decision

The accepted public-only 0.18.1 boundary is exhausted for this timing hypothesis. The human owner must choose among materially different directions:

1. change the pinned Excalidraw version and re-prove the integration boundary;
2. authorize fork, package patch, private/undocumented integration, or DOM-dependent suppression;
3. relax the sole-route/no-transient-native-availability requirement;
4. change the mixed human/AI Undo product model;
5. defer or remove Whiteboard under the current package boundary.

No agent may silently select one.

GATE VERDICT: FAIL
AC4: FAIL
AC7: FAIL
Broad Ticket 02 work: BLOCKED
Public timing remediation: EXHAUSTED
Required next action: human-owner boundary decision
