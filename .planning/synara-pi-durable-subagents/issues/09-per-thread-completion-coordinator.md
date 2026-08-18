# 09 — Per-thread completion coordinator

**What to build:** Completion delivery is coordinated per parent thread.
Near-simultaneous managed child completions form one bounded follow-up, at most
one unacknowledged follow-up exists per thread, and a busy parent defers delivery
until no active parent turn remains. Legacy completion nudges are suppressed
only after Synara acknowledges ownership for that managed execution.

**Blocked by:** 08 — Durable completion outbox.

**Status:** ready-for-agent → **implemented (awaiting review)**

- [x] **T09-AC1:** Completions for one parent thread inside the configured
      batching window produce one follow-up containing bounded summaries and
      execution identities.
- [x] **T09-AC2:** A thread has at most one pending or unacknowledged managed
      follow-up; later bursts wait or join a later batch.
- [x] **T09-AC3:** Delivery occurs only when the parent has no active turn, or
      after the active turn's terminal lifecycle is durable; user-read state is not
      a delivery gate.
- [x] **T09-AC4:** Delivery failure remains retryable and cannot duplicate
      follow-up content or change execution outcomes.
- [x] **T09-AC5:** Legacy extension notification remains active until Synara has
      acknowledged completion-delivery ownership for that execution.
- [x] **T09-AC6:** Superseded delivery entries create no follow-up effects, and
      their execution results remain retrievable by identity.

## Implementation Report

**Implementation state:** implemented — awaiting independent feature review

### Delivered scope

Per-thread completion coordination on top of the Ticket 08 durable outbox,
plus the Alfie ownership-acknowledgement gate. Symphony commits `98b9e990`,
`b4a9295b`, and the acceptance/re-pin commit; Alfie commit `489acd626`
(`@alfie/pi-subagents@0.14.0-alfie.1`, new capability
`completion-delivery-ownership`, provenance manifest re-pinned with
recomputed SHA-256 for `package.json` + `src/index.ts`; `agent-manager.ts`
unchanged).

- **Per-thread completion coordinator**
  (`piSubagentCompletionCoordinator.ts`): the Decision 0013 F3 production
  consumer of the outbox. Bounded per-thread batching window
  (`SYNARA_PI_SUBAGENT_COMPLETION_BATCH_WINDOW_MS`, default 2000 ms, range
  0–30000, standard resolver contract; 0 flushes immediately); at most one
  outstanding follow-up per thread (later bursts wait and join a later
  batch after settle); per-follow-up bounded entry cap (default 8 — overflow
  joins the next batch so ONE follow-up stays bounded under any burst);
  safe-parent-boundary delivery (`isParentBusy` — the ONLY delivery gate;
  deferral consumes no retry budget and writes no durable state; the batch
  re-flushes on `onParentTurnSettled`); journal-first dispatch (entries
  marked `delivered` BEFORE the parent effect; repository-side
  generation-fencing supersedes stale entries inside the transition with no
  follow-up effect); bounded automatic retry (a dispatch failure re-flushes
  the thread after one batching window while entries stay within the
  Ticket 08 retry policy — the coordinator consumes
  `piSubagentCompletionRetryLimit` through the same repository scan); a
  follow-up turn that ran is acknowledged (its content was seen and is
  never re-sent); a follow-up turn rejected BEFORE running produced no
  parent content, so its entries return to retryable delivery.
- **Repository**: `listRecoverableCompletionOutbox` gained the optional
  `parentThreadId` filter (branch-specific query over the existing
  `idx_..._thread` index) so the coordinator scans only its own thread.
- **PiAdapter wiring** (`Layers/PiAdapter.ts`): adapter-lifetime coordinator
  instance (created when the repository exists); `isParentBusy` reads the
  live sessions map (`context.activeTurnId`); `sendFollowUp` dispatches ONE
  bounded follow-up turn on the parent session prompt (harness policy +
  bounded per-entry summaries carrying the stable outbox identity, the
  parent-effect dedupe key per Decision 0013 F4); diagnostics surface on
  the runtime-event channel (`subagents/completion-delivery-diagnostic`).
  Trigger: post-commit `onTerminalPersisted` routes by negotiated
  capability — sessions whose extension advertises
  `completion-delivery-ownership` drive the coordinator; legacy sessions
  disposition the entry as legacy-owned (`delivered`+`acknowledged` at
  terminal-persist, `subagents/completion-legacy-owned` runtime event) so
  the legacy nudge stays the sole delivery channel and entries never
  accumulate. Parent-turn settle hooks: the SDK `message_end` handler
  acknowledges an outstanding follow-up (a turn that RAN showed its
  content) and releases parked batches (busy-then-idle, T09-AC3);
  `completePromptRejection` (turn rejected before running) returns the
  batch to retryable delivery (T09-AC4).
- **Alfie extension** (`489acd626`, `0.14.0-alfie.1`): advertises
  `completion-delivery-ownership`; mixed-version host gate (ticket-07
  pattern) records whether the host offered the capability in its
  handshake; the background terminal reporter now returns the observation
  promise — its resolution (the host's durable terminal+outbox commit) is
  the ownership acknowledgement. onComplete suppresses the legacy
  notification pipeline (extracted verbatim as
  `emitLegacyCompletionNotification`) for the acknowledged record ONLY;
  no acknowledgement (older host, persistence failure, bounded 5 s wait)
  keeps the legacy nudge exactly as before.
- **Contracts**: `completion-delivery-ownership` capability literal; the
  handshake `optionalCapabilities` now offers it (older extensions simply
  do not return it).

### Changed production call chain

Extension terminal observation → `ingestPiSubagentTerminal` (terminal +
outbox atomic commit) → post-commit `onTerminalPersisted` → capability
router: ownership session → `coordinator.onCompletionPending` → window
open → (busy? park until `onParentTurnSettled`) → scan thread entries
(`retryLimit` policy) → mark each `delivered` (stale → superseded, no
effect) → ONE `session.prompt` follow-up (bounded summaries + identities) →
`message_end` (turn ran) → `markCompletionAcknowledged` → next batch may
open. Legacy session → `markCompletionDelivered` +
`markCompletionAcknowledged` (legacy-owned disposition) → legacy nudge
remains the delivery mechanism. Extension side: managed background
completion → terminal observation promise resolves (ownership ack) → nudge
suppressed; otherwise → `emitLegacyCompletionNotification` verbatim.

### Review disclosure (pre-review)

- **At-least-once with stable identity, not exactly-once (Decision 0013
  F4):** a crash between follow-up dispatch and the `delivered` mark can
  re-deliver the batch after restart; every follow-up entry carries the
  stable `outboxId` as the parent-effect key. Within a live process the
  one-outstanding registry prevents re-dispatch while a batch is in flight.
- **Ack-attribution:** `message_end` on the follow-up thread acknowledges
  the outstanding batch; a user turn racing between dispatch and completion
  can attribute the settle earlier. The semantic gate is "the parent
  reached a safe boundary after delivery" — the follow-up content was
  already shown; acknowledgement only releases the next batch.
- **Busy-boundary check is adapter-memory truth** (`context.activeTurnId`):
  a parent turn starting between the check and `session.prompt` cannot be
  interrupted (the prompt is queued by the runtime); the coordinator never
  steers into an active turn.
- **Legacy disposition failure:** if the legacy-owned delivered+acknowledged
  marks fail, the entry stays recoverable-pending (Ticket 10 startup
  recovery re-dispositions it); a runtime event records the attempt.
- **Ticket 10 parallel strand:** restart reconciliation
  (`piSubagentRestartReconciliation.ts`) was implemented by a parallel
  ticket-10 stream in the same working tree; its commits (`e58ff719`,
  `863ef999`) interleave with this ticket's commits. No file overlap on
  production sources (ticket 10 touches `main.ts` startup wiring,
  reconciliation coordinator, its own tests).

### Acceptance evidence matrix

| Criterion | Source evidence | Verification evidence | Result |
| --------- | --------------- | --------------------- | ------ |
| T09-AC1 | Coordinator batching window + per-follow-up cap; follow-up carries bounded summaries + execution identities + stable dedupe ids | piSubagentCompletionCoordinator.test.ts AC1: two terminals in-window → ONE dispatch with both entries (ids, bounded summaries, dedupeId=outboxId); window-0 flushes immediately; batch-cap overflow joins the NEXT batch | pass |
| T09-AC2 | One-outstanding registry + durable `delivered`-but-unacknowledged ledger; per-thread scan never co-batches | AC2 tests: later burst while outstanding → no second dispatch until settle, then a later batch with exactly the waiting entries; thread-isolation test: two threads → two separate single-entry follow-ups | pass |
| T09-AC3 | `isParentBusy` is the only gate (structurally no user-read input); deferral parks without durable writes; `onParentTurnSettled` re-flushes | AC3 test: busy → window elapses → NO dispatch (even 60× later); entry stays pending; busy-then-idle → settle releases exactly one dispatch. Real-Pi AC5 managed test proves safe-boundary dispatch on a live session | pass |
| T09-AC4 | Journal-first dispatch (delivered before effect); dispatch failure → `failed_retryable` (attempt_count+1) + bounded auto-retry within the Ticket 08 policy; prompt-rejection returns entries to retryable; outcome never rewritten | AC4 tests: failed dispatch → failed_retryable(1) + execution still succeeded → retry → ONE accepted follow-up → acknowledged; retry-budget exhaustion stops dispatching, evidence readable; follow-up-turn-failed → retryable redelivery without duplicate content | pass |
| T09-AC5 | Extension-side host gate + ack-dependent suppression; server-side capability router + legacy-owned disposition | Extension tests (managed-terminal.test.ts, 3 new): ack resolves → nudge suppressed; older host → nudge fires (followUp+triggerTurn); persistence failure → nudge fires. Real-Pi wallclock (piSubagentCompletionOwnershipAcceptance, 2 tests): managed pin — ack suppresses nudge, ONE Synara follow-up on the real parent, entry acknowledged, no legacy nudge in transcript; legacy 608c1c57d worktree — legacy nudge active on parent, entry legacy-owned acknowledged, NO Synara follow-up (no double notification) | pass |
| T09-AC6 | Repository-side `fenceOrSupersede` inside `markCompletionDelivered` (superseded_instead, no effect); evidence reads unchanged | AC6 test: resume to generation 2 → stale entry superseded with NO dispatch; `getTerminalEvidence` + summary readable by identity; new attempt's terminal delivers its own batch normally | pass |

### Failure and diagnostic evidence

- Dispatch failure: `pi_subagent_completion_delivery_failed` (per execution,
 attempt count, bounded message); durable `failed_retryable` within budget.
- Scan failure: `pi_subagent_completion_delivery_failed` thread-scoped
 diagnostic; the batch retries on the next trigger.
- Supersede: `pi_subagent_completion_superseded`, zero parent effect.
- Legacy disposition: `subagents/completion-legacy-owned` runtime event;
 failure leaves the entry recoverable-pending (Ticket 10 recovery scope).
- No new diagnostic literals were required (existing Ticket 07/08 codes
  cover the surfaces); contracts tests pin the capability literal.

### Verification runs

- `vitest run src/provider/piSubagentCompletionCoordinator.test.ts` — 10/10
  (T09-AC1/2/3/4/6 matrix: real repository + in-memory SQLite, production
  ingest, virtual clock, fault-injectable parent boundary).
- `vitest run src/provider/piSubagentCompletionOwnershipAcceptance.test.ts`
  — 2/2 (T09-AC5 real-Pi mixed managed/legacy; provenance verified at the
  new pin; legacy extension materialized from a detached worktree at
  608c1c57d with compiled artifact verification).
- `vitest run src/provider/piSubagentCompletionOutbox.test.ts` — 11/11
  (Ticket 08 regression; the per-thread filter is additive).
- Alfie extension suites: managed-terminal 7/7 (3 new T09-AC5 tests),
  synara-bridge green after capability/version pin updates; full extension
  package suite 29/29 on the touched files.
- Contracts: `piSubagents.test.ts` capability test green (new literal).
- Config: 3 new knob tests green (177 total in suite file run).
- `tsc --noEmit` (apps/server): exit 0.
- Wallclock suites re-run per-file standalone after the version-pin update
  (RealExtension, TerminalAcceptance, CancellationAcceptance,
  IntegratedAcceptance, RestartAcceptance, ForegroundAcceptance,
  ProgressAcceptance) — results recorded in the review step.
- `bun fmt` / `bun lint` / `bun typecheck` (workspace) — final pass before
  review (per AGENTS single-bundle rule).

## Testing Seams

**Approval status:** Approved — owner approval in the ticket-breakdown review
on 2026-08-16, including the safe-boundary rule recorded in T09-AC3.

- **T09-AC1, T09-AC2, T09-AC3, T09-AC4, T09-AC6:** Server orchestration
  integration boundary with simultaneous completion, active-parent, idle-parent,
  busy-then-idle, failure, retry, and supersede fixtures.
- **T09-AC2, T09-AC4:** Completion-delivery state-machine contract.
- **T09-AC5:** Isolated real-Pi mixed managed/legacy boundary — ownership
  acknowledgement suppresses only the managed nudge.
