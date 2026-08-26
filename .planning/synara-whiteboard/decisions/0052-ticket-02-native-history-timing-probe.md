# Decision 0052: Reassess Ticket 02 native-history containment after reproducible WP-GATE timing failure

Status: Binding — Decision 0051 narrowly amended for one remediation probe
Date: 2026-08-26
Trigger: Material new evidence / Reassessment
Prior decision disposition: Decision 0051 remains binding except for one bounded public-only post-commit timing probe
Reopens Decisions 0047, 0048, or 0050: No

## Question

After real stable Chromium reproducibly showed package-native Undo enabled following a human Delete, even though the adapter synchronously invoked public `api.history.clear()` before exposing `onSceneChange`, does the accepted public integration boundary permit one bounded timing-remediation probe, or must Ticket 02 immediately escalate to the human owner for a package, integration-boundary, or product-contract change?

## Governing references

### Authoritative

1. `.planning/synara-whiteboard/PROJECT.md`
2. `.planning/synara-whiteboard/issues/02-prove-ai-batch-undo-redo.md`
3. `.planning/synara-whiteboard/PRODUCT-CONTRACT.md`
4. `.planning/synara-whiteboard/spec.md`
5. `.planning/synara-whiteboard/decisions/0051-ticket-02-exact-batch-history-direction.md`
6. `.planning/synara-whiteboard/plans/02-exact-ai-batch-undo-redo.md`
7. `.planning/synara-whiteboard/decisions/0050-ticket-01-final-acceptance-hold-removed.md`
8. `.planning/synara-whiteboard/decisions/0048-ticket-01-excalidraw-feasibility-boundary.md`
9. `.planning/synara-whiteboard/decisions/0047-testing-strategy-governance-reassessment.md`

### Current evidence

1. Gate source `2d5103b60`.
2. Candidate/evidence `cd69bc867`.
3. Independent review `a591ef956`.
4. `.planning/synara-whiteboard/evidence/ticket-02/gate-containment.md`.
5. `.planning/synara-whiteboard/evidence/ticket-02/gate-browser.log`.
6. `.planning/synara-whiteboard/evidence/ticket-02/gate-failure.md`.
7. `.planning/synara-whiteboard/reviews/ticket-02-gate-failure-review.md`.
8. Independent logs under `/tmp/synara-whiteboard-ticket02-gate-independent/`.

## Exact evidence finding

High-confidence facts:

1. Exact Excalidraw 0.18.1 was exercised in real stable Chromium.
2. Worker runs on ports `51217` and `51219`, plus independent clean-worktree run on `51221`, reproduced the same failure.
3. After a real package Delete mutation, native Undo reported `disabled === false` and no `aria-disabled="true"`.
4. Before the Synara observer received the scene change, the adapter synchronously invoked only documented public `api.history.clear()`.
5. Synchronous clear at the current package `onChange` point does not maintain Decision 0051's native-inertness invariant.
6. AC4 and AC7 are currently **FAIL**.
7. Broad WP-CORE and later work was correctly stopped.
8. No private API, undocumented action key, runtime DOM/CSS suppression, package mutation, monkey-patching, remount, fork, or version change was attempted.

The failure is not explained by dependency drift, dirty measurement state, coordinator unit failure, or Ticket 01 regression.

Unconfirmed causal hypothesis: Excalidraw may record or publish the human mutation into native history after invoking host `onChange`, causing synchronous clear to occur before the relevant native-history commit.

The evidence does not establish internal scheduling order and does not yet prove that a later public `history.clear()` is incapable of containment. That remaining uncertainty is narrow and publicly observable.

## Decision 0051 disposition

Decision 0051 remains binding except for the one probe authorized here.

The following are unchanged:

- Synara owns the single user-visible session history.
- Native history is containment-only.
- Native controls may not become active or invokable, including through a user-reachable transient window.
- Native keyboard may not compete with the Synara dispatcher.
- Human capture must remain reliable.
- Runtime integration is public-only.
- Broad work requires complete WP-GATE PASS.
- Decisions 0047, 0048, and 0050 remain accepted.

## Binding verdict

Exactly one bounded public-only post-commit native-history-clear probe is authorized.

This remains inside the accepted boundary because it uses the same public API, tests a previously identified timing risk, does not change package/product outcomes, preserves the no-transient requirement, and is isolated and reversible.

The authorization is consumed by one implementation-and-measurement attempt. Repeated timing variants, open-ended scheduler experiments, or trying delays until green are not authorized.

## Exact allowed write set

```text
apps/web/src/components/whiteboard/ticket01/SynaraExcalidrawAdapter.tsx
apps/web/src/components/whiteboard/ticket02/ExcalidrawTicket02Harness.tsx
apps/web/src/components/whiteboard/ticket02/SynaraHistoryTypes.ts
apps/web/src/components/whiteboard/ticket02/SynaraSessionHistory.ts
apps/web/src/components/whiteboard/ticket02/SynaraHistoryCommands.ts
apps/web/src/components/whiteboard/ticket02/SynaraHistoryGate.test.ts
apps/web/src/components/whiteboard/ticket02/SynaraHistoryGate.acceptance.browser.tsx
.planning/synara-whiteboard/evidence/ticket-02/gate-containment.md
.planning/synara-whiteboard/evidence/ticket-02/gate-browser.log
.planning/synara-whiteboard/evidence/ticket-02/gate-failure.md
.planning/synara-whiteboard/evidence/ticket-02/gate-timing-probe.md
```

Coordinator/type/command changes are allowed only when strictly necessary to represent bounded pending-human-settlement or deterministic settle-or-consume behavior. They may not implement deferred WP-CORE outcomes, assets, 20-event history, general human grouping, or unrelated failure architecture.

No package/lock, browser configuration, server, shared contract, persistence, production navigation, RightDock, or later-ticket path is authorized.

## Allowed techniques

The probe may use:

1. Public `api.history.clear()` as the only native-history mutation.
2. Public `onChange` and existing public scene/app/file reads.
3. One bounded host-owned post-commit settlement handshake using standard browser/React scheduling primitives.
4. At most the existing synchronous clear and one deterministic post-commit clear for the same human mutation.
5. Deferral of settled human-event exposure until the handshake completes.
6. Wrapper capture that consumes Synara commands while settlement is pending.
7. Deterministic settle-before-command behavior when possible, otherwise command consumption without scene mutation.
8. Test-only accessible native-control queries, `MutationObserver`, activation attempts, and scene/cursor/fingerprint observation.
9. Existing real stable Chromium configuration on isolated ports.
10. Focused unit tests for pending settlement, duplicate callbacks, one-human-event capture, and settle-or-consume commands.

Implementation must be event-driven and bounded. Arbitrary sleeps, guessed debounce intervals, continuous timers, runtime polling, or retries are not acceptable containment contracts.

Runtime code may not inspect native button state. Native-control state remains test-only evidence.

## Required decisive probe

Use the same real human Delete scenario.

Observation begins before Delete and continues through:

1. package mutation;
2. every observed participating `onChange`;
3. synchronous clear;
4. bounded post-commit clear;
5. settled Synara event exposure;
6. at least the next browser task and animation-frame opportunity after settlement.

The test installs its native-control observer before mutation and retains evidence capable of detecting an enabled transition even if the control later returns to disabled.

During the window, attempt:

- captured platform Undo/Redo shortcuts;
- rapid repeated shortcuts around settlement;
- native pointer activation;
- focus plus keyboard activation;
- programmatic browser activation;
- available accessibility-equivalent activation.

Also prove:

- exactly one Synara human event;
- Delete remains applied after settlement;
- Synara Undo restores exact pre-Delete semantics;
- Synara Redo restores exact post-Delete semantics;
- one input invokes dispatcher at most once;
- native action changes neither scene nor cursor;
- no AI checkpoint becomes reachable;
- stable adapter identity and no remount;
- no uncaught or suppressed clear failure.

If the Delete probe passes, the same candidate reruns the complete original WP-GATE matrix, including canvas focus, text-edit focus, representative pointer interaction, keyboard mutation, rapid activation, and human-capture-after-clear. Delete alone does not pass the Gate.

## Stop conditions

Stop and preserve failure immediately if:

1. MutationObserver or equivalent records native Undo/Redo enabled or accessibly invokable at any point.
2. Native pointer, keyboard, programmatic, or accessibility activation mutates the scene.
3. Package keyboard competes with Synara dispatcher.
4. One shortcut reaches both routes or moves cursor more than once.
5. Human mutation is lost, duplicated, incorrectly grouped, or exposed before containment settles.
6. Final scene differs from intended mutation.
7. Result depends on arbitrary delay, retries, timing luck, headless-only behavior, or unbounded wait.
8. Result is flaky across isolated stable-Chromium repetitions.
9. Runtime selector/DOM/CSS suppression, private API, undocumented key, stack inspection, package mutation, monkey-patch, remount, fork, or version change becomes necessary.
10. The bounded second clear still leaves native Undo enabled or invokable.
11. Full Gate regression fails after a narrow Delete success.

After any stop condition:

```text
GATE VERDICT: FAIL
AC4: FAIL
AC7: FAIL
Broad Ticket 02 work: BLOCKED
Public timing remediation: EXHAUSTED
Required next action: human-owner boundary decision
```

No second timing-remediation attempt is authorized without materially different public evidence and a new Reassessment.

## Current status

```text
WP-GATE: FAIL — REMEDIATION PROBE AUTHORIZED
AC4: FAIL
AC7: FAIL
Completed three-progress batch: PASS as partial evidence only
Ticket 02: BLOCKED
WP-CORE and later work: NOT AUTHORIZED
Project frontier: Ticket 02 remains current
```

The probe authorization does not convert AC4/AC7 to pending or pass. They remain failed until the exact remediation candidate passes the complete Gate.

## Passing completed-batch code

The completed-batch implementation remains valid bounded partial evidence:

- three progressive updates create no intermediate Synara event;
- completion appends one Synara event;
- Synara Undo restores pre-batch semantics;
- Synara Redo restores final semantics;
- captured shortcuts use Synara cursor;
- adapter identity remains stable.

It need not be rolled back, is not Ticket completion, and may change only as strictly necessary for the bounded handshake. All claims rerun on the remediation candidate.

## Prohibition continuity

All Decision 0048/0051 prohibitions continue:

- no fork/patch/version/lock change;
- no private History/ActionManager or private imports;
- no native-stack inspection;
- no undocumented `canvasActions.undo/redo` keys or casts to inject them;
- no monkey-patching;
- no runtime native-control DOM queries;
- no selector/class/button-order/CSS suppression;
- no remount restore;
- no mock editor as browser proof;
- no weakening of no-transient invariant;
- no broad implementation before Gate PASS.

## Rejected alternatives

- Concluding the entire public boundary impossible before testing the narrow post-commit hypothesis.
- Proceeding to WP-CORE because completed AI Undo/Redo passed.
- Allowing brief native availability because wrapper shortcuts are captured.
- Fixed timeout or repeated delayed clears.
- DOM/CSS hiding.
- Changing package, fork, or product behavior before exhausting the one public hypothesis.
- Running later Ticket matrix during the probe.

## Failure, rollback, and owner escalation

The probe is isolated and reversible. On failure, retain completed-batch work only as research evidence and do not route into WP-CORE.

The human owner must then choose among materially different boundaries:

1. change the pinned Excalidraw version and re-prove integration;
2. authorize fork/patch/private/undocumented/DOM-dependent integration;
3. relax the sole-route/no-transient requirement;
4. change the mixed human/AI Undo product model;
5. defer or remove Whiteboard under the current package boundary.

No agent may silently choose among them.

## Downstream authorization

After this record is persisted and tracked:

- one worker may perform the bounded probe within the exact write set;
- focused Gate tests and stable Chromium evidence are authorized;
- independent bounded Gate review is required afterward;
- broad Ticket 02 remains prohibited.

Only complete independently verified Gate PASS authorizes CHECKPOINT-GATE and WP-CORE.

## Reassessment conditions

Reassess if the bounded probe passes complete Gate; hits any stop condition; materially new official evidence establishes a supported boundary; exact behavior differs in another required environment; owner changes package/integration/product model; or the scheduling primitive proves unreliable/unbounded.
