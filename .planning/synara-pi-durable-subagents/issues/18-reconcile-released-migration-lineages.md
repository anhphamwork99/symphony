# 18 — Reconcile released migration lineages

**What to build:** Existing Symphony and upstream Synara databases can both
open and migrate safely without treating different released migrations as the
same history. The project establishes an explicit compatibility mapping for the
diverged migration region, ports every required upstream schema change, and
allocates Pi-subagent schema additions only after the reconciled range. Fresh,
Symphony-lineage, and upstream-v0.7.2 databases converge on the intended schema
without replaying unrelated migrations or losing data.

**Blocked by:** None — can start immediately.

**Status:** completed

- [x] **T18-AC1:** The checked-in migration sequence contains no unreviewed
  reuse of an `(id, name)` pair already released by either supported lineage.
- [x] **T18-AC2:** The existing Symphony migration at the divergence point
  remains compatible with databases that already applied it; no blind renumber
  invalidates those databases.
- [x] **T18-AC3:** Every upstream v0.7.2 migration in the conflicting range is
  represented or deliberately reconciled with evidence; no upstream schema
  behavior silently disappears.
- [x] **T18-AC4:** Pi-subagent execution and lease/progress schema changes use
  non-conflicting lineage entries and remain idempotent.
- [x] **T18-AC5:** Fresh, Symphony-lineage, and upstream-v0.7.2 fixtures migrate
  successfully to equivalent intended schema while preserving representative
  pre-existing data.
- [x] **T18-AC6:** The migration-lineage checker exits successfully without an
  alias between migrations that differ in schema or semantics.
- [x] **T18-AC7:** A second startup/migration pass is a no-op and produces no
  duplicate tables, columns, indexes, or data transformation.

## Testing Seams

**Approval status:** Approved — owner approved the remediation breakdown and
known seams on 2026-08-16.

- **T18-AC1, T18-AC2, T18-AC3, T18-AC4, T18-AC6:** Migration lineage checker —
  detect released-ID/name conflicts and reject unjustified aliases.
- **T18-AC5, T18-AC7:** Server persistence startup against three durable
  database-history fixtures — migrate twice, inspect schema, and verify
  representative data survival.
- **T18-AC3, T18-AC5:** Schema-contract comparison — prove each required
  upstream behavior is present after convergence rather than merely making the
  lineage checker green.

## Implementation Report

**Implementation state:** complete

### Delivered scope

1. **Ported Upstream v0.7.2 Migrations (90–96):**
   - `090_ProjectionThreadMessageTextSegments.ts`: creates `message_text_segments` table.
   - `091_AutomationFailureTolerance.ts`: adds `stop_after_consecutive_failures`, `consecutive_failure_count`, `disabled_reason`, `disabled_at` to `automation_definitions`.
   - `092_BackfillAutomationRunThreadSource.ts`: backfills `creationSource = 'automation_run'` on standalone run threads.
   - `093_BackfillMaxIterationsDisabledReason.ts`: backfills `disabled_reason = 'max-iterations'` where iteration cap was reached.
   - `094_ProjectionThreadsGoal.ts`: adds `goal` column to `projection_threads`.
   - `095_ProjectionThreadsGoalTiming.ts`: adds `goal_started_at`, `goal_paused_at` to `projection_threads`.
   - `096_ProjectionThreadsGoalAchievements.ts`: adds `goal_achievements_json` to `projection_threads`.
2. **Relocated Symphony Feature Migration (97):**
   - `097_ProjectMcpActivation.ts` (relocated from 90): idempotently adds `synara_mcp_desired_state`, `synara_mcp_activation_version`, `synara_mcp_activation_operation_json` to `projection_projects`.
3. **Allocated Pi-Subagent Schema (98–99):**
   - `098_PiSubagentExecutions.ts`: creates `pi_subagent_executions` and `pi_subagent_lifecycle_journal` tables and indexes.
   - `099_PiSubagentLeasesAndProgress.ts`: adds heartbeat, lease expiry, progress JSON, and dropped progress count columns.
4. **Explicit Lineage Compatibility Mapping:**
   - Declared alias in `MIGRATION_LINEAGE_ALIASES` in `apps/server/src/persistence/Migrations.ts`:
     `{ historicalId: 90, historicalName: "ProjectMcpActivation", currentId: 97, historicalSlotRequiresRerun: true }`.
   - Supports 3 distinct database histories:
     - Fresh databases (applies 1..99 cleanly).
     - Symphony-lineage databases (shipped in `v0.7.2-symphony.1` / `v0.7.2-symphony.2` with migration 90 as `ProjectMcpActivation`): slot 90 is cleared by alias repair, upstream 90..96 apply, 97 applies idempotently preserving existing MCP activation data, and 98..99 apply.
     - Upstream-v0.7.2 databases (shipped with migrations 1..96): migrations 97..99 apply cleanly without replaying or deleting 1..96, preserving all pre-existing text segments, goals, and automation definitions.

### Changed production call chain

1. **Database Startup Ingress:**
   `NodeSqliteClient.layer` -> `SqlitePersistence.runMigrations` -> `reconcileMigrationLineage`
2. **Lineage Reconciliation Execution:**
   - Queries `effect_sql_migrations`.
   - Evaluates `planMigrationLineageAliasRepairs`: matches Symphony historical `[90, "ProjectMcpActivation"]`.
   - Emits `{ kind: "remove", migrationId: 90 }` and deletes tracker row 90 so upstream migrations are not skipped.
   - Migrator runs pending migrations: 90..96 (upstream schema additions), 97 (ProjectMcpActivation checks `columnExists` and preserves existing columns/data), 98 (pi_subagent_executions table creation), 99 (pi_subagent progress columns).
3. **Pi-Subagent Persistence Availability:**
   - `PiSubagentExecutionRepositoryLive` accesses `pi_subagent_executions` and `pi_subagent_lifecycle_journal` reliably across fresh, Symphony, and upstream migrated databases.

### Acceptance evidence matrix

| Criterion | Source evidence | Verification evidence | Result |
| --- | --- | --- | --- |
| T18-AC1 | `apps/server/src/persistence/Migrations.ts` (lines 211–224) | `node scripts/check-migration-lineage.ts` (exit code 0 across 84 release tags) | passed |
| T18-AC2 | `apps/server/src/persistence/Migrations.ts` (`MIGRATION_LINEAGE_ALIASES`), `apps/server/src/persistence/Migrations.test.ts` (`releasedSymphonyV072Layer`) | `vitest run src/persistence/Migrations.test.ts` (asserts pre-existing `synara_mcp_desired_state` and activation version survive) | passed |
| T18-AC3 | `apps/server/src/persistence/Migrations/090..096` | `vitest run src/persistence/Migrations/091..094*.test.ts`, `vitest run src/persistence/Migrations/MigrationLineageReconciliation.test.ts` | passed |
| T18-AC4 | `apps/server/src/persistence/Migrations/098..099`, `apps/server/src/persistence/Layers/PiSubagentExecutionRepository.test.ts` | `vitest run src/persistence/Layers/PiSubagentExecutionRepository.test.ts` (8 tests pass) | passed |
| T18-AC5 | `apps/server/src/persistence/Migrations/MigrationLineageReconciliation.test.ts` | Fresh, Symphony, and Upstream fixtures migrate and compare `sqlite_master` objects byte-for-byte; pre-existing rows verified | passed |
| T18-AC6 | `scripts/check-migration-lineage.ts`, `scripts/check-migration-lineage.test.ts` | `vitest run scripts/check-migration-lineage.test.ts` (11 tests pass), `node scripts/check-migration-lineage.ts` (code 0) | passed |
| T18-AC7 | `apps/server/src/persistence/Migrations/MigrationLineageReconciliation.test.ts` | Second and third `runMigrations()` passes return `[]`, assert 0 schema mutations or data changes | passed |

### Failure and diagnostic evidence

1. **Unregistered divergence / unrecognized foreign lineage:**
   Verified in `Migrations.test.ts` ("refuses to run when the divergence is inside the shared lineage prefix"): fails closed with `MigrationLineageError`.
2. **Schema too new:**
   Verified in `Migrations.test.ts` ("refuses writable migration startup for a newer Synara schema"): fails closed with `MigrationSchemaTooNewError`.
3. **Invalid alias declaration:**
   Verified in `Migrations.test.ts` ("declines when the tracker also diverges outside the alias"): ignores invalid alias and takes standard safe truncation/replay path.

### Verification commands and results

```bash
# 1. Migration Lineage Checker (CI preflight)
node scripts/check-migration-lineage.ts
# Result: Migration lineage check passed: all migrations shipped across 84 release tags (v0.0.16..v0.7.2-symphony.2) keep their released (id, name). Exit 0.

# 2. Lineage Guard Unit Tests
bun x vitest run scripts/check-migration-lineage.test.ts
# Result: 1 passed (11 tests passed), Duration 126ms. Exit 0.

# 3. Dedicated 3-Fixture Lineage Reconciliation Tests
bun --cwd apps/server run test src/persistence/Migrations/MigrationLineageReconciliation.test.ts
# Result: 1 passed (4 tests passed), Duration 752ms. Exit 0.

# 4. Server Migration Replay & Unit Tests
bun --cwd apps/server run test src/persistence/Migrations.test.ts src/persistence/Migrations/
# Result: 32 passed (69 tests passed), Duration 10.10s. Exit 0.

# 5. Pi-Subagent Persistence Tests
bun --cwd apps/server run test src/persistence/Layers/PiSubagentExecutionRepository.test.ts
# Result: 1 passed (8 tests passed), Duration 762ms. Exit 0.
```

### Migration compatibility evidence

- **Fresh database:** Empty SQLite database applies migrations 1..99 in sequence. Full schema generated matching production contracts.
- **Symphony lineage database:** Database with applied migrations 1..90 (`ProjectMcpActivation`) and pre-existing project rows. `reconcileMigrationLineage` deletes tracker row 90, runs 90..96 (upstream), runs 97 (`ProjectMcpActivation`) idempotently, runs 98..99. Pre-existing `synara_mcp_desired_state` and activation metadata preserved.
- **Upstream v0.7.2 database:** Database with applied migrations 1..96 and pre-existing message text segments, thread goals, and automation definition failure tolerance. Migrations 97..99 run cleanly without modifying 1..96. Pre-existing goals, message segments, and failure tolerance data preserved.
- **Schema equivalence:** `MigrationLineageReconciliation.test.ts` confirmed `sqlite_master` schema objects (`tables`, `columns`, `indexes`) across all 3 databases are 100% identical post-migration.

### Real-Pi evidence

Not applicable — database schema and migration reconciliation tier.

### Deviations and remaining risks

None. All 84 git release tags in the repository history are verified against the canonical lineage and allowances.

### Commits

- Changes in `apps/server/src/persistence/Migrations.ts`, `apps/server/src/persistence/Migrations/`, `apps/server/src/persistence/Migrations.test.ts`, `scripts/check-migration-lineage.test.ts`.

### Reviewer handoff

To reproduce verification:
```bash
# Verify migration lineage checker against all tags
node scripts/check-migration-lineage.ts

# Verify lineage unit tests
bun x vitest run scripts/check-migration-lineage.test.ts

# Verify 3-fixture convergence and idempotency
bun --cwd apps/server run test src/persistence/Migrations/MigrationLineageReconciliation.test.ts

# Verify full migration suite
bun --cwd apps/server run test src/persistence/Migrations.test.ts src/persistence/Migrations/
```
