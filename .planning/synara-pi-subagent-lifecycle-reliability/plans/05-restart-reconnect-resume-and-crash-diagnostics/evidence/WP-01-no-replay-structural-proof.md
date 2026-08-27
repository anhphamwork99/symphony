# WP-01 — Structural no-replay proof (T05-AC6)

**Candidate SHA:** `7521b92c7cb8a614346f994e963aa379175f540b`
**Method:** source/import/caller/reference analysis of the frozen candidate (srcwalk caller traces + import inspection of the exact production files), cross-checked against executed test cases in the producer run (`WP-01-focused-deterministic.log`, `Test Files 9 passed (9)`, `Tests 118 passed (118)`, producer exit `0`). Comments are cited only as corroboration; every claim below rests on code structure (imports, call edges, gating order).

## 1. `reconcilePiSubagentExecutions` has no spawn, Resume, launcher, or delegation-dispatch dependency

- **Imports of `apps/server/src/provider/piSubagentRestartReconciliation.ts`** (whole-file import inspection): `effect`, `@synara/contracts` types, `../config.ts` bounds constants, `PiSubagentExecutionRepositoryShape` types, `PI_SUBAGENT_TERMINAL_SEQUENCE`, `truncateWithEllipsis`, `PiSubagentActiveChild` type, `isTerminalPiSubagentState`. There is **no import** of the resume coordinator, the admission/launch coordinator, the Agent launcher, the bridge dispatch, or any delegation module.
- **Effects written by the function body** (`piSubagentRestartReconciliation.ts:245-497`): `repository.listNonTerminalExecutions`, `recordHeartbeatObservation` (live-owner refresh), `listJournalEvents`, injectable `readTranscriptTerminal`, `getObservation` (lease mode), `recordTerminalEvent` (terminal restore), `recordOrphanedEvent` (owner-loss settle), and the `onDiagnostic` observer. No function value in the input contract (`ReconcilePiSubagentExecutionsInput`, :97-123) can launch: the only injectable behavioral seams are the read-only probe list and the terminal reader.
- **Caller trace (srcwalk, 25+ sites)**: production callers are exactly `makeServerProgram` (`apps/server/src/main.ts:610`) and `makeRealPiWsHarness` (`apps/server/src/provider/piSubagentRealPiAcceptanceHelpers.ts:1951`, test helper); every other caller is a test file. No launcher/spawn module calls it.
- **Corroborating executed test**: "T10-AC4: startup reconciliation performs no spawn, resume, or other side-effecting delegation replay" (`piSubagentRestartReconciliation.test.ts:310`).

## 2. Startup order is outbox recovery → no-owner teardown evidence → restart reconciliation, and never imports/invokes Resume

- **Production composition** (`apps/server/src/main.ts`, `makeServerProgram` startup block ~:580-636): (1) `recoverCompletionOutbox`; (2) `runPiSubagentProcessTeardown({ repository, dispatchOwnedTeardown: () => Promise.resolve(undefined), ... })` — the production startup dispatch is the **no-op endpoint**, so boot kills nothing (bounded band-78 `owner_unproven` evidence where band 74 still matches); (3) `reconcilePiSubagentExecutions({ repository, mode: "restart", summaryMaxChars })`. Comment + code agree: the reconciliation runs AFTER server liveness, owner-loss fence follows the journal-only no-owner evidence (Decision 0027).
- **Executed proof of order and idempotence**: "records no-owner teardown evidence before the Ticket-10 orphan fence" (`piSubagentStartupRecoveryOrder.test.ts:116`) asserts journal row counts for bands 74/75/78 (1 each), absence of proven/survivors rows, orphan generation 1→2, and a replay pass appending nothing and re-dispatching nothing (`dispatches` remains exactly `[execution.executionId]`).
- **`main.ts` never imports any Resume module**: its pi-subagent import set (`main.ts:72` region) includes `reconcilePiSubagentExecutions`, outbox recovery, teardown, watchdog sweeps — no `piSubagentResumeCoordinator` import exists in `main.ts` (import inspection; the only production importers of `piSubagentResumeCoordinator.ts` are `PiAdapter.ts` and the coordinator itself, per the import scan below).

## 3. Snapshot/card/cursor paths read projection/replay state only

- `makeCursorSafeSnapshotLiveStream` input surface (`wsSnapshotLiveStream.ts`, exercised at `wsSnapshotLiveStream.test.ts:14-18`): `subscribeLive`, `snapshot`, `snapshotSequence`, `getHighWaterSequence`, `resumeFromSequence`, `resumeSubjectExists`, `replay`, `onResnapshotRequired`. **No repository-write, admission, launcher, or provider-dispatch parameter exists** — the module structurally cannot create work; its only outputs are stream items and the `ORCHESTRATION_RESNAPSHOT_REQUIRED` demand (executed: `:288-324`).
- Execution-card reads in `piSubagentExecutionCardSurface.test.ts` go through `system.repository.getExecutionCard` / `readThreadEvents(threadId, fromSequenceExclusive, THREAD_DETAIL_EVENT_TYPES)` — pure read/event-projection calls; the card write paths exercised there (`recordTeardownOutcome` 77/78 publication rows) are the Ticket-03/16 evidence seams driven explicitly by tests, not by reconnect. Publication of committed card events is journal-accounted (`"already_applied and stale_generation teardown outcomes publish NOTHING"`, `:742`).
- Zero work creation is the executed outcome: no reconnect/cursor/snapshot test in the invocation observes any new attempt, generation, seq-80 row, admission, or launch (AC1 matrix row).

## 4. Watchdog and cleanup modules do not import or invoke Resume

- **`piSubagentWatchdogEscalation.ts` import list** (whole-file inspection): `effect`, contracts types, `../config.ts` retry bound, `PiSubagentExecutionRepositoryShape` type, `piSubagentBridge.ts` types, `cancelParentTurnScope` (from the cancellation coordinator), `isTerminalPiSubagentState`. **No Resume import.** Its repository writes are band 70–74 stage records, diagnostic rows, and settlement through the normal terminal lifecycle; escalation ends in the band-74 teardown handoff (executed: "T15-AC6 … hands the owned execution to the process-teardown stage", `piSubagentWatchdogEscalation.test.ts:549`).
- **`piSubagentProcessTeardown.ts` import list**: contracts types, `effect`, repository shape types, `isTerminalPiSubagentState`, `PI_SUBAGENT_WATCHDOG_BAND`. **No Resume import.** Dispatch goes only through the injected `dispatchOwnedTeardown` endpoint, and proof settles only via `recordTeardownOutcome` band 76.
- **`piSubagentRestartReconciliation.ts`**: the token "resume" appears only in comments and the owner-loss diagnostic message ("the execution was not automatically replayed", "Resume of an orphaned execution is explicit user action") — zero code references (whole-file scan).
- Executed guards: "T14-AC3: reconciliation NEVER resumes — restart reconciliation orphans without creating a new attempt, and resume is the only exit" and "T14-AC3: public command-surface audit — startup/reconciliation/sweep surfaces contain no resume dispatch (explicit-only)" (`piSubagentResumeCoordinator.test.ts:651, 716`) — the audit case inspects the actual public command surfaces for resume dispatch and passes only because none exists.

## 5. The sole production Resume consumer is the explicit ProviderService → PiAdapter path

- **Import scan**: production (non-test) files importing `piSubagentResumeCoordinator.ts` = exactly `apps/server/src/provider/Layers/PiAdapter.ts` (+ the coordinator module itself).
- **Caller trace of `resumePiSubagentExecution` (coordinator)**: production callers = `PiAdapter.resumePiSubagentExecution` (`PiAdapter.ts:5374`, invoking `resumePiSubagentExecutionCoordinator` at `:5423`) and `ProviderService.resumePiSubagentExecution` (calling `routed.adapter.resumePiSubagentExecution` at `ProviderService.ts:2374`). `ProviderService.resumePiSubagentExecution`'s only production caller is `processPiSubagentExecutionResumeRequested` (`ProviderCommandReactor.ts:2914`), dispatched from the explicit domain event `thread.pi-subagent-execution-resume-requested` (`ProviderCommandReactor.ts:2891`, case at `:3707-3708`). Every other caller site is a test.
- Therefore the complete production Resume chain is: explicit command → ProviderCommandReactor → ProviderService → PiAdapter → coordinator. No startup, hydration, reconnect, watchdog, reconciliation, teardown, or outbox path reaches it (points 1–4).

## 6. Provider-inactive denial precedes adapter/coordinator access

- `ProviderCommandReactor` first rejects an absent/stopped bound session at
  `ProviderCommandReactor.ts:2901-2911` with
  `provider.subagent-execution.resume.failed` and
  `No active provider session is bound to this thread.`, before its sole
  ProviderService call at `:2913-2917`.
- If the runtime becomes inactive after that reactor check,
  `ProviderService.resumePiSubagentExecution` resolves it with
  `allowRecovery: false` at `ProviderService.ts:2357-2361` (no recovery
  reconstruction, hence no provider bootstrap); on `!routed.isActive` it
  returns the validation error
  `Cannot resume subagent execution '<executionId>' because the provider runtime is not active.`
  at `:2362-2366`, before the adapter-capability check at `:2368-2372` and
  before `routed.adapter.resumePiSubagentExecution` at `:2374`. In both
  inactive cases the adapter is unreachable, so the coordinator (reachable
  only through the adapter, point 5) cannot execute, persist sequence 80, mint
  an attempt, or invoke a launcher.
- Structural no-bootstrap: `allowRecovery: false` makes inactive-state recovery impossible in this operation, so the inactive denial can never be converted into a bootstrap or replay.
- Corroborating executed surface: the gate-denial family ("T14-AC4" cases at `piSubagentResumeCoordinator.test.ts:405/437/457/558/606`) proves every denial returns before `recordResumeEvent`/`launchChildAttempt` (zero attempts/children asserted).

## Conclusion

All six structural claims hold on the frozen candidate `7521b92c7cb8a614346f994e963aa379175f540b`:

1. Reconciliation is read-evidence + guarded durable writes with no dispatch capability in its contract or imports.
2. Production startup runs outbox → no-owner teardown evidence (no-op dispatch endpoint) → reconciliation, importing no Resume module.
3. Snapshot/card/cursor surfaces are structurally read-only with respect to work creation.
4. Watchdog and teardown import no Resume module and end in handoff/proof seams, never child creation.
5. The only production Resume consumer is the explicit command chain through ProviderService → PiAdapter.
6. The provider-inactive denial precedes adapter/coordinator access and cannot bootstrap.

No automatic replay or Resume path exists in any startup, hydration, reconnect, watchdog, reconciliation, or cleanup route. Producer exit 0 over the nine-file serialized invocation (`WP-01-focused-deterministic.log`).
