# 08 — Durable completion outbox

**What to build:** Every applicable terminal creates a durable completion
outbox entry before parent notification. Execution outcome and completion
delivery are separate state machines, so delivery failure never rewrites a
successful child as failed. Delivery can retry idempotently, and superseded
entries cannot create follow-up effects.

**Blocked by:** 07 — Journal-first terminal lifecycle.

**Status:** ready-for-agent → implemented (awaiting review)

- [x] **T08-AC1:** Terminal persistence and outbox creation are atomic or
      equivalently journal-first recoverable before notification.
- [x] **T08-AC2:** Delivery state is independently represented as pending,
      delivered, acknowledged, failed/retryable, or superseded without mutating
      execution outcome.
- [x] **T08-AC3:** Replayed terminal or outbox processing creates no duplicate
      entry or follow-up effect.
- [x] **T08-AC4:** Crash or failure between terminal persistence and delivery
      leaves the execution terminal and the outbox recoverably pending.
- [x] **T08-AC5:** Retry uses a stable dedupe identity and can reach
      acknowledgement without duplicate parent content.
- [x] **T08-AC6:** A completion superseded by a newer generation produces no
      delivery effect while its original execution evidence remains readable.

## Testing Seams

**Approval status:** Approved — owner approval in the ticket-breakdown review
on 2026-08-16.

- **T08-AC1, T08-AC3, T08-AC4, T08-AC5:** Server orchestration integration
  boundary with crash-before-delivery, replay, retry, and acknowledgement
  fault injection.
- **T08-AC2, T08-AC6:** Completion-delivery state-machine contract — prove
  outcome/delivery separation and supersede rules.
- **T08-AC5:** Parent completion-injection boundary — same dedupe identity
  cannot create duplicate parent effects.

## Implementation Report

**Implementation state:** implemented — review requested (2026-08-18)

### Delivered scope

Durable completion outbox for managed Pi subagent executions, Symphony-side
only (no Alfie change required: the extension already reports terminal
evidence through the Ticket 07 seam; the outbox is server-internal delivery
durability — the `terminal-outbox` capability was already in the negotiated
optional-capability list).

- **Migration 102** (`102_PiSubagentCompletionOutbox.ts`): the
  `pi_subagent_completion_outbox` table — one row per applicable terminal
  (succeeded|failed) per attempt/generation, `UNIQUE (execution_id,
  attempt_id, generation)` dedup identity, CHECK-guarded delivery states
  (`pending|delivered|acknowledged|failed_retryable|superseded`), bounded
  summary + transcript reference columns (Decision 0012 F2 inheritance),
  attempt counter, last error, superseded-by-generation, delivered/acknowledged
  timestamps, plus state and thread indexes.
- **Repository** (`PiSubagentExecutionRepository`): the outbox INSERT is now
  part of `recordTerminalEvent`'s single transaction (atomic terminal + outbox
  creation, T08-AC1) — an outbox write failure rolls back the whole
  transaction so no terminal can exist without its completion entry; new
  methods `recordCompletionOutboxEntry` (idempotent create),
  `getCompletionOutboxEntry`, `listRecoverableCompletionOutbox` (pending +
  failed_retryable within the retry budget),
  `listTerminalEventsWithoutOutbox` (journal-first recovery scan),
  `markCompletionDelivered` / `markCompletionAcknowledged` /
  `markCompletionDeliveryFailed` / `markCompletionSuperseded` — every
  transition is guarded (invalid transitions reported, never silently
  applied), delivery transitions are generation-fenced (a stale entry is
  superseded instead of delivered), and NO outbox method touches the execution
  aggregate (outcome/delivery separation, T08-AC2).
- **Coordinator** (`piSubagentCompletionOutbox.ts`):
  `recoverCompletionOutbox` — journal-first recovery creating pending entries
  for terminal journal rows without outbox rows (pre-102 databases and any
  crash window; idempotent); `processPendingCompletions` — the delivery pump
  over the recoverable set: fence/supersede check BEFORE any delivery effect,
  inject through the parent completion boundary carrying the stable
  `dedupeId` (= the deterministic `outboxId`), mark delivered, settle
  acknowledged when the parent acknowledged; delivery failures increment
  the durable attempt counter (retryable within the configured budget) and
  emit `pi_subagent_completion_delivery_failed` — they never mutate the
  execution outcome and never degrade control health (delivery failure is
  not execution failure, T08-AC2, spec stories 21/22).
- **Contracts** (`packages/contracts/src/piSubagents.ts`):
  `PiSubagentCompletionDeliveryState`,
  `PiSubagentCompletionOutboxEntry` schemas; diagnostic codes
  `pi_subagent_completion_outbox_persistence_failed`,
  `pi_subagent_completion_delivery_failed`,
  `pi_subagent_completion_superseded`.
- **Config** knob `SYNARA_PI_SUBAGENT_COMPLETION_RETRY_LIMIT`
  (`resolvePiSubagentCompletionRetryLimit`, default 5, range 0–100, standard
  resolver contract) wired through `ServerConfigShape` and `main.ts`.
- **Adapter** (`PiAdapter`): `onTerminalPersisted` now additionally emits the
  `subagents/completion-outbox-pending` runtime event (bounded payload:
  identities + deliveryState only) for `recorded` terminals — the operator
  surface for the pending completion. The parent follow-up-turn consumer is
  Ticket 09 scope; restart-time recovery invocation is Ticket 10 scope.
- **Decision 0012 F3 follow-up:** `ingestPiSubagentTerminal`'s defensive
  `summaryMaxChars` guard now checks the configuration MAXIMUM as well
  (`MIN..MAX` symmetric) — an externally-constructed oversized cap falls back
  to the default instead of being honored.

### Changed production call chain

Extension terminal observation → `ingestPiSubagentTerminal` →
`repository.recordTerminalEvent` (one transaction: dedup → continuity →
journal INSERT → guarded aggregate UPDATE → outbox INSERT `pending`) →
post-commit `onTerminalPersisted` → adapter runtime events
(`subagents/terminal-settled` + `subagents/completion-outbox-pending`).
Recovery path: `recoverCompletionOutbox` scans terminal journal rows without
outbox rows → idempotent `recordCompletionOutboxEntry`. Delivery path:
`processPendingCompletions` → fence check (supersede stale generations with
`pi_subagent_completion_superseded`, no delivery effect) → parent
completion-injection boundary (`dedupeId` = outbox identity) →
`markCompletionDelivered` → optional `markCompletionAcknowledged`; failures →
`markCompletionDeliveryFailed` (attempt_count + 1, retryable) +
`pi_subagent_completion_delivery_failed` diagnostic.

### Review disclosure (pre-review)

- **Parent consumer is Ticket 09:** the delivery pump's `deliver` boundary is
  the owner-approved testing seam (parent completion-injection boundary);
  production wiring of the actual follow-up turn (batching, one-outstanding-
  per-thread, safe-boundary deferral) is Ticket 09 scope. The outbox state
  machine, atomicity, recovery, retry, and supersede semantics — everything
  T08-AC1..AC6 names — are complete and durable here.
- **Startup recovery invocation is Ticket 10:** restart reconciliation owns
  invoking `recoverCompletionOutbox` + `processPendingCompletions` at server
  start; the journal-first scan exists and is idempotent, and pre-102
  databases with terminal rows but no outbox rows recover through it.
- **Cancelled executions create no outbox entry:** `recordTerminalEvent`
  accepts only `succeeded|failed` (applicable terminals); cancellation
  settles through `recordCancelledAck` which deliberately creates no
  completion entry — a cancelled child is not a completion to notify.
- **Retry budget semantics:** `failed_retryable` entries beyond the configured
  retry limit stop being auto-recovered but remain fully readable (state,
  last_error, bounded evidence) — the operator surface; a later
  acknowledged redelivery cannot resurrect them (acknowledged/superseded are
  terminal delivery states; exhausted entries need explicit operator action).

### Acceptance evidence matrix

| Criterion | Source evidence | Verification evidence | Result |
| --------- | --------------- | --------------------- | ------ |
| T08-AC1 | Outbox INSERT inside `recordTerminalEvent`'s single `sql.withTransaction` after the guarded aggregate UPDATE; `ON CONFLICT DO NOTHING` on the unique identity; journal-first recovery scan for the equivalent path | piSubagentCompletionOutbox.test.ts AC1 test: at `onTerminalPersisted` time the entry already exists `pending` with the SAME bounded summary/transcriptRef; failure-direction test: a failed transaction (missing execution) leaves NO journal row, NO aggregate, NO outbox row — never terminal-without-outbox | pass |
| T08-AC2 | Delivery states `pending/delivered/acknowledged/failed_retryable/superseded` CHECK-constrained in migration 102; guarded transitions; no outbox method writes `pi_subagent_executions` | AC2 tests: full pending→delivered→acknowledged walk with timestamps; failed_retryable records attempt_count + last_error and stays recoverable; acknowledged is delivery-terminal (re-deliver → invalid_transition); execution observed/desired/updatedAt UNCHANGED through every transition | pass |
| T08-AC3 | Deterministic `outbox_<exec>_<att>_gen<gen>` identity + `UNIQUE (execution_id, attempt_id, generation)`; replay-safe create with original-evidence preservation; idempotent recovery scan | AC3 test: exact terminal replay → already_applied; direct duplicate create → already_applied with the ORIGINAL summary preserved; recovery replay recovers 0; second pump after acknowledgement issues no parent request | pass |
| T08-AC4 | Outbox created in the terminal transaction (crash cannot separate them); `listRecoverableCompletionOutbox` returns pending + retry-budget entries; `recoverCompletionOutbox` fills journal-without-outbox gaps | AC4 tests: crash-before-delivery (no pump runs) → execution terminal + entry pending → next pump delivers AND acknowledges; journal-first recovery test: generic-path terminal without outbox row → scan creates exactly one pending entry (bounded summary recovered from journal metadata) → replay recovers nothing | pass |
| T08-AC5 | Stable `dedupeId` (the outbox identity) carried on every delivery request; at-least-once pump with exactly-once parent effect; `markCompletionDeliveryFailed` increments the durable attempt counter | AC5 tests: pump 1 boundary rejects → failed_retryable (attempt 1) + `pi_subagent_completion_delivery_failed` diagnostic; pump 2 accepts+acknowledges → delivered+acknowledged with parent requestCount 2 but distinctEffectCount 1; retry-budget test: an exhausted entry stops auto-recovering while entry + evidence + succeeded outcome stay readable | pass |
| T08-AC6 | `fenceEntry` before any delivery effect + `fenceOrSupersede` inside the repository transitions: entry attempt/generation vs CURRENT aggregate; supersede records `superseded_by_generation`; acknowledged cannot be superseded | AC6 test: attempt-1 completion pending → resume to attempt/generation 2 → pump supersedes (1 superseded, 0 delivered, parent requestCount 0) + `pi_subagent_completion_superseded` diagnostic; superseded entry keeps terminalState/summary/transcriptRef readable; `getTerminalEvidence` + journal row still readable; attempt-2 terminal creates its OWN entry and delivers normally; supersede-guard test: acknowledged cannot regress to superseded, superseded cannot be delivered | pass |

### Failure and diagnostic evidence

- Outbox creation failure: rolls back the terminal transaction — the existing
  `pi_subagent_terminal_persistence_failed` surface fires (control-health
  degradation, producer rejection, no notification); the journal-first
  recovery scan failure emits `pi_subagent_completion_outbox_persistence_failed`.
- Delivery failure: `pi_subagent_completion_delivery_failed` diagnostic with
  attempt count and bounded message; durable `failed_retryable` +
  `attempt_count`; execution outcome untouched.
- Supersede: `pi_subagent_completion_superseded` diagnostic; NO delivery
  effect; original execution evidence readable.
- Invalid transitions (acknowledged re-deliver, supersede-after-ack): reported
  as `invalid_transition`, never silently applied.

### Verification runs

- `npx vitest run src/provider/piSubagentCompletionOutbox.test.ts` — 11/11
  pass (T08-AC1..AC6 matrix over the REAL repository + in-memory SQLite,
  driven through the production `ingestPiSubagentTerminal`).
- `npx vitest run src/provider/piSubagentTerminalLifecycle.test.ts` — 13/13
  (12 pre-existing + the new Decision-0012-F3 MAX-guard test).
- All wallclock suites, per-file standalone (Decision 0008 binding method,
  `env -i PATH HOME` prefix): ForegroundAcceptance 6/6, ForegroundReopen 1/1,
  ForegroundLifecycle 5/5, RealExtension 11/11, ProgressAcceptance 1/1,
  IntegratedAcceptance 7/7, CancellationAcceptance 2/2, TerminalAcceptance
  2/2 — the live adapter path exercises the atomic outbox insert through the
  real pinned extension with zero regression.
- Migration suites updated for migration 102 and green: Migrations.test.ts
  21/21, MigrationLineageReconciliation 4/4, MigrationReplay 3/3;
  PiSubagentExecutionRepository 12/12.
- Contracts: 19 files / 219 tests (4 new outbox-schema tests).
- Config suite: 174/174 (3 new knob tests).
- Full server unit project: 4,529 passed / 7 failed — the 7 failures are the
  pre-existing `CursorTextGeneration.test.ts` environment failures (Cursor
  ACP unavailable; the same documented pre-existing set, reproduced
  identically without this ticket's changes).
- `bun run typecheck` (workspace, 7 packages): pass. `bun run lint`: 0 errors
  (525 warnings, BELOW the 527-warning pre-change baseline — unused imports
  cleaned). `oxfmt`: applied; planning reformat noise reverted.
