# Ticket 09 Independent Review — Per-thread Completion Coordinator

- **Review date:** 2026-08-18
- **Candidate (Symphony):** `98b9e990`, `b4a9295b`, `80cfafa1`,
  `4fa55929`, `2c1b8d7f`, `86052771`
- **Candidate (Alfie):** `489acd6264eeedbb1a84e2ba2295af8d1b766b3b`
  (`@alfie/pi-subagents@0.14.0-alfie.1`)
- **Review type:** independent feature-level review
- **Verdict:** **PASS**, confidence **HIGH**

The reviewer completed the criterion review and returned PASS/HIGH with
findings F1–F4. The first response body was lost after late background-job
echoes; a recovery run independently reproduced the evidence below before an
upstream 429 interrupted report writing. This artifact preserves the completed
review verdict, recovered command evidence, source inspection, and the
findings requiring final-acceptance disposition.

## 1. Verdict table

| Criterion | Independent evidence | Verdict |
|---|---|---|
| **T09-AC1** | Coordinator opens one per-thread window, caps each batch, and carries bounded summaries, execution identities, and stable outbox IDs. Unit acceptance reproduced 10/10, including two in-window completions → one follow-up, immediate window `0`, and overflow → later batch. | **PASS** |
| **T09-AC2** | `outstanding` prevents a second follow-up on the same thread; later completions wait until settlement. Thread scans are filtered by `parentThreadId`. Unit evidence covers waiting bursts and independent threads. | **PASS** |
| **T09-AC3** | `isParentBusy` is the sole delivery gate; busy deferral changes no durable delivery state and consumes no retry attempt. `onParentTurnSettled` releases the parked thread. Real-Pi acceptance proves delivery at a live safe boundary. | **PASS** |
| **T09-AC4** | Entries are generation-fenced and marked delivered before dispatch; explicit dispatch rejection/failure returns them to `failed_retryable`, increments bounded attempt accounting where applicable, and never mutates execution outcome. Unit evidence covers failure → retry → acknowledgement, retry exhaustion, and prompt rejection before running. F1 records the remaining process-crash window for Supervisor disposition. | **PASS** |
| **T09-AC5** | Alfie suppresses the legacy nudge only after the host-advertised ownership capability and successful terminal-observation acknowledgement. Timeout, older host, or persistence rejection retains the unchanged legacy path. Real-Pi mixed-version acceptance reproduced 2/2; Alfie suites reproduced 29/29. | **PASS** |
| **T09-AC6** | Repository fencing supersedes stale entries before a parent effect; no follow-up is sent, while terminal/outbox evidence remains readable by identity. Unit supersession scenario passed. | **PASS** |

## 2. Source inspection

- Per-thread bounded batching and one-outstanding semantics are explicit in
  `apps/server/src/provider/piSubagentCompletionCoordinator.ts:24-31`,
  `:252-256`, `:400-417`, and `:488-494`.
- Busy-parent deferral occurs before any delivery-state write at
  `piSubagentCompletionCoordinator.ts:281-285`; settlement re-enters delivery
  through `onParentTurnSettled`.
- Generation-fenced journal-first dispatch marks each entry delivered at
  `piSubagentCompletionCoordinator.ts:295-333`, builds the bounded accepted
  batch, then invokes the parent boundary at `:340-344`.
- Explicit dispatch failure clears the in-memory outstanding slot, records
  retryable delivery failure, and schedules a bounded retry at
  `piSubagentCompletionCoordinator.ts:348-386`.
- Follow-up settlement acknowledges a turn that ran, or returns a rejected
  pre-run turn to retryable state, at
  `piSubagentCompletionCoordinator.ts:432-478`.
- The two coordinator `Effect.runPromise` programs have framing-level rejection
  containment from `86052771`; internal failures remain handled through
  `Effect.result` and diagnostics instead of leaking host-process unhandled
  rejections.
- `PiAdapter` constructs one adapter-lifetime coordinator, derives busy state
  from the live session's `activeTurnId`, and sends one bounded
  `session.prompt` follow-up carrying the outbox identity. Post-commit
  `onTerminalPersisted` routes negotiated ownership sessions to the
  coordinator and dispositions legacy sessions as legacy-owned. SDK
  `message_end` and prompt rejection are the corresponding settle paths.
- `listRecoverableCompletionOutbox` accepts a `parentThreadId` filter over the
  existing thread index; retry selection remains `pending` plus
  within-budget `failed_retryable` entries. No coordinator delivery method
  updates the execution aggregate.
- `config.ts` and `main.ts` resolve and wire
  `SYNARA_PI_SUBAGENT_COMPLETION_BATCH_WINDOW_MS`; the coordinator receives
  both that value and the Ticket 08 completion retry limit.
- Contracts and the bridge offer/accept the additive
  `completion-delivery-ownership` capability. Older extensions remain
  compatible because it is optional.
- Alfie `src/index.ts:810-876` uses the terminal reporter promise as the
  ownership acknowledgement only when the host offered the capability.
  A five-second race bounds the wait; rejection/timeout invokes
  `emitLegacyCompletionNotification`. Comparison with `608c1c57d` confirmed
  the extracted legacy flow retains `resultConsumed`, pending batch,
  `groupJoin`, individual nudge, and widget-update behavior.

## 3. Independently reproduced verification

All real-Pi/wallclock commands used the Decision 0008 environment:
`env -i PATH="$HOME/.bun/bin:$PATH" HOME="$HOME"`.

- `apps/server: bun run vitest run src/provider/piSubagentCompletionCoordinator.test.ts`
  — **10/10 passed**.
- `apps/server: bun run vitest run src/provider/piSubagentCompletionOwnershipAcceptance.test.ts`
  — **2/2 passed** (managed `0.14.0-alfie.1` and detached legacy
  `608c1c57d` worktree).
- `apps/server: bun run vitest run src/provider/piSubagentCompletionOutbox.test.ts`
  — **11/11 passed**.
- `apps/server: bun run vitest run src/persistence/Layers/PiSubagentExecutionRepository.test.ts`
  — **12/12 at the reviewed baseline**; the later recovery run observed
  concurrent Ticket 13 working-tree additions and excluded those unrelated
  tests from the Ticket 09 verdict.
- `apps/server: bun run vitest run src/main.test.ts` — **40/40 passed**.
- `apps/server: bun run vitest run src/persistence` — **52 files / 219 tests
  passed** during the recovery run.
- Per-file standalone wallclock regressions:
  TerminalAcceptance **2/2**, RealExtension **11/11**,
  IntegratedAcceptance **7/7**, CancellationAcceptance **2/2**,
  ProgressAcceptance **1/1**, ForegroundReopen **1/1**,
  ForegroundLifecycle **5/5**, RestartAcceptance **1/1**.
  ForegroundAcceptance had one timing-sensitive AC6 failure on the first
  recovery invocation, then passed **6/6** in three consecutive standalone
  reruns; see F3/M2.
- Alfie:
  `bun run vitest run test/managed-terminal.test.ts test/synara-bridge.test.ts`
  — **2 files / 29 tests passed** (`managed-terminal` 7/7,
  `synara-bridge` 22/22).
- Provenance:
  Alfie HEAD was
  `489acd6264eeedbb1a84e2ba2295af8d1b766b3b`; the reviewed manifest matched
  the pinned package/source artifacts. The extension acceptance suite also
  verifies provenance before exercising the real package.
- Implementer final verification, independently consistent with criterion
  runs: workspace formatting passed; lint **0 errors** (529 warnings);
  seven-package typecheck **7/7**; full workspace tests **381 files /
  4,603 passed / 0 failed / 17 skipped**.

## 4. Findings and dispositions

### F1 — LOW: delivered-before-effect crash can strand an unacknowledged entry

The coordinator persists `delivered` before calling `sendFollowUp`. A process
crash after that transition but before the prompt reaches the parent leaves a
`delivered`/unacknowledged row. The recoverable scan selects only `pending` and
within-budget `failed_retryable`; Ticket 10 restart reconciliation does not
redrive `delivered` rows. Thus the current ordering has a narrow lost-effect
window, not the report's stated “dispatch then delivered-mark” duplicate window.

**Disposition recommendation:** Supervisor must explicitly settle this before
final acceptance. Preferred remediation is a durable dispatch lease/claim that
can be recovered after owner loss, or a narrowly defined recovery rule for
`delivered`-unacknowledged entries using the stable outbox ID as effect key.
Do not weaken the one-outstanding invariant or rewrite execution outcome.
Because normal dispatch failures are correctly retryable and all criteria
otherwise pass, the independent verdict remains PASS with this residual
crash-consistency issue recorded.

### F2 — LOW: Implementation Report reverses the actual crash ordering

The pre-review disclosure says a crash “between follow-up dispatch and the
`delivered` mark” may redeliver. Source does the opposite: durable
`delivered` transition precedes `sendFollowUp`.

**Disposition recommendation:** correct the report wording on the next planning
touch and align it with F1's actual lost-effect window. This is documentation,
not a separate runtime defect.

### F3 — INFO: wallclock evidence remains method-sensitive

One recovery invocation of ForegroundAcceptance AC6 observed a terminal child
where the timing assertion expected detached; three immediate standalone reruns
passed 6/6. This is the already-governed Decision 0008 harness sensitivity, not
a Ticket 09 behavior failure.

**Disposition recommendation:** retain per-file standalone invocation with the
clean environment as mandatory acceptance evidence. Do not combine these files
or widen the accepted timing envelope without re-adjudication.

### F4 — INFO: settle attribution is thread-level, not prompt-ID-level

The outstanding batch is acknowledged on parent `message_end`. A user turn
racing after dispatch can provide the first safe settlement signal. The
follow-up content has already been submitted, and the signal only releases the
next batch; tests demonstrate no concurrent second follow-up or duplicate live
content.

**Disposition recommendation:** accept the disclosed semantic boundary for
Ticket 09. A future provider API exposing prompt/turn correlation should
prefer exact attribution, but this does not fail T09-AC2 or T09-AC4.

## 5. Method observations

- **M1:** Criterion-level unit and real-Pi tests directly cover all six
  acceptance criteria and both managed/legacy ownership paths.
- **M2:** Decision 0008's per-file standalone wallclock command and clean
  environment are part of the evidence contract; aggregate invocation is not
  an equivalent substitute.
- **M3:** The second evidence-recovery run overlapped unrelated Ticket 13
  working-tree edits. Failures originating exclusively in those uncommitted
  additions were excluded; committed Ticket 09 surfaces and focused suites
  remained green.
- **M4:** Late background-job notifications repeated already-consumed command
  outputs and did not change any criterion verdict.

## 6. Final review conclusion

**PASS — HIGH confidence.** T09-AC1 through T09-AC6 are satisfied by the
committed candidate and independently reproduced evidence. There is no
execution/delivery-state coupling, stale completion effect, mixed-version
double notification, or active-parent interruption in the reviewed paths.

Final acceptance should explicitly disposition F1's narrow
`delivered`-before-effect crash window and record F2's wording correction.
F3 and F4 are informational constraints, not acceptance blockers.
