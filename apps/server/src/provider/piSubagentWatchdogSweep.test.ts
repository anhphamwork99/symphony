import { it } from "@effect/vitest";
import { describe, expect } from "vitest";
import { Effect, Layer } from "effect";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { PiSubagentExecutionRepository } from "../persistence/Services/PiSubagentExecutionRepository.ts";
import { PiSubagentExecutionRepositoryLive } from "../persistence/Layers/PiSubagentExecutionRepository.ts";
import { sweepPiSubagentWallTimeExpiry } from "./piSubagentWallTimeSweep.ts";
import {
  startPiSubagentWatchdogSweep,
  sweepPiSubagentWatchdogEscalation,
} from "./piSubagentWatchdogSweep.ts";
import type { PiSubagentExtensionBridge } from "./piSubagentBridge.ts";

/**
 * Ticket 15 — Watchdog escalation sweep driver (Testing Seam: server
 * orchestration/process integration boundary with controllable child,
 * provider-turn, and provider-session fixtures; wall-time and
 * operator-observation boundary from ticket 13).
 */

const repositoryLayer = PiSubagentExecutionRepositoryLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
);

// 2026-08-18T12:00:00.000Z — three hours after the 09:00 admission, so the
// 2h wall-time budget has elapsed at the injected clock.
const NOW = 1_787_054_400_000;

const baseAdmission = {
  executionId: "exec_wds_1",
  attemptId: "att_wds_1",
  generation: 1,
  commandId: "cmd_wds_1",
  commandFingerprint: "fp_wds",
  clientCommandId: null,
  subject: "user_wds",
  projectId: "proj_default",
  parentThreadId: "thread_wds",
  parentTurnId: "turn_wds",
  parentToolCallId: null,
  agentType: "general-purpose",
  prompt: "watchdog sweep seed",
  mode: "background" as const,
  cancellationScope: "parent_turn" as const,
  state: "accepted" as const,
  diagnosticCode: "pi_subagent_managed_enabled" as const,
};

const makeBridge = (cancelStatus: "cancelled" | "missing"): PiSubagentExtensionBridge => ({
  handshake: () => ({
    ok: true,
    protocolVersion: 1,
    extensionVersion: "test",
    capabilities: ["managed-spawn", "abort-propagation", "durable-cancellation"],
  }),
  cancel: () => ({
    status: cancelStatus,
    executionId: baseAdmission.executionId,
    attemptId: baseAdmission.attemptId,
    generation: 1,
  }),
  getActiveExecutions: () => [
    {
      executionId: baseAdmission.executionId,
      attemptId: baseAdmission.attemptId,
      generation: 1,
      mode: "background",
      cancellationScope: "parent_turn",
      isRunning: true,
    },
  ],
});

describe("sweepPiSubagentWatchdogEscalation (Issue 15 driver)", () => {
  it.layer(repositoryLayer)(
    "dispatches the escalation chain for an expired execution and reports safe outcome metadata",
    (it) => {
      it.effect("escalates wall-time-expired execution through stage controls", () =>
        Effect.gen(function* () {
          const repository = yield* PiSubagentExecutionRepository;
          yield* repository.recordAdmission({
            ...baseAdmission,
            now: "2026-08-18T09:00:00.000Z",
          });
          yield* Effect.promise(() =>
            sweepPiSubagentWallTimeExpiry({
              repository,
              wallTimeMs: 7200000,
              nowMs: () => NOW,
            }),
          );

          const interrupts: string[] = [];
          const stops: string[] = [];
          const outcomes: Array<{ trigger: string; outcomeKind: string }> = [];

          const result = yield* Effect.promise(() =>
            sweepPiSubagentWatchdogEscalation({
              repository,
              resolveBridge: () => makeBridge("missing"),
              isOwnerGenerationDead: () => false,
              interruptProviderTurn: async (threadId) => {
                interrupts.push(threadId);
              },
              stopProviderSession: async (threadId) => {
                stops.push(threadId);
                return "stopped" as const;
              },
              stageTimeoutMs: 100,
              cancelRetryLimit: 0,
              leaseDurationMs: 30000,
              idleAfterMs: 60000,
              now: () => NOW,
              onEscalation: (escalation) => {
                outcomes.push({ trigger: escalation.trigger, outcomeKind: escalation.outcomeKind });
              },
            }),
          );

          expect(result.escalated).toBe(1);
          expect(interrupts).toEqual(["thread_wds"]);
          expect(stops).toEqual(["thread_wds"]);
          expect(outcomes).toEqual([{ trigger: "wall_time", outcomeKind: "cleanup_uncertain" }]);
        }),
      );
    },
  );

  it.layer(repositoryLayer)("runs nothing when no executions are watchdog-eligible", (it) => {
    it.effect("fresh heartbeat stays untouched", () =>
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* repository.recordAdmission({
          ...baseAdmission,
          now: new Date(NOW - 60_000).toISOString(),
        });
        yield* repository.recordHeartbeatObservation({
          executionId: baseAdmission.executionId,
          occurredAt: new Date(NOW - 30_000).toISOString(),
          leaseExpiresAt: new Date(NOW + 30_000).toISOString(),
        });

        const interrupts: string[] = [];
        const stops: string[] = [];
        const result = yield* Effect.promise(() =>
          sweepPiSubagentWatchdogEscalation({
            repository,
            resolveBridge: () => makeBridge("cancelled"),
            isOwnerGenerationDead: () => false,
            interruptProviderTurn: async (threadId) => {
              interrupts.push(threadId);
            },
            stopProviderSession: async (threadId) => {
              stops.push(threadId);
              return "stopped" as const;
            },
            stageTimeoutMs: 100,
            cancelRetryLimit: 0,
            leaseDurationMs: 30000,
            idleAfterMs: 60000,
            now: () => NOW,
          }),
        );

        expect(result.escalated).toBe(0);
        expect(interrupts).toHaveLength(0);
        expect(stops).toHaveLength(0);
      }),
    );
  });
});

describe("sweepPiSubagentWatchdogEscalation operator observation (Issue 15 / T15-AC7)", () => {
  it.layer(repositoryLayer)(
    "forwards stable diagnostics and safe escalation outcomes to the operator observers",
    (it) => {
      it.effect("diagnostic + escalation observers receive safe metadata", () =>
        Effect.gen(function* () {
          const repository = yield* PiSubagentExecutionRepository;
          yield* repository.recordAdmission({
            ...baseAdmission,
            now: "2026-08-18T09:00:00.000Z",
          });
          yield* Effect.promise(() =>
            sweepPiSubagentWallTimeExpiry({
              repository,
              wallTimeMs: 7200000,
              nowMs: () => NOW,
            }),
          );

          const diagnostics: Array<Record<string, unknown>> = [];
          const escalations: Array<Record<string, unknown>> = [];
          yield* Effect.promise(() =>
            sweepPiSubagentWatchdogEscalation({
              repository,
              resolveBridge: () => makeBridge("missing"),
              isOwnerGenerationDead: () => false,
              interruptProviderTurn: async () => undefined,
              stopProviderSession: async () => "uncertain" as const,
              stageTimeoutMs: 100,
              cancelRetryLimit: 0,
              leaseDurationMs: 30000,
              idleAfterMs: 60000,
              now: () => NOW,
              onDiagnostic: (event) => {
                diagnostics.push({ ...event });
              },
              onEscalation: (escalation) => {
                escalations.push({ ...escalation });
              },
            }),
          );

          // AC1 entry diagnostic reaches the operator surface with safe
          // correlation identity only.
          expect(
            diagnostics.some(
              (event) =>
                event.diagnosticCode === "pi_subagent_watchdog_walltime_escalation" &&
                event.executionId === baseAdmission.executionId &&
                event.attemptId === baseAdmission.attemptId &&
                event.parentThreadId === baseAdmission.parentThreadId,
            ),
          ).toBe(true);
          // Escalation outcome observation carries fixed metadata only.
          expect(escalations).toEqual([
            {
              executionId: baseAdmission.executionId,
              attemptId: baseAdmission.attemptId,
              generation: 1,
              parentThreadId: baseAdmission.parentThreadId,
              trigger: "wall_time",
              outcomeKind: "cleanup_uncertain",
            },
          ]);
        }),
      );
    },
  );
});

describe("startPiSubagentWatchdogSweep timer (Issue 15 driver)", () => {
  it.layer(repositoryLayer)("drives periodic passes through the injected scheduler", (it) => {
    it.effect("timer schedules and reschedules passes", () =>
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* repository.recordAdmission({
          ...baseAdmission,
          now: "2026-08-18T09:00:00.000Z",
        });
        yield* Effect.promise(() =>
          sweepPiSubagentWallTimeExpiry({
            repository,
            wallTimeMs: 7200000,
            nowMs: () => NOW,
          }),
        );

        const fired: number[] = [];
        const timers: Array<() => void> = [];
        const stops: string[] = [];
        const timer = startPiSubagentWatchdogSweep({
          repository,
          resolveBridge: () => makeBridge("cancelled"),
          isOwnerGenerationDead: () => false,
          interruptProviderTurn: async () => undefined,
          stopProviderSession: async (threadId) => {
            stops.push(threadId);
            return "stopped" as const;
          },
          stageTimeoutMs: 50,
          cancelRetryLimit: 0,
          leaseDurationMs: 30000,
          idleAfterMs: 60000,
          now: () => NOW,
          intervalMs: 100,
          schedule: (_delayMs, callback) => {
            const id = fired.length;
            fired.push(id);
            timers.push(callback);
            return { cancel: () => undefined };
          },
        });

        try {
          expect(fired).toHaveLength(1);
          // Drive the scheduled tick manually; the ack path (cancelled)
          // settles the execution without any stage dispatch. The wait uses
          // a REAL timer: @effect/vitest effects run on the TestClock, and
          // the sweep's background promise is outside Effect scheduling.
          timers[0]!();
          yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));
          expect(stops).toHaveLength(0);
          // Rescheduled after the pass completed.
          expect(fired.length).toBeGreaterThanOrEqual(2);
        } finally {
          timer.stop();
        }
      }),
    );
  });
});
