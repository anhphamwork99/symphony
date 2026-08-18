# 11 — Reconnectable execution card

**What to build:** Synara exposes managed execution aggregates and lifecycle
cursors through its WebSocket snapshot/replay surface, and the web application
renders an execution card with honest lifecycle and diagnostics. Refresh or
reconnect restores the latest card and resumes lifecycle without replaying
intermediate progress. Card cancellation drives the durable cancel path, and
background execution activity never hijacks transcript auto-follow.

**Blocked by:** 06 — Durable parent-turn cancellation; 09 — Per-thread
completion coordinator; 10 — Restart reconciliation to terminal or orphaned.

**Status:** ready-for-agent

- [ ] **T11-AC1:** The snapshot exposes execution identity, desired and observed
      state, latest progress, lease state, terminal summary, delivery state, and
      stable diagnostics as a bounded aggregate.
- [ ] **T11-AC2:** Lifecycle replay resumes after the client cursor; intermediate
      progress history is not replayed, and duplicate event identities have one
      projection effect.
- [ ] **T11-AC3:** Replay-window gaps produce an explicit resync/gap diagnostic
      and snapshot recovery rather than silent loss.
- [ ] **T11-AC4:** The card renders requested, queued, running, cancelling,
      cancelled, succeeded, failed, and orphaned with their applicable diagnostics.
- [ ] **T11-AC5:** Refresh or browser reconnect restores the card and latest
      progress without requiring the parent tool row to remain active.
- [ ] **T11-AC6:** Authorized cancel is idempotent and remains visibly
      `cancelling` until server acknowledgement; denial is visible without state
      corruption.
- [ ] **T11-AC7:** Heartbeat, resource usage, card state, and nested tool
      progress do not trigger transcript auto-follow; real message arrival and
      live assistant text retain existing behavior.
- [ ] **T11-AC8:** Legacy agents are labeled unmanaged/non-durable only in the
      execution-card experience and are not represented as managed records.

## Testing Seams

**Approval status:** Approved — owner approval in the ticket-breakdown review
on 2026-08-16.

- **T11-AC1, T11-AC2, T11-AC3:** WebSocket orchestration snapshot/replay
  harness with disconnect, cursor resume, duplicate, and replay-gap fixtures.
- **T11-AC4, T11-AC8:** Web execution-card component boundary over complete
  lifecycle and legacy fixtures.
- **T11-AC5, T11-AC6:** Browser reconnect and cancel-flow boundary with
  authorized and denied principals.
- **T11-AC7:** Focused transcript auto-follow browser tests preserving the
  repository's live-output guardrails.
- **T11-AC1:** Contract test proving snapshot and push payloads remain bounded
  and exclude full transcript content.

## Implementation Report

**Status:** implemented; review remediated (re-review PASS); R4-N1 follow-up
closed — awaiting Supervisor final acceptance.
**Date:** 2026-08-19 (implementation `95b9e169`; remediation `339fcc04`;
R4-N1 `c3bdbc78`; re-review PASS appended to the review file).

### Review remediation (independent review 2026-08-19: NEEDS REMEDIATION)

Independent review (persisted at
`reviews/11-reconnectable-execution-card-review.md`) returned PASS for
AC1/AC3/AC4/AC5/AC7, F1, and ticket-06 refactor equivalence, with four
findings. All four remediated:

- **R1 (BLOCKING)** — bridge published card events only for a thread's
  NEWEST execution (thread-scoped `LIMIT 1` read masked siblings). Fix: new
  identity-scoped repository seam `getExecutionCard(executionId)`; the bridge
  now reads THIS execution's committed card by identity (`none` only when the
  row is gone). Regression test: lifecycle on the older of two sibling
  executions publishes its own card event; `getExecutionCard` returns each
  identity regardless of sibling order and `None` for unknown ids.
- **R2 (LOW)** — card-cancel wiring (decider → reactor → ProviderService) had
  no end-to-end test. Fix: two engine-level reactor tests dispatching
  `thread.pi-subagent-execution.cancel` — one proves the service receives the
  exact identities with an active session; one proves the no-session denial
  appends a visible `provider.subagent-execution.cancel.failed` activity with
  zero service calls (the reactor now applies the same session-liveness gate
  as `thread.task.stop`).
- **R3 (LOW)** — the legacy "Unmanaged (legacy)" label was unreachable (strip
  mounted only with cards while the flag required zero cards). Fix: strip
  mounts when cards exist OR the legacy flag is true. Heuristic limitation
  (provider=pi + running turn + zero cards can mislabel a managed session
  whose executions are all cap-evicted) noted; a client-visible
  capability signal would be the honest long-term source.
- **R4 (INFO)** — outbox delivery transitions never published card updates.
  Fix: `markCompletionDelivered/Acknowledged/DeliveryFailed/Superseded` now
  notify post-commit (delivery-only band, states re-read from the committed
  aggregate). Re-review found R4-N1 (same seq-0 identity collided on the
  second delivery change) — closed at `c3bdbc78` by folding the committed
  delivery state into the delivery-band command id; regression test proves
  terminal → delivered → acknowledged all publish.

### Solution shape

Managed execution cards ride the EXISTING thread snapshot/replay surface as
first-class data — no new channel, no projection mirror table:

1. **Bounded card aggregate** (`packages/contracts/src/piSubagents.ts`):
   `PiSubagentExecutionCard` (identity, attempt/generation, desired/observed,
   diagnostics, lease, bounded coalesced-progress summary + drop counter,
   bounded terminal summary + opaque transcript ref, completion-outbox
   delivery state). Bounds: progress summary ≤512, diagnostic ≤512,
   `PI_SUBAGENT_EXECUTION_CARD_MAX_PER_THREAD = 64` (oldest dropped).
2. **Snapshot join** (`ProjectionSnapshotQuery`): thread detail AND full
   read-model snapshots join `pi_subagent_executions` + observation columns +
   terminal evidence + current outbox delivery state directly (the durable
   aggregate is its own source of truth; no projection table, no migration).
   Row→card mapping shared with the repository (`piSubagentExecutionCardRowToCard`)
   so bounds are single-sourced.
3. **Post-commit lifecycle publication**: the repository fires a
   module-scope listener (`setPiSubagentExecutionLifecycleListener`) strictly
   AFTER lifecycle-truth transactions commit (admission, lifecycle events,
   cancel intent/ack, terminal, orphan). Progress/heartbeat/walltime NEVER
   publish (AC2: no intermediate progress replay). The bridge
   (`piSubagentExecutionCardBridge`) re-reads committed truth and dispatches
   a deterministic internal `thread.pi-subagent-execution.upsert` command
   (`pisubcard_<exec>_<att>_gen<gen>_seq<seq>`) through a late-bound engine
   port (bound once in `main.ts`); same-id replay produces no second event.
4. **Event/replay**: `thread.pi-subagent-execution-updated` is a member of
   `THREAD_DETAIL_EVENT_TYPES`, inheriting cursor resume (`afterSequence`),
   the sequence dedupe fence, the 4096 replay limit, and the
   `ORCHESTRATION_RESNAPSHOT_REQUIRED`/snapshot-recovery path (AC3).
5. **Card cancel (AC6)**: client command `thread.pi-subagent-execution.cancel`
   → decider requires thread → event → `ProviderCommandReactor` →
   `ProviderService.cancelPiSubagentExecution` → PiAdapter →
   `cancelSinglePiSubagentExecution` (same journal-first, fenced,
   evidence-settled protocol as the parent-turn scope, one execution).
   The card stays visibly `cancelling` from the journaled intent until the
   ack/owner-death settlement lands as a new card event; denials (unknown,
   terminal, unsupported, inactive) surface as validation errors/activities
   without corrupting execution truth.
6. **Web projection**: per-thread normalized slice
   `piSubagentExecutionsByThreadId` + reducer upsert (idempotent by
   executionId; duplicate identities keep the previous array reference),
   eviction/deletion prune, and `getThreadFromState` reconstruction. The strip
   (`PiSubagentExecutionCardStrip`, composer chrome — NOT a transcript
   message) renders all lifecycle states + diagnostics + delivery badge +
   legacy label.
7. **Decision 0018 F1**: `pi_subagent_completion_delivery_succeeded` literal
   added; receipt-correlation confirmation and accepted-and-acknowledged
   finalization now emit it (never the failure code).

### Criterion evidence

| Criterion          | Evidence                                                                                                                                                                                                                                                                                                                                                                                               | Status |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| T11-AC1            | `piSubagentExecutionCardSurface.test.ts`: detail snapshot exposes identity/states/progress/lease/terminal/delivery; serialized card excludes prompt + raw progress JSON; per-thread cap drops oldest; delivery-state join proven                                                                                                                                                                       | pass   |
| T11-AC2            | Same file: deterministic command identity replays to ONE event (high-water unchanged on duplicate); progress/heartbeat publish nothing; cursor-resume returns zero card events after the cursor. Web `piSubagentExecutionCardStore.test.ts`: duplicate event identities keep ONE projection effect (reference-stable slice)                                                                            | pass   |
| T11-AC3            | Same file: card events are members of `THREAD_DETAIL_EVENT_TYPES` + `isThreadDetailEventFor` per-thread isolation; the gap→resync machinery (`ORCHESTRATION_RESNAPSHOT_REQUIRED`, snapshot fallback) is the existing `makeCursorSafeSnapshotLiveStream` path now covering card events (proven by `wsSnapshotLiveStream.test.ts`)                                                                       | pass   |
| T11-AC4            | `PiSubagentExecutionCardStrip.test.tsx`: all nine lifecycle labels render; diagnostics, terminal summary, delivery badge, orphaned guidance, cancel visibility/disable rules                                                                                                                                                                                                                           | pass   |
| T11-AC5            | Store test: snapshot hydration restores cards without any parent tool row (full read-model sync writes the slice; selector reconstructs). Browser test: strip renders from the durable snapshot and dispatches the durable cancel command                                                                                                                                                              | pass   |
| T11-AC6            | Coordinator tests: single-execution cancel leaves siblings untouched; desired flips to `cancelling` while observed stays non-terminal until evidence; idempotent re-cancel never re-dispatches; unknown execution → `not_found` denial. Component test: cancelling shows "waiting for server acknowledgement"; failed state shows no cancel affordance. Reducer: cancel-request events project NOTHING | pass   |
| T11-AC7            | `ChatView.browser.tsx` "execution-card activity never re-sticks...": card arrival + repeated card-state/progress/lease churn produce ZERO scroll re-sticks; a real streaming assistant message still re-sticks (control)                                                                                                                                                                               | pass   |
| T11-AC8            | Component test: legacy session renders the "Unmanaged (legacy)" label and never a managed record; managed sessions never see the label. Server-side, unmanaged admission rejects BEFORE any INSERT (verified in admission coordinator) so legacy never appears as managed rows                                                                                                                         | pass   |
| F1 (Decision 0018) | `piSubagentCompletionCoordinator.test.ts`: accepted-and-acknowledged finalization emits `pi_subagent_completion_delivery_succeeded` and NOT `pi_subagent_completion_delivery_failed`                                                                                                                                                                                                                   | pass   |

### Verification commands

- `bun run vitest run src/orchestration/Layers/piSubagentExecutionCardSurface.test.ts src/provider/piSubagentCancellationCoordinator.test.ts src/provider/piSubagentCompletionCoordinator.test.ts src/persistence/Layers/PiSubagentExecutionRepository.test.ts` (apps/server) — 63 pass
- `bun run vitest run src/piSubagentExecutionCardStore.test.ts src/components/chat/PiSubagentExecutionCardStrip.test.tsx src/storeEventReducer.test.ts src/storeProjection.test.ts src/storeNormalization.test.ts` (apps/web) — 145+ pass
- `bun run vitest run --config vitest.browser.config.ts src/components/ChatView.browser.tsx -t "execution-card"` — 2 pass (AC7 + AC5/AC6)
- `bunx tsc --noEmit` clean in contracts, shared, apps/server, apps/web

### Known notes

- The 9 `ChatView.browser.tsx` geometry/timing failures observed in a full
  sequential file run also fail on a stashed (pre-change) tree — pre-existing
  environment flakiness, not introduced by this ticket (verified 2026-08-19).
- Authorization scope: per-ticket seam = decider thread-existence gate +
  provider-layer trusted-context checks (same boundary as `thread.task.stop`);
  a per-thread principal model does not exist in `wsRpc` today (recorded as a
  scout finding; not a regression introduced here).
