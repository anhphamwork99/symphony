# 20 — Atomic authorized production admission

**What to build:** A managed Agent request from the actual Pi extension enters
one production admission path that authorizes the caller, durably records one
logical execution and first attempt, and only then allows the child to start.
Concurrent or redelivered commands and lifecycle events are idempotent.
Crashes cannot expose half-admitted state, and attempt-local sequencing remains
compatible with future resume attempts.

**Blocked by:** 18 — Reconcile released migration lineages; 19 — Complete
real-Pi capability negotiation.

**Status:** completed

- [x] **T20-AC1:** The production composition provides the durable execution
      repository and routes the actual managed Agent spawn through admission before
      child-start evidence.
- [x] **T20-AC2:** Execution record, first attempt, and requested/accepted or
      rejected lifecycle truth commit atomically; injected failure leaves none of
      them partially visible.
- [x] **T20-AC3:** Concurrent commands with the same command identity create
      exactly one execution and attempt; every caller receives the same accepted or
      already-applied identities rather than a raw uniqueness failure.
- [x] **T20-AC4:** Lifecycle redelivery is idempotent by execution, attempt,
      generation, and attempt-local sequence; a future attempt may begin its own
      sequence without colliding with a prior attempt.
- [x] **T20-AC5:** Project/thread ownership, active-turn, approval, provider,
      and subject authority are verified from server-minted trusted context before
      spawn; identifiers supplied by the extension do not grant authority.
- [x] **T20-AC6:** Rejected admission is terminal with a stable diagnostic and
      starts no child; a successful admission runs the child under server-minted
      execution, attempt, and generation identities.
- [x] **T20-AC7:** Legacy or unhandshaked Agent work bypasses managed admission
      without creating managed execution records or being labeled durable.
- [x] **T20-AC8:** Database reopen after admission returns the same aggregate
      and journal ordering, proving the result is not an in-memory record.

## Testing Seams

**Approval status:** Approved — owner approved the remediation breakdown and
known seams on 2026-08-16.

- **T20-AC1, T20-AC5, T20-AC6, T20-AC7:** Actual Pi Agent → production server
  admission → child-start boundary with authorized, denied, managed, and legacy
  sessions.
- **T20-AC2, T20-AC3, T20-AC4, T20-AC8:** Durable admission transaction
  boundary with concurrent replay, lifecycle redelivery, write-fault injection,
  multiple attempts, and database reopen.
- **T20-AC5:** Existing trusted authorization boundary — verify subject,
  project, thread, approval, active-turn, and provider constraints without
  trusting model-supplied identity.

## Implementation Report

**Implementation state:** completed

**Final acceptance:** Accepted with recorded nonblocking risks by Project
Supervisor on 2026-08-17. See
[`decisions/0004-t20-atomic-authorized-production-admission-final-acceptance.md`](../decisions/0004-t20-atomic-authorized-production-admission-final-acceptance.md).

> Status note: the previous candidate completion claims in this report were
> rejected on review (AC1/2/4/5/6 failed). This report replaces them. The
> remediation is committed locally (no push) and re-verified; residual risks
> are listed under "Deviations and remaining risks".

### Delivered scope

One production admission path for the actual Pi extension's managed `Agent`
tool call: server-minted identity, trusted server authority, atomic durable
execution + first attempt + sequence-1 lifecycle journal, then child start.

- **PiAdapter** (`apps/server/src/provider/Layers/PiAdapter.ts`) installs a
  per-session wrapper around the real extension's `Agent` tool when the
  negotiated capability is managed and the durable repository is present. The
  wrapper: mints a server-scoped command identity (`cmd_<uuid>`) keyed by the
  client correlation identity (`params.commandId ?? toolCallId`); derives
  project/thread/active-turn exclusively from server truth (session input,
  server-tracked active turn, and the genuine `ProjectionSnapshotQuery` read
  service — never extension params); validates subject authority through the
  live `McpSessionAuthority` registry (`assertAdmittable`); runs
  `admitSubagentSpawn`; and only on `accepted` invokes the child with
  server-minted `executionId`/`attemptId`/`generation`. `rejected` and
  `already_applied` never start a child.
- **Admission coordinator** (`apps/server/src/provider/piSubagentAdmissionCoordinator.ts`)
  enforces, in order: managed capability, control health, provider constant
  `pi`, server-minted ownership cross-checks (thread/project/active turn),
  server projection truth (thread existence, archive, project, active turn,
  thread runtime mode), the approval gate, and Decision-21 subject authority
  (`assertAdmittable`). Coordinator-path authorization rejections durably
  record a rejected execution + sequence-1 journal event atomically. Rejections
  before coordinator entry, command-identity conflicts, and persistence
  failures remain terminal and fail closed without claiming a newly persisted
  rejection row.
- **Repository** (`apps/server/src/persistence/Layers/PiSubagentExecutionRepository.ts`)
  commits the execution row and the sequence-1 journal event in one
  transaction (T20-AC2), dedups admission by `(command_id, command_fingerprint)`
  with concurrent-race recovery, and records lifecycle events with
  attempt/generation-local dedup (`event_id` or
  `(execution_id, attempt_id, generation, sequence)`). A same `commandId`
  under a different ownership fingerprint is a deterministic
  `pi_subagent_command_identity_mismatch` rejection — the other execution's
  identities are never returned.
- **Migration 100** (`apps/server/src/persistence/Migrations/100_PiSubagentAdmissionIdentity.ts`)
  appends durable command-ownership columns (`command_fingerprint`,
  `client_command_id`, `subject`), durable first-attempt columns
  (`first_attempt_id`, `first_attempt_generation` + backfill), and rebuilds the
  lifecycle journal table so uniqueness is `(execution_id, attempt_id,
generation, sequence)` — attempt 2 may restart its own sequence at 1. The
  rebuild is guarded on the released 098 pre-state and is a second-pass no-op;
  released 098/099 data is preserved (proven by migration test).
- **Alfie extension** (separate repo, commit `2a3f69bd6`): the `Agent` tool
  schema accepts host-minted `executionId`/`attemptId`/`generation`; the child
  record, child execution identity, bridge spawn result, `getActiveExecutions`,
  and the child transcript output entry carry them verbatim. Legacy spawns
  (no host-minted identity) mint their own record id exactly as before; a
  partial identity set is treated as absent and never fabricated.
- **Production composition**: `PiSubagentExecutionRepositoryLive` is provided
  in both `makeServerRuntimeServicesLayer` and `makeServerProviderLayer`
  (`serverLayers.ts`, `runtimeLayer.ts`); `ProjectionSnapshotQuery` and
  `McpSessionAuthority` resolve from the application graph in production.

### Changed production call chain

```
Actual Agent tool invocation (real Pi extension, loaded from disk)
   │
   ▼
PiAdapter wrapAgentTool (server-scoped command identity minted per session)
   │
   ▼
Genuine ProjectionSnapshotQuery read (server truth: thread/project/runtimeMode)
   │
   ▼
admitSubagentSpawn
   ├─ capability + control health
   ├─ provider = "pi" (adapter constant)
   ├─ server-minted ownership cross-checks (thread/project/turn)
   ├─ projection checks (thread exists, not archived, project, active turn)
   ├─ approval gate (thread.runtimeMode; Pi has no approval gate → fail closed)
   ├─ McpSessionAuthority.assertAdmittable(binding, {projectId}) (Decision 21)
   └─ recordAdmission: [journal seq 1 + execution row] in ONE transaction
        (accepted, or one rejected terminal path)
   │
   ▼
child start ONLY on accepted: childParams carry executionId/attemptId/generation
   → Alfie extension accepts them → child record/identity/transcript carry them
```

### Acceptance evidence matrix

| Criterion | Source evidence                                                                                    | Verification evidence                                                                                                                                                                                                                                                                                              | Result |
| --------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| T20-AC1   | PiAdapter wrap; `runtimeLayer.ts`/`serverLayers.ts` composition; `ProjectionSnapshotQuery` service | `piSubagentRealExtension.test.ts` "T20-AC1…": real extension session; admission observed before child; durable row + sequence-1 journal; child transcript output entry carries the server-minted identity                                                                                                          | Passed |
| T20-AC2   | `recordAdmission` single `sql.withTransaction`                                                     | repo test "cross-fingerprint mid-transaction fault": journal write succeeds, executions INSERT hits the released `command_id` UNIQUE constraint (real injected failure between the two writes) → rollback proven: zero partial journal events, zero partial rows                                                   | Passed |
| T20-AC3   | `(command_id, command_fingerprint)` dedup + race recovery                                          | repo concurrent test (8 callers → 1 admitted/7 already_applied, identical identities); coordinator concurrent same-authority test (8 → 1/7); no raw uniqueness failure                                                                                                                                             | Passed |
| T20-AC4   | attempt/generation-local journal uniqueness (migration 100) + dedup key                            | repo T20-AC4 test: attempt 2 generation 2 sequence 1 recorded (audit repro retired), stale attempt-1 event journaled but aggregate not regressed; journal ordering deterministic (generation, sequence)                                                                                                            | Passed |
| T20-AC5   | coordinator trusted-context + projection + `assertAdmittable`                                      | coordinator tests: missing-binding, unknown-authority, revoked, expired-auth, expired-credential, stale-session-generation, subject-mismatch, project-mismatch, thread hijack, turn mismatch, approval-required, provider mismatch — all rejected with stable diagnostics; cross-authority same-commandId rejected | Passed |
| T20-AC6   | wrap: rejected/already_applied never call the child; accepted runs under server-minted identities  | real-extension test: denied spawn (revoked authority) returns terminal error, zero additional child transcript files; accepted spawn's child transcript records the server-minted identity; wrapper result carries them                                                                                            | Passed |
| T20-AC7   | wrap installed only when `isManaged && repository`; legacy sessions untouched                      | `piSubagentSession.test.ts` T20-AC7 (legacy fixture bypasses admission, no record, no identity) + bridge/legacy tests; real-extension legacy test unchanged                                                                                                                                                        | Passed |
| T20-AC8   | SQLite disk persistence                                                                            | repo disk-reopen test: fresh connection re-reads the same aggregate, ordered journal, fingerprint, subject, first-attempt columns                                                                                                                                                                                  | Passed |

### Failure and diagnostic evidence

- **Provider mismatch:** `pi_subagent_admission_provider_mismatch`.
- **Subject authority:** `pi_subagent_admission_unauthorized` with the
  registry's deterministic reason for missing-binding, unknown-authority,
  revoked, expired-auth, expired-credential, stale-session-generation,
  subject-mismatch, project-mismatch; registry unavailable fails closed.
- **Thread/project/turn:** `pi_subagent_admission_unauthorized` /
  `pi_subagent_admission_project_mismatch` /
  `pi_subagent_admission_active_turn_required` from server truth.
- **Approval:** `pi_subagent_admission_unauthorized` when the thread is
  `approval-required` (Pi provider has no approval gate) — the spawn is
  refused before it runs; no optional booleans are consulted.
- **Command identity collision:** `pi_subagent_command_identity_mismatch`
  (new contract diagnostic) — never the other execution's identities.
- **Persistence fault:** `pi_subagent_lifecycle_persistence_failed`, control
  health degrades, no partial rows (injected mid-transaction fault test).
- **Mid-transaction rollback:** the cross-fingerprint conflict test proves the
  journal row written inside the transaction is rolled back when the
  executions INSERT fails (zero partial journal/execution rows).

### Verification commands and results

Commands (focused; `bun run ... test` per project convention; no fmt/lint/
typecheck were run — owner did not authorize those heavyweight commands; the
production code was verified type-correct by static inspection):

```
ALFIE_REPO_DIR=/private/tmp/alfie-issue20-remediation bun run --cwd apps/server test \
  src/persistence/Layers/PiSubagentExecutionRepository.test.ts \
  src/persistence/Migrations/100_PiSubagentAdmissionIdentity.test.ts \
  src/provider/piSubagentAdmissionCoordinator.test.ts \
  src/provider/piSubagentBridge.test.ts \
  src/provider/piSubagentRealExtension.test.ts \
  src/provider/piSubagentSession.test.ts
```

- Result: 6 files passed, 62 tests passed (baseline candidate was 5 files /
  51 tests; the suite grew with the remediation tests).
- Migration suites: `Migrations.test.ts` + `MigrationReplay.test.ts` +
  `MigrationLineageReconciliation.test.ts` → 3 files, 28 tests passed
  (updated for migration 100 in the tracker expectations).
- `scripts/check-migration-lineage.test.ts` → 11 tests passed (lineage
  checker accepts migration 100).
- Alfie worktree: `bun run test` → 28 files, 451 tests passed (baseline 28 /
  443).
- Concurrency: 8-way concurrent replay converges to 1 admitted + 7
  already_applied with identical identities (repo and coordinator levels).
- Disk reopen: temporary SQLite file admitted → closed → reopened with a fresh
  layer → same aggregate, ordered journal, fingerprint/subject/first-attempt
  columns.
- Real extension: 9/9 tests including provenance (pinned commit + SHA-256
  hashes) against the Alfie remediation worktree.

### Migration compatibility evidence

- Applied lineage through 099, seeded 098/099-shaped rows, applied migration
  100: rows preserved byte-for-byte (executions + both journal events),
  `first_attempt_id`/`first_attempt_generation` backfilled from the admission
  attempt, `command_fingerprint` defaulted to `''` for legacy rows, and
  attempt 2 generation 2 sequence 1 INSERT succeeds (unique
  `(execution_id, attempt_id, generation, sequence)`).
- Second pass of migration 100 is a no-op (guard on the released
  `UNIQUE (execution_id, sequence)` pre-state in `sqlite_master`).
- Released 098/099 migrations are untouched; fresh databases run 1–100.
- Accepted lineage baseline: Decision 0002 (Symphony `42694412`; migrations
  090–099), Decision 0003 (Symphony `d44c6ef6`, Alfie `b34255e0`).

### Real-Pi evidence

- Actual `@alfie/pi-subagents` extension loaded from disk (provenance
  verified: Git origin, HEAD `2a3f69bd6`, clean extension path, package
  identity, SHA-256 hashes of `package.json`, `src/index.ts`,
  `src/agent-manager.ts`).
- Accepted spawn: admission observed via the `onSubagentAdmission` seam
  BEFORE child start; server-minted `executionId`/`attemptId`/`generation`
  returned; the real child's transcript output file (written by the actual
  extension for the actual child record) records the exact server-minted
  identity — this is what the child received, not wrapper output.
- Denied spawn (authority revoked between calls): terminal
  `pi_subagent_admission_unauthorized` error; child invocation count zero
  (no additional transcript file); rejection durable with the client
  correlation preserved.
- Cross-authority: thread B replaying thread A's extension-supplied
  `commandId` receives its OWN server-minted execution (audit repro #2
  retired end-to-end); coordinator-level test additionally proves a replay of
  the same commandId under a different subject is refused
  (`pi_subagent_command_identity_mismatch`).

### Deviations and remaining risks

- **Approval dimension (T20-AC5):** the Pi provider session has NO approval
  gate (`PiAdapter.respondToRequest` is unsupported; the server's approval
  receipts, `projection_pending_interactions`, are populated only by
  provider-raised approval requests, which Pi never raises; the extension's
  Agent tool has no approval flow). The remediation therefore verifies the
  approval constraint from server truth: the thread's `runtimeMode`
  (`full-access`/`auto` → no approval gate needed for the managed spawn;
  `approval-required` → refused before it runs with a stable diagnostic),
  following the existing gateless-provider precedent
  (`BrowserDownloadApprovalRequired`/`DeviceApprovalRequired`). Optional
  approval booleans are never accepted. A managed spawn in an
  approval-required Pi thread is intentionally refused; if the owner wants
  approval-required Pi threads to admit managed spawns, that requires a real
  approval surface (provider approval requests for Pi or a durable approval
  receipt flow) — out of Issue-20 scope.
- **Thread-missing pre-coordinator corner:** when the session's thread row is
  absent from the projection snapshot, the PiAdapter wrap returns a terminal
  rejection without persisting a row (there is no server truth to correlate);
  all other rejection paths persist a rejected execution + journal event.
- **Child model:** the real-extension test's child has no model in the
  hermetic agent dir, so the child fails fast after its record + transcript
  are created; the assertion targets the child's durable receipt of the
  server-minted identity, not child completion.
- **`getByCommandId`** remains a commandId-only correlation read; the
  admission dedup path always uses `(commandId, fingerprint)`.
- **Typecheck not run** (not authorized); production code was verified
  type-correct by static inspection and by the focused suites exercising every
  changed production path.
- Not exercised: Issue-21 control-health recovery, Issue-22 detach behavior,
  Issue-23 progress/leases/saturation, Issue-24 final integrated acceptance —
  all out of scope by contract.

### Commits

- Alfie (writable worktree `/private/tmp/alfie-issue20-remediation`, branch
  `issue20-server-minted-identity`, parent `b34255e0c`):
  `2a3f69bd6af47dda4ef1966eaa709d47cc0d7d39`
  "feat(pi-subagents): accept server-minted managed execution identity at
  spawn (issue 20)". Working tree clean.
- Symphony (isolated worktree, chain
  `bc4b3050e` → candidate cherry-pick `8061a09e` → remediation commit
  "fix(pi): remediate issue 20 atomic authorized production admission",
  which is the HEAD of the isolated worktree at the time of this report; the
  exact SHA is `git rev-parse HEAD` in that worktree). The canonical
  `/Users/anhpham99/symphony` checkout was never modified, staged, committed,
  or reset. No push was performed (pushed: no).
- Provenance fixture `piSubagentExtensionProvenance.json` updated to the new
  Alfie commit and exact SHA-256 hashes.

### Reviewer handoff

Reproductions (focused commands, no fmt/lint/typecheck):

```bash
# Alfie (remediation worktree)
cd /private/tmp/alfie-issue20-remediation/agent/extensions/pi-subagents
bun run test

# Symphony (isolated worktree) — authorized success, denied spawn, concurrent
# replay, write-fault, attempt-2 restart, reopen
cd <isolated-symphony-worktree>
ALFIE_REPO_DIR=/private/tmp/alfie-issue20-remediation bun run --cwd apps/server test \
  src/persistence/Layers/PiSubagentExecutionRepository.test.ts \
  src/persistence/Migrations/100_PiSubagentAdmissionIdentity.test.ts \
  src/provider/piSubagentAdmissionCoordinator.test.ts \
  src/provider/piSubagentRealExtension.test.ts \
  src/provider/piSubagentSession.test.ts \
  src/provider/piSubagentBridge.test.ts
```

The `onSubagentAdmission` observer in `piSubagentRealExtension.test.ts`
replays the exact authorized accepted/denied/cross-authority sequences against
the real extension.
