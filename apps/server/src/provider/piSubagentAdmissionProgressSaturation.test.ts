import {
  type OrchestrationReadModel,
  type PiSubagentNegotiatedCapability,
  ProjectId,
  ThreadId,
  TurnId,
} from "@synara/contracts";
import { Effect, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";

import { makeMcpSessionAuthorityRegistry } from "../agentGateway/mcpSessionAuthority.ts";
import { PiSubagentExecutionRepositoryLive } from "../persistence/Layers/PiSubagentExecutionRepository.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { PiSubagentExecutionRepository } from "../persistence/Services/PiSubagentExecutionRepository.ts";
import { admitSubagentSpawn } from "./piSubagentAdmissionCoordinator.ts";
import { makePiSubagentProgressCoalescer } from "./piSubagentProgressCoalescer.ts";

const repositoryLayer = PiSubagentExecutionRepositoryLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
);

const capability: PiSubagentNegotiatedCapability = {
  status: "managed_enabled",
  diagnosticCode: "pi_subagent_managed_enabled",
  isManaged: true,
  protocolVersion: 1,
  capabilities: ["managed-spawn", "coalesced-progress", "execution-identity-routing-v1"],
  extensionVersion: "0.15.0-alfie.5",
};

const thread = {
  id: "thread_saturation" as ThreadId,
  projectId: "proj_saturation" as ProjectId,
  archivedAt: null,
  runtimeMode: "full-access" as const,
  session: {
    status: "running" as const,
    activeTurnId: "turn_saturation" as TurnId,
  },
  latestTurn: {
    id: "turn_saturation" as TurnId,
    state: "running" as const,
  },
} as unknown as OrchestrationReadModel["threads"][number];

describe("Pi subagent admission + progress saturation (Issue 13 / T13-AC6)", () => {
  it("bounds concurrent admissions and progress memory while terminal delivery stays durable", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const registry = makeMcpSessionAuthorityRegistry();
        const authority = registry.mint({
          subject: "user_saturation",
          kind: "authenticated",
          authSessionId: "auth_saturation",
          authExpiresAt: null,
        });
        const binding = registry.bindingFor(authority.authorityId, {
          threadId: "thread_saturation",
          provider: "pi",
          projectId: "proj_saturation",
          lifecycleGeneration: null,
          credentialTtlMs: 60 * 60 * 1000,
        })!;

        const admissions = yield* Effect.forEach(
          Array.from({ length: 100 }, (_, index) => index),
          (index) =>
            admitSubagentSpawn({
              command: {
                commandId: `cmd_integrated_sat_${index}`,
                projectId: "proj_saturation" as ProjectId,
                parentThreadId: "thread_saturation" as ThreadId,
                parentTurnId: "turn_saturation" as TurnId,
                parentToolCallId: `call_integrated_sat_${index}`,
                agentType: "researcher",
                prompt: `bounded saturation seed ${index}`,
                mode: "foreground",
                cancellationScope: "parent_turn",
              },
              sessionCapability: capability,
              snapshotQuery: {
                getSnapshot: () =>
                  Effect.succeed({
                    threads: [thread],
                    projects: [],
                    spaces: [],
                  } as unknown as OrchestrationReadModel),
              },
              repository,
              authorityRegistry: registry,
              trustedContext: {
                trustedThreadId: "thread_saturation" as ThreadId,
                trustedProjectId: "proj_saturation" as ProjectId,
                trustedActiveTurnId: "turn_saturation" as TurnId,
                trustedProvider: "pi",
                mcpAuthority: binding,
              },
              admissionPolicy: {
                providerConcurrency: 4,
                serverQueueCap: 64,
                projectQueueCap: 16,
              },
              now: "2026-08-18T12:00:00.000Z",
            }),
          { concurrency: "unbounded" },
        );

        const accepted = admissions.filter((result) => result.status === "accepted");
        expect(accepted).toHaveLength(4);
        expect(admissions.filter((result) => result.status === "rejected")).toHaveLength(96);
        expect(yield* repository.listNonTerminalExecutions()).toHaveLength(4);

        const target = accepted[0]!;
        const scheduled: Array<() => void> = [];
        const coalescer = makePiSubagentProgressCoalescer({
          now: () => 0,
          schedule: (_delayMs, callback) => {
            scheduled.push(callback);
            return { cancel: () => undefined };
          },
          flushIntervalMs: 500,
          idleTtlMs: 30_000,
          onFlush: (flush) =>
            Effect.runPromise(
              repository.recordProgressObservation({
                executionId: flush.executionId,
                progressJson: flush.progressJson,
                occurredAt: "2026-08-18T12:00:01.000Z",
                droppedCountDelta: flush.coalescedCount,
              }),
            ),
        });

        // Sustained progress pressure retains one latest slot for the one
        // live execution rather than one entry per observation.
        for (let index = 0; index < 5_000; index += 1) {
          yield* Effect.promise(() =>
            coalescer.recordProgress(
              target.executionId,
              JSON.stringify({ step: index, status: "running" }),
            ),
          );
          expect(coalescer.trackedExecutions()).toBe(1);
          expect(coalescer.pendingCount()).toBeLessThanOrEqual(1);
        }
        expect(scheduled.length).toBeLessThanOrEqual(2);

        // Terminal truth bypasses progress coalescing and atomically creates
        // the completion outbox entry even while a trailing snapshot waits.
        const terminal = yield* repository.recordTerminalEvent({
          executionId: target.executionId,
          attemptId: target.attemptId,
          generation: target.generation,
          sequence: 40,
          state: "succeeded",
          occurredAt: "2026-08-18T12:00:02.000Z",
          summary: "terminal survives admission and progress saturation",
        });
        expect(terminal.kind).toBe("recorded");

        yield* Effect.promise(() => coalescer.dispose(target.executionId));
        expect(coalescer.trackedExecutions()).toBe(0);
        expect(coalescer.pendingCount()).toBe(0);

        const stored = yield* repository.getById(target.executionId);
        expect(Option.isSome(stored)).toBe(true);
        if (Option.isSome(stored)) {
          expect(stored.value.observedState).toBe("succeeded");
        }
        const outboxId = `outbox_${target.executionId}_${target.attemptId}_gen${target.generation}`;
        const outbox = yield* repository.getCompletionOutboxEntry(outboxId);
        expect(Option.isSome(outbox)).toBe(true);
        if (Option.isSome(outbox)) {
          expect(outbox.value.deliveryState).toBe("pending");
          expect(outbox.value.terminalState).toBe("succeeded");
        }
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });
});
