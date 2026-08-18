# 09 — Per-thread completion coordinator

**What to build:** Completion delivery is coordinated per parent thread.
Near-simultaneous managed child completions form one bounded follow-up, at most
one unacknowledged follow-up exists per thread, and a busy parent defers delivery
until no active parent turn remains. Legacy completion nudges are suppressed
only after Synara acknowledges ownership for that managed execution.

**Blocked by:** 08 — Durable completion outbox.

**Status:** ready-for-agent → implemented → **needs remediation (Decision 0015)**

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

**Implementation state:** needs remediation — Decision 0015 (2026-08-18)

### Final-acceptance outcome (2026-08-18)

**NEEDS REMEDIATION.** The independent review returned PASS/HIGH for
T09-AC1..AC6, but the Project Supervisor rejected final acceptance under
Decision 0015. T09-AC1/2/3/5/6 remain proven. T09-AC4 remains open because
the coordinator persists `delivered` before `sendFollowUp`; process death
between those operations can leave a delivered/unacknowledged row outside
all recovery scans and permanently lose the parent effect.

The binding remediation must make unfinished dispatch durably recoverable,
reuse stable outbox/batch identity at an enforceably idempotent parent-effect
boundary, preserve one outstanding batch per thread across recovery, and prove
both crash positions: before parent acceptance and after acceptance but before
local finalization. See
[Decision 0015](../decisions/0015-t09-per-thread-completion-coordinator-final-acceptance-remediation.md)
and the persisted
[independent review](../reviews/09-per-thread-completion-coordinator-review.md).

### Decision 0016 remediation implementation (2026-08-18)

**Status: implemented under Decision 0016 — NOT accepted, NOT yet
independently reviewed.** Ticket 09 remains `needs remediation`. This section
records the remediated implementation (isolated worktree branch
`impl/t09-crash-safe-parent-effect`, commits `0f298eb8` … `3aed8084`) and the
actual parent-effect sequence; it makes **no acceptance claim**.

**Actual parent-effect sequence (Decision 0016 §1/§6):**

1. **Immutable batch commit** — a bounded `pi_subagent_completion_dispatch_batches`
   ledger (migration 103) is the durable recovery authority. Batch create
   transactionally selects canonical, generation-applicable recoverable outbox
   members, fences stale ones (zero effect), caps membership, freezes the
   complete deterministic `thread.turn.start` command (timestamp, dispatch
   mode `queue`, origin `agent`, runtime/interaction/assistant modes,
   deterministic message id, parent thread, bounded parent message with the
   current harness-policy header), associates each member exactly once, and
   reserves the durable one-active-batch slot (partial unique
   `parent_thread_id` index over nonterminal states).
2. **Exact command/receipt acceptance** — the coordinator dispatches the
   STORED frozen command, byte-for-byte, through a narrow single-assignment
   late-bound parent-effect port. `OrchestrationEngine.dispatch` atomically
   persists the deterministic parent message, an immediate turn-start or
   durable queued-turn request, the command fingerprint, and a
   fingerprint-matched accepted receipt. Delivery (provider turn / queued-turn
   promotion) is downstream. A pre-dispatch recompute-and-compare of the
   canonical fingerprint fails closed on drift/malformed payload.
3. **Receipt-correlated finalization** — recovery transactionally marks the
   batch accepted (guarded on exact command id + fingerprint + parent message
   id + accepted receipt sequence), then acknowledges ONLY its exact
   associated members and releases the active-thread slot. Generic
   `message_end`/settle/session events only trigger a recovery check; they can
   never acknowledge a batch.

Batch states: `awaiting_acceptance`, `retryable`, `accepted`, `acknowledged`,
`superseded`, `exhausted`. Transient no-receipt failures re-dispatch the same
identity at the Ticket 08 retry ceiling; a persisted rejection or identity
collision settles exhausted with one genuine attempt and no repeated
increments; child outcomes and terminal evidence are never mutated.

**Changed surfaces:** migration 103 + batch repository state machine (guarded
create/recover/fail/reject/finalize/supersede/exhaust, exact receipt
correlation); deterministic identity/frozen-command module (`SHA-256` over
parent thread + canonical ordered outbox ids, separately typed batch/command/
message ids, bytes-identical stored-payload replay); diagnostic literals
(batch persistence/rejected/collision/recovery) + resolved
`SYNARA_PI_SUBAGENT_COMPLETION_MAX_BATCH_ENTRIES` (1–64, default 8);
parent-effect dispatcher bridge; coordinator rewrite; PiAdapter/composition
(bridge created before the provider layer, bound once via main.ts; direct
completion `session.prompt` removed; recovery on binding, hydration/start,
safe boundary, new completion, bounded ongoing scan); real-Pi ownership
acceptance now binds the real OrchestrationEngine.

**Evidence (focused suites, all green):** migration 103 + migration
replay/lineage (`90..103`); completion-dispatch-batch repository state
machine (13); dispatch-identity (12); parent-effect bridge (10); coordinator
deterministic fault suite (19) covering both Decision 0016 crash positions,
timeout → byte-identical retry, accepted-despite-timeout, payload drift /
malformed fail-closed, persisted rejection without repeated increments,
concurrent recovery one-batch, busy/lazy no-budget + recover on exact trigger,
restart without a new terminal, unrelated settle immunity, stale-before-create
and stale-before-submit zero command, cross-thread isolation, later
same-thread batching, evidence byte-stability, rollback inertness;
engine-backed acceptance (4) through the real OrchestrationEngine; real-Pi
ownership acceptance managed+legacy (2, per-file standalone under Decision
0008). Full command outcomes, failure/diagnostic evidence, and the single
bundled fmt/lint/typecheck pass are recorded in WP-08 (the report revision
under this issue).

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

| Criterion | Source evidence                                                                                                                                                                                                                    | Verification evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Result |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| T09-AC1   | Coordinator batching window + per-follow-up cap; follow-up carries bounded summaries + execution identities + stable dedupe ids                                                                                                    | piSubagentCompletionCoordinator.test.ts AC1: two terminals in-window → ONE dispatch with both entries (ids, bounded summaries, dedupeId=outboxId); window-0 flushes immediately; batch-cap overflow joins the NEXT batch                                                                                                                                                                                                                                                                                               | pass   |
| T09-AC2   | One-outstanding registry + durable `delivered`-but-unacknowledged ledger; per-thread scan never co-batches                                                                                                                         | AC2 tests: later burst while outstanding → no second dispatch until settle, then a later batch with exactly the waiting entries; thread-isolation test: two threads → two separate single-entry follow-ups                                                                                                                                                                                                                                                                                                             | pass   |
| T09-AC3   | `isParentBusy` is the only gate (structurally no user-read input); deferral parks without durable writes; `onParentTurnSettled` re-flushes                                                                                         | AC3 test: busy → window elapses → NO dispatch (even 60× later); entry stays pending; busy-then-idle → settle releases exactly one dispatch. Real-Pi AC5 managed test proves safe-boundary dispatch on a live session                                                                                                                                                                                                                                                                                                   | pass   |
| T09-AC4   | Journal-first dispatch (delivered before effect); dispatch failure → `failed_retryable` (attempt_count+1) + bounded auto-retry within the Ticket 08 policy; prompt-rejection returns entries to retryable; outcome never rewritten | AC4 tests: failed dispatch → failed_retryable(1) + execution still succeeded → retry → ONE accepted follow-up → acknowledged; retry-budget exhaustion stops dispatching, evidence readable; follow-up-turn-failed → retryable redelivery without duplicate content                                                                                                                                                                                                                                                     | pass   |
| T09-AC5   | Extension-side host gate + ack-dependent suppression; server-side capability router + legacy-owned disposition                                                                                                                     | Extension tests (managed-terminal.test.ts, 3 new): ack resolves → nudge suppressed; older host → nudge fires (followUp+triggerTurn); persistence failure → nudge fires. Real-Pi wallclock (piSubagentCompletionOwnershipAcceptance, 2 tests): managed pin — ack suppresses nudge, ONE Synara follow-up on the real parent, entry acknowledged, no legacy nudge in transcript; legacy 608c1c57d worktree — legacy nudge active on parent, entry legacy-owned acknowledged, NO Synara follow-up (no double notification) | pass   |
| T09-AC6   | Repository-side `fenceOrSupersede` inside `markCompletionDelivered` (superseded_instead, no effect); evidence reads unchanged                                                                                                      | AC6 test: resume to generation 2 → stale entry superseded with NO dispatch; `getTerminalEvidence` + summary readable by identity; new attempt's terminal delivers its own batch normally                                                                                                                                                                                                                                                                                                                               | pass   |

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
