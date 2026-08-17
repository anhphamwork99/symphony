import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { Cause, Effect, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";

import type { ThreadId } from "@synara/contracts";

import { makeSqlitePersistenceLive } from "../persistence/Layers/Sqlite.ts";
import {
  makePiSubagentExecutionRepository,
  PiSubagentExecutionRepositoryLive,
} from "../persistence/Layers/PiSubagentExecutionRepository.ts";
import {
  PiSubagentExecutionRepository,
  type PiSubagentExecutionRecord,
  type PiSubagentJournalEvent,
} from "../persistence/Services/PiSubagentExecutionRepository.ts";

describe("PiSubagentForegroundReopen (T22-AC4)", () => {
  it("T22-AC4: file-backed SQLite persists detached foreground execution and recovers exact non-terminal aggregate and ordered journal across reopen", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "synara-t22-reopen-"));
    const dbPath = path.join(tempDir, "state.sqlite");

    const executionId = "exec_t22_reopen_001";
    const attemptId = "att_t22_reopen_001";
    const generation = 1;
    const commandId = "cmd_t22_reopen_001";
    const threadId = "th_t22_reopen_1" as ThreadId;
    const parentTurnId = "turn_t22_1";
    const parentToolCallId = "call_t22_1";
    const projectId = "proj_t22";
    const foregroundWaitMs = 5000;

    const acceptedAt = "2026-08-17T09:00:00.000Z";
    const startedAt = "2026-08-17T09:00:00.100Z";
    const detachedAt = "2026-08-17T09:00:05.100Z";

    try {
      // ---------------------------------------------------------------------
      // Phase 1: Open file-backed SQLite, record admission (seq 1), started (seq 2), and detached (seq 3)
      // ---------------------------------------------------------------------
      await Effect.runPromise(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const repo = yield* PiSubagentExecutionRepository;

          // Insert projection project and thread prerequisites
          yield* sql`
            INSERT OR IGNORE INTO projection_projects (
              project_id, kind, title, workspace_root, default_model_selection_json,
              scripts_json, created_at, updated_at
            ) VALUES (
              'proj_t22', 'project', 'T22 Project', ${tempDir}, '{"provider":"pi","model":"pi"}',
              '[]', '2026-08-17T09:00:00.000Z', '2026-08-17T09:00:00.000Z'
            )
          `;
          yield* sql`
            INSERT OR IGNORE INTO projection_threads (
              thread_id, project_id, title, model_selection_json,
              runtime_mode, interaction_mode, env_mode, created_at, updated_at, deleted_at
            ) VALUES (
              'th_t22_reopen_1', 'proj_t22', 'Reopen Thread',
              '{"provider":"pi","model":"pi"}',
              'full-access', 'default', 'local',
              '2026-08-17T09:00:00.000Z', '2026-08-17T09:00:00.000Z', NULL
            )
          `;

          // Sequence 1: Admission (accepted)
          const admission = yield* repo.recordAdmission({
            executionId,
            attemptId,
            generation,
            commandId,
            parentThreadId: threadId,
            parentTurnId,
            parentToolCallId,
            projectId,
            agentType: "researcher",
            prompt: "Test durable reopen after foreground detach",
            mode: "foreground",
            cancellationScope: "parent_turn",
            commandFingerprint: "fingerprint_t22_reopen_001",
            state: "accepted",
            now: acceptedAt,
            subject: "user_t22_reopen",
          });
          expect(admission.kind).toBe("admitted");

          // Sequence 2: Started (running) with bounded metadata
          const startedMetadata = {
            phase: "started",
            occurredAt: startedAt,
            attachmentMode: "foreground",
            foregroundWaitMs,
          };
          yield* repo.recordLifecycleEvent({
            eventId: `evt_${executionId}_${attemptId}_gen${generation}_seq2_started`,
            executionId,
            attemptId,
            generation,
            sequence: 2,
            state: "running",
            occurredAt: startedAt,
            metadataJson: JSON.stringify(startedMetadata),
          });

          // Sequence 3: Detached (running) with bounded metadata
          const detachedMetadata = {
            phase: "detached",
            occurredAt: detachedAt,
            attachmentMode: "foreground",
            foregroundWaitMs,
          };
          yield* repo.recordLifecycleEvent({
            eventId: `evt_${executionId}_${attemptId}_gen${generation}_seq3_detached`,
            executionId,
            attemptId,
            generation,
            sequence: 3,
            state: "running",
            occurredAt: detachedAt,
            metadataJson: JSON.stringify(detachedMetadata),
          });

          // Verify state before closing
          const initialRecord = yield* repo.getById(executionId);
          expect(Option.isSome(initialRecord)).toBe(true);
          if (Option.isSome(initialRecord)) {
            expect(initialRecord.value.observedState).toBe("running");
            expect(initialRecord.value.attemptId).toBe(attemptId);
            expect(initialRecord.value.generation).toBe(generation);
          }
        }).pipe(
          Effect.provide(
            PiSubagentExecutionRepositoryLive.pipe(
              Layer.provideMerge(
                makeSqlitePersistenceLive(dbPath).pipe(Layer.provide(NodeServices.layer)),
              ),
            ),
          ),
        ),
      );

      // ---------------------------------------------------------------------
      // Phase 2: Reopen the database from disk with a fresh Layer and verify
      // ---------------------------------------------------------------------
      await Effect.runPromise(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const repo = yield* PiSubagentExecutionRepository;

          // 1. Verify execution aggregate recovery via repository service
          const fetchedOption = yield* repo.getById(executionId);
          expect(Option.isSome(fetchedOption)).toBe(true);
          if (Option.isNone(fetchedOption)) return;

          const aggregate = fetchedOption.value;
          expect(aggregate.executionId).toBe(executionId);
          expect(aggregate.commandId).toBe(commandId);
          expect(aggregate.parentThreadId).toBe(threadId);
          expect(aggregate.parentTurnId).toBe(parentTurnId);
          expect(aggregate.parentToolCallId).toBe(parentToolCallId);
          expect(aggregate.projectId).toBe(projectId);
          expect(aggregate.agentType).toBe("researcher");
          expect(aggregate.mode).toBe("foreground");
          expect(aggregate.cancellationScope).toBe("parent_turn");
          expect(aggregate.observedState).toBe("running"); // Non-terminal running state
          expect(aggregate.attemptId).toBe(attemptId);
          expect(aggregate.generation).toBe(generation);

          // 2. Verify complete ordered journal recovery via repository service
          const journal = yield* repo.listJournalEvents(executionId);
          expect(journal).toHaveLength(3);

          // Sequence 1: accepted
          const seq1 = journal[0]!;
          expect(seq1.sequence).toBe(1);
          expect(seq1.state).toBe("accepted");
          expect(seq1.executionId).toBe(executionId);
          expect(seq1.attemptId).toBe(attemptId);
          expect(seq1.generation).toBe(generation);
          expect(seq1.occurredAt).toBe(acceptedAt);

          // Sequence 2: running / started
          const seq2 = journal[1]!;
          expect(seq2.sequence).toBe(2);
          expect(seq2.state).toBe("running");
          expect(seq2.executionId).toBe(executionId);
          expect(seq2.attemptId).toBe(attemptId);
          expect(seq2.generation).toBe(generation);
          expect(seq2.occurredAt).toBe(startedAt);
          expect(seq2.metadata).toEqual({
            phase: "started",
            occurredAt: startedAt,
            attachmentMode: "foreground",
            foregroundWaitMs,
          });

          // Sequence 3: running / detached
          const seq3 = journal[2]!;
          expect(seq3.sequence).toBe(3);
          expect(seq3.state).toBe("running");
          expect(seq3.executionId).toBe(executionId);
          expect(seq3.attemptId).toBe(attemptId);
          expect(seq3.generation).toBe(generation);
          expect(seq3.occurredAt).toBe(detachedAt);
          expect(seq3.metadata).toEqual({
            phase: "detached",
            occurredAt: detachedAt,
            attachmentMode: "foreground",
            foregroundWaitMs,
          });

          // 3. Raw SQL verification of on-disk SQLite schema columns
          const execRows = yield* sql<{
            readonly execution_id: string;
            readonly command_id: string;
            readonly observed_state: string;
            readonly attempt_id: string;
            readonly generation: number;
            readonly first_attempt_id: string;
            readonly first_attempt_generation: number;
            readonly command_fingerprint: string;
            readonly subject: string;
          }>`
            SELECT
              execution_id,
              command_id,
              observed_state,
              attempt_id,
              generation,
              first_attempt_id,
              first_attempt_generation,
              command_fingerprint,
              subject
            FROM pi_subagent_executions
            WHERE execution_id = ${executionId}
          `;
          expect(execRows).toHaveLength(1);
          const execRow = execRows[0]!;
          expect(execRow.execution_id).toBe(executionId);
          expect(execRow.command_id).toBe(commandId);
          expect(execRow.observed_state).toBe("running");
          expect(execRow.attempt_id).toBe(attemptId);
          expect(execRow.generation).toBe(generation);
          expect(execRow.first_attempt_id).toBe(attemptId);
          expect(execRow.first_attempt_generation).toBe(generation);
          expect(execRow.command_fingerprint).toBe("fingerprint_t22_reopen_001");
          expect(execRow.subject).toBe("user_t22_reopen");

          const eventRows = yield* sql<{
            readonly event_id: string;
            readonly sequence: number;
            readonly state: string;
            readonly metadata_json: string | null;
          }>`
            SELECT event_id, sequence, state, metadata_json
            FROM pi_subagent_lifecycle_journal
            WHERE execution_id = ${executionId}
            ORDER BY sequence ASC
          `;
          expect(eventRows).toHaveLength(3);
          expect(eventRows[0]!.sequence).toBe(1);
          expect(eventRows[0]!.state).toBe("accepted");

          expect(eventRows[1]!.sequence).toBe(2);
          expect(eventRows[1]!.state).toBe("running");
          expect(JSON.parse(eventRows[1]!.metadata_json!)).toEqual({
            phase: "started",
            occurredAt: startedAt,
            attachmentMode: "foreground",
            foregroundWaitMs,
          });

          expect(eventRows[2]!.sequence).toBe(3);
          expect(eventRows[2]!.state).toBe("running");
          expect(JSON.parse(eventRows[2]!.metadata_json!)).toEqual({
            phase: "detached",
            occurredAt: detachedAt,
            attachmentMode: "foreground",
            foregroundWaitMs,
          });
        }).pipe(
          Effect.provide(
            PiSubagentExecutionRepositoryLive.pipe(
              Layer.provideMerge(
                makeSqlitePersistenceLive(dbPath).pipe(Layer.provide(NodeServices.layer)),
              ),
            ),
          ),
        ),
      );

      // ---------------------------------------------------------------------
      // Phase 3: Multiple concurrent executions with mixed lifecycles surviving reopen
      // ---------------------------------------------------------------------
      const exec2 = "exec_t22_reopen_002_inline";
      const exec3 = "exec_t22_reopen_003_completed_after_detach";

      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* PiSubagentExecutionRepository;

          // Exec 2: Fast inline (seq 1 accepted -> seq 2 started -> seq 3 completed)
          yield* repo.recordAdmission({
            executionId: exec2,
            attemptId: "att_002",
            generation: 1,
            commandId: "cmd_t22_reopen_002",
            parentThreadId: threadId,
            parentTurnId,
            parentToolCallId,
            projectId,
            agentType: "researcher",
            prompt: "Fast inline task",
            mode: "foreground",
            cancellationScope: "parent_turn",
            commandFingerprint: "fingerprint_002",
            state: "accepted",
            now: "2026-08-17T09:01:00.000Z",
            subject: "user_t22_reopen",
          });
          yield* repo.recordLifecycleEvent({
            eventId: "evt_002_started",
            executionId: exec2,
            attemptId: "att_002",
            generation: 1,
            sequence: 2,
            state: "running",
            occurredAt: "2026-08-17T09:01:00.100Z",
            metadataJson: JSON.stringify({
              phase: "started",
              occurredAt: "2026-08-17T09:01:00.100Z",
              attachmentMode: "foreground",
              foregroundWaitMs,
            }),
          });
          yield* repo.recordLifecycleEvent({
            eventId: "evt_002_completed",
            executionId: exec2,
            attemptId: "att_002",
            generation: 1,
            sequence: 3,
            state: "completed",
            occurredAt: "2026-08-17T09:01:00.500Z",
          });

          // Exec 3: Detached running that settled later (seq 1 -> seq 2 -> seq 3 detached -> seq 4 completed)
          yield* repo.recordAdmission({
            executionId: exec3,
            attemptId: "att_003",
            generation: 1,
            commandId: "cmd_t22_reopen_003",
            parentThreadId: threadId,
            parentTurnId,
            parentToolCallId,
            projectId,
            agentType: "researcher",
            prompt: "Long task completed later",
            mode: "foreground",
            cancellationScope: "parent_turn",
            commandFingerprint: "fingerprint_003",
            state: "accepted",
            now: "2026-08-17T09:02:00.000Z",
            subject: "user_t22_reopen",
          });
          yield* repo.recordLifecycleEvent({
            eventId: "evt_003_started",
            executionId: exec3,
            attemptId: "att_003",
            generation: 1,
            sequence: 2,
            state: "running",
            occurredAt: "2026-08-17T09:02:00.100Z",
            metadataJson: JSON.stringify({
              phase: "started",
              occurredAt: "2026-08-17T09:02:00.100Z",
              attachmentMode: "foreground",
              foregroundWaitMs,
            }),
          });
          yield* repo.recordLifecycleEvent({
            eventId: "evt_003_detached",
            executionId: exec3,
            attemptId: "att_003",
            generation: 1,
            sequence: 3,
            state: "running",
            occurredAt: "2026-08-17T09:02:05.100Z",
            metadataJson: JSON.stringify({
              phase: "detached",
              occurredAt: "2026-08-17T09:02:05.100Z",
              attachmentMode: "foreground",
              foregroundWaitMs,
            }),
          });
          yield* repo.recordLifecycleEvent({
            eventId: "evt_003_completed",
            executionId: exec3,
            attemptId: "att_003",
            generation: 1,
            sequence: 4,
            state: "completed",
            occurredAt: "2026-08-17T09:02:10.000Z",
          });
        }).pipe(
          Effect.provide(
            PiSubagentExecutionRepositoryLive.pipe(
              Layer.provideMerge(
                makeSqlitePersistenceLive(dbPath).pipe(Layer.provide(NodeServices.layer)),
              ),
            ),
          ),
        ),
      );

      // Reopen again and check all 3 executions independently
      await Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* PiSubagentExecutionRepository;

          // Exec 1 remains detached running
          const rec1 = (yield* repo.getById(executionId)).pipe(Option.getOrThrow);
          expect(rec1.observedState).toBe("running");
          const j1 = yield* repo.listJournalEvents(executionId);
          expect(j1).toHaveLength(3);
          expect(j1.map((e) => e.sequence)).toEqual([1, 2, 3]);

          // Exec 2 is completed inline
          const rec2 = (yield* repo.getById(exec2)).pipe(Option.getOrThrow);
          expect(rec2.observedState).toBe("completed");
          const j2 = yield* repo.listJournalEvents(exec2);
          expect(j2).toHaveLength(3);
          expect(j2.map((e) => e.state)).toEqual(["accepted", "running", "completed"]);

          // Exec 3 is completed after detach
          const rec3 = (yield* repo.getById(exec3)).pipe(Option.getOrThrow);
          expect(rec3.observedState).toBe("completed");
          const j3 = yield* repo.listJournalEvents(exec3);
          expect(j3).toHaveLength(4);
          expect(j3.map((e) => e.state)).toEqual(["accepted", "running", "running", "completed"]);
          expect(j3[1]!.metadata).toMatchObject({ phase: "started" });
          expect(j3[2]!.metadata).toMatchObject({ phase: "detached" });
        }).pipe(
          Effect.provide(
            PiSubagentExecutionRepositoryLive.pipe(
              Layer.provideMerge(
                makeSqlitePersistenceLive(dbPath).pipe(Layer.provide(NodeServices.layer)),
              ),
            ),
          ),
        ),
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
