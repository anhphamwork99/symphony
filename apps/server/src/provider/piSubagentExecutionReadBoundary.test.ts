import type {
  PiSubagentCancellationScope,
  PiSubagentExecutionRecord,
  PiSubagentLifecycleState,
} from "@synara/contracts";
import { ProjectId, ThreadId } from "@synara/contracts";
import { Effect, Layer, Option } from "effect";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PiSubagentExecutionRepositoryLive } from "../persistence/Layers/PiSubagentExecutionRepository.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { PiSubagentExecutionRepository } from "../persistence/Services/PiSubagentExecutionRepository.ts";
import type { ProjectionSnapshotQueryShape } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ingestPiSubagentTerminal } from "./piSubagentTerminalCoordinator.ts";
import {
  makePiSubagentExecutionReadService,
  piSubagentReadDenialToWsRpcError,
} from "./piSubagentExecutionReadService.ts";
import { reconcilePiSubagentExecutions } from "./piSubagentRestartReconciliation.ts";

/**
 * Ticket 12 — authorized transcript-read command boundary (approved Testing
 * Seams: T12-AC1/AC2/AC3/AC7 fixtures for project/thread authorization,
 * pagination, missing, and corrupt evidence).
 *
 * The repository layer is the REAL repository over in-memory SQLite; the
 * projection snapshot query is faked to the narrow getThreadShellById seam
 * the boundary consumes (thread existence + trusted projectId).
 */

const repositoryLayer = PiSubagentExecutionRepositoryLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
);

const SUMMARY_MAX_CHARS = 2000;

function makeExecution(overrides?: Partial<PiSubagentExecutionRecord>): PiSubagentExecutionRecord {
  return {
    executionId: "exec_t12_1",
    attemptId: "att_t12_1",
    generation: 1,
    commandId: "cmd_t12_1",
    projectId: "proj_default" as ProjectId,
    parentThreadId: "th_t12" as ThreadId,
    parentTurnId: null,
    parentToolCallId: "call_t12",
    agentType: "general-purpose",
    prompt: "task",
    mode: "background",
    cancellationScope: "parent_turn" as PiSubagentCancellationScope,
    desiredState: "running" as PiSubagentLifecycleState,
    observedState: "running" as PiSubagentLifecycleState,
    createdAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T00:00:00.000Z",
    ...overrides,
  };
}

interface SnapshotHarness {
  readonly threads: Map<string, string>;
  readonly snapshotQuery: Pick<ProjectionSnapshotQueryShape, "getThreadShellById">;
}

function makeSnapshotHarness(
  threads: Record<string, string> = { th_t12: "proj_default" },
): SnapshotHarness {
  const map = new Map(Object.entries(threads));
  const snapshotQuery: Pick<ProjectionSnapshotQueryShape, "getThreadShellById"> = {
    getThreadShellById: (threadId: ThreadId) =>
      // The read boundary consumes ONLY id + projectId of the shell; the
      // narrow fake keeps the harness honest about the consumed surface.
      Effect.succeed(
        map.has(threadId)
          ? (Option.some({ id: threadId, projectId: map.get(threadId)! }) as never)
          : Option.none(),
      ),
  };
  return { threads: map, snapshotQuery };
}

const admit = (record: PiSubagentExecutionRecord) =>
  Effect.gen(function* () {
    const repository = yield* PiSubagentExecutionRepository;
    const result = yield* repository.recordAdmission({
      executionId: record.executionId,
      attemptId: record.attemptId,
      generation: record.generation,
      commandId: record.commandId,
      commandFingerprint: `fp_${record.commandId}`,
      projectId: record.projectId,
      parentThreadId: record.parentThreadId,
      parentTurnId: record.parentTurnId,
      parentToolCallId: record.parentToolCallId,
      agentType: record.agentType,
      prompt: record.prompt,
      mode: record.mode,
      cancellationScope: record.cancellationScope,
      state: "accepted",
      now: record.createdAt,
    });
    expect(result.kind === "admitted" || result.kind === "already_applied").toBe(true);
  });

const terminal = (overrides: Record<string, unknown> = {}) => ({
  executionId: "exec_t12_1",
  attemptId: "att_t12_1",
  generation: 1,
  state: "succeeded" as const,
  occurredAt: "2026-08-19T00:01:00.000Z",
  summary: "Agent completed: result summary text.",
  ...overrides,
});

let artifactDir: string;

beforeAll(async () => {
  artifactDir = await mkdtemp(join(tmpdir(), "synara-t12-boundary-"));
});

afterAll(async () => {
  await rm(artifactDir, { recursive: true, force: true });
});

const transcriptLines = (count: number): string =>
  Array.from({ length: count }, (_, i) =>
    JSON.stringify({
      isSidechain: true,
      agentId: "agent-t12",
      type: "assistant",
      message: { role: "assistant", content: `transcript entry ${i}` },
      timestamp: "2026-08-19T00:00:30.000Z",
      cwd: "/w",
    }),
  ).join("\n") + "\n";

describe("Pi subagent authorized result/transcript read boundary (Issue 12)", () => {
  it("T12-AC1: an authorized read returns the bounded result with project/thread authority verified", async () => {
    const harness = makeSnapshotHarness();
    const transcriptRef = join(artifactDir, "authorized.output");
    await writeFile(transcriptRef, transcriptLines(3), "utf-8");

    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({
          repository,
          observation: terminal({ transcriptRef }),
        });

        const service = makePiSubagentExecutionReadService({
          repository,
          snapshotQuery: harness.snapshotQuery,
          summaryMaxChars: SUMMARY_MAX_CHARS,
        });

        const result = yield* service.readResult({ executionId: "exec_t12_1" });
        expect(result.observedState).toBe("succeeded");
        expect(result.terminalState).toBe("succeeded");
        expect(result.summary).toBe("Agent completed: result summary text.");
        expect(result.summaryTruncated).toBe(false);
        expect(result.transcriptRef).toBe(transcriptRef);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T12-AC2: an unknown executionId denies without leaking metadata, ref, or content", async () => {
    const harness = makeSnapshotHarness();
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());

        const service = makePiSubagentExecutionReadService({
          repository,
          snapshotQuery: harness.snapshotQuery,
          summaryMaxChars: SUMMARY_MAX_CHARS,
        });

        const denied = yield* service.readResult({ executionId: "exec_unknown" }).pipe(Effect.flip);
        expect(denied.kind).toBe("not_found");

        const deniedPage = yield* service
          .readTranscriptPage({
            executionId: "exec_unknown",
          })
          .pipe(Effect.flip);
        expect(deniedPage.kind).toBe("not_found");
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T12-AC2: a thread/project mismatch denies exactly like an unknown id", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({
          repository,
          observation: terminal({ transcriptRef: "/tmp/leak-ref.output" }),
        });

        // Thread missing from the read model.
        const missingThread = makeSnapshotHarness({});
        const missingService = makePiSubagentExecutionReadService({
          repository,
          snapshotQuery: missingThread.snapshotQuery,
          summaryMaxChars: SUMMARY_MAX_CHARS,
        });
        const missing = yield* missingService
          .readResult({ executionId: "exec_t12_1" })
          .pipe(Effect.flip);
        expect(missing.kind).toBe("denied");

        // Thread exists but under a DIFFERENT project than the execution row.
        const otherProject = makeSnapshotHarness({ th_t12: "proj_other" });
        const mismatchService = makePiSubagentExecutionReadService({
          repository,
          snapshotQuery: otherProject.snapshotQuery,
          summaryMaxChars: SUMMARY_MAX_CHARS,
        });
        const mismatch = yield* mismatchService
          .readTranscriptPage({
            executionId: "exec_t12_1",
          })
          .pipe(Effect.flip);
        expect(mismatch.kind).toBe("denied");
        if (mismatch.kind === "denied") {
          expect(mismatch.diagnosticCode).toBe("pi_subagent_read_denied");
        }
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T12-AC3: transcript reads page by cursor through the authorized boundary", async () => {
    const harness = makeSnapshotHarness();
    const transcriptRef = join(artifactDir, "paged-boundary.output");
    await writeFile(transcriptRef, transcriptLines(5), "utf-8");

    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({ repository, observation: terminal({ transcriptRef }) });

        const service = makePiSubagentExecutionReadService({
          repository,
          snapshotQuery: harness.snapshotQuery,
          summaryMaxChars: SUMMARY_MAX_CHARS,
        });

        const first = yield* service.readTranscriptPage({
          executionId: "exec_t12_1",
          limit: 2,
        });
        expect(first.entries).toHaveLength(2);
        expect(first.hasMore).toBe(true);
        expect(first.nextCursor).toBe(2);

        const second = yield* service.readTranscriptPage({
          executionId: "exec_t12_1",
          cursor: first.nextCursor!,
          limit: 2,
        });
        expect(second.entries.map((entry) => entry.content)).toEqual([
          "transcript entry 2",
          "transcript entry 3",
        ]);

        const last = yield* service.readTranscriptPage({
          executionId: "exec_t12_1",
          cursor: second.nextCursor!,
          limit: 2,
        });
        expect(last.entries).toHaveLength(1);
        expect(last.hasMore).toBe(false);
        expect(last.nextCursor).toBeNull();
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T12-AC4: a summary capped at ingest reports the truncation diagnostic with a retrievable continuation", async () => {
    const harness = makeSnapshotHarness();
    const transcriptRef = join(artifactDir, "truncated-summary.output");
    await writeFile(transcriptRef, transcriptLines(2), "utf-8");
    const cappedSummary = "y".repeat(SUMMARY_MAX_CHARS + 500);

    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({
          repository,
          observation: terminal({ transcriptRef, summary: cappedSummary }),
        });

        const service = makePiSubagentExecutionReadService({
          repository,
          snapshotQuery: harness.snapshotQuery,
          summaryMaxChars: SUMMARY_MAX_CHARS,
        });

        const result = yield* service.readResult({ executionId: "exec_t12_1" });
        expect(result.summaryTruncated).toBe(true);
        expect(result.diagnosticCode).toBe("pi_subagent_result_truncated");
        expect(result.transcriptRef).toBe(transcriptRef);

        // The continuation is retrievable through the transcript surface.
        const page = yield* service.readTranscriptPage({ executionId: "exec_t12_1" });
        expect(page.entries.length).toBeGreaterThan(0);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T12-AC7: a missing artifact reports the stable missing diagnostic without changing the outcome", async () => {
    const harness = makeSnapshotHarness();
    const transcriptRef = join(artifactDir, "expired.output");
    await writeFile(transcriptRef, transcriptLines(1), "utf-8");
    await rm(transcriptRef);

    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({
          repository,
          observation: terminal({ transcriptRef }),
        });

        const service = makePiSubagentExecutionReadService({
          repository,
          snapshotQuery: harness.snapshotQuery,
          summaryMaxChars: SUMMARY_MAX_CHARS,
        });

        const page = yield* service.readTranscriptPage({ executionId: "exec_t12_1" });
        expect(page.entries).toHaveLength(0);
        expect(page.diagnosticCode).toBe("pi_subagent_transcript_missing");
        expect(page.hasMore).toBe(false);

        // The durable outcome is unchanged by the unavailable evidence.
        const execution = yield* repository.getById("exec_t12_1");
        expect(Option.getOrNull(execution)?.observedState).toBe("succeeded");
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T12-AC7: corrupt artifact lines degrade the read with a stable diagnostic", async () => {
    const harness = makeSnapshotHarness();
    const transcriptRef = join(artifactDir, "corrupt-boundary.output");
    await writeFile(
      transcriptRef,
      ["{broken json", transcriptLines(1).trim()].join("\n") + "\n",
      "utf-8",
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({
          repository,
          observation: terminal({ transcriptRef }),
        });

        const service = makePiSubagentExecutionReadService({
          repository,
          snapshotQuery: harness.snapshotQuery,
          summaryMaxChars: SUMMARY_MAX_CHARS,
        });

        const page = yield* service.readTranscriptPage({ executionId: "exec_t12_1" });
        expect(page.entries).toHaveLength(1);
        expect(page.skippedCorruptEntries).toBe(1);
        expect(page.diagnosticCode).toBe("pi_subagent_transcript_corrupt");
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T12-AC6: an available transcript never reinterprets state; an orphaned read stays orphaned", async () => {
    const harness = makeSnapshotHarness();
    const orphanedRef = join(artifactDir, "orphaned.output");
    await writeFile(orphanedRef, transcriptLines(2), "utf-8");
    const succeededRef = join(artifactDir, "succeeded.output");
    await writeFile(succeededRef, transcriptLines(2), "utf-8");

    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        // An orphaned execution: restart reconciliation with no live owner
        // settles it orphaned. Its transcript artifact exists on disk, but the
        // extension only reports the reference at terminal — so the durable
        // evidence has no ref and the read must report the stable missing
        // diagnostic WITHOUT claiming the child is running or changing state.
        yield* admit(makeExecution());
        yield* admit(
          makeExecution({
            executionId: "exec_t12_ok",
            attemptId: "att_t12_ok",
            commandId: "cmd_t12_ok",
            parentToolCallId: "call_ok",
          }),
        );
        // A terminal execution with a readable artifact: reading its
        // transcript is pure observation — availability is not liveness and
        // the state must not move.
        yield* ingestPiSubagentTerminal({
          repository,
          observation: {
            executionId: "exec_t12_ok",
            attemptId: "att_t12_ok",
            generation: 1,
            state: "succeeded",
            occurredAt: "2026-08-19T00:01:00.000Z",
            summary: "done",
            transcriptRef: succeededRef,
          },
        });
        const reconciliation = yield* reconcilePiSubagentExecutions({
          repository,
          mode: "restart",
          liveOwnerProbes: [],
          now: () => new Date("2026-08-19T01:00:00.000Z").getTime(),
        });
        expect(
          reconciliation.outcomes.some(
            (outcome) => outcome.kind === "orphaned" && outcome.executionId === "exec_t12_1",
          ),
        ).toBe(true);

        const service = makePiSubagentExecutionReadService({
          repository,
          snapshotQuery: harness.snapshotQuery,
          summaryMaxChars: SUMMARY_MAX_CHARS,
        });

        const orphanedPage = yield* service.readTranscriptPage({
          executionId: "exec_t12_1",
        });
        expect(orphanedPage.observedState).toBe("orphaned");
        expect(orphanedPage.entries).toHaveLength(0);
        expect(orphanedPage.diagnosticCode).toBe("pi_subagent_transcript_missing");

        const succeededPage = yield* service.readTranscriptPage({
          executionId: "exec_t12_ok",
        });
        expect(succeededPage.observedState).toBe("succeeded");
        expect(succeededPage.entries.length).toBeGreaterThan(0);

        const orphanedAfter = yield* repository.getById("exec_t12_1");
        expect(Option.getOrNull(orphanedAfter)?.observedState).toBe("orphaned");
        const succeededAfter = yield* repository.getById("exec_t12_ok");
        expect(Option.getOrNull(succeededAfter)?.observedState).toBe("succeeded");
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T12-AC1: a caller whose authority does not own the parent thread is denied; an owning authority may read", async () => {
    const harness = makeSnapshotHarness();
    const transcriptRef = join(artifactDir, "authority.output");
    await writeFile(transcriptRef, transcriptLines(1), "utf-8");

    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({
          repository,
          observation: terminal({ transcriptRef }),
        });

        // Simulate the production caller-authorization hook shape (the WS
        // handler wires McpSessionAuthority.resolveForThread the same way:
        // a connection holding an authority may only read executions whose
        // parent thread is bound to the SAME authority).
        const owningAuthority = "auth-owner-1";
        const makeHook =
          (connectionAuthorityId: string | null) => (_input: { readonly parentThreadId: string }) =>
            Effect.succeed(
              connectionAuthorityId !== null && connectionAuthorityId !== owningAuthority
                ? ({ kind: "denied", diagnosticCode: "pi_subagent_read_denied" } as const)
                : ({ kind: "authorized" } as const),
            );

        const ownedService = makePiSubagentExecutionReadService({
          repository,
          snapshotQuery: harness.snapshotQuery,
          summaryMaxChars: SUMMARY_MAX_CHARS,
          authorizeCaller: makeHook(owningAuthority),
        });
        const owned = yield* ownedService.readResult({ executionId: "exec_t12_1" });
        expect(owned.observedState).toBe("succeeded");

        const foreignService = makePiSubagentExecutionReadService({
          repository,
          snapshotQuery: harness.snapshotQuery,
          summaryMaxChars: SUMMARY_MAX_CHARS,
          authorizeCaller: makeHook("auth-other-2"),
        });
        const foreign = yield* foreignService
          .readTranscriptPage({
            executionId: "exec_t12_1",
          })
          .pipe(Effect.flip);
        expect(foreign.kind).toBe("denied");
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T12-AC1/AC2: WS denial mapping is stable for unknown and unauthorized reads", () => {
    const notFound = piSubagentReadDenialToWsRpcError({ kind: "not_found" });
    expect(notFound.code).toBe("PI_SUBAGENT_EXECUTION_NOT_FOUND");
    expect(notFound.retryable).toBe(false);
    expect(notFound.message).not.toContain("transcript");

    const denied = piSubagentReadDenialToWsRpcError({
      kind: "denied",
      diagnosticCode: "pi_subagent_read_denied",
    });
    expect(denied.code).toBe("PI_SUBAGENT_READ_DENIED");
    expect(denied.retryable).toBe(false);
  });
});
